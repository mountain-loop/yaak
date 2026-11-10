//! Splits a query into tokens. Never fails: anything it does not recognise is text.

use crate::ast::{CompareOp, FieldValue, NumberLiteral, Span};

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TokKind {
    LParen,
    RParen,
    /// `-` at the start of a term. It negates only what follows it directly.
    Minus,
    Or,
    And,
    Word(String),
    Phrase {
        text: String,
    },
    Field {
        path: Vec<String>,
        path_span: Span,
        value: FieldValue,
        value_span: Span,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Tok {
    pub kind: TokKind,
    pub span: Span,
}

pub(crate) fn lex(input: &str) -> Vec<Tok> {
    let mut toks = Vec::new();
    let mut i = 0;
    while let Some(c) = input[i..].chars().next() {
        if c.is_whitespace() {
            i += c.len_utf8();
            continue;
        }
        let (kind, end) = match c {
            '(' => (TokKind::LParen, i + 1),
            ')' => (TokKind::RParen, i + 1),
            '-' => (TokKind::Minus, i + 1),
            '"' => {
                let (text, end) = lex_quoted(input, i);
                (TokKind::Phrase { text }, end)
            }
            '@' => match lex_field(input, i) {
                Some(field) => field,
                None => lex_word(input, i),
            },
            _ => lex_word(input, i),
        };
        toks.push(Tok { kind, span: Span::new(i, end) });
        i = end;
    }
    toks
}

/// Whether `c` ends a bare free-text word.
fn ends_word(c: char) -> bool {
    c.is_whitespace() || matches!(c, '(' | ')' | '"')
}

/// Whether `c` ends a bare field value. Parentheses inside a value are kept, except a closing
/// one, which closes the group the field sits in.
fn ends_value(c: char) -> bool {
    c.is_whitespace() || c == ')'
}

fn run_until(input: &str, start: usize, stop: impl Fn(char) -> bool) -> usize {
    input[start..].find(stop).map_or(input.len(), |n| start + n)
}

fn lex_word(input: &str, start: usize) -> (TokKind, usize) {
    // The first character is never a word end (the caller checked), so a word is never empty
    let first = input[start..].chars().next().map_or(0, char::len_utf8);
    let end = run_until(input, start + first, ends_word);
    let text = &input[start..end];
    let kind = match text {
        "OR" => TokKind::Or,
        "AND" => TokKind::And,
        _ => TokKind::Word(text.to_string()),
    };
    (kind, end)
}

/// A double-quoted string starting at `start`. `\"` and `\\` are escapes; any other backslash
/// is kept. Without a closing quote it runs to the end of the input.
pub(crate) fn lex_quoted(input: &str, start: usize) -> (String, usize) {
    let mut text = String::new();
    let mut chars = input[start + 1..].char_indices();
    while let Some((n, c)) = chars.next() {
        match c {
            '"' => return (text, start + 1 + n + 1),
            '\\' => match input[start + 1 + n + 1..].chars().next() {
                Some(next @ ('"' | '\\')) => {
                    text.push(next);
                    chars.next();
                }
                _ => text.push('\\'),
            },
            c => text.push(c),
        }
    }
    (text, input.len())
}

pub(crate) fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// `@path:value`, or `None` when the text at `start` is not one (no colon after the path).
fn lex_field(input: &str, start: usize) -> Option<(TokKind, usize)> {
    let mut path = Vec::new();
    let mut i = start + 1;
    loop {
        let end = run_until(input, i, |c| !is_ident_char(c));
        if end == i {
            return None;
        }
        path.push(input[i..end].to_string());
        i = end;
        match input[i..].chars().next() {
            Some('.') => i += 1,
            Some(':') => break,
            _ => return None,
        }
    }
    let path_span = Span::new(start, i + 1);
    let (value, value_end) = lex_value(input, i + 1);
    let kind = TokKind::Field { path, path_span, value, value_span: Span::new(i + 1, value_end) };
    Some((kind, value_end))
}

fn lex_value(input: &str, start: usize) -> (FieldValue, usize) {
    match input[start..].chars().next() {
        None => return (FieldValue::Text { text: String::new(), quoted: false }, start),
        Some(c) if ends_value(c) => {
            return (FieldValue::Text { text: String::new(), quoted: false }, start);
        }
        Some('"') => {
            let (text, end) = lex_quoted(input, start);
            return (FieldValue::Text { text, quoted: true }, end);
        }
        Some('[') => {
            if let Some((low, high, end)) = lex_range(input, start) {
                return (FieldValue::Range { low, high }, end);
            }
        }
        Some(_) => {}
    }
    let end = run_until(input, start, ends_value);
    (classify_bare(&input[start..end]), end)
}

/// What a bare (unquoted) field value means: presence, a comparison, a wildcard pattern, or
/// plain text.
pub(crate) fn classify_bare(raw: &str) -> FieldValue {
    if raw == "*" {
        return FieldValue::Exists;
    }
    if let Some((op, number)) = parse_compare(raw) {
        return FieldValue::Compare { op, number };
    }
    if raw.contains('*') {
        return FieldValue::Wildcard { pattern: raw.to_string() };
    }
    FieldValue::Text { text: raw.to_string(), quoted: false }
}

fn parse_compare(raw: &str) -> Option<(CompareOp, NumberLiteral)> {
    let (op, rest) = if let Some(rest) = raw.strip_prefix(">=") {
        (CompareOp::Gte, rest)
    } else if let Some(rest) = raw.strip_prefix("<=") {
        (CompareOp::Lte, rest)
    } else if let Some(rest) = raw.strip_prefix('>') {
        (CompareOp::Gt, rest)
    } else if let Some(rest) = raw.strip_prefix('<') {
        (CompareOp::Lt, rest)
    } else {
        return None;
    };
    Some((op, parse_number(rest)?))
}

/// A number with an optional unit: `-?digits(.digits)?letters?`, the whole of `raw`.
pub(crate) fn parse_number(raw: &str) -> Option<NumberLiteral> {
    let body = raw.strip_prefix('-').unwrap_or(raw);
    let digits_end = body.find(|c: char| !c.is_ascii_digit()).unwrap_or(body.len());
    if digits_end == 0 {
        return None;
    }
    let mut end = digits_end;
    if let Some(fraction) = body[end..].strip_prefix('.') {
        let fraction_len = fraction.find(|c: char| !c.is_ascii_digit()).unwrap_or(fraction.len());
        if fraction_len == 0 {
            return None;
        }
        end += 1 + fraction_len;
    }
    let unit = &body[end..];
    if !unit.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let number_len = raw.len() - body.len() + end;
    let value: f64 = raw[..number_len].parse().ok()?;
    Some(NumberLiteral {
        value,
        unit: (!unit.is_empty()).then(|| unit.to_string()),
        raw: raw.to_string(),
    })
}

/// `[low TO high]` starting at `start`, or `None` when the text does not have exactly that
/// shape (it is then a literal value).
fn lex_range(input: &str, start: usize) -> Option<(NumberLiteral, NumberLiteral, usize)> {
    let skip_ws = |i: usize| run_until(input, i, |c| !c.is_whitespace());
    let mut i = skip_ws(start + 1);
    let low_end = run_until(input, i, |c| c.is_whitespace() || c == ']');
    let low = parse_number(&input[i..low_end])?;
    i = skip_ws(low_end);
    if i == low_end {
        return None;
    }
    input[i..].strip_prefix("TO")?;
    i += 2;
    let after_to = skip_ws(i);
    if after_to == i {
        return None;
    }
    i = after_to;
    let high_end = run_until(input, i, |c| c.is_whitespace() || c == ']');
    let high = parse_number(&input[i..high_end])?;
    i = skip_ws(high_end);
    input[i..].strip_prefix(']')?;
    let end = i + 1;
    match input[end..].chars().next() {
        None => Some((low, high, end)),
        Some(c) if ends_value(c) => Some((low, high, end)),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(input: &str) -> Vec<TokKind> {
        lex(input).into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn numbers() {
        let n = parse_number("500ms").unwrap();
        assert_eq!(n.value, 500.0);
        assert_eq!(n.unit.as_deref(), Some("ms"));
        assert_eq!(parse_number("-2.5").unwrap().value, -2.5);
        assert_eq!(parse_number("400").unwrap().unit, None);
        assert!(parse_number("").is_none());
        assert!(parse_number("ms").is_none());
        assert!(parse_number("1.").is_none());
        assert!(parse_number("1.5.2").is_none());
        assert!(parse_number("12a3").is_none());
        assert!(parse_number("-").is_none());
    }

    #[test]
    fn words_and_operators() {
        assert_eq!(
            kinds("a OR b AND or"),
            vec![
                TokKind::Word("a".into()),
                TokKind::Or,
                TokKind::Word("b".into()),
                TokKind::And,
                TokKind::Word("or".into()),
            ]
        );
    }

    #[test]
    fn words_stop_at_parens_and_quotes() {
        assert_eq!(
            kinds("(a)b\"c d\""),
            vec![
                TokKind::LParen,
                TokKind::Word("a".into()),
                TokKind::RParen,
                TokKind::Word("b".into()),
                TokKind::Phrase { text: "c d".into() },
            ]
        );
    }

    #[test]
    fn quoted_escapes() {
        assert_eq!(lex_quoted(r#""a \"b\" \\ \n""#, 0), (r#"a "b" \ \n"#.to_string(), 15));
        assert_eq!(lex_quoted(r#""open"#, 0), ("open".to_string(), 5));
        assert_eq!(lex_quoted(r#""trailing\"#, 0), ("trailing\\".to_string(), 10));
    }

    #[test]
    fn spans_are_bytes() {
        let toks = lex("é @url:ü");
        assert_eq!(toks[0].span, Span::new(0, 2));
        assert_eq!(toks[1].span, Span::new(3, 10));
    }

    #[test]
    fn range_needs_its_whole_shape() {
        assert!(lex_range("[1 TO 2]", 0).is_some());
        assert!(lex_range("[ 1  TO  2 ]", 0).is_some());
        assert!(lex_range("[1 to 2]", 0).is_none());
        assert!(lex_range("[1TO 2]", 0).is_none());
        assert!(lex_range("[1 TO 2", 0).is_none());
        assert!(lex_range("[1 TO 2]x", 0).is_none());
        assert!(lex_range("[a TO b]", 0).is_none());
        assert!(lex_range("[ base_url ]", 0).is_none());
    }
}
