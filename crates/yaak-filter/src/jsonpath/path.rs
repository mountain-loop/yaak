//! Path strings into the steps the engine traces: jsonpath-plus's
//! `toPathArray`, after lifting out what this engine reads differently.

use super::json::{self, Json};
use super::rfc::{closing_bracket, quoted_string};
use fancy_regex::{Captures, Regex};
use std::rc::Rc;
use std::sync::LazyLock;

/// One step of a path. jsonpath-plus decides what a step means while tracing,
/// so most steps stay text until then.
#[derive(Debug, Clone)]
pub enum Loc {
    Str(Rc<str>),
    /// A part of a `,` union or a script's result, which take none of the RFC 9535 additions.
    Part(Rc<str>),
    Num(f64),
    /// A script result that is neither a string nor a number, by its string form.
    Other(Rc<str>),
    /// A script's array result, which jsonpath-plus follows only if its string form is a key.
    ArrayKey(Rc<str>),
    /// Quoted names: always literal keys.
    Names(Rc<[String]>),
    /// An RFC 9535 filter written without parentheses.
    Filter(Rc<str>),
}

const PLACEHOLDER_OPEN: char = '\u{E000}';
const PLACEHOLDER_CLOSE: char = '\u{E001}';

static PROPERTY_TYPE: LazyLock<Regex> = LazyLock::new(|| regex(r"@[A-Za-z0-9_$\-]+\(\)"));
static SCRIPT: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"[\['](\??\([^\n\r\x{2028}\x{2029}]*?\))[\]'](?![^\n\r\x{2028}\x{2029}]\])")
});
static QUOTED: LazyLock<Regex> = LazyLock::new(|| regex(r#"\[['"]([^'\]]*)['"]\]"#));
static BOUNDARY: LazyLock<Regex> = LazyLock::new(|| regex(r#"['"]?\.['"]?(?![^\[]*\])|\[['"]?"#));
static PARENT: LazyLock<Regex> = LazyLock::new(|| regex(r"(?:;)?(\^+)(?:;)?"));
static DESCENDANT: LazyLock<Regex> = LazyLock::new(|| regex(r";;;|;;"));
static TRAILING: LazyLock<Regex> = LazyLock::new(|| regex(r";$|'?\]|'$"));
static SUBX: LazyLock<Regex> = LazyLock::new(|| regex(r"#([0-9]+)"));

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap_or_else(|e| unreachable!("{pattern}: {e}"))
}

fn replace(
    re: &Regex,
    text: &str,
    rep: impl FnMut(&Captures<'_>) -> String,
) -> Result<String, String> {
    re.try_replacen(text, 0, rep)
        .map(|s| s.into_owned())
        .map_err(|e| format!("path is too complex: {e}"))
}

pub fn parse(path: &str) -> Result<Vec<Loc>, String> {
    let (text, lifted) = if path.contains([PLACEHOLDER_OPEN, PLACEHOLDER_CLOSE]) {
        (path.to_string(), Vec::new())
    } else {
        lift(path)
    };
    let mut subx: Vec<String> = Vec::new();
    let normalized = replace(&PROPERTY_TYPE, &text, |c| format!(";{};", &c[0]))?;
    let normalized = replace(&SCRIPT, &normalized, |c| {
        subx.push(c[1].to_string());
        format!("[#{}]", subx.len() - 1)
    })?;
    let normalized = replace(&QUOTED, &normalized, |c| {
        format!("['{}']", c[1].replace('.', "%@%").replace('~', "%%@@%%"))
    })?;
    let normalized = normalized.replace('~', ";~;");
    let normalized = replace(&BOUNDARY, &normalized, |_| ";".to_string())?;
    let normalized = normalized.replace("%@%", ".").replace("%%@@%%", "~");
    let normalized = replace(&PARENT, &normalized, |c| {
        let ups: Vec<&str> = c[1].split("").filter(|s| !s.is_empty()).collect();
        format!(";{};", ups.join(";"))
    })?;
    let normalized = replace(&DESCENDANT, &normalized, |_| ";..;".to_string())?;
    let normalized = replace(&TRAILING, &normalized, |_| String::new())?;

    normalized
        .split(';')
        .map(|part| {
            if let Some(index) = placeholder_index(part) {
                return Ok(lifted.get(index).cloned().unwrap_or_else(|| Loc::Str(part.into())));
            }
            let subx_index =
                SUBX.captures(part).map_err(|e| e.to_string())?.map(|c| c[1].parse::<usize>().ok());
            Ok(match subx_index {
                None => Loc::Str(part.into()),
                Some(index) => match index.and_then(|i| subx.get(i)) {
                    Some(script) => Loc::Str(script.as_str().into()),
                    None => Loc::Other("undefined".into()),
                },
            })
        })
        .collect()
}

/// The old plugin walked complete literal paths containing `["` by own
/// property instead of handing them to jsonpath-plus (so `$["s"].length` is
/// `0` for an empty string). These are their keys.
pub fn literal_keys(path: &str) -> Option<Vec<String>> {
    if !path.contains("[\"") {
        return None;
    }
    let mut rest = path.trim().strip_prefix('$')?;
    let mut keys = Vec::new();
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('.') {
            let len = after
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$'))
                .unwrap_or(after.len());
            let name = &after[..len];
            if name.is_empty() || name == "$" || name.starts_with(|c: char| c.is_ascii_digit()) {
                return None;
            }
            keys.push(name.to_string());
            rest = &after[len..];
        } else if let Some(after) = rest.strip_prefix("[\"") {
            let mut escaped = false;
            let end = after.char_indices().find_map(|(i, c)| {
                let closes = c == '"' && !escaped;
                escaped = c == '\\' && !escaped;
                closes.then_some(i)
            })?;
            let Json::String(key) = json::parse(&format!("\"{}", &after[..=end])).ok()? else {
                return None;
            };
            keys.push(key);
            rest = after[end + 1..].strip_prefix(']')?;
        } else if let Some(after) = rest.strip_prefix('[') {
            let len = after.find(|c: char| !c.is_ascii_digit()).unwrap_or(after.len());
            let digits = &after[..len];
            let index = digits.parse::<u64>().ok().filter(|i| *i <= 9_007_199_254_740_991)?;
            if digits.len() > 1 && digits.starts_with('0') {
                return None;
            }
            keys.push(index.to_string());
            rest = after[len..].strip_prefix(']')?;
        } else {
            return None;
        }
    }
    Some(keys)
}

fn placeholder_index(part: &str) -> Option<usize> {
    part.strip_prefix(PLACEHOLDER_OPEN)?.strip_suffix(PLACEHOLDER_CLOSE)?.parse().ok()
}

/// Lifts out quoted names (`["a.b"]`, `['a', 'b']`) and RFC 9535 filters
/// without parentheses (`[?@.a > 1]`), leaving placeholders jsonpath-plus's
/// normalization passes through as single steps.
fn lift(path: &str) -> (String, Vec<Loc>) {
    let chars: Vec<char> = path.chars().collect();
    let mut out = String::new();
    let mut lifted = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            let next = chars.get(i + 1).copied();
            let after = chars.get(i + 2).copied();
            let replacement = match next {
                Some('?') if after != Some('(') => closing_bracket(&chars, i).map(|close| {
                    let text: String = chars[i + 2..close - 1].iter().collect();
                    (Loc::Filter(text.into()), close)
                }),
                Some('?' | '(') => {
                    if let Some(close) = closing_bracket(&chars, i) {
                        out.extend(&chars[i..close]);
                        i = close;
                        continue;
                    }
                    None
                }
                _ => quoted_names(&chars, i + 1)
                    .map(|(names, close)| (Loc::Names(names.into()), close)),
            };
            if let Some((loc, close)) = replacement {
                out.push_str(&format!("[{PLACEHOLDER_OPEN}{}{PLACEHOLDER_CLOSE}]", lifted.len()));
                lifted.push(loc);
                i = close;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    (out, lifted)
}

/// `"a"` or `'a', "b"` up to the closing `]`, and the index after it.
fn quoted_names(chars: &[char], mut i: usize) -> Option<(Vec<String>, usize)> {
    let blank = |c: &char| matches!(c, ' ' | '\t' | '\n' | '\r');
    let mut names = Vec::new();
    loop {
        while chars.get(i).is_some_and(blank) {
            i += 1;
        }
        let (name, end) = quoted_string(chars, i)?;
        names.push(name);
        i = end;
        while chars.get(i).is_some_and(blank) {
            i += 1;
        }
        match chars.get(i) {
            Some(']') => return Some((names, i + 1)),
            Some(',') => i += 1,
            _ => return None,
        }
    }
}
