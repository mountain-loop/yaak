//! Writes field terms back out as query text.

use crate::ast::FieldValue;
use crate::lexer::{classify_bare, is_ident_char};

/// A term matching `value` in `field`: `@field:value`, or `-@field:value` when `negated`. The
/// value stays bare when it would read back as the same literal text, and is quoted (with `"`
/// and `\` escaped) when it holds whitespace, a quote, a `)`, a `*`, or the shape of a
/// comparison or range.
pub fn format_field(field: &str, value: &str, negated: bool) -> String {
    let sign = if negated { "-" } else { "" };
    format!("{sign}@{field}:{}", format_value(value))
}

/// A field value as it should be written after the colon.
pub fn format_value(value: &str) -> String {
    if is_bare_value(value) { value.to_string() } else { quote(value) }
}

/// `value` in double quotes, with `"` and `\` escaped.
pub fn quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        if matches!(c, '"' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

fn is_bare_value(value: &str) -> bool {
    let Some(first) = value.chars().next() else {
        return false;
    };
    if first == '"' || first == '[' {
        return false;
    }
    if value.chars().any(|c| c.is_whitespace() || c == ')') {
        return false;
    }
    matches!(classify_bare(value), FieldValue::Text { .. })
}

/// Whether `name` can be written as a field path: identifiers joined by dots.
pub fn is_valid_path(name: &str) -> bool {
    !name.is_empty()
        && name.split('.').all(|part| !part.is_empty() && part.chars().all(is_ident_char))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_or_quoted() {
        assert_eq!(format_value("post"), "post");
        assert_eq!(format_value("a b"), "\"a b\"");
        assert_eq!(format_value(""), "\"\"");
        assert_eq!(format_value("*"), "\"*\"");
        assert_eq!(format_value("a*"), "\"a*\"");
        assert_eq!(format_value(">5"), "\">5\"");
        assert_eq!(format_value(">x"), ">x");
        assert_eq!(format_value("[1 TO 2]"), "\"[1 TO 2]\"");
        assert_eq!(format_value("[x"), "\"[x\"");
        assert_eq!(format_value("a)"), "\"a)\"");
        assert_eq!(format_value("a(b"), "a(b");
        assert_eq!(format_value("a\"b"), "a\"b");
        assert_eq!(format_value("a\\b"), "a\\b");
        assert_eq!(format_value("x\\ y"), "\"x\\\\ y\"");
    }

    #[test]
    fn negated() {
        assert_eq!(format_field("type", "grpc", true), "-@type:grpc");
        assert_eq!(format_field("name", "My Request", true), "-@name:\"My Request\"");
    }

    #[test]
    fn paths() {
        assert!(is_valid_path("method"));
        assert!(is_valid_path("req.header.x-cache"));
        assert!(!is_valid_path(""));
        assert!(!is_valid_path("a..b"));
        assert!(!is_valid_path("a b"));
    }
}
