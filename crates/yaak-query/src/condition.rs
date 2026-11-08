//! What a field term asks of a field's values, resolved once from the term's value and the
//! field's kind.
//!
//! The evaluator matches with these, and a consumer that compiles queries elsewhere (to SQL,
//! say) translates them rather than deriving the rules again, so the two agree. The helpers
//! below are the value tests the conditions are made of, for a compiler that has to run them
//! where the values are.

use crate::ast::{CompareOp, FieldValue};
use crate::lexer::parse_number;
use crate::schema::{FieldKind, Unit, parse_flag, to_base};

/// A field term's test, applied to each of the field's values: the term matches when any value
/// passes, except [`Condition::Flag`] `false`, which matches when none is set.
#[derive(Clone, Debug, PartialEq)]
pub enum Condition {
    /// The value, as lowercase text, contains this lowercase text, which is never empty.
    Contains(String),
    /// The whole value, as lowercase text, matches this lowercase pattern, where `*` matches
    /// any run of characters. A pattern without `*` must equal the value.
    Wildcard(String),
    /// The value is there: text that is not empty, any number, or a flag that is set.
    Present,
    /// The value reads as a number.
    IsNumber,
    /// The value, read as a number, equals this one, in the field's base unit.
    Equals(f64),
    /// The value, read as a number, compares so with this one, in the field's base unit.
    Compare(CompareOp, f64),
    /// The value, read as a number, is in this inclusive range, in the field's base unit.
    Range(f64, f64),
    /// With `true`, some value is a set flag; with `false`, none is.
    Flag(bool),
    /// Nothing matches: a value the field cannot take, such as a unit it does not have.
    Never,
}

impl Condition {
    /// The condition `value` sets for a field of `kind`.
    pub fn new(kind: &FieldKind, value: &FieldValue) -> Self {
        match kind {
            FieldKind::Text => text_condition(value),
            FieldKind::Number { units } => number_condition(value, units),
            FieldKind::Flag => flag_condition(value),
        }
    }

    /// Whether a text value passes.
    pub fn matches_text(&self, text: &str) -> bool {
        match self {
            Condition::Contains(needle) => contains_ignore_case(text, needle),
            Condition::Wildcard(pattern) => wildcard_match(pattern, &text.to_lowercase()),
            Condition::Present => !text.is_empty(),
            Condition::Flag(_) => parse_flag(text) == Some(true),
            _ => self.matches_parsed_number(read_number(text)),
        }
    }

    /// Whether a number value passes.
    pub fn matches_number(&self, n: f64) -> bool {
        match self {
            Condition::Contains(needle) => format_number(n).contains(needle.as_str()),
            Condition::Wildcard(pattern) => wildcard_match(pattern, &format_number(n)),
            Condition::Present => true,
            Condition::Flag(_) => n != 0.0,
            _ => self.matches_parsed_number(Some(n)),
        }
    }

    /// Whether a flag value passes.
    pub fn matches_flag(&self, b: bool) -> bool {
        let text = if b { "true" } else { "false" };
        match self {
            Condition::Contains(needle) => text.contains(needle.as_str()),
            Condition::Wildcard(pattern) => wildcard_match(pattern, text),
            Condition::Present | Condition::Flag(_) => b,
            _ => false,
        }
    }

    fn matches_parsed_number(&self, n: Option<f64>) -> bool {
        match self {
            Condition::IsNumber => n.is_some(),
            Condition::Equals(target) => n == Some(*target),
            Condition::Compare(op, target) => n.is_some_and(|n| op.test(n, *target)),
            Condition::Range(low, high) => n.is_some_and(|n| n >= *low && n <= *high),
            _ => false,
        }
    }
}

fn text_condition(value: &FieldValue) -> Condition {
    match value {
        FieldValue::Text { text, .. } if text.is_empty() => Condition::Never,
        FieldValue::Text { text, .. } => Condition::Contains(text.to_lowercase()),
        FieldValue::Wildcard { pattern } => Condition::Wildcard(pattern.to_lowercase()),
        FieldValue::Exists => Condition::Present,
        // A text field holding numbers, such as a status shown as text
        FieldValue::Compare { op, number } if number.unit.is_none() => {
            Condition::Compare(*op, number.value)
        }
        FieldValue::Range { low, high } if low.unit.is_none() && high.unit.is_none() => {
            Condition::Range(low.value, high.value)
        }
        FieldValue::Compare { .. } | FieldValue::Range { .. } => Condition::Never,
    }
}

fn number_condition(value: &FieldValue, units: &[Unit]) -> Condition {
    match value {
        FieldValue::Text { text, .. } if text.is_empty() => Condition::Never,
        // `@status:404` is equality; anything else matches the number as text
        FieldValue::Text { text, quoted: false } => match parse_number(text) {
            Some(number) => to_base(&number, units).map_or(Condition::Never, Condition::Equals),
            None => text_condition(value),
        },
        FieldValue::Text { quoted: true, .. } | FieldValue::Wildcard { .. } => {
            text_condition(value)
        }
        FieldValue::Exists => Condition::IsNumber,
        FieldValue::Compare { op, number } => {
            to_base(number, units).map_or(Condition::Never, |target| Condition::Compare(*op, target))
        }
        FieldValue::Range { low, high } => match (to_base(low, units), to_base(high, units)) {
            (Some(low), Some(high)) => Condition::Range(low, high),
            _ => Condition::Never,
        },
    }
}

fn flag_condition(value: &FieldValue) -> Condition {
    match value {
        FieldValue::Exists => Condition::Flag(true),
        FieldValue::Text { text, .. } => parse_flag(text).map_or(Condition::Never, Condition::Flag),
        _ => Condition::Never,
    }
}

/// Whether `hay`, lowercased, contains `needle`, which is lowercase already. Copies nothing
/// when both are ASCII.
pub fn contains_ignore_case(hay: &str, needle: &str) -> bool {
    if !(hay.is_ascii() && needle.is_ascii()) {
        return hay.to_lowercase().contains(needle);
    }
    let (hay, needle) = (hay.as_bytes(), needle.as_bytes());
    needle.is_empty() || hay.windows(needle.len()).any(|w| w.eq_ignore_ascii_case(needle))
}

/// Whether `pattern`, where `*` matches any run of characters, matches the whole of `text`.
/// Case-sensitive: both are lowercase already when matching a query.
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let mut parts = pattern.split('*');
    let first = parts.next().unwrap_or_default();
    let Some(mut rest) = text.strip_prefix(first) else {
        return false;
    };
    let parts: Vec<&str> = parts.collect();
    let Some((last, middle)) = parts.split_last() else {
        // No `*` at all: the whole text must equal the pattern
        return rest.is_empty();
    };
    for part in middle {
        match rest.find(part) {
            Some(i) => rest = &rest[i + part.len()..],
            None => return false,
        }
    }
    rest.len() >= last.len() && rest.ends_with(last)
}

/// A text value read as a number, as comparisons read it: the whole text, spaces around it
/// aside.
pub fn read_number(text: &str) -> Option<f64> {
    text.trim().parse().ok()
}

/// A number as text, as a field's text matching sees it: `200`, not `200.0`.
pub fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", n as i64) } else { n.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;
    use crate::ast::Node;

    fn condition(kind: FieldKind, input: &str) -> Condition {
        let Some(Node::Field { value, .. }) = parse(input) else { panic!("not a field") };
        Condition::new(&kind, &value)
    }

    fn ms() -> FieldKind {
        FieldKind::Number {
            units: vec![
                Unit { name: "ms".into(), factor: 1.0 },
                Unit { name: "s".into(), factor: 1000.0 },
            ],
        }
    }

    #[test]
    fn resolves_text_values() {
        assert_eq!(condition(FieldKind::Text, "@a:Foo"), Condition::Contains("foo".into()));
        assert_eq!(condition(FieldKind::Text, "@a:"), Condition::Never);
        assert_eq!(condition(FieldKind::Text, "@a:F*o"), Condition::Wildcard("f*o".into()));
        assert_eq!(condition(FieldKind::Text, "@a:*"), Condition::Present);
        assert_eq!(condition(FieldKind::Text, "@a:>5"), Condition::Compare(CompareOp::Gt, 5.0));
        assert_eq!(condition(FieldKind::Text, "@a:>5s"), Condition::Never);
    }

    #[test]
    fn resolves_number_values_in_base_units() {
        assert_eq!(condition(ms(), "@d:1.5s"), Condition::Equals(1500.0));
        assert_eq!(condition(ms(), "@d:1m"), Condition::Never);
        assert_eq!(condition(ms(), "@d:<2s"), Condition::Compare(CompareOp::Lt, 2000.0));
        assert_eq!(condition(ms(), "@d:[1s TO 2s]"), Condition::Range(1000.0, 2000.0));
        assert_eq!(condition(ms(), "@d:*"), Condition::IsNumber);
        assert_eq!(condition(ms(), "@d:\"15\""), Condition::Contains("15".into()));
        assert_eq!(condition(ms(), "@d:abc"), Condition::Contains("abc".into()));
    }

    #[test]
    fn resolves_flags() {
        assert_eq!(condition(FieldKind::Flag, "@f:*"), Condition::Flag(true));
        assert_eq!(condition(FieldKind::Flag, "@f:no"), Condition::Flag(false));
        assert_eq!(condition(FieldKind::Flag, "@f:maybe"), Condition::Never);
    }

    #[test]
    fn tests_values() {
        let c = Condition::Wildcard("40*".into());
        assert!(c.matches_number(404.0));
        assert!(!c.matches_text("504"));
        assert!(Condition::Equals(200.0).matches_text(" 200 "));
        assert!(Condition::Contains("é".into()).matches_text("CAFÉ"));
        assert!(!Condition::Present.matches_text(""));
        assert!(Condition::Flag(true).matches_flag(true));
    }
}
