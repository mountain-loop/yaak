//! The response document as `JSON.parse` builds it, and `JSON.stringify(_, null, 2)`.

use super::value::JsValue;
use indexmap::IndexMap;

const MAX_DEPTH: usize = 128;

#[derive(Debug)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(IndexMap<String, Json>),
}

pub fn parse(text: &str) -> Result<Json, String> {
    let mut parser = Parser { bytes: text.as_bytes(), text, pos: 0 };
    parser.skip_ws();
    let value = parser.value(0)?;
    parser.skip_ws();
    if parser.pos < parser.bytes.len() {
        return Err(parser.error("trailing characters"));
    }
    Ok(value)
}

struct Parser<'t> {
    bytes: &'t [u8],
    text: &'t str,
    pos: usize,
}

impl Parser<'_> {
    fn error(&self, message: &str) -> String {
        let mut end = self.pos.min(self.text.len());
        while !self.text.is_char_boundary(end) {
            end -= 1;
        }
        let before = &self.text[..end];
        let line = before.matches('\n').count() + 1;
        let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
        format!("{message} at line {line} column {column}")
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.peek() {
            self.pos += 1;
        }
    }

    fn expect_word(&mut self, word: &str, value: Json) -> Result<Json, String> {
        if self.text[self.pos..].starts_with(word) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(self.error("expected value"))
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, String> {
        if depth > MAX_DEPTH {
            return Err(self.error("recursion limit exceeded"));
        }
        match self.peek() {
            None => Err(self.error("EOF while parsing a value")),
            Some(b'n') => self.expect_word("null", Json::Null),
            Some(b't') => self.expect_word("true", Json::Bool(true)),
            Some(b'f') => self.expect_word("false", Json::Bool(false)),
            Some(b'"') => Ok(Json::String(self.string()?)),
            Some(b'[') => self.array(depth),
            Some(b'{') => self.object(depth),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => Err(self.error("expected value")),
        }
    }

    fn array(&mut self, depth: usize) -> Result<Json, String> {
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Json::Array(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value(depth + 1)?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Json::Array(items));
                }
                _ => return Err(self.error("expected `,` or `]`")),
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Json, String> {
        self.pos += 1;
        let mut map = IndexMap::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Json::Object(map));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.error("key must be a string"));
            }
            let key = self.string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(self.error("expected `:`"));
            }
            self.pos += 1;
            self.skip_ws();
            let value = self.value(depth + 1)?;
            map.insert(key, value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Json::Object(js_key_order(map)));
                }
                _ => return Err(self.error("expected `,` or `}`")),
            }
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => self.digits(),
            _ => return Err(self.error("invalid number")),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("invalid number"));
            }
            self.digits();
        }
        if let Some(b'e' | b'E') = self.peek() {
            self.pos += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("invalid number"));
            }
            self.digits();
        }
        let number =
            self.text[start..self.pos].parse::<f64>().map_err(|e| self.error(&e.to_string()))?;
        Ok(Json::Number(number))
    }

    fn digits(&mut self) {
        while let Some(b'0'..=b'9') = self.peek() {
            self.pos += 1;
        }
    }

    fn hex4(&mut self) -> Result<u16, String> {
        let hex =
            self.text.get(self.pos..self.pos + 4).ok_or_else(|| self.error("invalid escape"))?;
        let unit = u16::from_str_radix(hex, 16).map_err(|_| self.error("invalid escape"))?;
        if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(self.error("invalid escape"));
        }
        self.pos += 4;
        Ok(unit)
    }

    fn string(&mut self) -> Result<String, String> {
        self.pos += 1;
        let mut out = String::new();
        loop {
            let run = self.pos;
            while let Some(b) = self.peek() {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.pos += 1;
            }
            out.push_str(&self.text[run..self.pos]);
            match self.peek() {
                None => return Err(self.error("EOF while parsing a string")),
                Some(b'"') => {
                    self.pos += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.pos += 1;
                    let escape =
                        self.peek().ok_or_else(|| self.error("EOF while parsing a string"))?;
                    self.pos += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let unit = self.hex4()?;
                            let mut units = vec![unit];
                            if (0xD800..0xDC00).contains(&unit)
                                && self.text[self.pos..].starts_with("\\u")
                            {
                                let save = self.pos;
                                self.pos += 2;
                                let low = self.hex4()?;
                                if (0xDC00..0xE000).contains(&low) {
                                    units.push(low);
                                } else {
                                    self.pos = save;
                                }
                            }
                            out.push_str(&String::from_utf16_lossy(&units));
                        }
                        _ => return Err(self.error("invalid escape")),
                    }
                }
                Some(_) => return Err(self.error("control character in string")),
            }
        }
    }
}

/// `JSON.parse` gives array-index keys first, ascending, then the rest in document order.
fn js_key_order(map: IndexMap<String, Json>) -> IndexMap<String, Json> {
    if !map.keys().any(|k| array_index(k).is_some()) {
        return map;
    }
    let (mut indexes, rest): (Vec<_>, Vec<_>) =
        map.into_iter().partition(|(k, _)| array_index(k).is_some());
    indexes.sort_by_key(|(k, _)| array_index(k));
    indexes.into_iter().chain(rest).collect()
}

/// The value of a canonical array-index string ("0", "17", never "07" or "-1").
pub fn array_index(key: &str) -> Option<u32> {
    if key.is_empty()
        || (key.len() > 1 && key.starts_with('0'))
        || !key.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    key.parse::<u32>().ok().filter(|i| *i < u32::MAX)
}

/// `JSON.stringify(values, null, 2)`.
pub fn stringify_results(values: &[JsValue<'_>]) -> String {
    let mut out = String::new();
    write_array(&mut out, values.iter(), values.is_empty(), 0);
    out
}

fn indent(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn write_array<'v, 'a: 'v>(
    out: &mut String,
    items: impl Iterator<Item = &'v JsValue<'a>>,
    empty: bool,
    depth: usize,
) {
    if empty {
        out.push_str("[]");
        return;
    }
    out.push('[');
    for (i, item) in items.enumerate() {
        if i > 0 {
            out.push(',');
        }
        indent(out, depth + 1);
        if !write_js(out, item, depth + 1) {
            out.push_str("null");
        }
    }
    indent(out, depth);
    out.push(']');
}

/// Writes the value and returns true, or false for what `JSON.stringify` drops.
fn write_js(out: &mut String, value: &JsValue<'_>, depth: usize) -> bool {
    match value {
        JsValue::Undefined | JsValue::Function(_) => return false,
        JsValue::Null => out.push_str("null"),
        JsValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        JsValue::Number(n) => write_number(out, *n),
        JsValue::String(s) => write_string(out, s),
        JsValue::Doc(json) => write_json(out, json, depth),
        JsValue::Array(array) => {
            write_array(out, array.items.iter(), array.items.is_empty(), depth)
        }
        JsValue::Regex(_) => out.push_str("{}"),
    }
    true
}

fn write_json(out: &mut String, json: &Json, depth: usize) {
    match json {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Number(n) => write_number(out, *n),
        Json::String(s) => write_string(out, s),
        Json::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write_json(out, item, depth + 1);
            }
            indent(out, depth);
            out.push(']');
        }
        Json::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (key, item)) in map.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write_string(out, key);
                out.push_str(": ");
                write_json(out, item, depth + 1);
            }
            indent(out, depth);
            out.push('}');
        }
    }
}

fn write_number(out: &mut String, n: f64) {
    if n.is_finite() {
        out.push_str(&number_to_string(n));
    } else {
        out.push_str("null");
    }
}

fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `Number.prototype.toString()` for radix 10.
pub fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n == 0.0 {
        return "0".to_string();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let sign = if n < 0.0 { "-" } else { "" };
    let sci = format!("{:e}", n.abs());
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n_exp = exponent.parse::<i32>().unwrap_or(0) + 1;
    let body = if k <= n_exp && n_exp <= 21 {
        format!("{digits}{}", "0".repeat((n_exp - k) as usize))
    } else if 0 < n_exp && n_exp <= 21 {
        format!("{}.{}", &digits[..n_exp as usize], &digits[n_exp as usize..])
    } else if -6 < n_exp && n_exp <= 0 {
        format!("0.{}{digits}", "0".repeat((-n_exp) as usize))
    } else {
        let e = n_exp - 1;
        let e_sign = if e < 0 { "-" } else { "+" };
        let rest = if k > 1 { format!(".{}", &digits[1..]) } else { String::new() };
        format!("{}{rest}e{e_sign}{}", &digits[..1], e.abs())
    };
    format!("{sign}{body}")
}
