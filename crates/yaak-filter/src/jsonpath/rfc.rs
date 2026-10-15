//! RFC 9535 filter expressions, for `[?expr]` written without parentheses,
//! and its function extensions, which `?(...)` filters may call too.

use super::Engine;
use super::json::Json;
use super::value::JsValue;

const MAX_DEPTH: usize = 100;

/// An embedded query: `@` or `$` and the segments after it, run by the engine.
#[derive(Debug, Clone)]
pub struct Query {
    pub root: bool,
    pub path: String,
    pub singular: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RfcFunction {
    Length,
    Count,
    Match,
    Search,
    Value,
}

impl RfcFunction {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "length" => Some(RfcFunction::Length),
            "count" => Some(RfcFunction::Count),
            "match" => Some(RfcFunction::Match),
            "search" => Some(RfcFunction::Search),
            "value" => Some(RfcFunction::Value),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            RfcFunction::Length => "length",
            RfcFunction::Count => "count",
            RfcFunction::Match => "match",
            RfcFunction::Search => "search",
            RfcFunction::Value => "value",
        }
    }

    pub fn takes_nodes(self) -> bool {
        match self {
            RfcFunction::Count | RfcFunction::Value => true,
            RfcFunction::Length | RfcFunction::Match | RfcFunction::Search => false,
        }
    }

    pub fn arity(self) -> usize {
        match self {
            RfcFunction::Length | RfcFunction::Count | RfcFunction::Value => 1,
            RfcFunction::Match | RfcFunction::Search => 2,
        }
    }

    fn returns_logical(self) -> bool {
        match self {
            RfcFunction::Match | RfcFunction::Search => true,
            RfcFunction::Length | RfcFunction::Count | RfcFunction::Value => false,
        }
    }

    /// The function's result; `None` is RFC 9535's Nothing.
    fn call<'a>(
        self,
        args: &[Option<JsValue<'a>>],
        nodes: &[JsValue<'a>],
        engine: &Engine<'a>,
    ) -> Option<JsValue<'a>> {
        let arg = |i: usize| args.get(i).cloned().flatten();
        match self {
            RfcFunction::Length => match arg(0)? {
                JsValue::String(s) => Some(JsValue::Number(s.chars().count() as f64)),
                JsValue::Doc(Json::Array(items)) => Some(JsValue::Number(items.len() as f64)),
                JsValue::Doc(Json::Object(map)) => Some(JsValue::Number(map.len() as f64)),
                JsValue::Array(array) => Some(JsValue::Number(array.items.len() as f64)),
                _ => None,
            },
            RfcFunction::Count => Some(JsValue::Number(nodes.len() as f64)),
            RfcFunction::Value => match nodes {
                [one] => Some(one.clone()),
                _ => None,
            },
            RfcFunction::Match | RfcFunction::Search => {
                let matched = match (arg(0), arg(1)) {
                    (Some(JsValue::String(text)), Some(JsValue::String(pattern))) => engine
                        .i_regexp(&pattern, self == RfcFunction::Match)
                        .is_some_and(|re| re.is_match(&text).unwrap_or(false)),
                    _ => false,
                };
                Some(JsValue::Bool(matched))
            }
        }
    }

    /// A call from a `?(...)` filter, where Nothing is `undefined`.
    pub fn call_js<'a>(self, args: &[Vec<JsValue<'a>>], engine: &Engine<'a>) -> JsValue<'a> {
        let nodes =
            if self.takes_nodes() { args.first().cloned().unwrap_or_default() } else { Vec::new() };
        let values: Vec<Option<JsValue<'a>>> = if self.takes_nodes() {
            Vec::new()
        } else {
            args.iter()
                .map(|arg| arg.first().cloned().filter(|v| !matches!(v, JsValue::Undefined)))
                .collect()
        };
        self.call(&values, &nodes, engine).unwrap_or(JsValue::Undefined)
    }
}

fn is_name_first(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || (c as u32) >= 0x80
}

fn is_name_char(c: char) -> bool {
    is_name_first(c) || c.is_ascii_digit()
}

fn is_blank(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

/// The index after the `]` that closes the bracket opened at `open`, skipping quoted text.
pub fn closing_bracket(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 0;
    let mut i = open;
    while i < chars.len() {
        match chars[i] {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            quote @ ('\'' | '"') => {
                i += 1;
                while i < chars.len() && chars[i] != quote {
                    i += if chars[i] == '\\' { 2 } else { 1 };
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Reads the segments after `@` or `$` from `start`, returning where they end.
pub fn scan_query(chars: &[char], start: usize, root: bool) -> (usize, Query) {
    let mut end = start;
    let mut singular = true;
    loop {
        let mut i = end;
        while chars.get(i).copied().is_some_and(is_blank) {
            i += 1;
        }
        if chars.get(i) == Some(&'.') && chars.get(i + 1) == Some(&'.') {
            i += 2;
            singular = false;
            match chars.get(i) {
                Some('*') => i += 1,
                Some('[') => match closing_bracket(chars, i) {
                    Some(close) => i = close,
                    None => break,
                },
                Some(c) if is_name_first(*c) => i = name_end(chars, i),
                _ => break,
            }
        } else if chars.get(i) == Some(&'.') {
            i += 1;
            match chars.get(i) {
                Some('*') => {
                    singular = false;
                    i += 1;
                }
                Some(c) if is_name_first(*c) => i = name_end(chars, i),
                _ => break,
            }
        } else if chars.get(i) == Some(&'[') {
            let Some(close) = closing_bracket(chars, i) else {
                break;
            };
            let selector: String = chars[i + 1..close - 1].iter().collect();
            singular &= is_singular_selector(selector.trim_matches(is_blank));
            i = close;
        } else {
            break;
        }
        end = i;
    }
    let path = format!("${}", chars[start..end].iter().collect::<String>());
    (end, Query { root, path, singular })
}

fn name_end(chars: &[char], mut i: usize) -> usize {
    while chars.get(i).copied().is_some_and(is_name_char) {
        i += 1;
    }
    i
}

fn is_singular_selector(selector: &str) -> bool {
    let digits = selector.strip_prefix('-').unwrap_or(selector);
    let index = !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit());
    let chars: Vec<char> = selector.chars().collect();
    let quoted = quoted_string(&chars, 0).is_some_and(|(_, end)| end == chars.len());
    index || quoted
}

#[derive(Debug)]
pub enum Logical {
    Or(Vec<Logical>),
    And(Vec<Logical>),
    Not(Box<Logical>),
    Compare(Comparable, CompareOp, Comparable),
    Exists(Query),
    Test(Call),
}

#[derive(Debug, Clone, Copy)]
pub enum CompareOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug)]
pub enum Comparable {
    Literal(Literal),
    Query(Query),
    Call(Call),
}

#[derive(Debug)]
pub enum Literal {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
}

#[derive(Debug)]
pub struct Call {
    function: RfcFunction,
    args: Vec<Arg>,
}

#[derive(Debug)]
enum Arg {
    Value(Comparable),
    Nodes(Query),
}

pub fn parse(text: &str) -> Result<Logical, String> {
    let mut parser = Parser { chars: text.chars().collect(), index: 0, depth: 0 };
    parser.blank();
    let logical = parser.or()?;
    parser.blank();
    if parser.index < parser.chars.len() {
        return Err(parser.error("unexpected"));
    }
    Ok(logical)
}

struct Parser {
    chars: Vec<char>,
    index: usize,
    depth: usize,
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.index).copied()
    }

    fn eat(&mut self, s: &str) -> bool {
        let matches =
            s.chars().enumerate().all(|(i, c)| self.chars.get(self.index + i) == Some(&c));
        if matches {
            self.index += s.chars().count();
        }
        matches
    }

    fn blank(&mut self) {
        while self.peek().is_some_and(is_blank) {
            self.index += 1;
        }
    }

    fn error(&self, message: &str) -> String {
        let rest: String = self.chars[self.index.min(self.chars.len())..].iter().collect();
        if rest.is_empty() {
            format!("{message} end of filter expression")
        } else {
            format!("{message} \"{rest}\" in filter expression")
        }
    }

    fn or(&mut self) -> Result<Logical, String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err("filter expression is nested too deeply".to_string());
        }
        let mut items = vec![self.and()?];
        loop {
            self.blank();
            if !self.eat("||") {
                break;
            }
            self.blank();
            items.push(self.and()?);
        }
        self.depth -= 1;
        Ok(if items.len() == 1 { items.remove(0) } else { Logical::Or(items) })
    }

    fn and(&mut self) -> Result<Logical, String> {
        let mut items = vec![self.basic()?];
        loop {
            self.blank();
            if !self.eat("&&") {
                break;
            }
            self.blank();
            items.push(self.basic()?);
        }
        Ok(if items.len() == 1 { items.remove(0) } else { Logical::And(items) })
    }

    fn basic(&mut self) -> Result<Logical, String> {
        if self.peek() == Some('!') && self.chars.get(self.index + 1) != Some(&'=') {
            self.index += 1;
            self.blank();
            let inner = if self.peek() == Some('(') { self.paren()? } else { self.test()? };
            return Ok(Logical::Not(Box::new(inner)));
        }
        if self.peek() == Some('(') {
            return self.paren();
        }
        let left = self.comparable()?;
        let save = self.index;
        self.blank();
        let op = [
            ("==", CompareOp::Eq),
            ("!=", CompareOp::Ne),
            ("<=", CompareOp::Le),
            (">=", CompareOp::Ge),
            ("<", CompareOp::Lt),
            (">", CompareOp::Gt),
        ]
        .into_iter()
        .find(|(text, _)| self.eat(text));
        let Some((_, op)) = op else {
            self.index = save;
            return self.as_test(left);
        };
        self.blank();
        let right = self.comparable()?;
        for side in [&left, &right] {
            check_comparable(side)?;
        }
        Ok(Logical::Compare(left, op, right))
    }

    fn paren(&mut self) -> Result<Logical, String> {
        self.index += 1;
        self.blank();
        let inner = self.or()?;
        self.blank();
        if !self.eat(")") {
            return Err(self.error("expected `)` before"));
        }
        Ok(inner)
    }

    fn test(&mut self) -> Result<Logical, String> {
        let comparable = self.comparable()?;
        self.as_test(comparable)
    }

    fn as_test(&self, comparable: Comparable) -> Result<Logical, String> {
        match comparable {
            Comparable::Query(query) => Ok(Logical::Exists(query)),
            Comparable::Call(call) if call.function.returns_logical() => Ok(Logical::Test(call)),
            Comparable::Call(call) => Err(format!(
                "{}() gives a value; compare it rather than test it",
                call.function.name()
            )),
            Comparable::Literal(_) => {
                Err(self.error("a literal is not a test; expected a comparison before"))
            }
        }
    }

    fn comparable(&mut self) -> Result<Comparable, String> {
        match self.peek() {
            Some(c @ ('@' | '$')) => {
                let (end, query) = scan_query(&self.chars, self.index + 1, c == '$');
                self.index = end;
                Ok(Comparable::Query(query))
            }
            Some('\'' | '"') => Ok(Comparable::Literal(Literal::String(self.string()?))),
            Some(c) if c == '-' || c.is_ascii_digit() => {
                Ok(Comparable::Literal(Literal::Number(self.number()?)))
            }
            Some(c) if c.is_ascii_lowercase() => {
                let start = self.index;
                while self
                    .peek()
                    .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                {
                    self.index += 1;
                }
                let name: String = self.chars[start..self.index].iter().collect();
                if self.peek() == Some('(') {
                    return self.call(&name).map(Comparable::Call);
                }
                match name.as_str() {
                    "true" => Ok(Comparable::Literal(Literal::Bool(true))),
                    "false" => Ok(Comparable::Literal(Literal::Bool(false))),
                    "null" => Ok(Comparable::Literal(Literal::Null)),
                    _ => {
                        self.index = start;
                        Err(self.error("unexpected"))
                    }
                }
            }
            _ => Err(self.error("expected a query, literal or function at")),
        }
    }

    fn call(&mut self, name: &str) -> Result<Call, String> {
        let function =
            RfcFunction::from_name(name).ok_or_else(|| format!("unknown function {name}()"))?;
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err("filter expression is nested too deeply".to_string());
        }
        self.index += 1;
        let mut args = Vec::new();
        loop {
            self.blank();
            if args.is_empty() && self.eat(")") {
                break;
            }
            let arg = self.comparable()?;
            args.push(if function.takes_nodes() {
                match arg {
                    Comparable::Query(query) => Arg::Nodes(query),
                    Comparable::Literal(_) | Comparable::Call(_) => {
                        return Err(format!("{}() takes a query", function.name()));
                    }
                }
            } else {
                check_comparable(&arg)?;
                Arg::Value(arg)
            });
            self.blank();
            if self.eat(")") {
                break;
            }
            if !self.eat(",") {
                return Err(self.error("expected `,` or `)` before"));
            }
        }
        if args.len() != function.arity() {
            return Err(format!("{}() takes {} argument(s)", function.name(), function.arity()));
        }
        self.depth -= 1;
        Ok(Call { function, args })
    }

    fn number(&mut self) -> Result<f64, String> {
        let start = self.index;
        self.eat("-");
        let digits = |p: &mut Parser| {
            let from = p.index;
            while p.peek().is_some_and(|c| c.is_ascii_digit()) {
                p.index += 1;
            }
            p.index - from
        };
        let int_start = self.index;
        if digits(self) == 0 || (self.chars[int_start] == '0' && self.index - int_start > 1) {
            return Err(self.error("invalid number at"));
        }
        if self.eat(".") && digits(self) == 0 {
            return Err(self.error("invalid number at"));
        }
        if self.peek().is_some_and(|c| c == 'e' || c == 'E') {
            self.index += 1;
            if !self.eat("+") {
                self.eat("-");
            }
            if digits(self) == 0 {
                return Err(self.error("invalid number at"));
            }
        }
        let text: String = self.chars[start..self.index].iter().collect();
        text.parse::<f64>().map_err(|_| self.error("invalid number at"))
    }

    fn string(&mut self) -> Result<String, String> {
        quoted_string(&self.chars, self.index)
            .map(|(value, end)| {
                self.index = end;
                value
            })
            .ok_or_else(|| self.error("invalid string literal at"))
    }
}

/// A quoted name with JSON escapes (and `\'`), and the index after its closing quote.
pub fn quoted_string(chars: &[char], start: usize) -> Option<(String, usize)> {
    let quote = *chars.get(start).filter(|c| matches!(c, '\'' | '"'))?;
    let mut out = String::new();
    let mut i = start + 1;
    loop {
        let c = *chars.get(i)?;
        i += 1;
        if c == quote {
            return Some((out, i));
        }
        if c != '\\' {
            out.push(c);
            continue;
        }
        let escaped = *chars.get(i)?;
        i += 1;
        match escaped {
            '"' | '\'' | '\\' | '/' => out.push(escaped),
            'b' => out.push('\u{8}'),
            'f' => out.push('\u{c}'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'u' => {
                let hex = |at: usize| -> Option<u16> {
                    let digits: String = chars.get(at..at + 4)?.iter().collect();
                    if !digits.chars().all(|c| c.is_ascii_hexdigit()) {
                        return None;
                    }
                    u16::from_str_radix(&digits, 16).ok()
                };
                let mut units = vec![hex(i)?];
                i += 4;
                let paired = (0xD800..0xDC00).contains(&units[0])
                    && chars.get(i) == Some(&'\\')
                    && chars.get(i + 1) == Some(&'u');
                if let Some(low) = hex(i + 2).filter(|low| paired && (0xDC00..0xE000).contains(low))
                {
                    units.push(low);
                    i += 6;
                }
                out.push_str(&String::from_utf16_lossy(&units));
            }
            _ => return None,
        }
    }
}

fn check_comparable(comparable: &Comparable) -> Result<(), String> {
    match comparable {
        Comparable::Query(query) if !query.singular => Err(format!(
            "{}{} can select several nodes, so it cannot be compared",
            if query.root { "$" } else { "@" },
            &query.path[1..]
        )),
        Comparable::Call(call) if call.function.returns_logical() => {
            Err(format!("{}() gives a test result, not a value to compare", call.function.name()))
        }
        Comparable::Query(_) | Comparable::Call(_) | Comparable::Literal(_) => Ok(()),
    }
}

impl Logical {
    pub fn test<'a>(&self, current: &JsValue<'a>, engine: &Engine<'a>) -> Result<bool, String> {
        Ok(match self {
            Logical::Or(items) => {
                for item in items {
                    if item.test(current, engine)? {
                        return Ok(true);
                    }
                }
                false
            }
            Logical::And(items) => {
                for item in items {
                    if !item.test(current, engine)? {
                        return Ok(false);
                    }
                }
                true
            }
            Logical::Not(inner) => !inner.test(current, engine)?,
            Logical::Exists(query) => !engine.query(query, current)?.is_empty(),
            Logical::Test(call) => call.eval(current, engine)?.is_some_and(|v| v.truthy()),
            Logical::Compare(left, op, right) => {
                let left = left.eval(current, engine)?;
                let right = right.eval(current, engine)?;
                let (l, r) = (left.as_ref(), right.as_ref());
                match op {
                    CompareOp::Eq => equal(l, r),
                    CompareOp::Ne => !equal(l, r),
                    CompareOp::Lt => less(l, r),
                    CompareOp::Le => less(l, r) || equal(l, r),
                    CompareOp::Gt => less(r, l),
                    CompareOp::Ge => less(r, l) || equal(l, r),
                }
            }
        })
    }
}

impl Comparable {
    fn eval<'a>(
        &self,
        current: &JsValue<'a>,
        engine: &Engine<'a>,
    ) -> Result<Option<JsValue<'a>>, String> {
        Ok(match self {
            Comparable::Literal(Literal::Null) => Some(JsValue::Null),
            Comparable::Literal(Literal::Bool(b)) => Some(JsValue::Bool(*b)),
            Comparable::Literal(Literal::Number(n)) => Some(JsValue::Number(*n)),
            Comparable::Literal(Literal::String(s)) => Some(JsValue::string(s.clone())),
            Comparable::Query(query) => match engine.query(query, current)?.as_slice() {
                [one] => Some(one.clone()),
                _ => None,
            },
            Comparable::Call(call) => call.eval(current, engine)?,
        })
    }
}

impl Call {
    fn eval<'a>(
        &self,
        current: &JsValue<'a>,
        engine: &Engine<'a>,
    ) -> Result<Option<JsValue<'a>>, String> {
        let mut values = Vec::new();
        let mut nodes = Vec::new();
        for arg in &self.args {
            match arg {
                Arg::Value(comparable) => values.push(comparable.eval(current, engine)?),
                Arg::Nodes(query) => nodes = engine.query(query, current)?,
            }
        }
        Ok(self.function.call(&values, &nodes, engine))
    }
}

fn equal(a: Option<&JsValue<'_>>, b: Option<&JsValue<'_>>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => deep_equal(a, b),
        _ => false,
    }
}

fn deep_equal(a: &JsValue<'_>, b: &JsValue<'_>) -> bool {
    match (a, b) {
        (JsValue::Doc(a), JsValue::Doc(b)) => json_equal(a, b),
        (JsValue::Null, JsValue::Null) => true,
        (JsValue::Bool(a), JsValue::Bool(b)) => a == b,
        (JsValue::Number(a), JsValue::Number(b)) => a == b,
        (JsValue::String(a), JsValue::String(b)) => a == b,
        _ => false,
    }
}

fn json_equal(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Array(a), Json::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| json_equal(a, b))
        }
        (Json::Object(a), Json::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|w| json_equal(v, w)))
        }
        (Json::Null, Json::Null) => true,
        (Json::Bool(a), Json::Bool(b)) => a == b,
        (Json::Number(a), Json::Number(b)) => a == b,
        (Json::String(a), Json::String(b)) => a == b,
        (Json::Null, _)
        | (Json::Bool(_), _)
        | (Json::Number(_), _)
        | (Json::String(_), _)
        | (Json::Array(_), _)
        | (Json::Object(_), _) => false,
    }
}

fn less(a: Option<&JsValue<'_>>, b: Option<&JsValue<'_>>) -> bool {
    match (a, b) {
        (Some(JsValue::Number(a)), Some(JsValue::Number(b))) => a < b,
        (Some(JsValue::String(a)), Some(JsValue::String(b))) => a < b,
        _ => false,
    }
}
