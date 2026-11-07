//! The `@yaakapp-internal/query` exports.
//!
//! JavaScript counts string positions in UTF-16 code units, so every span going out is
//! converted from bytes, and the cursor coming in is converted to bytes.

use crate::{Document, Node, Schema, Span};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

/// Byte offset to UTF-16 offset, and back, for one input.
struct Offsets {
    /// `utf16[i]` is the UTF-16 offset of byte `i`, for every char boundary and the end.
    utf16: Vec<u32>,
}

impl Offsets {
    fn new(input: &str) -> Self {
        let mut utf16 = vec![0; input.len() + 1];
        let mut units = 0u32;
        for (i, c) in input.char_indices() {
            for b in 0..c.len_utf8() {
                utf16[i + b] = units;
            }
            units += c.len_utf16() as u32;
        }
        utf16[input.len()] = units;
        Self { utf16 }
    }

    fn span(&self, span: Span) -> Span {
        Span { start: self.utf16[span.start()], end: self.utf16[span.end()] }
    }

    /// The byte offset of UTF-16 offset `pos`, or of the char it falls inside.
    fn byte(&self, pos: u32) -> usize {
        self.utf16.partition_point(|&u| u < pos).min(self.utf16.len() - 1)
    }
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn from_js<T: DeserializeOwned>(value: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// The parsed tree (`Node | null`), with UTF-16 spans.
#[wasm_bindgen]
pub fn parse_query(input: &str) -> Result<JsValue, JsValue> {
    let offsets = Offsets::new(input);
    let mut root = crate::parse(input);
    if let Some(root) = &mut root {
        root.map_spans(&|s| offsets.span(s));
    }
    to_js(&root)
}

/// Highlighting spans (`Token[]`), in UTF-16 offsets.
#[wasm_bindgen]
pub fn query_tokens(input: &str) -> Result<JsValue, JsValue> {
    let offsets = Offsets::new(input);
    let mut tokens = crate::tokens(input);
    for token in &mut tokens {
        token.span = offsets.span(token.span);
    }
    to_js(&tokens)
}

/// `Completions | null` at UTF-16 offset `cursor`. `values` maps field paths to the values seen
/// for them (`Record<string, string[]>`).
#[wasm_bindgen]
pub fn query_completions(
    input: &str,
    cursor: u32,
    schema: JsValue,
    values: JsValue,
) -> Result<JsValue, JsValue> {
    let schema: Schema = from_js(schema)?;
    let values: HashMap<String, Vec<String>> =
        if values.is_undefined() || values.is_null() { HashMap::new() } else { from_js(values)? };
    let offsets = Offsets::new(input);
    let mut result = crate::completions(input, offsets.byte(cursor), &schema, &values);
    if let Some(result) = &mut result {
        result.span = offsets.span(result.span);
    }
    to_js(&result)
}

/// The terms the schema cannot run (`Diagnostic[]`), with UTF-16 spans.
#[wasm_bindgen]
pub fn query_diagnostics(input: &str, schema: JsValue) -> Result<JsValue, JsValue> {
    let schema: Schema = from_js(schema)?;
    let offsets = Offsets::new(input);
    let mut diagnostics =
        crate::parse(input).map(|root| schema.diagnostics(&root)).unwrap_or_default();
    for diagnostic in &mut diagnostics {
        match diagnostic {
            crate::Diagnostic::UnknownField { span, .. }
            | crate::Diagnostic::InvalidValue { span, .. } => *span = offsets.span(*span),
        }
    }
    to_js(&diagnostics)
}

#[wasm_bindgen]
pub fn query_format_field(field: &str, value: &str, negated: bool) -> String {
    crate::format_field(field, value, negated)
}

/// A query parsed once and matched against many documents.
#[wasm_bindgen]
pub struct QueryMatcher {
    root: Option<Node>,
    schema: Schema,
}

#[wasm_bindgen]
impl QueryMatcher {
    #[wasm_bindgen(constructor)]
    pub fn new(input: &str, schema: JsValue) -> Result<QueryMatcher, JsValue> {
        Ok(QueryMatcher { root: crate::parse(input), schema: from_js(schema)? })
    }

    /// Whether the query has no terms, so it matches everything.
    #[wasm_bindgen(getter, js_name = isEmpty)]
    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    /// Whether a `Document` (`{ text, fields }`), as JSON, matches. JSON crosses into wasm far
    /// faster than walking a JS object property by property, which matters per sidebar item.
    pub fn matches(&self, doc_json: &str) -> Result<bool, JsValue> {
        let doc: Document =
            serde_json::from_str(doc_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(crate::evaluate(self.root.as_ref(), &self.schema, &doc))
    }
}
