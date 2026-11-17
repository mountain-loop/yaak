//! Builds the [`Node`] tree from tokens.
//!
//! Precedence, tightest first: `-`, then AND (implicit or written), then `OR`. The parser is
//! forgiving and never fails: a stray `)` or a dangling `OR`, `AND` or `-` is ignored, an
//! unclosed `(` closes at the end, and an empty group is dropped. Groups and negations nest
//! at most [`MAX_DEPTH`] deep; past that, `(` and `-` are ignored, so pathological input can't
//! exhaust the stack (the WebAssembly build has a small one).

use crate::ast::{Node, Span};
use crate::lexer::{Tok, TokKind, lex};

/// How deep groups and negations may nest, together.
pub const MAX_DEPTH: usize = 32;

/// Parses a query. `None` when it has no terms (empty, only whitespace, or only operators).
pub fn parse(input: &str) -> Option<Node> {
    let toks = lex(input);
    let mut parser = Parser { toks: &toks, i: 0 };
    let mut parts = Vec::new();
    // A `)` with no group to close ends parse_or early; skip it and carry on
    loop {
        if let Some(node) = parser.parse_or(0) {
            parts.push(node);
        }
        if parser.peek().is_none() {
            break;
        }
        parser.i += 1;
    }
    join(parts, |children, span| Node::And { children, span })
}

struct Parser<'a> {
    toks: &'a [Tok],
    i: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&'a Tok> {
        self.toks.get(self.i)
    }

    fn parse_or(&mut self, depth: usize) -> Option<Node> {
        let mut parts = Vec::new();
        loop {
            if let Some(node) = self.parse_and(depth) {
                parts.push(node);
            }
            match self.peek() {
                Some(Tok { kind: TokKind::Or, .. }) => self.i += 1,
                _ => break,
            }
        }
        join(parts, |children, span| Node::Or { children, span })
    }

    fn parse_and(&mut self, depth: usize) -> Option<Node> {
        let mut parts = Vec::new();
        while let Some(tok) = self.peek() {
            match tok.kind {
                TokKind::Or | TokKind::RParen => break,
                TokKind::And => self.i += 1,
                _ => {
                    if let Some(node) = self.parse_unary(depth) {
                        parts.push(node);
                    }
                }
            }
        }
        join(parts, |children, span| Node::And { children, span })
    }

    /// Always consumes at least one token.
    fn parse_unary(&mut self, depth: usize) -> Option<Node> {
        let tok = self.peek()?;
        if tok.kind != TokKind::Minus {
            return self.parse_primary(depth);
        }
        self.i += 1;
        // `-` negates only a term, group or another `-` written directly after it
        let next = self.peek().filter(|next| {
            next.span.start == tok.span.end
                && !matches!(next.kind, TokKind::RParen | TokKind::Or | TokKind::And)
        });
        if next.is_none() || depth >= MAX_DEPTH {
            return None;
        }
        let node = self.parse_unary(depth + 1)?;
        let span = tok.span.to(node.span());
        Some(Node::Not { node: Box::new(node), span })
    }

    /// Always consumes at least one token.
    fn parse_primary(&mut self, depth: usize) -> Option<Node> {
        let tok = self.peek()?;
        self.i += 1;
        match &tok.kind {
            TokKind::Word(text) => Some(Node::Term { text: text.clone(), span: tok.span }),
            TokKind::Phrase { text } => Some(Node::Phrase { text: text.clone(), span: tok.span }),
            TokKind::Field { path, path_span, value, value_span } => Some(Node::Field {
                path: path.clone(),
                value: value.clone(),
                span: tok.span,
                path_span: *path_span,
                value_span: *value_span,
            }),
            // Too deep: the group's contents carry on at this level instead
            TokKind::LParen if depth >= MAX_DEPTH => None,
            TokKind::LParen => {
                let inner = self.parse_or(depth + 1);
                if let Some(Tok { kind: TokKind::RParen, .. }) = self.peek() {
                    self.i += 1;
                }
                inner
            }
            // Operators are handled by the callers; reaching one here means it is out of place
            TokKind::Minus | TokKind::Or | TokKind::And | TokKind::RParen => None,
        }
    }
}

/// One node stays itself; several are joined by `make` with a span covering them all.
fn join(mut parts: Vec<Node>, make: impl Fn(Vec<Node>, Span) -> Node) -> Option<Node> {
    match parts.len() {
        0 => None,
        1 => parts.pop(),
        _ => {
            let span = parts[0].span().to(parts[parts.len() - 1].span());
            Some(make(parts, span))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{CompareOp, FieldValue};

    /// A compact rendering of the tree, to keep the tests readable.
    fn show(input: &str) -> String {
        fn go(node: &Node) -> String {
            match node {
                Node::And { children, .. } => {
                    format!("(and {})", children.iter().map(go).collect::<Vec<_>>().join(" "))
                }
                Node::Or { children, .. } => {
                    format!("(or {})", children.iter().map(go).collect::<Vec<_>>().join(" "))
                }
                Node::Not { node, .. } => format!("(not {})", go(node)),
                Node::Term { text, .. } => text.clone(),
                Node::Phrase { text, .. } => format!("{text:?}"),
                Node::Field { path, value, .. } => {
                    let value = match value {
                        FieldValue::Text { text, quoted: false } => text.clone(),
                        FieldValue::Text { text, quoted: true } => format!("{text:?}"),
                        FieldValue::Wildcard { pattern } => format!("wild({pattern})"),
                        FieldValue::Exists => "exists".to_string(),
                        FieldValue::Compare { op, number } => {
                            format!("{}{}", op.as_str(), number.raw)
                        }
                        FieldValue::Range { low, high } => format!("[{} TO {}]", low.raw, high.raw),
                    };
                    format!("@{}={}", path.join("."), value)
                }
            }
        }
        parse(input).map_or("none".to_string(), |n| go(&n))
    }

    #[test]
    fn empty() {
        assert_eq!(show(""), "none");
        assert_eq!(show("   "), "none");
        assert_eq!(show("OR AND"), "none");
        assert_eq!(show("()"), "none");
        assert_eq!(show("-"), "none");
        assert_eq!(show(")"), "none");
    }

    #[test]
    fn terms_and_phrases() {
        assert_eq!(show("foo"), "foo");
        assert_eq!(show("foo bar"), "(and foo bar)");
        assert_eq!(show("\"hi there\""), "\"hi there\"");
        assert_eq!(show("\"hi there"), "\"hi there\"");
        assert_eq!(show("a\"b c\"d"), "(and a \"b c\" d)");
        assert_eq!(show(r#""say \"hi\"""#), r#""say \"hi\"""#);
    }

    #[test]
    fn boolean_operators() {
        assert_eq!(show("a OR b"), "(or a b)");
        assert_eq!(show("a AND b"), "(and a b)");
        assert_eq!(show("a b OR c"), "(or (and a b) c)");
        assert_eq!(show("a OR b c"), "(or a (and b c))");
        assert_eq!(show("a OR b OR c"), "(or a b c)");
        // Case-sensitive, as Datadog: lowercase is a word
        assert_eq!(show("a or b"), "(and a or b)");
        assert_eq!(show("a and b"), "(and a and b)");
        // NOT is not a keyword
        assert_eq!(show("NOT a"), "(and NOT a)");
    }

    #[test]
    fn dangling_operators_are_ignored() {
        assert_eq!(show("a OR"), "a");
        assert_eq!(show("OR a"), "a");
        assert_eq!(show("a OR OR b"), "(or a b)");
        assert_eq!(show("a AND"), "a");
        assert_eq!(show("a -"), "a");
        assert_eq!(show("- a"), "a");
        assert_eq!(show("(a -)"), "a");
    }

    #[test]
    fn groups() {
        assert_eq!(show("(a OR b) -c"), "(and (or a b) (not c))");
        assert_eq!(show("-(a OR b)"), "(not (or a b))");
        assert_eq!(show("(a OR b"), "(or a b)");
        assert_eq!(show("a) b"), "(and a b)");
        assert_eq!(show("((a))"), "a");
        assert_eq!(show("x (a (b OR c))"), "(and x (and a (or b c)))");
    }

    #[test]
    fn negation() {
        assert_eq!(show("-foo"), "(not foo)");
        assert_eq!(show("--foo"), "(not (not foo))");
        assert_eq!(show("-\"a b\""), "(not \"a b\")");
        assert_eq!(show("-@type:grpc"), "(not @type=grpc)");
        assert_eq!(show("a-b"), "a-b");
        assert_eq!(show("-OR a"), "a");
    }

    #[test]
    fn fields() {
        assert_eq!(show("@method:post"), "@method=post");
        assert_eq!(show("@url:\"a b\""), "@url=\"a b\"");
        assert_eq!(show("@header.x-cache:HIT"), "@header.x-cache=HIT");
        assert_eq!(show("@req.header.content-type:json"), "@req.header.content-type=json");
        assert_eq!(show("@folder:x OR @folder:y"), "(or @folder=x @folder=y)");
        assert_eq!(show("@url:https://a.b/c?d=e"), "@url=https://a.b/c?d=e");
    }

    #[test]
    fn at_is_required() {
        assert_eq!(show("method:post"), "method:post");
        assert_eq!(show("localhost:3000"), "localhost:3000");
        assert_eq!(show("@method"), "@method");
        assert_eq!(show("@"), "@");
        assert_eq!(show("@.a:b"), "@.a:b");
        assert_eq!(show("@a.:b"), "@a.:b");
        assert_eq!(show("@a b:c"), "(and @a b:c)");
    }

    #[test]
    fn trailing_field_has_empty_value() {
        assert_eq!(show("@method:"), "@method=");
        assert_eq!(show("@method: post"), "(and @method= post)");
        assert_eq!(show("(@method:)"), "@method=");
    }

    #[test]
    fn field_values() {
        assert_eq!(show("@url:-foo"), "@url=-foo");
        assert_eq!(show("@url:AND"), "@url=AND");
        assert_eq!(show("@url:a(b"), "@url=a(b");
        assert_eq!(show("(@url:a OR @url:b)"), "(or @url=a @url=b)");
        assert_eq!(show("@url:a\"b"), "@url=a\"b");
        assert_eq!(show("@url:\"a"), "@url=\"a\"");
    }

    #[test]
    fn special_values() {
        assert_eq!(show("@status:*"), "@status=exists");
        assert_eq!(show("-@status:*"), "(not @status=exists)");
        assert_eq!(show("@url:*.github.com"), "@url=wild(*.github.com)");
        assert_eq!(show("@url:\"*.github.com\""), "@url=\"*.github.com\"");
        assert_eq!(show("@status:>=400"), "@status=>=400");
        assert_eq!(show("@duration:>500ms"), "@duration=>500ms");
        assert_eq!(show("@status:<1"), "@status=<1");
        assert_eq!(show("@status:[400 TO 499]"), "@status=[400 TO 499]");
        assert_eq!(show("(@status:[400 TO 499])"), "@status=[400 TO 499]");
        // Not quite the shape: literal text or a wildcard
        assert_eq!(show("@status:>="), "@status=>=");
        assert_eq!(show("@status:>abc"), "@status=>abc");
        assert_eq!(show("@status:**"), "@status=wild(**)");
        assert_eq!(show("@status:[400"), "@status=[400");
    }

    #[test]
    fn templates_parse_sanely() {
        assert_eq!(show("@url:${[ base_url ]}"), "(and @url=${[ base_url ]})");
        assert_eq!(show("@url:[ base_url ]"), "(and @url=[ base_url ])");
        assert_eq!(show("@url:\"${[ base_url ]}/x\""), "@url=\"${[ base_url ]}/x\"");
    }

    #[test]
    fn compare_value_details() {
        let Some(Node::Field { value: FieldValue::Compare { op, number }, .. }) =
            parse("@duration:<=1.5s")
        else {
            panic!("not a comparison");
        };
        assert_eq!(op, CompareOp::Lte);
        assert_eq!(number.value, 1.5);
        assert_eq!(number.unit.as_deref(), Some("s"));
    }

    #[test]
    fn spans() {
        let input = "-@url:\"a b\" OR (c";
        let node = parse(input).unwrap();
        let Node::Or { children, span } = &node else {
            panic!()
        };
        assert_eq!(span.slice(input), input);
        let Node::Not { node: field, span } = &children[0] else {
            panic!()
        };
        assert_eq!(span.slice(input), "-@url:\"a b\"");
        let Node::Field { span, path_span, value_span, .. } = field.as_ref() else {
            panic!()
        };
        assert_eq!(span.slice(input), "@url:\"a b\"");
        assert_eq!(path_span.slice(input), "@url:");
        assert_eq!(value_span.slice(input), "\"a b\"");
        assert_eq!(children[1].span().slice(input), "c");

        let input = "@method:";
        let Some(Node::Field { value_span, .. }) = parse(input) else {
            panic!()
        };
        assert_eq!(value_span, Span::new(8, 8));
    }

    #[test]
    fn nesting_is_bounded() {
        fn depth(node: &Node) -> usize {
            match node {
                Node::And { children, .. } | Node::Or { children, .. } => {
                    children.iter().map(depth).max().unwrap_or(0) + 1
                }
                Node::Not { node, .. } => depth(node) + 1,
                _ => 1,
            }
        }
        let parens = format!("{}a OR b{}", "(".repeat(5000), ")".repeat(5000));
        let negations = format!("{}a", "-".repeat(5000));
        let mixed = format!("{}a{}", "-(".repeat(5000), ")".repeat(5000));
        for input in [parens, negations, mixed] {
            let node = parse(&input).unwrap();
            assert!(depth(&node) <= MAX_DEPTH + 2, "too deep for {:?}", &input[..10]);
        }
        // Within the limit, nesting is kept exactly
        let input = format!("{}a{}", "(".repeat(MAX_DEPTH), ")".repeat(MAX_DEPTH));
        assert_eq!(show(&input), "a");
        assert_eq!(show(&format!("{}a", "-".repeat(2))), "(not (not a))");
    }

    #[test]
    fn never_panics_on_odd_input() {
        for input in [
            "\"",
            "\\",
            "@",
            "@:",
            "@a:",
            "-",
            "--",
            "(",
            ")",
            "((",
            "))",
            "[",
            "@a:[",
            "@a:[1 TO",
            "@a:\"",
            "@a:\"\\",
            "é@ü:ö",
            "@a.b.c:",
            "@a:>",
            "@a:<=",
            "-(",
            "OR",
            "AND OR",
            "@a:)",
            "🦀 @x:🦀 \"🦀",
        ] {
            let _ = parse(input);
        }
    }
}
