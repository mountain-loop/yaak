//! What a consumer's fields are, and how its bare words match.

use crate::ast::{FieldValue, Node, NumberLiteral, Span};
use crate::lexer::parse_number;
use serde::{Deserialize, Serialize};

/// A consumer's searchable fields.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Schema {
    pub fields: Vec<FieldDef>,
    /// Substring when left out.
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<FreeText>"))]
    pub free_text: FreeText,
}

/// How a bare word matches the document's free text. A quoted phrase is always a substring.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum FreeText {
    /// A substring, falling back to word-prefix matching (`mr` finds "My Request"), as
    /// fuzzbunny does.
    Fuzzy,
    /// A case-insensitive substring.
    #[default]
    Substring,
}

/// One field: `@name:value`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct FieldDef {
    /// The field's path, dotted when nested: `method`, `req.header`.
    pub name: String,
    pub kind: FieldKind,
    /// A map of named values, such as headers: `@header.<key>:value` is valid for any key, and
    /// the key is matched against the document's keys (case-insensitively).
    #[serde(default)]
    #[cfg_attr(test, ts(optional, as = "Option<bool>"))]
    pub map: bool,
    /// A short note shown with the field in completions.
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub info: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum FieldKind {
    Text,
    /// A number, with the units a comparison or range may be written in. A number written
    /// without a unit is in the field's base unit.
    Number {
        #[serde(default)]
        units: Vec<Unit>,
    },
    /// True or false: `@name:true`, `@name:false`, and `@name:*` for true.
    Flag,
}

/// A unit a number may be written in, and how many of the field's base unit it is worth:
/// `{ name: "s", factor: 1000 }` for a field counted in milliseconds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Unit {
    pub name: String,
    pub factor: f64,
}

/// A field path resolved against the schema.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedField<'a> {
    pub def: &'a FieldDef,
    /// The key under a map field: `x-cache` for `@header.x-cache`. `None` for the map field
    /// itself (`@header:...`, which matches any key) and for plain fields.
    pub key: Option<String>,
}

impl ResolvedField<'_> {
    /// The lowercase dotted path a document stores this field's values under.
    pub fn document_path(&self) -> String {
        match &self.key {
            Some(key) => format!("{}.{}", self.def.name.to_lowercase(), key.to_lowercase()),
            None => self.def.name.to_lowercase(),
        }
    }
}

/// Something in a query the schema does not accept. The query still parses and runs; the
/// offending term matches nothing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum Diagnostic {
    /// No field has this path. `span` covers `@path:`.
    UnknownField { path: String, span: Span },
    /// The value cannot apply to this field: a unit the field does not take, a number for a
    /// text-only flag, and so on. `span` covers the value.
    InvalidValue { path: String, span: Span },
}

impl Schema {
    pub fn new(fields: Vec<FieldDef>, free_text: FreeText) -> Self {
        Self { fields, free_text }
    }

    /// Finds the field a path names, case-insensitively. A path under a map field resolves to
    /// that field with the rest of the path as the key; the longest matching map wins.
    pub fn resolve(&self, path: &[String]) -> Option<ResolvedField<'_>> {
        let joined = path.join(".").to_lowercase();
        if let Some(def) = self.fields.iter().find(|f| f.name.to_lowercase() == joined) {
            return Some(ResolvedField { def, key: None });
        }
        self.fields
            .iter()
            .filter(|f| f.map)
            .filter_map(|f| {
                let name = f.name.to_lowercase();
                let key = joined.strip_prefix(&name)?.strip_prefix('.')?;
                (!key.is_empty()).then_some((name.len(), f, key))
            })
            .max_by_key(|(len, ..)| *len)
            .map(|(_, def, key)| ResolvedField { def, key: Some(key.to_string()) })
    }

    /// The terms in a query this schema cannot run, for the UI to mark.
    pub fn diagnostics(&self, root: &Node) -> Vec<Diagnostic> {
        let mut out = Vec::new();
        root.walk(&mut |node| {
            let Node::Field { path, value, path_span, value_span, .. } = node else {
                return;
            };
            let joined = path.join(".");
            match self.resolve(path) {
                None => out.push(Diagnostic::UnknownField { path: joined, span: *path_span }),
                Some(field) => {
                    if !value_fits(&field.def.kind, value) {
                        out.push(Diagnostic::InvalidValue { path: joined, span: *value_span });
                    }
                }
            }
        });
        out
    }
}

/// Whether a value can mean anything for a field of this kind.
fn value_fits(kind: &FieldKind, value: &FieldValue) -> bool {
    match (kind, value) {
        (FieldKind::Number { units }, FieldValue::Compare { number, .. }) => {
            to_base(number, units).is_some()
        }
        (FieldKind::Number { units }, FieldValue::Range { low, high }) => {
            to_base(low, units).is_some() && to_base(high, units).is_some()
        }
        // A bare number is equality, so its unit has to be one the field takes
        (FieldKind::Number { units }, FieldValue::Text { text, quoted: false }) => {
            parse_number(text).is_none_or(|number| to_base(&number, units).is_some())
        }
        // Text holding numbers compares them as plain numbers, without units
        (FieldKind::Text, FieldValue::Compare { number, .. }) => number.unit.is_none(),
        (FieldKind::Text, FieldValue::Range { low, high }) => {
            low.unit.is_none() && high.unit.is_none()
        }
        (FieldKind::Flag, FieldValue::Text { text, .. }) => {
            text.is_empty() || parse_flag(text).is_some()
        }
        (FieldKind::Flag, FieldValue::Exists) => true,
        (FieldKind::Flag, _) => false,
        _ => true,
    }
}

/// A number in the field's base unit, or `None` when its unit is not one the field takes.
pub(crate) fn to_base(number: &NumberLiteral, units: &[Unit]) -> Option<f64> {
    match &number.unit {
        None => Some(number.value),
        Some(unit) => units
            .iter()
            .find(|u| u.name.eq_ignore_ascii_case(unit))
            .map(|u| number.value * u.factor),
    }
}

pub(crate) fn parse_flag(text: &str) -> Option<bool> {
    match text.to_lowercase().as_str() {
        "true" | "yes" | "1" => Some(true),
        "false" | "no" | "0" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;

    fn field(name: &str, kind: FieldKind, map: bool) -> FieldDef {
        FieldDef { name: name.to_string(), kind, map, info: None }
    }

    fn schema() -> Schema {
        Schema::new(
            vec![
                field("url", FieldKind::Text, false),
                field("header", FieldKind::Text, true),
                field("req.header", FieldKind::Text, true),
                field(
                    "duration",
                    FieldKind::Number { units: vec![Unit { name: "s".into(), factor: 1000.0 }] },
                    false,
                ),
                field("error", FieldKind::Flag, false),
            ],
            FreeText::Substring,
        )
    }

    fn path(p: &str) -> Vec<String> {
        p.split('.').map(String::from).collect()
    }

    #[test]
    fn resolves_plain_and_map_fields() {
        let s = schema();
        assert_eq!(s.resolve(&path("URL")).unwrap().def.name, "url");
        assert_eq!(s.resolve(&path("url")).unwrap().key, None);

        let h = s.resolve(&path("header.X-Cache")).unwrap();
        assert_eq!(h.def.name, "header");
        assert_eq!(h.key.as_deref(), Some("x-cache"));
        assert_eq!(h.document_path(), "header.x-cache");

        let r = s.resolve(&path("req.header.accept")).unwrap();
        assert_eq!(r.def.name, "req.header");
        assert_eq!(r.key.as_deref(), Some("accept"));

        // The map itself, with no key
        assert_eq!(s.resolve(&path("header")).unwrap().key, None);

        assert!(s.resolve(&path("nope")).is_none());
        assert!(s.resolve(&path("url.x")).is_none());
        assert!(s.resolve(&path("req")).is_none());
    }

    #[test]
    fn reports_unknown_fields_and_bad_values() {
        let s = schema();
        let input = "@nope:x @url:y @duration:>5m @duration:>5s @error:maybe @error:true";
        let diagnostics = s.diagnostics(&parse(input).unwrap());
        assert_eq!(
            diagnostics,
            vec![
                Diagnostic::UnknownField { path: "nope".into(), span: Span::new(0, 6) },
                Diagnostic::InvalidValue { path: "duration".into(), span: Span::new(25, 28) },
                Diagnostic::InvalidValue { path: "error".into(), span: Span::new(50, 55) },
            ]
        );
    }

    /// Diagnostics flag exactly the unit mistakes the evaluator rejects.
    #[test]
    fn reports_units_the_evaluator_rejects() {
        let s = schema();
        let invalid = |input: &str| !s.diagnostics(&parse(input).unwrap()).is_empty();
        assert!(invalid("@duration:1m"));
        assert!(invalid("@duration:[1m TO 2s]"));
        assert!(invalid("@url:>1s"));
        assert!(invalid("@url:[1 TO 2s]"));
        assert!(!invalid("@duration:1s"));
        assert!(!invalid("@duration:1500"));
        assert!(!invalid("@duration:abc"));
        assert!(!invalid("@duration:\"1m\""));
        assert!(!invalid("@url:>1"));
        assert!(!invalid("@url:1m"));
    }

    #[test]
    fn deserializes_from_json() {
        let s: Schema = serde_json::from_str(
            r#"{
                "fields": [
                    { "name": "method", "kind": { "type": "text" } },
                    { "name": "header", "kind": { "type": "text" }, "map": true },
                    { "name": "size", "kind": { "type": "number", "units": [{ "name": "kb", "factor": 1024 }] } },
                    { "name": "error", "kind": { "type": "flag" }, "info": "Failed" }
                ],
                "freeText": "fuzzy"
            }"#,
        )
        .unwrap();
        assert_eq!(s.free_text, FreeText::Fuzzy);
        assert!(s.fields[1].map);
        assert_eq!(s.fields[3].info.as_deref(), Some("Failed"));
    }
}
