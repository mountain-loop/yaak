//! JavaScript regular expressions on `fancy-regex`.

use super::value::{JsArray, JsValue, MatchInfo};
use fancy_regex::{Captures, Regex, RegexBuilder};
use std::cell::Cell;
use std::fmt;
use std::rc::Rc;

const JS_WHITESPACE: &str =
    r"\t\n\x0B\x0C\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";
/// JavaScript's `\b` and `\B` only count ASCII word characters.
const WORD_BOUNDARY: &str =
    r"(?:(?<=[0-9A-Za-z_])(?![0-9A-Za-z_])|(?<![0-9A-Za-z_])(?=[0-9A-Za-z_]))";
const NOT_WORD_BOUNDARY: &str =
    r"(?:(?<=[0-9A-Za-z_])(?=[0-9A-Za-z_])|(?<![0-9A-Za-z_])(?![0-9A-Za-z_]))";
const NOT_LINE_TERMINATOR: &str = r"[^\n\r\u2028\u2029]";

pub struct JsRegex {
    pub source: String,
    pub flags: String,
    regex: Regex,
    global: bool,
    /// In UTF-16 code units, as JavaScript counts it.
    pub last_index: Cell<usize>,
}

impl fmt::Debug for JsRegex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "/{}/{}", self.source, self.flags)
    }
}

impl JsRegex {
    pub fn new(source: &str, flags: &str) -> Result<Self, String> {
        let mut seen = String::new();
        for flag in flags.chars() {
            if seen.contains(flag) || !"dgimsuvy".contains(flag) {
                return Err(format!("Invalid flags supplied to RegExp constructor '{flags}'"));
            }
            if flag == 'v' || flag == 'y' {
                return Err(format!("the regular expression flag {flag} is not supported"));
            }
            seen.push(flag);
        }
        let dot_all = flags.contains('s');
        let translated = translate(source, dot_all)?;
        let regex = RegexBuilder::new(&translated)
            .case_insensitive(flags.contains('i'))
            .multi_line(flags.contains('m'))
            .build()
            .map_err(|e| format!("Invalid regular expression: /{source}/{flags}: {e}"))?;
        Ok(JsRegex {
            source: if source.is_empty() { "(?:)".to_string() } else { source.to_string() },
            flags: flags.to_string(),
            regex,
            global: flags.contains('g'),
            last_index: Cell::new(0),
        })
    }

    /// An RFC 9535 `match()` or `search()` pattern; `None` when it is not one this engine reads.
    pub fn i_regexp(pattern: &str, whole: bool) -> Option<Self> {
        let source = if whole { format!("^(?:{pattern})$") } else { pattern.to_string() };
        JsRegex::new(&source, "u").ok()
    }

    pub fn is_match(&self, text: &str) -> Result<bool, String> {
        self.regex.is_match(text).map_err(runtime_error)
    }

    pub fn test(&self, text: &str) -> Result<bool, String> {
        if !self.global {
            return self.is_match(text);
        }
        let Some(start) = utf16_to_byte(text, self.last_index.get()) else {
            self.last_index.set(0);
            return Ok(false);
        };
        match self.regex.find_from_pos(text, start).map_err(runtime_error)? {
            Some(m) => {
                self.last_index.set(byte_to_utf16(text, m.end()));
                Ok(true)
            }
            None => {
                self.last_index.set(0);
                Ok(false)
            }
        }
    }

    pub fn match_string<'a>(&self, text: &str) -> Result<JsValue<'a>, String> {
        if self.global {
            self.last_index.set(0);
            let mut matches = Vec::new();
            let mut pos = 0;
            while pos <= text.len() {
                let Some(m) = self.regex.find_from_pos(text, pos).map_err(runtime_error)? else {
                    break;
                };
                matches.push(JsValue::string(m.as_str()));
                pos = if m.end() == m.start() { next_boundary(text, m.end()) } else { m.end() };
            }
            return Ok(if matches.is_empty() { JsValue::Null } else { JsValue::array(matches) });
        }
        let Some(captures) = self.regex.captures(text).map_err(runtime_error)? else {
            return Ok(JsValue::Null);
        };
        let index = captures.get(0).map_or(0, |m| byte_to_utf16(text, m.start()));
        Ok(JsValue::Array(Rc::new(JsArray {
            items: capture_values(&captures, 0),
            match_info: Some(MatchInfo { index: index as f64, input: text.to_string() }),
        })))
    }

    /// `String.prototype.split` with a regular expression separator, captures included.
    pub fn split<'a>(&self, text: &str, limit: usize) -> Result<Vec<JsValue<'a>>, String> {
        let mut parts = Vec::new();
        if limit == 0 {
            return Ok(parts);
        }
        if text.is_empty() {
            if self.regex.find(text).map_err(runtime_error)?.is_none() {
                parts.push(JsValue::string(""));
            }
            return Ok(parts);
        }
        let (mut p, mut q) = (0, 0);
        while q < text.len() {
            let Some(captures) = self.regex.captures_from_pos(text, q).map_err(runtime_error)?
            else {
                break;
            };
            let Some(whole) = captures.get(0) else { break };
            q = whole.start();
            if q >= text.len() {
                break;
            }
            let e = whole.end().min(text.len());
            if e == p {
                q = next_boundary(text, q);
                continue;
            }
            parts.push(JsValue::string(&text[p..q]));
            if parts.len() == limit {
                return Ok(parts);
            }
            p = e;
            for capture in capture_values(&captures, 1) {
                parts.push(capture);
                if parts.len() == limit {
                    return Ok(parts);
                }
            }
            q = p;
        }
        parts.push(JsValue::string(&text[p..]));
        Ok(parts)
    }
}

fn capture_values<'a>(captures: &Captures<'_>, from: usize) -> Vec<JsValue<'a>> {
    (from..captures.len())
        .map(|i| captures.get(i).map_or(JsValue::Undefined, |m| JsValue::string(m.as_str())))
        .collect()
}

fn runtime_error(e: fancy_regex::Error) -> String {
    format!("regular expression failed: {e}")
}

fn next_boundary(text: &str, pos: usize) -> usize {
    text[pos..].chars().next().map_or(pos + 1, |c| pos + c.len_utf8())
}

fn utf16_to_byte(text: &str, index: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, c) in text.char_indices() {
        if units >= index {
            return Some(byte);
        }
        units += c.len_utf16();
    }
    (units >= index).then_some(text.len())
}

fn byte_to_utf16(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

/// Rewrites a JavaScript pattern into `fancy-regex` syntax with JavaScript's
/// meaning for `.`, `\d`, `\w`, `\s`, `\b` and the characters JavaScript
/// takes literally (`]`, `{` and `}` outside a quantifier, `[` inside a class).
fn translate(source: &str, dot_all: bool) -> Result<String, String> {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::new();
    let mut in_class = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        i += 1;
        match c {
            '\\' => {
                let Some(&e) = chars.get(i) else {
                    return Err("Invalid regular expression: \\ at end of pattern".to_string());
                };
                i += 1;
                match e {
                    'd' => out.push_str(if in_class { "0-9" } else { "[0-9]" }),
                    'D' => out.push_str("[^0-9]"),
                    'w' => out.push_str(if in_class { "0-9A-Za-z_" } else { "[0-9A-Za-z_]" }),
                    'W' => out.push_str("[^0-9A-Za-z_]"),
                    's' if in_class => out.push_str(JS_WHITESPACE),
                    's' => out.push_str(&format!("[{JS_WHITESPACE}]")),
                    'S' => out.push_str(&format!("[^{JS_WHITESPACE}]")),
                    'b' if in_class => out.push_str(r"\x08"),
                    'b' => out.push_str(WORD_BOUNDARY),
                    'B' => out.push_str(NOT_WORD_BOUNDARY),
                    'n' => out.push_str(r"\n"),
                    'r' => out.push_str(r"\r"),
                    't' => out.push_str(r"\t"),
                    'f' => out.push_str(r"\x0C"),
                    'v' => out.push_str(r"\x0B"),
                    '0' if !chars.get(i).is_some_and(char::is_ascii_digit) => out.push_str(r"\x00"),
                    '1'..='9' if !in_class => {
                        out.push('\\');
                        out.push(e);
                        while let Some(d) = chars.get(i).filter(|d| d.is_ascii_digit()) {
                            out.push(*d);
                            i += 1;
                        }
                    }
                    'x' if hex_run(&chars, i, 2) => {
                        out.push_str(&format!(
                            r"\x{{{}}}",
                            chars[i..i + 2].iter().collect::<String>()
                        ));
                        i += 2;
                    }
                    'u' if chars.get(i) == Some(&'{') => {
                        let end = chars[i..].iter().position(|c| *c == '}').map(|p| p + i);
                        let Some(end) = end else {
                            return Err(
                                "Invalid regular expression: invalid Unicode escape".to_string()
                            );
                        };
                        out.push_str(&format!(
                            r"\x{{{}}}",
                            chars[i + 1..end].iter().collect::<String>()
                        ));
                        i = end + 1;
                    }
                    'u' if hex_run(&chars, i, 4) => {
                        let high =
                            u32::from_str_radix(&chars[i..i + 4].iter().collect::<String>(), 16)
                                .unwrap_or(0);
                        i += 4;
                        let mut code = high;
                        if (0xD800..0xDC00).contains(&high)
                            && chars.get(i) == Some(&'\\')
                            && chars.get(i + 1) == Some(&'u')
                            && hex_run(&chars, i + 2, 4)
                        {
                            let low = u32::from_str_radix(
                                &chars[i + 2..i + 6].iter().collect::<String>(),
                                16,
                            )
                            .unwrap_or(0);
                            if (0xDC00..0xE000).contains(&low) {
                                code = 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00);
                                i += 6;
                            }
                        }
                        out.push_str(&format!(r"\x{{{code:X}}}"));
                    }
                    'c' if chars.get(i).is_some_and(char::is_ascii_alphabetic) => {
                        out.push_str(&format!(r"\x{{{:X}}}", (chars[i] as u32) % 32));
                        i += 1;
                    }
                    'k' if chars.get(i) == Some(&'<') => out.push_str(r"\k"),
                    'p' | 'P' if chars.get(i) == Some(&'{') => {
                        let end = chars[i..]
                            .iter()
                            .position(|c| *c == '}')
                            .map_or(chars.len() - 1, |p| p + i);
                        out.push('\\');
                        out.push(e);
                        out.extend(&chars[i..=end]);
                        i = end + 1;
                    }
                    e => push_literal(&mut out, e),
                }
            }
            '[' if in_class => out.push_str(r"\["),
            '[' => {
                let negated = chars.get(i) == Some(&'^');
                let body = if negated { i + 1 } else { i };
                if chars.get(body) == Some(&']') {
                    out.push_str(if negated { r"[\s\S]" } else { r"[^\s\S]" });
                    i = body + 1;
                } else {
                    in_class = true;
                    out.push('[');
                    if negated {
                        out.push('^');
                        i += 1;
                    }
                }
            }
            ']' if in_class => {
                in_class = false;
                out.push(']');
            }
            '&' | '~' if in_class => {
                out.push('\\');
                out.push(c);
            }
            ']' | '}' => push_literal(&mut out, c),
            '{' if !in_class => {
                let quantifier = quantifier_len(&chars[i..]);
                if quantifier > 0 && !out.is_empty() {
                    out.push('{');
                    out.extend(&chars[i..i + quantifier]);
                    i += quantifier;
                } else {
                    push_literal(&mut out, '{');
                }
            }
            '.' if !in_class && !dot_all => out.push_str(NOT_LINE_TERMINATOR),
            '.' if !in_class => out.push_str(r"[\s\S]"),
            '(' if !in_class && chars.get(i) == Some(&'?') && chars.get(i + 1) == Some(&'<') => {
                if matches!(chars.get(i + 2), Some('=' | '!')) {
                    out.push_str("(?<");
                } else {
                    out.push_str("(?P<");
                }
                i += 2;
            }
            c => out.push(c),
        }
    }
    Ok(out)
}

fn push_literal(out: &mut String, c: char) {
    if c.is_ascii_punctuation() || c == ' ' {
        out.push('\\');
    }
    out.push(c);
}

fn hex_run(chars: &[char], from: usize, len: usize) -> bool {
    chars.get(from..from + len).is_some_and(|run| run.iter().all(char::is_ascii_hexdigit))
}

/// The length of `n}`, `n,}` or `n,m}` after a `{`, or 0 when JavaScript reads the brace literally.
fn quantifier_len(rest: &[char]) -> usize {
    let digits = |from: usize| rest[from..].iter().take_while(|c| c.is_ascii_digit()).count();
    let mut i = digits(0);
    if i == 0 {
        return 0;
    }
    if rest.get(i) == Some(&',') {
        i += 1;
        i += digits(i);
    }
    if rest.get(i) == Some(&'}') { i + 1 } else { 0 }
}
