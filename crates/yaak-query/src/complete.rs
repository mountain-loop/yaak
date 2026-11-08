//! What can complete the term at the cursor.

use crate::ast::Span;
use crate::format::{format_value, is_valid_path};
use crate::lexer::{TokKind, is_ident_char, lex, lex_quoted};
use crate::schema::{FieldKind, Schema};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Completions for the term at the cursor, all replacing `span`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Completions {
    pub span: Span,
    pub items: Vec<Completion>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Completion {
    /// What to show: a field's path, or a value as it is.
    pub label: String,
    /// What replaces the span: `@method:`, `@header.`, or a value quoted when it needs to be.
    pub insert: String,
    pub kind: CompletionKind,
    pub info: Option<String>,
    /// The term is not finished after inserting (a field still needs its value, a map field its
    /// key), so completion should open again.
    pub reopen: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum CompletionKind {
    Field,
    Value,
}

/// Completions at byte offset `cursor` of `input`.
///
/// At the start of a term, or in a word made of identifier characters (with or without its
/// `@`), these are the schema's fields whose path contains what is typed, those starting with
/// it first. After `@map.` they are the keys given in `values` under the map's name. After
/// `@field:` they are the values given in `values` under the field's path that contain what is
/// typed (quotes and escapes aside); the whole value is replaced. A field written without its
/// `@` (`method:post`) gets the term with the `@`. Inside a phrase, after a `)`, or in other
/// text there are none.
pub fn completions(
    input: &str,
    cursor: usize,
    schema: &Schema,
    values: &HashMap<String, Vec<String>>,
) -> Option<Completions> {
    let mut cursor = cursor.min(input.len());
    while !input.is_char_boundary(cursor) {
        cursor -= 1;
    }

    let toks = lex(input);
    let Some(tok) = toks.iter().find(|t| t.span.start() < cursor && cursor <= t.span.end()) else {
        // Between terms: anything may start here
        let at_term_start = input[..cursor].chars().next_back().is_none_or(char::is_whitespace);
        return at_term_start
            .then(|| field_completions(schema, values, "", Span::new(cursor, cursor)))
            .flatten();
    };

    match &tok.kind {
        TokKind::Minus | TokKind::LParen if cursor == tok.span.end() => {
            field_completions(schema, values, "", Span::new(cursor, cursor))
        }
        TokKind::Word(word) => {
            let typed = &input[tok.span.start()..cursor];
            if let Some(fix) = missing_at(word, typed, schema) {
                return Some(Completions { span: tok.span, items: vec![fix] });
            }
            let partial = typed.strip_prefix('@').unwrap_or(typed);
            if !partial.chars().all(|c| is_ident_char(c) || c == '.') {
                return None;
            }
            field_completions(schema, values, partial, Span::new(tok.span.start(), cursor))
        }
        TokKind::Field { path, path_span, value_span, .. } => {
            if cursor < value_span.start() {
                // In the path: replace it through the colon
                let partial = &input[tok.span.start() + 1..cursor];
                return field_completions(schema, values, partial, *path_span);
            }
            value_completions(input, cursor, path, *value_span, schema, values)
        }
        _ => None,
    }
}

/// A word written like a field but without its `@` (`method:post`), once the cursor is past the
/// colon: the same term with the `@`, replacing the word. Words like `localhost:3000`, whose
/// part before the colon is no field, get nothing.
fn missing_at(word: &str, typed: &str, schema: &Schema) -> Option<Completion> {
    if word.starts_with('@') || !typed.contains(':') {
        return None;
    }
    let (path, value) = word.split_once(':')?;
    if !is_valid_path(path) {
        return None;
    }
    let path: Vec<String> = path.split('.').map(String::from).collect();
    schema.resolve(&path)?;
    let term = format!("@{word}");
    Some(Completion {
        label: term.clone(),
        insert: term,
        kind: CompletionKind::Field,
        info: None,
        // With no value yet, go on to the field's values
        reopen: value.is_empty(),
    })
}

fn field_completions(
    schema: &Schema,
    values: &HashMap<String, Vec<String>>,
    partial: &str,
    span: Span,
) -> Option<Completions> {
    let needle = partial.to_lowercase();
    let mut items = Vec::new();

    // Keys under a map: `@header.x-` offers `@header.x-cache:`
    if let Some((map_name, key_partial)) = needle.rsplit_once('.')
        && let Some(map) = schema.fields.iter().find(|f| f.map && f.name.to_lowercase() == map_name)
    {
        let keys = lookup(values, map_name).into_iter().flatten();
        for key in ranked(keys, key_partial) {
            let path = format!("{}.{}", map.name, key);
            if !is_valid_path(&path) {
                continue;
            }
            items.push(Completion {
                insert: format!("@{path}:"),
                label: path,
                kind: CompletionKind::Field,
                info: None,
                reopen: true,
            });
        }
    }

    for field in ranked_by(&schema.fields, &needle, |f| f.name.as_str()) {
        let insert =
            if field.map { format!("@{}.", field.name) } else { format!("@{}:", field.name) };
        items.push(Completion {
            label: field.name.clone(),
            insert,
            kind: CompletionKind::Field,
            info: field.info.clone(),
            reopen: true,
        });
    }

    (!items.is_empty()).then_some(Completions { span, items })
}

fn value_completions(
    input: &str,
    cursor: usize,
    path: &[String],
    value_span: Span,
    schema: &Schema,
    values: &HashMap<String, Vec<String>>,
) -> Option<Completions> {
    let field = schema.resolve(path)?;
    let typed = &input[value_span.start()..cursor];
    let needle = if typed.starts_with('"') { lex_quoted(typed, 0).0 } else { typed.to_string() };

    let joined = path.join(".");
    let flags = ["true".to_string(), "false".to_string()];
    let candidates: Vec<&String> = match lookup(values, &joined) {
        Some(given) => given.iter().collect(),
        None if field.def.kind == FieldKind::Flag => flags.iter().collect(),
        None => return None,
    };

    let items: Vec<Completion> = ranked(candidates, &needle.to_lowercase())
        .into_iter()
        .map(|value| Completion {
            label: value.clone(),
            insert: format_value(value),
            kind: CompletionKind::Value,
            info: None,
            reopen: false,
        })
        .collect();
    (!items.is_empty()).then_some(Completions { span: value_span, items })
}

/// The values a consumer gave for `path`, matched case-insensitively.
fn lookup<'a>(values: &'a HashMap<String, Vec<String>>, path: &str) -> Option<&'a Vec<String>> {
    values
        .get(path)
        .or_else(|| values.iter().find(|(k, _)| k.eq_ignore_ascii_case(path)).map(|(_, v)| v))
}

/// The strings containing `needle` (lowercase), those starting with it first, each once.
fn ranked<'a>(items: impl IntoIterator<Item = &'a String>, needle: &str) -> Vec<&'a String> {
    let items: Vec<&String> = items.into_iter().collect();
    let mut seen = HashSet::new();
    ranked_by(&items, needle, |s| s.as_str())
        .into_iter()
        .copied()
        .filter(|s| seen.insert(*s))
        .collect()
}

fn ranked_by<'a, T>(items: &'a [T], needle: &str, key: impl Fn(&T) -> &str) -> Vec<&'a T> {
    let lower = |item: &T| key(item).to_lowercase();
    let starts = items.iter().filter(|i| lower(i).starts_with(needle));
    let contains = items.iter().filter(|i| {
        let l = lower(i);
        !l.starts_with(needle) && l.contains(needle)
    });
    starts.chain(contains).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{FieldDef, FreeText};

    fn schema() -> Schema {
        let text = |name: &str| FieldDef {
            name: name.into(),
            kind: FieldKind::Text,
            map: false,
            info: None,
        };
        Schema::new(
            vec![
                text("method"),
                text("url"),
                text("name"),
                FieldDef { name: "header".into(), kind: FieldKind::Text, map: true, info: None },
                FieldDef { name: "error".into(), kind: FieldKind::Flag, map: false, info: None },
            ],
            FreeText::Fuzzy,
        )
    }

    fn values() -> HashMap<String, Vec<String>> {
        HashMap::from([
            (
                "method".to_string(),
                vec!["GET".to_string(), "POST".to_string(), "PATCH".to_string()],
            ),
            ("name".to_string(), vec!["My Request".to_string(), "Other".to_string()]),
            (
                "header".to_string(),
                vec![
                    "x-cache".to_string(),
                    "Accept".to_string(),
                    "bad key".to_string(),
                ],
            ),
        ])
    }

    /// The completion at the `|` in `input`: the replaced text and the inserts.
    fn at(input: &str) -> Option<(String, Vec<String>)> {
        let cursor = input.find('|').unwrap();
        let input = input.replacen('|', "", 1);
        let c = completions(&input, cursor, &schema(), &values())?;
        Some((c.span.slice(&input).to_string(), c.items.into_iter().map(|i| i.insert).collect()))
    }

    fn inserts(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn fields_at_a_term_start() {
        let all = inserts(&["@method:", "@url:", "@name:", "@header.", "@error:"]);
        assert_eq!(at("|"), Some(("".into(), all.clone())));
        assert_eq!(at("a |"), Some(("".into(), all.clone())));
        assert_eq!(at("-|"), Some(("".into(), all.clone())));
        assert_eq!(at("(|"), Some(("".into(), all)));
    }

    #[test]
    fn fields_for_a_partial_word() {
        assert_eq!(at("@met|"), Some(("@met".into(), inserts(&["@method:"]))));
        assert_eq!(at("met|"), Some(("met".into(), inserts(&["@method:"]))));
        // Starts-with first, then contains
        assert_eq!(at("@me|"), Some(("@me".into(), inserts(&["@method:", "@name:"]))));
        assert_eq!(at("-@ur|"), Some(("@ur".into(), inserts(&["@url:"]))));
        assert_eq!(at("x (@na|"), Some(("@na".into(), inserts(&["@name:"]))));
        assert_eq!(
            at("@e|"),
            Some(("@e".into(), inserts(&["@error:", "@method:", "@name:", "@header."])))
        );
        assert_eq!(at("@zz|"), None);
        assert_eq!(at("localhost:30|"), None);
    }

    #[test]
    fn map_keys() {
        assert_eq!(
            at("@header.|"),
            Some(("@header.".into(), inserts(&["@header.x-cache:", "@header.Accept:"])))
        );
        assert_eq!(
            at("@header.ac|"),
            Some(("@header.ac".into(), inserts(&["@header.Accept:", "@header.x-cache:"])))
        );
    }

    #[test]
    fn values_after_the_colon() {
        assert_eq!(at("@method:|"), Some(("".into(), inserts(&["GET", "POST", "PATCH"]))));
        assert_eq!(at("@method:p|"), Some(("p".into(), inserts(&["POST", "PATCH"]))));
        assert_eq!(at("@method:t|"), Some(("t".into(), inserts(&["GET", "POST", "PATCH"]))));
        assert_eq!(at("@name:my|"), Some(("my".into(), inserts(&["\"My Request\""]))));
        assert_eq!(at("@name:\"my r|"), Some(("\"my r".into(), inserts(&["\"My Request\""]))));
        // The whole value is replaced, even past the cursor
        assert_eq!(at("@method:p|os x"), Some(("pos".into(), inserts(&["POST", "PATCH"]))));
        assert_eq!(at("@method:zz|"), None);
        // Fields with no values given offer none, unknown fields neither
        assert_eq!(at("@url:|"), None);
        assert_eq!(at("@nope:|"), None);
        // Flags offer true and false
        assert_eq!(at("@error:|"), Some(("".into(), inserts(&["true", "false"]))));
    }

    #[test]
    fn editing_a_field_name() {
        assert_eq!(at("@met|hod:post"), Some(("@method:".into(), inserts(&["@method:"]))));
    }

    #[test]
    fn suggests_the_at_for_a_field_written_without_it() {
        assert_eq!(at("method:post|"), Some(("method:post".into(), inserts(&["@method:post"]))));
        assert_eq!(at("x method:p|"), Some(("method:p".into(), inserts(&["@method:p"]))));
        assert_eq!(at("-method:po|st"), Some(("method:post".into(), inserts(&["@method:post"]))));
        assert_eq!(at("(METHOD:get|"), Some(("METHOD:get".into(), inserts(&["@METHOD:get"]))));
        assert_eq!(
            at("header.accept:json|"),
            Some(("header.accept:json".into(), inserts(&["@header.accept:json"])))
        );
        // With nothing after the colon, the field's values come next
        let c = completions("method:", 7, &schema(), &values()).unwrap();
        assert_eq!(c.items[0].insert, "@method:");
        assert!(c.items[0].reopen);
        assert!(!completions("method:x", 8, &schema(), &values()).unwrap().items[0].reopen);
        // Not a field: plain text, nothing to suggest
        assert_eq!(at("localhost:3000|"), None);
        assert_eq!(at("nope:x|"), None);
        assert_eq!(at("http://x|"), None);
        // Before the colon, the word still completes field names
        assert_eq!(at("met|hod:post"), Some(("met".into(), inserts(&["@method:"]))));
    }

    #[test]
    fn nothing_inside_phrases_or_after_parens() {
        assert_eq!(at("\"my |"), None);
        assert_eq!(at("(a)|"), None);
        // A word is replaced up to the cursor
        assert_eq!(at("a|b"), Some(("a".into(), inserts(&["@name:", "@header."]))));
    }

    #[test]
    fn cursor_is_clamped() {
        let c = completions("é", 1, &schema(), &values());
        assert!(c.is_none() || c.unwrap().span.end <= 2);
        assert!(completions("", 99, &schema(), &values()).is_some());
    }
}
