//! The parsed query tree.
//!
//! Every node carries the byte span of its source text, so a consumer can highlight it, point
//! at it in a diagnostic, or rewrite it in place. A consumer that compiles queries (to SQL, say)
//! walks [`Node`] directly; nothing here depends on how the query is evaluated.

use serde::{Deserialize, Serialize};

/// A half-open byte range `start..end` in the query source.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start: start as u32, end: end as u32 }
    }

    pub fn start(&self) -> usize {
        self.start as usize
    }

    pub fn end(&self) -> usize {
        self.end as usize
    }

    /// The source text this span covers.
    pub fn slice<'a>(&self, source: &'a str) -> &'a str {
        &source[self.start()..self.end()]
    }

    pub(crate) fn to(&self, other: Span) -> Span {
        Span { start: self.start.min(other.start), end: self.end.max(other.end) }
    }
}

/// A node of the parsed query.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum Node {
    /// Every child matches: terms side by side, or joined with `AND`.
    And { children: Vec<Node>, span: Span },
    /// Any child matches: terms joined with `OR`.
    Or { children: Vec<Node>, span: Span },
    /// The node does not match: `-term`, `-(group)`, `-@field:value`.
    Not { node: Box<Node>, span: Span },
    /// A bare word, matched against the document's free text.
    Term { text: String, span: Span },
    /// A double-quoted string, matched against the free text with its spaces kept.
    Phrase { text: String, span: Span },
    /// `@path:value`.
    Field {
        /// The dotted path, one entry per identifier: `@req.header.accept` is
        /// `["req", "header", "accept"]`.
        path: Vec<String>,
        value: FieldValue,
        span: Span,
        /// `@path:`, from the `@` through the colon.
        #[serde(rename = "pathSpan")]
        path_span: Span,
        /// The value as written, quotes included. Empty (and at the end of the field) when
        /// nothing follows the colon.
        #[serde(rename = "valueSpan")]
        value_span: Span,
    },
}

impl Node {
    pub fn span(&self) -> Span {
        match self {
            Node::And { span, .. }
            | Node::Or { span, .. }
            | Node::Not { span, .. }
            | Node::Term { span, .. }
            | Node::Phrase { span, .. }
            | Node::Field { span, .. } => *span,
        }
    }

    /// Calls `f` on this node and every node below it, parents first.
    pub fn walk<'a>(&'a self, f: &mut impl FnMut(&'a Node)) {
        f(self);
        match self {
            Node::And { children, .. } | Node::Or { children, .. } => {
                for child in children {
                    child.walk(f);
                }
            }
            Node::Not { node, .. } => node.walk(f),
            Node::Term { .. } | Node::Phrase { .. } | Node::Field { .. } => {}
        }
    }

    /// Rewrites every span in the tree, for a consumer that counts positions differently (the
    /// WebAssembly package hands JavaScript UTF-16 offsets).
    pub fn map_spans(&mut self, f: &impl Fn(Span) -> Span) {
        match self {
            Node::And { children, span } | Node::Or { children, span } => {
                *span = f(*span);
                for child in children {
                    child.map_spans(f);
                }
            }
            Node::Not { node, span } => {
                *span = f(*span);
                node.map_spans(f);
            }
            Node::Term { span, .. } | Node::Phrase { span, .. } => *span = f(*span),
            Node::Field { span, path_span, value_span, .. } => {
                *span = f(*span);
                *path_span = f(*path_span);
                *value_span = f(*value_span);
            }
        }
    }
}

/// What a field term's value asks for. The shape is decided by the parser alone; the schema
/// decides what it means for a given field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum FieldValue {
    /// Plain text, matched as a case-insensitive substring. `quoted` when it was written in
    /// double quotes (escapes already removed). Empty for a trailing `@field:`.
    Text { text: String, quoted: bool },
    /// A bare value containing `*`, which must match the whole field value. `*` matches any
    /// run of characters, including none.
    Wildcard { pattern: String },
    /// `*` alone: the field has a value. Negated, it has none.
    Exists,
    /// `>`, `>=`, `<` or `<=` followed by a number.
    Compare {
        op: CompareOp,
        number: NumberLiteral,
    },
    /// `[low TO high]`, inclusive.
    Range {
        low: NumberLiteral,
        high: NumberLiteral,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum CompareOp {
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Gte,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Lte,
}

impl CompareOp {
    pub fn as_str(&self) -> &'static str {
        match self {
            CompareOp::Gt => ">",
            CompareOp::Gte => ">=",
            CompareOp::Lt => "<",
            CompareOp::Lte => "<=",
        }
    }

    pub fn test(&self, left: f64, right: f64) -> bool {
        match self {
            CompareOp::Gt => left > right,
            CompareOp::Gte => left >= right,
            CompareOp::Lt => left < right,
            CompareOp::Lte => left <= right,
        }
    }
}

/// A number as written in a comparison or range, with its unit when it has one (`500ms`,
/// `2.5mb`). The schema says which units a field accepts and what they are worth.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct NumberLiteral {
    pub value: f64,
    pub unit: Option<String>,
    /// The number as it appears in the source, unit included.
    pub raw: String,
}
