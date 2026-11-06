//! The slice of JavaScript values and coercions the safe evaluator needs.

use super::json::{Json, array_index, number_to_string};
use super::regex::JsRegex;
use std::borrow::Cow;
use std::cmp::Ordering;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub enum JsValue<'a> {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Cow<'a, str>),
    /// An array or object of the document, compared by identity.
    Doc(&'a Json),
    Array(Rc<JsArray<'a>>),
    Regex(Rc<JsRegex>),
    Function(Rc<BoundMethod<'a>>),
}

#[derive(Debug, Default)]
pub struct JsArray<'a> {
    pub items: Vec<JsValue<'a>>,
    /// Set on the array `String.prototype.match` returns.
    pub match_info: Option<MatchInfo>,
}

#[derive(Debug)]
pub struct MatchInfo {
    pub index: f64,
    pub input: String,
}

#[derive(Debug)]
pub struct BoundMethod<'a> {
    pub receiver: JsValue<'a>,
    pub method: Method,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    StringIncludes,
    StringStartsWith,
    StringEndsWith,
    StringIndexOf,
    StringLastIndexOf,
    StringToLowerCase,
    StringToUpperCase,
    StringTrim,
    StringTrimStart,
    StringTrimEnd,
    StringSlice,
    StringSubstring,
    StringSplit,
    StringMatch,
    StringToString,
    ArrayIncludes,
    ArrayIndexOf,
    ArrayJoin,
    ArrayToString,
    NumberToString,
    NumberToFixed,
    RegexTest,
}

impl Method {
    pub fn name(self) -> &'static str {
        match self {
            Method::StringIncludes | Method::ArrayIncludes => "includes",
            Method::StringStartsWith => "startsWith",
            Method::StringEndsWith => "endsWith",
            Method::StringIndexOf | Method::ArrayIndexOf => "indexOf",
            Method::StringLastIndexOf => "lastIndexOf",
            Method::StringToLowerCase => "toLowerCase",
            Method::StringToUpperCase => "toUpperCase",
            Method::StringTrim => "trim",
            Method::StringTrimStart => "trimStart",
            Method::StringTrimEnd => "trimEnd",
            Method::StringSlice => "slice",
            Method::StringSubstring => "substring",
            Method::StringSplit => "split",
            Method::StringMatch => "match",
            Method::StringToString | Method::ArrayToString | Method::NumberToString => "toString",
            Method::ArrayJoin => "join",
            Method::NumberToFixed => "toFixed",
            Method::RegexTest => "test",
        }
    }
}

const STRING_METHODS: &[(&str, Method)] = &[
    ("includes", Method::StringIncludes),
    ("startsWith", Method::StringStartsWith),
    ("endsWith", Method::StringEndsWith),
    ("indexOf", Method::StringIndexOf),
    ("lastIndexOf", Method::StringLastIndexOf),
    ("toLowerCase", Method::StringToLowerCase),
    ("toUpperCase", Method::StringToUpperCase),
    ("trim", Method::StringTrim),
    ("trimStart", Method::StringTrimStart),
    ("trimEnd", Method::StringTrimEnd),
    ("slice", Method::StringSlice),
    ("substring", Method::StringSubstring),
    ("split", Method::StringSplit),
    ("match", Method::StringMatch),
    ("toString", Method::StringToString),
];
const ARRAY_METHODS: &[(&str, Method)] = &[
    ("includes", Method::ArrayIncludes),
    ("indexOf", Method::ArrayIndexOf),
    ("join", Method::ArrayJoin),
    ("toString", Method::ArrayToString),
];
const NUMBER_METHODS: &[(&str, Method)] = &[
    ("toString", Method::NumberToString),
    ("toFixed", Method::NumberToFixed),
];
const REGEX_METHODS: &[(&str, Method)] = &[("test", Method::RegexTest)];

/// Every method name a call may use; anything else is rejected before evaluation.
pub fn is_allowed_method_name(name: &str) -> bool {
    [STRING_METHODS, ARRAY_METHODS, NUMBER_METHODS, REGEX_METHODS]
        .iter()
        .any(|t| t.iter().any(|(n, _)| *n == name))
}

const STRING_PROTO: &[&str] = &[
    "anchor",
    "at",
    "big",
    "blink",
    "bold",
    "charAt",
    "charCodeAt",
    "codePointAt",
    "concat",
    "fontcolor",
    "fontsize",
    "fixed",
    "isWellFormed",
    "italics",
    "link",
    "localeCompare",
    "matchAll",
    "normalize",
    "padEnd",
    "padStart",
    "repeat",
    "replace",
    "replaceAll",
    "search",
    "small",
    "strike",
    "sub",
    "substr",
    "sup",
    "toWellFormed",
    "trimLeft",
    "trimRight",
    "toLocaleLowerCase",
    "toLocaleUpperCase",
    "valueOf",
];
const ARRAY_PROTO: &[&str] = &[
    "at",
    "concat",
    "copyWithin",
    "fill",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "lastIndexOf",
    "pop",
    "push",
    "reverse",
    "shift",
    "unshift",
    "slice",
    "sort",
    "splice",
    "keys",
    "entries",
    "values",
    "forEach",
    "filter",
    "flat",
    "flatMap",
    "map",
    "every",
    "some",
    "reduce",
    "reduceRight",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
    "toLocaleString",
];
const NUMBER_PROTO: &[&str] = &["toExponential", "toPrecision", "valueOf", "toLocaleString"];
const BOOLEAN_PROTO: &[&str] = &["toString", "valueOf"];
const REGEX_PROTO: &[&str] = &["exec", "compile", "toString"];
const FUNCTION_PROTO: &[&str] = &[
    "length",
    "name",
    "arguments",
    "caller",
    "apply",
    "bind",
    "call",
    "toString",
];
const OBJECT_PROTO: &[&str] = &[
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "toLocaleString",
];
/// Reading these off a prototype is refused, as jsonpath-plus's safe evaluator does.
const BLOCKED: &[&str] = &[
    "constructor",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

impl<'a> JsValue<'a> {
    pub fn from_doc(json: &'a Json) -> Self {
        match json {
            Json::Null => JsValue::Null,
            Json::Bool(b) => JsValue::Bool(*b),
            Json::Number(n) => JsValue::Number(*n),
            Json::String(s) => JsValue::String(Cow::Borrowed(s)),
            Json::Array(_) | Json::Object(_) => JsValue::Doc(json),
        }
    }

    pub fn string(s: impl Into<String>) -> Self {
        JsValue::String(Cow::Owned(s.into()))
    }

    pub fn array(items: Vec<JsValue<'a>>) -> Self {
        JsValue::Array(Rc::new(JsArray { items, match_info: None }))
    }

    pub fn truthy(&self) -> bool {
        match self {
            JsValue::Undefined | JsValue::Null => false,
            JsValue::Bool(b) => *b,
            JsValue::Number(n) => *n != 0.0 && !n.is_nan(),
            JsValue::String(s) => !s.is_empty(),
            JsValue::Doc(_) | JsValue::Array(_) | JsValue::Regex(_) | JsValue::Function(_) => true,
        }
    }

    pub fn is_object(&self) -> bool {
        match self {
            JsValue::Doc(_) | JsValue::Array(_) | JsValue::Regex(_) | JsValue::Function(_) => true,
            JsValue::Undefined
            | JsValue::Null
            | JsValue::Bool(_)
            | JsValue::Number(_)
            | JsValue::String(_) => false,
        }
    }

    pub fn type_of(&self) -> &'static str {
        match self {
            JsValue::Undefined => "undefined",
            JsValue::Null | JsValue::Doc(_) | JsValue::Array(_) | JsValue::Regex(_) => "object",
            JsValue::Bool(_) => "boolean",
            JsValue::Number(_) => "number",
            JsValue::String(_) => "string",
            JsValue::Function(_) => "function",
        }
    }

    /// `ToPrimitive`: every object here stringifies, whatever the hint.
    pub fn to_primitive(&self) -> JsValue<'a> {
        if self.is_object() { JsValue::string(self.to_js_string()) } else { self.clone() }
    }

    pub fn to_number(&self) -> f64 {
        match self {
            JsValue::Undefined => f64::NAN,
            JsValue::Null => 0.0,
            JsValue::Bool(b) => f64::from(u8::from(*b)),
            JsValue::Number(n) => *n,
            JsValue::String(s) => string_to_number(s),
            JsValue::Doc(_) | JsValue::Array(_) | JsValue::Regex(_) | JsValue::Function(_) => {
                string_to_number(&self.to_js_string())
            }
        }
    }

    pub fn to_js_string(&self) -> String {
        match self {
            JsValue::Undefined => "undefined".to_string(),
            JsValue::Null => "null".to_string(),
            JsValue::Bool(b) => b.to_string(),
            JsValue::Number(n) => number_to_string(*n),
            JsValue::String(s) => s.to_string(),
            JsValue::Doc(Json::Array(items)) => join_doc(items, ","),
            JsValue::Doc(_) => "[object Object]".to_string(),
            JsValue::Array(array) => join_values(&array.items, ","),
            JsValue::Regex(re) => format!("/{}/{}", re.source, re.flags),
            JsValue::Function(_) => "function () { [native code] }".to_string(),
        }
    }

    pub fn to_int32(&self) -> i32 {
        self.to_uint32() as i32
    }

    pub fn to_uint32(&self) -> u32 {
        let n = self.to_number();
        if !n.is_finite() {
            return 0;
        }
        n.trunc().rem_euclid(4_294_967_296.0) as u32
    }

    /// `ToIntegerOrInfinity`.
    pub fn to_integer(&self) -> f64 {
        let n = self.to_number();
        if n.is_nan() { 0.0 } else { n.trunc() + 0.0 }
    }

    fn same_object(&self, other: &JsValue<'a>) -> bool {
        match (self, other) {
            (JsValue::Doc(a), JsValue::Doc(b)) => std::ptr::eq(*a, *b),
            (JsValue::Array(a), JsValue::Array(b)) => Rc::ptr_eq(a, b),
            (JsValue::Regex(a), JsValue::Regex(b)) => Rc::ptr_eq(a, b),
            (JsValue::Function(a), JsValue::Function(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }

    pub fn strict_eq(&self, other: &JsValue<'a>) -> bool {
        match (self, other) {
            (JsValue::Undefined, JsValue::Undefined) | (JsValue::Null, JsValue::Null) => true,
            (JsValue::Bool(a), JsValue::Bool(b)) => a == b,
            (JsValue::Number(a), JsValue::Number(b)) => a == b,
            (JsValue::String(a), JsValue::String(b)) => a == b,
            (a, b) => a.same_object(b),
        }
    }

    /// `SameValueZero`, for `Array.prototype.includes`.
    fn same_value_zero(&self, other: &JsValue<'a>) -> bool {
        match (self, other) {
            (JsValue::Number(a), JsValue::Number(b)) if a.is_nan() && b.is_nan() => true,
            (a, b) => a.strict_eq(b),
        }
    }

    pub fn loose_eq(&self, other: &JsValue<'a>) -> bool {
        use JsValue::{Bool, Null, Number, String, Undefined};
        match (self, other) {
            (Undefined | Null, Undefined | Null) => true,
            (Undefined | Null, _) | (_, Undefined | Null) => false,
            (Number(a), String(b)) => *a == string_to_number(b),
            (String(a), Number(b)) => string_to_number(a) == *b,
            (Bool(_), _) => JsValue::Number(self.to_number()).loose_eq(other),
            (_, Bool(_)) => self.loose_eq(&JsValue::Number(other.to_number())),
            (a, b) if a.is_object() && !b.is_object() => a.to_primitive().loose_eq(b),
            (a, b) if !a.is_object() && b.is_object() => a.loose_eq(&b.to_primitive()),
            (a, b) => a.strict_eq(b),
        }
    }

    /// `IsLessThan`; `None` is JavaScript's undefined, from NaN.
    pub fn less_than(&self, other: &JsValue<'a>) -> Option<bool> {
        let (a, b) = (self.to_primitive(), other.to_primitive());
        if let (JsValue::String(a), JsValue::String(b)) = (&a, &b) {
            return Some(a.encode_utf16().cmp(b.encode_utf16()) == Ordering::Less);
        }
        let (a, b) = (a.to_number(), b.to_number());
        if a.is_nan() || b.is_nan() { None } else { Some(a < b) }
    }

    pub fn add(&self, other: &JsValue<'a>) -> JsValue<'a> {
        let (a, b) = (self.to_primitive(), other.to_primitive());
        if matches!(a, JsValue::String(_)) || matches!(b, JsValue::String(_)) {
            JsValue::string(a.to_js_string() + &b.to_js_string())
        } else {
            JsValue::Number(a.to_number() + b.to_number())
        }
    }
}

fn join_doc(items: &[Json], separator: &str) -> String {
    let parts: Vec<String> = items
        .iter()
        .map(|item| match item {
            Json::Null => String::new(),
            item => JsValue::from_doc(item).to_js_string(),
        })
        .collect();
    parts.join(separator)
}

fn join_values(items: &[JsValue<'_>], separator: &str) -> String {
    let parts: Vec<String> = items
        .iter()
        .map(|item| match item {
            JsValue::Undefined | JsValue::Null => String::new(),
            item => item.to_js_string(),
        })
        .collect();
    parts.join(separator)
}

/// `StringToNumber`.
pub fn string_to_number(s: &str) -> f64 {
    let s = s.trim_matches(is_js_whitespace);
    if s.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = s.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0.0, |n, c| {
                n * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0))
            });
        }
    }
    let unsigned = s.strip_prefix(['+', '-']).unwrap_or(s);
    if unsigned == "Infinity" {
        return if s.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let bytes = unsigned.as_bytes();
    let mut i = 0;
    let int_digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
    i += int_digits;
    let mut frac_digits = 0;
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        frac_digits = bytes[i..].iter().take_while(|b| b.is_ascii_digit()).count();
        i += frac_digits;
    }
    if int_digits + frac_digits == 0 {
        return f64::NAN;
    }
    if let Some(b'e' | b'E') = bytes.get(i) {
        i += 1;
        if let Some(b'+' | b'-') = bytes.get(i) {
            i += 1;
        }
        let exp_digits = bytes[i..].iter().take_while(|b| b.is_ascii_digit()).count();
        if exp_digits == 0 {
            return f64::NAN;
        }
        i += exp_digits;
    }
    if i != bytes.len() {
        return f64::NAN;
    }
    s.parse::<f64>().unwrap_or(f64::NAN)
}

/// An own property, as `Object.hasOwn` sees it.
pub fn own_property<'a>(value: &JsValue<'a>, key: &str) -> Option<JsValue<'a>> {
    match value {
        JsValue::Doc(Json::Object(map)) => map.get(key).map(JsValue::from_doc),
        JsValue::Doc(Json::Array(items)) => {
            if key == "length" {
                return Some(JsValue::Number(items.len() as f64));
            }
            array_index(key).and_then(|i| items.get(i as usize)).map(JsValue::from_doc)
        }
        JsValue::Array(array) => {
            if key == "length" {
                return Some(JsValue::Number(array.items.len() as f64));
            }
            if let Some(info) = &array.match_info {
                match key {
                    "index" => return Some(JsValue::Number(info.index)),
                    "input" => return Some(JsValue::string(info.input.clone())),
                    "groups" => return Some(JsValue::Undefined),
                    _ => {}
                }
            }
            array_index(key).and_then(|i| array.items.get(i as usize)).cloned()
        }
        JsValue::String(s) => {
            if key == "length" {
                return Some(JsValue::Number(s.encode_utf16().count() as f64));
            }
            let i = array_index(key)? as usize;
            let unit = s.encode_utf16().nth(i)?;
            Some(JsValue::string(String::from_utf16_lossy(&[unit])))
        }
        JsValue::Regex(re) => match key {
            "lastIndex" => Some(JsValue::Number(re.last_index.get() as f64)),
            "source" => Some(JsValue::string(re.source.clone())),
            "flags" => {
                let mut flags: Vec<char> = re.flags.chars().collect();
                flags.sort_by_key(|f| "dgimsuvy".find(*f));
                Some(JsValue::string(flags.into_iter().collect::<String>()))
            }
            _ => [
                "hasIndices",
                "global",
                "ignoreCase",
                "multiline",
                "dotAll",
                "unicode",
                "unicodeSets",
                "sticky",
            ]
            .iter()
            .position(|name| *name == key)
            .map(|i| JsValue::Bool(re.flags.contains("dgimsuvy".as_bytes()[i] as char))),
        },
        JsValue::Doc(_)
        | JsValue::Undefined
        | JsValue::Null
        | JsValue::Bool(_)
        | JsValue::Number(_)
        | JsValue::Function(_) => None,
    }
}

/// `object[key]` in the safe evaluator: own properties, then the allowlisted
/// methods; any other inherited member is refused rather than guessed at.
pub fn get_property<'a>(object: &JsValue<'a>, key: &str) -> Result<JsValue<'a>, String> {
    if matches!(object, JsValue::Undefined | JsValue::Null) {
        return Err(format!(
            "Cannot read properties of {} (reading '{key}')",
            object.to_js_string()
        ));
    }
    if let Some(own) = own_property(object, key) {
        return Ok(own);
    }
    if BLOCKED.contains(&key) {
        return Err(format!(
            "Cannot read properties of {} (reading '{key}')",
            object.to_js_string()
        ));
    }
    let (methods, proto, kind): (&[(&str, Method)], &[&str], &str) = match object {
        JsValue::String(_) => (STRING_METHODS, STRING_PROTO, "a string"),
        JsValue::Doc(Json::Array(_)) | JsValue::Array(_) => {
            (ARRAY_METHODS, ARRAY_PROTO, "an array")
        }
        JsValue::Number(_) => (NUMBER_METHODS, NUMBER_PROTO, "a number"),
        JsValue::Regex(_) => (REGEX_METHODS, REGEX_PROTO, "a regular expression"),
        JsValue::Bool(_) => (&[], BOOLEAN_PROTO, "a boolean"),
        JsValue::Function(_) => (&[], FUNCTION_PROTO, "a function"),
        JsValue::Doc(_) | JsValue::Undefined | JsValue::Null => (&[], &[], "an object"),
    };
    if let Some((_, method)) = methods.iter().find(|(name, _)| *name == key) {
        return Ok(JsValue::Function(Rc::new(BoundMethod {
            receiver: object.clone(),
            method: *method,
        })));
    }
    if proto.contains(&key) || OBJECT_PROTO.contains(&key) {
        return Err(format!("{key} is not supported on {kind}"));
    }
    Ok(JsValue::Undefined)
}

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn find_units(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return (from <= haystack.len()).then_some(from);
    }
    (from..=haystack.len().checked_sub(needle.len())?).find(|&i| haystack[i..].starts_with(needle))
}

fn clamp_index(n: f64, len: usize) -> usize {
    n.clamp(0.0, len as f64) as usize
}

/// A relative start or end index, as `slice` and `includes` take them.
fn relative_index(n: f64, len: usize) -> usize {
    if n < 0.0 { clamp_index(len as f64 + n, len) } else { clamp_index(n, len) }
}

fn arg<'v, 'a>(args: &'v [JsValue<'a>], i: usize) -> &'v JsValue<'a> {
    args.get(i).unwrap_or(&JsValue::Undefined)
}

pub fn call_method<'a>(
    bound: &BoundMethod<'a>,
    args: &[JsValue<'a>],
) -> Result<JsValue<'a>, String> {
    let receiver = &bound.receiver;
    match bound.method {
        Method::StringIncludes
        | Method::StringStartsWith
        | Method::StringEndsWith
        | Method::StringIndexOf
        | Method::StringLastIndexOf
        | Method::StringToLowerCase
        | Method::StringToUpperCase
        | Method::StringTrim
        | Method::StringTrimStart
        | Method::StringTrimEnd
        | Method::StringSlice
        | Method::StringSubstring
        | Method::StringSplit
        | Method::StringMatch
        | Method::StringToString => string_method(bound.method, &receiver.to_js_string(), args),
        Method::ArrayIncludes
        | Method::ArrayIndexOf
        | Method::ArrayJoin
        | Method::ArrayToString => {
            let items: Vec<JsValue<'a>> = match receiver {
                JsValue::Doc(Json::Array(items)) => items.iter().map(JsValue::from_doc).collect(),
                JsValue::Array(array) => array.items.clone(),
                _ => Vec::new(),
            };
            array_method(bound.method, &items, args)
        }
        Method::NumberToString => {
            let n = receiver.to_number();
            let radix = arg(args, 0);
            let radix = if matches!(radix, JsValue::Undefined) { 10.0 } else { radix.to_integer() };
            if !(2.0..=36.0).contains(&radix) {
                return Err("toString() radix must be between 2 and 36".to_string());
            }
            Ok(JsValue::string(number_to_radix(n, radix as u32)))
        }
        Method::NumberToFixed => {
            let digits = arg(args, 0).to_integer();
            if !(0.0..=100.0).contains(&digits) {
                return Err("toFixed() digits argument must be between 0 and 100".to_string());
            }
            Ok(JsValue::string(to_fixed(receiver.to_number(), digits as usize)))
        }
        Method::RegexTest => match receiver {
            JsValue::Regex(re) => re.test(&arg(args, 0).to_js_string()).map(JsValue::Bool),
            _ => Ok(JsValue::Bool(false)),
        },
    }
}

fn string_method<'a>(method: Method, s: &str, args: &[JsValue<'a>]) -> Result<JsValue<'a>, String> {
    let units = utf16(s);
    let len = units.len();
    let search_string = |i: usize| -> Result<Vec<u16>, String> {
        if let JsValue::Regex(_) = arg(args, i) {
            return Err(format!(
                "First argument to String.prototype.{} must not be a regular expression",
                method.name()
            ));
        }
        Ok(utf16(&arg(args, i).to_js_string()))
    };
    Ok(match method {
        Method::StringIncludes => {
            let needle = search_string(0)?;
            let from = clamp_index(arg(args, 1).to_integer(), len);
            JsValue::Bool(find_units(&units, &needle, from).is_some())
        }
        Method::StringStartsWith => {
            let needle = search_string(0)?;
            let from = clamp_index(arg(args, 1).to_integer(), len);
            JsValue::Bool(units[from..].starts_with(&needle))
        }
        Method::StringEndsWith => {
            let needle = search_string(0)?;
            let end = match arg(args, 1) {
                JsValue::Undefined => len,
                end => clamp_index(end.to_integer(), len),
            };
            JsValue::Bool(units[..end].ends_with(&needle))
        }
        Method::StringIndexOf => {
            let needle = utf16(&arg(args, 0).to_js_string());
            let from = clamp_index(arg(args, 1).to_integer(), len);
            JsValue::Number(find_units(&units, &needle, from).map_or(-1.0, |i| i as f64))
        }
        Method::StringLastIndexOf => {
            let needle = utf16(&arg(args, 0).to_js_string());
            let position = arg(args, 1).to_number();
            let start = if position.is_nan() { len } else { clamp_index(position.trunc(), len) };
            let last = len.checked_sub(needle.len()).map(|max| start.min(max));
            let found =
                last.and_then(|last| (0..=last).rev().find(|&i| units[i..].starts_with(&needle)));
            JsValue::Number(found.map_or(-1.0, |i| i as f64))
        }
        Method::StringToLowerCase => JsValue::string(s.to_lowercase()),
        Method::StringToUpperCase => JsValue::string(s.to_uppercase()),
        Method::StringTrim => JsValue::string(s.trim_matches(is_js_whitespace)),
        Method::StringTrimStart => JsValue::string(s.trim_start_matches(is_js_whitespace)),
        Method::StringTrimEnd => JsValue::string(s.trim_end_matches(is_js_whitespace)),
        Method::StringSlice => {
            let start = relative_index(arg(args, 0).to_integer(), len);
            let end = match arg(args, 1) {
                JsValue::Undefined => len,
                end => relative_index(end.to_integer(), len),
            };
            JsValue::string(if start < end {
                from_utf16(&units[start..end])
            } else {
                String::new()
            })
        }
        Method::StringSubstring => {
            let start = clamp_index(arg(args, 0).to_integer(), len);
            let end = match arg(args, 1) {
                JsValue::Undefined => len,
                end => clamp_index(end.to_integer(), len),
            };
            JsValue::string(from_utf16(&units[start.min(end)..start.max(end)]))
        }
        Method::StringSplit => split(s, &units, arg(args, 0), arg(args, 1))?,
        Method::StringMatch => {
            let regex = match arg(args, 0) {
                JsValue::Regex(re) => re.clone(),
                JsValue::Undefined => Rc::new(JsRegex::new("(?:)", "")?),
                other => Rc::new(JsRegex::new(&other.to_js_string(), "")?),
            };
            regex.match_string(s)?
        }
        Method::StringToString => JsValue::string(s),
        Method::ArrayIncludes
        | Method::ArrayIndexOf
        | Method::ArrayJoin
        | Method::ArrayToString
        | Method::NumberToString
        | Method::NumberToFixed
        | Method::RegexTest => JsValue::Undefined,
    })
}

fn split<'a>(
    s: &str,
    units: &[u16],
    separator: &JsValue<'a>,
    limit: &JsValue<'a>,
) -> Result<JsValue<'a>, String> {
    let limit = match limit {
        JsValue::Undefined => u32::MAX,
        limit => limit.to_uint32(),
    } as usize;
    if let JsValue::Regex(re) = separator {
        let parts = re.split(s, limit)?;
        return Ok(JsValue::array(parts));
    }
    if limit == 0 {
        return Ok(JsValue::array(Vec::new()));
    }
    if let JsValue::Undefined = separator {
        return Ok(JsValue::array(vec![JsValue::string(s)]));
    }
    let separator = utf16(&separator.to_js_string());
    let parts: Vec<JsValue<'a>> = if separator.is_empty() {
        units.iter().map(|u| JsValue::string(from_utf16(&[*u]))).collect()
    } else {
        let mut parts = Vec::new();
        let mut start = 0;
        while let Some(i) = find_units(units, &separator, start) {
            parts.push(JsValue::string(from_utf16(&units[start..i])));
            start = i + separator.len();
        }
        parts.push(JsValue::string(from_utf16(&units[start..])));
        parts
    };
    Ok(JsValue::array(parts.into_iter().take(limit).collect()))
}

fn array_method<'a>(
    method: Method,
    items: &[JsValue<'a>],
    args: &[JsValue<'a>],
) -> Result<JsValue<'a>, String> {
    let len = items.len();
    Ok(match method {
        Method::ArrayIncludes => {
            let from = relative_index(arg(args, 1).to_integer(), len);
            JsValue::Bool(items[from..].iter().any(|item| item.same_value_zero(arg(args, 0))))
        }
        Method::ArrayIndexOf => {
            let from = relative_index(arg(args, 1).to_integer(), len);
            let found = items[from..].iter().position(|item| item.strict_eq(arg(args, 0)));
            JsValue::Number(found.map_or(-1.0, |i| (i + from) as f64))
        }
        Method::ArrayJoin => {
            let separator = match arg(args, 0) {
                JsValue::Undefined => ",".to_string(),
                separator => separator.to_js_string(),
            };
            JsValue::string(join_values(items, &separator))
        }
        Method::ArrayToString => JsValue::string(join_values(items, ",")),
        Method::StringIncludes
        | Method::StringStartsWith
        | Method::StringEndsWith
        | Method::StringIndexOf
        | Method::StringLastIndexOf
        | Method::StringToLowerCase
        | Method::StringToUpperCase
        | Method::StringTrim
        | Method::StringTrimStart
        | Method::StringTrimEnd
        | Method::StringSlice
        | Method::StringSubstring
        | Method::StringSplit
        | Method::StringMatch
        | Method::StringToString
        | Method::NumberToString
        | Method::NumberToFixed
        | Method::RegexTest => JsValue::Undefined,
    })
}

/// V8's `DoubleToRadixCString`, digit for digit.
fn number_to_radix(value: f64, radix: u32) -> String {
    if radix == 10 || !value.is_finite() {
        return number_to_string(value);
    }
    let digit_char = |d: u32| std::char::from_digit(d, radix).unwrap_or('0');
    let next_double = |x: f64| f64::from_bits(x.to_bits() + 1);
    let exponent = |x: f64| {
        let biased = ((x.to_bits() >> 52) & 0x7FF) as i32;
        if biased == 0 { -1074 } else { biased - 1075 }
    };
    let radix_f = f64::from(radix);
    let negative = value < 0.0;
    let value = value.abs();
    let mut integer = value.floor();
    let mut fraction = value - integer;
    let mut delta = (0.5 * (next_double(value) - value)).max(next_double(0.0));
    let mut fraction_digits: Vec<u32> = Vec::new();
    let mut has_point = false;
    if fraction >= delta {
        has_point = true;
        loop {
            fraction *= radix_f;
            delta *= radix_f;
            let digit = fraction as u32;
            fraction_digits.push(digit);
            fraction -= f64::from(digit);
            if (fraction > 0.5 || (fraction == 0.5 && digit & 1 == 1)) && fraction + delta > 1.0 {
                loop {
                    match fraction_digits.pop() {
                        None => {
                            integer += 1.0;
                            break;
                        }
                        Some(d) if d + 1 < radix => {
                            fraction_digits.push(d + 1);
                            break;
                        }
                        Some(_) => {}
                    }
                }
                break;
            }
            if fraction < delta {
                break;
            }
        }
    }
    let mut integer_digits: Vec<char> = Vec::new();
    while exponent(integer / radix_f) > 0 {
        integer /= radix_f;
        integer_digits.push('0');
    }
    loop {
        let remainder = integer % radix_f;
        integer_digits.push(digit_char(remainder as u32));
        integer = (integer - remainder) / radix_f;
        if integer <= 0.0 {
            break;
        }
    }
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.extend(integer_digits.iter().rev());
    if has_point && !fraction_digits.is_empty() {
        out.push('.');
        out.extend(fraction_digits.iter().map(|d| digit_char(*d)));
    }
    out
}

/// `Number.prototype.toFixed`: exact decimal value, ties away from zero.
fn to_fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() || x.abs() >= 1e21 {
        return number_to_string(x);
    }
    let exact = format!("{:.1100}", x.abs());
    let (int_part, frac_part) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut kept: Vec<u8> = int_part.bytes().chain(frac_part.bytes().take(digits)).collect();
    if frac_part.as_bytes().get(digits).is_some_and(|d| *d >= b'5') {
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, b'1');
                break;
            }
            i -= 1;
            if kept[i] == b'9' {
                kept[i] = b'0';
            } else {
                kept[i] += 1;
                break;
            }
        }
    }
    let int_len = kept.len() - digits;
    let mut out = String::from_utf8_lossy(&kept[..int_len]).into_owned();
    if digits > 0 {
        out.push('.');
        out.push_str(&String::from_utf8_lossy(&kept[int_len..]));
    }
    if x < 0.0 { format!("-{out}") } else { out }
}
