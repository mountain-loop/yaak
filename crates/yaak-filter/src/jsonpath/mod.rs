//! A port of jsonpath-plus 11.0.0 (`JSONPath({ path, json })` with its default
//! options and safe evaluator), so expressions written for the JavaScript
//! filter plugin keep their results. Where it differs on purpose: quoted
//! bracket names are always literal keys, and some RFC 9535 syntax that
//! jsonpath-plus finds nothing for works (`[-1]`, `[::-1]`, `[?@.a > 1]`,
//! `length()`, `count()`, `match()`, `search()`, `value()`).

mod json;
mod path;
mod regex;
mod rfc;
mod script;
mod value;

use json::Json;
pub(crate) use json::number_to_string;
use path::Loc;
use regex::JsRegex;
use rfc::Query;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::LazyLock;
use value::{JsValue, own_property};

/// Nested `_trace` calls; a debug build spends about 8 KB of stack on each.
const MAX_DEPTH: usize = 180;
/// Steps a single evaluation may take; `..` after `..` grows exponentially with nesting.
const MAX_STEPS: usize = 20_000_000;

pub fn evaluate(text: &str, query: &str) -> Result<String, String> {
    let root = json::parse(text).map_err(|e| format!("Invalid JSON: {e}"))?;
    if let Some(keys) = path::literal_keys(query) {
        let found = keys.iter().try_fold(JsValue::from_doc(&root), |v, k| own_property(&v, k));
        return Ok(json::stringify_results(found.as_slice()));
    }
    let engine = Engine::new(&root);
    let values =
        engine.run(query, &JsValue::from_doc(&root)).map_err(|e| format!("Invalid filter: {e}"))?;
    Ok(json::stringify_results(&values))
}

#[derive(Clone, Debug)]
enum PathElem {
    Str(Rc<str>),
    Num(f64),
}

impl PathElem {
    fn to_js(&self) -> JsValue<'static> {
        match self {
            PathElem::Str(s) => JsValue::string(s.to_string()),
            PathElem::Num(n) => JsValue::Number(*n),
        }
    }

    fn text(&self) -> String {
        match self {
            PathElem::Str(s) => s.to_string(),
            PathElem::Num(n) => number_to_string(*n),
        }
    }
}

struct PathNode {
    elem: PathElem,
    prev: Path,
}

/// The steps from the root, newest first and shared, as jsonpath-plus copies its arrays.
type Path = Option<Rc<PathNode>>;

fn push(path: &Path, elem: PathElem) -> Path {
    Some(Rc::new(PathNode { elem, prev: path.clone() }))
}

/// `JSONPath.toPathString`.
fn path_string(path: &Path) -> String {
    let mut elems = Vec::new();
    let mut node = path.as_ref();
    while let Some(n) = node {
        elems.push(n.elem.text());
        node = n.prev.as_ref();
    }
    elems.reverse();
    let mut out = "$".to_string();
    for elem in elems.iter().skip(1) {
        let operator =
            elem == "~" || elem == "^" || (elem.starts_with('@') && elem.ends_with("()"));
        if operator {
            continue;
        }
        if !elem.is_empty() && elem.bytes().all(|b| b.is_ascii_digit() || b == b'*') {
            out.push_str(&format!("[{elem}]"));
        } else {
            out.push_str(&format!("['{elem}']"));
        }
    }
    out
}

struct Ret<'a> {
    path: Path,
    value: JsValue<'a>,
    /// The steps after a `^`, to trace again from the parent.
    parent_selector: Option<Rc<[Loc]>>,
}

enum Traced<'a> {
    One(Ret<'a>),
    Many(Vec<Option<Ret<'a>>>),
}

fn add<'a>(ret: &mut Vec<Option<Ret<'a>>>, traced: Traced<'a>) {
    match traced {
        Traced::One(r) => ret.push(Some(r)),
        Traced::Many(items) => ret.extend(items),
    }
}

enum FilterPlan {
    /// jsonpath-plus spots `@.key[?(...)]` in a filter and keeps the items
    /// whose `key` the inner filter selects anything from, ignoring the rest.
    Nested {
        key: String,
        inner: Loc,
    },
    Script(Rc<Script>),
}

struct Script {
    expr: script::Expr,
    code: String,
    uses_path: bool,
}

#[allow(clippy::type_complexity)]
pub(crate) struct Engine<'a> {
    root: &'a Json,
    paths: RefCell<HashMap<String, Rc<[Loc]>>>,
    scripts: RefCell<HashMap<String, Rc<Script>>>,
    filters: RefCell<HashMap<String, Rc<FilterPlan>>>,
    rfc_filters: RefCell<HashMap<String, Rc<rfc::Logical>>>,
    /// RFC 9535 `match()` and `search()` patterns, `None` when invalid.
    regexes: RefCell<HashMap<(String, bool), Option<Rc<JsRegex>>>>,
    has_parent_selector: Cell<bool>,
    depth: Cell<usize>,
    steps: Cell<usize>,
}

static SLICE: LazyLock<fancy_regex::Regex> = LazyLock::new(|| {
    fancy_regex::Regex::new(r"^(-?[0-9]*):(-?[0-9]*):?([0-9]*)$")
        .unwrap_or_else(|e| unreachable!("{e}"))
});
static NESTED: LazyLock<fancy_regex::Regex> = LazyLock::new(|| {
    fancy_regex::Regex::new(r"@[^\n\r\x{2028}\x{2029}]?([^?]*)[\['](\??\([^\n\r\x{2028}\x{2029}]*?\))(?![^\n\r\x{2028}\x{2029}]\)\])[\]']")
        .unwrap_or_else(|e| unreachable!("{e}"))
});

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

impl<'a> Engine<'a> {
    fn new(root: &'a Json) -> Self {
        Engine {
            root,
            paths: RefCell::default(),
            scripts: RefCell::default(),
            filters: RefCell::default(),
            rfc_filters: RefCell::default(),
            regexes: RefCell::default(),
            has_parent_selector: Cell::new(false),
            depth: Cell::new(0),
            steps: Cell::new(0),
        }
    }

    /// `JSONPath.evaluate` from `start`, as values.
    fn run(&self, query: &str, start: &JsValue<'a>) -> Result<Vec<JsValue<'a>>, String> {
        let locs = self.path(query)?;
        let locs: &[Loc] = match &locs[..] {
            [Loc::Str(first), rest @ ..] if &**first == "$" && !rest.is_empty() => rest,
            all => all,
        };
        let root_path = push(&None, PathElem::Str("$".into()));
        let frame = Frame {
            expr: locs,
            val: start,
            path: &root_path,
            parent: &JsValue::Null,
            parent_prop: &JsValue::Null,
            literal_priority: false,
        };
        let traced = self.trace(&frame)?;
        let rets = match traced {
            Traced::One(r) => vec![Some(r)],
            Traced::Many(items) => items,
        };
        Ok(rets
            .into_iter()
            .flatten()
            .filter(|r| r.parent_selector.is_none())
            .map(|r| r.value)
            .collect())
    }

    pub(crate) fn query(
        &self,
        query: &Query,
        current: &JsValue<'a>,
    ) -> Result<Vec<JsValue<'a>>, String> {
        let start = if query.root { JsValue::from_doc(self.root) } else { current.clone() };
        self.run(&query.path, &start)
    }

    pub(crate) fn i_regexp(&self, pattern: &str, whole: bool) -> Option<Rc<JsRegex>> {
        self.regexes
            .borrow_mut()
            .entry((pattern.to_string(), whole))
            .or_insert_with(|| JsRegex::i_regexp(pattern, whole).map(Rc::new))
            .clone()
    }

    fn path(&self, query: &str) -> Result<Rc<[Loc]>, String> {
        if let Some(locs) = self.paths.borrow().get(query) {
            return Ok(locs.clone());
        }
        let locs: Rc<[Loc]> = path::parse(query)?.into();
        for loc in locs.iter() {
            self.check(loc)?;
        }
        self.paths.borrow_mut().insert(query.to_string(), locs.clone());
        Ok(locs)
    }

    /// Compiles what a step will evaluate, so a malformed or unsupported
    /// expression is an error even when no node reaches it.
    fn check(&self, loc: &Loc) -> Result<(), String> {
        match loc {
            Loc::Str(s) | Loc::Part(s) => {
                if s.starts_with("?(") {
                    self.filter(s).map(drop)
                } else if s.starts_with('(') {
                    self.script(s).map(drop)
                } else if s.contains(',') {
                    s.split(',').try_for_each(|part| self.check(&Loc::Part(part.into())))
                } else {
                    Ok(())
                }
            }
            Loc::Filter(text) => self.rfc_filter(text).map(drop),
            Loc::Num(_) | Loc::Other(_) | Loc::ArrayKey(_) | Loc::Names(_) => Ok(()),
        }
    }

    fn script(&self, code: &str) -> Result<Rc<Script>, String> {
        if let Some(script) = self.scripts.borrow().get(code) {
            return Ok(script.clone());
        }
        let expr = script::parse(&script::substitute(code)).map_err(|e| format!("{e}: {code}"))?;
        let script =
            Rc::new(Script { expr, code: code.to_string(), uses_path: code.contains("@path") });
        self.scripts.borrow_mut().insert(code.to_string(), script.clone());
        Ok(script)
    }

    fn filter(&self, loc: &str) -> Result<Rc<FilterPlan>, String> {
        if let Some(plan) = self.filters.borrow().get(loc) {
            return Ok(plan.clone());
        }
        let code = match loc.strip_prefix("?(").and_then(|s| s.strip_suffix(')')) {
            Some(inner) if !loc.contains(is_line_terminator) => inner,
            _ => loc,
        };
        let nested = NESTED.captures(code).map_err(|e| e.to_string())?;
        let plan = match nested {
            Some(c) => {
                let inner = Loc::Str(c[2].into());
                self.check(&inner)?;
                FilterPlan::Nested { key: c[1].to_string(), inner }
            }
            None => FilterPlan::Script(self.script(code)?),
        };
        let plan = Rc::new(plan);
        self.filters.borrow_mut().insert(loc.to_string(), plan.clone());
        Ok(plan)
    }

    fn rfc_filter(&self, text: &str) -> Result<Rc<rfc::Logical>, String> {
        if let Some(filter) = self.rfc_filters.borrow().get(text) {
            return Ok(filter.clone());
        }
        let filter = Rc::new(rfc::parse(text).map_err(|e| format!("{e}: ?{text}"))?);
        self.rfc_filters.borrow_mut().insert(text.to_string(), filter.clone());
        Ok(filter)
    }

    fn run_script(
        &self,
        script: &Script,
        value: &JsValue<'a>,
        property: JsValue<'a>,
        path: impl FnOnce() -> String,
        parent: &JsValue<'a>,
        parent_property: &JsValue<'a>,
    ) -> Result<JsValue<'a>, String> {
        let scope = script::Scope {
            value: value.clone(),
            property,
            parent: parent.clone(),
            parent_property: parent_property.clone(),
            path: script.uses_path.then(path),
        };
        script::eval(&script.expr, &scope, self).map_err(|e| format!("{e}: {}", script.code))
    }

    fn trace(&self, f: &Frame<'_, 'a>) -> Result<Traced<'a>, String> {
        let depth = self.depth.get() + 1;
        if depth > MAX_DEPTH {
            return Err("the path goes too deep".to_string());
        }
        self.steps.set(self.steps.get() + 1);
        if self.steps.get() > MAX_STEPS {
            return Err("the path takes too many steps to evaluate".to_string());
        }
        self.depth.set(depth);
        let traced = self.trace_inner(f);
        self.depth.set(depth - 1);
        traced
    }

    /// Traces the rest of the path from a child of the frame's value.
    fn child(
        &self,
        f: &Frame<'_, 'a>,
        child: &JsValue<'a>,
        elem: PathElem,
        literal_priority: bool,
        ret: &mut Vec<Option<Ret<'a>>>,
    ) -> Result<(), String> {
        let path = push(f.path, elem.clone());
        let parent_prop = elem.to_js();
        let next = Frame {
            expr: f.rest(),
            val: child,
            path: &path,
            parent: f.val,
            parent_prop: &parent_prop,
            literal_priority,
        };
        add(ret, self.trace(&next)?);
        Ok(())
    }

    /// Traces other steps from the frame's own value.
    fn again(
        &self,
        f: &Frame<'_, 'a>,
        expr: &[Loc],
        ret: &mut Vec<Option<Ret<'a>>>,
    ) -> Result<(), String> {
        add(ret, self.trace(&Frame { expr, literal_priority: false, ..*f })?);
        Ok(())
    }

    fn with_first(first: Loc, rest: &[Loc]) -> Vec<Loc> {
        std::iter::once(first).chain(rest.iter().cloned()).collect()
    }

    fn trace_inner(&self, f: &Frame<'_, 'a>) -> Result<Traced<'a>, String> {
        let Some(loc) = f.expr.first() else {
            return Ok(Traced::One(Ret {
                path: f.path.clone(),
                value: f.val.clone(),
                parent_selector: None,
            }));
        };
        let mut ret = Vec::new();
        match loc {
            Loc::Names(names) => {
                let child_priority = names.len() > 1 || !f.literal_priority;
                for name in names.iter() {
                    if let Some(child) = f.own(name) {
                        self.child(
                            f,
                            &child,
                            PathElem::Str(name.as_str().into()),
                            child_priority,
                            &mut ret,
                        )?;
                    }
                }
            }
            Loc::Filter(text) => {
                let filter = self.rfc_filter(text)?;
                for (m, child) in walk(f.val) {
                    if filter.test(&child, self)? {
                        self.child(f, &child, m, false, &mut ret)?;
                    }
                }
            }
            Loc::Num(_) | Loc::Other(_) | Loc::ArrayKey(_) => {
                let elem = match loc {
                    Loc::Num(n) => PathElem::Num(*n),
                    _ => PathElem::Str(loc_text(loc).into()),
                };
                match f.own(&elem.text()) {
                    Some(child) => self.child(f, &child, elem, false, &mut ret)?,
                    None if matches!(loc, Loc::ArrayKey(_)) => {}
                    None => {
                        return Err(format!(
                            "{} is not a property name the path can follow",
                            elem.text()
                        ));
                    }
                }
            }
            Loc::Str(s) | Loc::Part(s) => {
                if let Some(early) = self.trace_str(f, s, matches!(loc, Loc::Str(_)), &mut ret)? {
                    return Ok(early);
                }
            }
        }
        if self.has_parent_selector.get() {
            self.resolve_parent_selectors(f, &mut ret)?;
        }
        Ok(Traced::Many(ret))
    }

    /// A `^` below this frame resolves here, by tracing what follows it from this frame's value.
    fn resolve_parent_selectors(
        &self,
        f: &Frame<'_, 'a>,
        ret: &mut Vec<Option<Ret<'a>>>,
    ) -> Result<(), String> {
        let mut t = 0;
        while t < ret.len() {
            let selector = ret[t]
                .as_ref()
                .and_then(|r| r.parent_selector.clone().map(|s| (s, r.path.clone())));
            if let Some((rest, path)) = selector {
                let frame = Frame { expr: &rest, path: &path, literal_priority: false, ..*f };
                match self.trace(&frame)? {
                    Traced::One(r) => ret[t] = Some(r),
                    Traced::Many(items) => {
                        let mut items = items.into_iter();
                        ret[t] = items.next().flatten();
                        for item in items {
                            t += 1;
                            ret.insert(t, item);
                        }
                    }
                }
            }
            t += 1;
        }
        Ok(())
    }

    /// `_trace` for a text step, in jsonpath-plus's order of tests. Returns
    /// the result itself for the steps that end the trace (`^`, `~`, a type).
    fn trace_str(
        &self,
        f: &Frame<'_, 'a>,
        s: &str,
        rfc_additions: bool,
        ret: &mut Vec<Option<Ret<'a>>>,
    ) -> Result<Option<Traced<'a>>, String> {
        let named = |key: &str| PathElem::Str(key.into());
        if let Some(child) = f.own(s).filter(|_| f.literal_priority) {
            self.child(f, &child, named(s), false, ret)?;
        } else if s == "*" {
            for (m, child) in walk(f.val) {
                self.child(f, &child, m, true, ret)?;
            }
        } else if s == ".." {
            self.again(f, f.rest(), ret)?;
            for (m, child) in walk(f.val) {
                if matches!(child, JsValue::Doc(_) | JsValue::Null) {
                    let path = push(f.path, m.clone());
                    let parent_prop = m.to_js();
                    let next = Frame {
                        val: &child,
                        path: &path,
                        parent: f.val,
                        parent_prop: &parent_prop,
                        literal_priority: false,
                        ..*f
                    };
                    add(ret, self.trace(&next)?);
                }
            }
        } else if s == "^" {
            self.has_parent_selector.set(true);
            let parent_path = f.path.as_ref().and_then(|n| n.prev.clone());
            return Ok(Some(Traced::One(Ret {
                path: parent_path,
                value: JsValue::Undefined,
                parent_selector: Some(f.rest().into()),
            })));
        } else if s == "~" {
            return Ok(Some(Traced::One(Ret {
                path: push(f.path, named("~")),
                value: f.parent_prop.clone(),
                parent_selector: None,
            })));
        } else if s == "$" {
            let frame = Frame {
                expr: f.rest(),
                parent: &JsValue::Null,
                parent_prop: &JsValue::Null,
                literal_priority: false,
                ..*f
            };
            add(ret, self.trace(&frame)?);
        } else if SLICE.is_match(s).map_err(|e| e.to_string())? {
            if let JsValue::Doc(Json::Array(items)) = f.val {
                self.trace_indexes(f, slice_indexes(s, items.len()), ret)?;
            }
        } else if s.starts_with("?(") {
            self.trace_filter(f, s, ret)?;
        } else if s.starts_with('(') {
            let script = self.script(s)?;
            let property = f.path.as_ref().map_or(JsValue::Undefined, |n| n.elem.to_js());
            let result = self.run_script(
                &script,
                f.val,
                property,
                || path_string(f.path),
                f.parent,
                f.parent_prop,
            )?;
            let next = match result {
                JsValue::Undefined => Loc::Str("".into()),
                JsValue::String(s) => Loc::Part(s.as_ref().into()),
                JsValue::Number(n) => Loc::Num(n),
                array @ (JsValue::Doc(Json::Array(_)) | JsValue::Array(_)) => {
                    Loc::ArrayKey(array.to_js_string().into())
                }
                other => Loc::Other(other.to_js_string().into()),
            };
            self.again(f, &Self::with_first(next, f.rest()), ret)?;
        } else if s.starts_with('@') {
            if value_type(s)?.matches(f.val) {
                return Ok(Some(Traced::One(Ret {
                    path: f.path.clone(),
                    value: f.val.clone(),
                    parent_selector: None,
                })));
            }
        } else if let Some((key, child)) =
            s.strip_prefix('`').and_then(|key| f.own(key).map(|child| (key, child)))
        {
            self.child(f, &child, named(key), true, ret)?;
        } else if s.contains(',') {
            for part in s.split(',') {
                self.again(f, &Self::with_first(Loc::Part(part.into()), f.rest()), ret)?;
            }
        } else if let Some(child) = f.own(s).filter(|_| !f.literal_priority) {
            self.child(f, &child, named(s), true, ret)?;
        } else if rfc_additions && let JsValue::Doc(Json::Array(items)) = f.val {
            if let Some(index) = negative_index(s, items.len()) {
                self.trace_indexes(f, vec![index], ret)?;
            } else if let Some(indexes) = reverse_slice_indexes(s, items.len()) {
                self.trace_indexes(f, indexes, ret)?;
            }
        }
        Ok(None)
    }

    fn trace_filter(
        &self,
        f: &Frame<'_, 'a>,
        loc: &str,
        ret: &mut Vec<Option<Ret<'a>>>,
    ) -> Result<(), String> {
        match &*self.filter(loc)? {
            FilterPlan::Nested { key, inner } => {
                for (m, child) in walk(f.val) {
                    let nested = if key.is_empty() {
                        child.clone()
                    } else if matches!(child, JsValue::Null) {
                        return Err(format!("Cannot read properties of null (reading '{key}')"));
                    } else {
                        own_property(&child, key).unwrap_or(JsValue::Undefined)
                    };
                    let frame = Frame {
                        expr: std::slice::from_ref(inner),
                        val: &nested,
                        literal_priority: false,
                        ..*f
                    };
                    let found = match self.trace(&frame)? {
                        Traced::One(_) => true,
                        Traced::Many(items) => !items.is_empty(),
                    };
                    if found {
                        self.child(f, &child, m, false, ret)?;
                    }
                }
            }
            FilterPlan::Script(script) => {
                for (m, child) in walk(f.val) {
                    let at_path = || path_string(&push(f.path, m.clone()));
                    if self
                        .run_script(script, &child, m.to_js(), at_path, f.parent, f.parent_prop)?
                        .truthy()
                    {
                        self.child(f, &child, m, false, ret)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn trace_indexes(
        &self,
        f: &Frame<'_, 'a>,
        indexes: Vec<f64>,
        ret: &mut Vec<Option<Ret<'a>>>,
    ) -> Result<(), String> {
        for i in indexes {
            self.again(f, &Self::with_first(Loc::Num(i), f.rest()), ret)?;
        }
        Ok(())
    }
}

/// One `_trace` call's arguments.
#[derive(Clone, Copy)]
struct Frame<'f, 'a> {
    expr: &'f [Loc],
    val: &'f JsValue<'a>,
    path: &'f Path,
    parent: &'f JsValue<'a>,
    parent_prop: &'f JsValue<'a>,
    literal_priority: bool,
}

impl<'a> Frame<'_, 'a> {
    fn rest(&self) -> &[Loc] {
        self.expr.get(1..).unwrap_or_default()
    }

    /// `val && Object.hasOwn(val, key)`, and the property.
    fn own(&self, key: &str) -> Option<JsValue<'a>> {
        self.val.truthy().then(|| own_property(self.val, key)).flatten()
    }
}

fn loc_text(loc: &Loc) -> String {
    match loc {
        Loc::Str(s) | Loc::Part(s) | Loc::Other(s) | Loc::ArrayKey(s) | Loc::Filter(s) => {
            s.to_string()
        }
        Loc::Num(n) => number_to_string(*n),
        Loc::Names(names) => names.join(","),
    }
}

/// `_walk`: array indexes, or object keys in `JSON.parse` order.
fn walk<'a>(val: &JsValue<'a>) -> Vec<(PathElem, JsValue<'a>)> {
    match val {
        JsValue::Doc(Json::Array(items)) => items
            .iter()
            .enumerate()
            .map(|(i, item)| (PathElem::Num(i as f64), JsValue::from_doc(item)))
            .collect(),
        JsValue::Doc(Json::Object(map)) => map
            .iter()
            .map(|(k, v)| (PathElem::Str(k.as_str().into()), JsValue::from_doc(v)))
            .collect(),
        _ => Vec::new(),
    }
}

/// `_slice`: Python-style `start:end:step` with jsonpath-plus's defaults.
fn slice_indexes(loc: &str, len: usize) -> Vec<f64> {
    let len = len as f64;
    let parts: Vec<&str> = loc.split(':').collect();
    let number = |s: &str| value::string_to_number(s);
    let or_default = |n: f64, default: f64| if n == 0.0 || n.is_nan() { default } else { n };
    let step = parts.get(2).filter(|s| !s.is_empty()).map_or(1.0, |s| or_default(number(s), 1.0));
    let start = parts.first().filter(|s| !s.is_empty()).map_or(0.0, |s| or_default(number(s), 0.0));
    let end = parts.get(1).filter(|s| !s.is_empty()).map_or(len, |s| number(s));
    let mut indexes = Vec::new();
    if end.is_nan() {
        return indexes;
    }
    let start = if start < 0.0 { (start + len).max(0.0) } else { start.min(len) };
    let end = if end < 0.0 { (end + len).max(0.0) } else { end.min(len) };
    let mut i = start;
    while i < end {
        indexes.push(i);
        i += step;
    }
    indexes
}

fn parse_int(s: &str) -> Option<i64> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(s.parse::<i64>().unwrap_or(if s.starts_with('-') { i64::MIN } else { i64::MAX }))
}

/// RFC 9535 `[-n]`, which jsonpath-plus looks up as the key "-n".
fn negative_index(loc: &str, len: usize) -> Option<f64> {
    let n = parse_int(loc).filter(|n| *n < 0 && !loc.starts_with("-0"))?;
    let index = len as i64 + n;
    (index >= 0).then_some(index as f64)
}

/// An RFC 9535 slice with a negative step, which jsonpath-plus does not read as a slice.
fn reverse_slice_indexes(loc: &str, len: usize) -> Option<Vec<f64>> {
    let parts: Vec<&str> = loc.split(':').collect();
    let [start, end, step] = parts[..] else {
        return None;
    };
    let step = parse_int(step).filter(|s| *s < 0)?;
    let bound = |s: &str| if s.is_empty() { Some(None) } else { parse_int(s).map(Some) };
    let (start, end) = (bound(start)?, bound(end)?);
    let len = len as i64;
    let normalize = |i: i64| if i >= 0 { i } else { len.saturating_add(i) };
    let upper = normalize(start.unwrap_or(len - 1)).clamp(-1, len - 1);
    let lower = end.map_or(-1, |e| normalize(e).clamp(-1, len - 1));
    let mut indexes = Vec::new();
    let mut i = upper;
    while lower < i {
        indexes.push(i as f64);
        i = i.saturating_add(step);
    }
    Some(indexes)
}

#[derive(Clone, Copy)]
enum ValueType {
    Scalar,
    Boolean,
    String,
    Undefined,
    Function,
    Integer,
    Number,
    NonFinite,
    Object,
    Array,
    Null,
}

/// The `@string()`-style step, by jsonpath-plus's `loc.slice(1, -2)`.
fn value_type(loc: &str) -> Result<ValueType, String> {
    let chars: Vec<char> = loc.chars().collect();
    let name: String =
        chars.get(1..chars.len().saturating_sub(2)).map(|c| c.iter().collect()).unwrap_or_default();
    Ok(match name.as_str() {
        "scalar" => ValueType::Scalar,
        "boolean" => ValueType::Boolean,
        "string" => ValueType::String,
        "undefined" => ValueType::Undefined,
        "function" => ValueType::Function,
        "integer" => ValueType::Integer,
        "number" => ValueType::Number,
        "nonFinite" => ValueType::NonFinite,
        "object" => ValueType::Object,
        "array" => ValueType::Array,
        "null" => ValueType::Null,
        "other" => {
            return Err(
                "@other() needs an otherTypeCallback, which filters cannot supply".to_string()
            );
        }
        name => return Err(format!("Unknown value type {name}")),
    })
}

impl ValueType {
    fn matches(self, val: &JsValue<'_>) -> bool {
        match self {
            ValueType::Scalar => !val.truthy() || !val.is_object(),
            ValueType::Boolean => matches!(val, JsValue::Bool(_)),
            ValueType::String => matches!(val, JsValue::String(_)),
            ValueType::Undefined => matches!(val, JsValue::Undefined),
            ValueType::Function => matches!(val, JsValue::Function(_)),
            ValueType::Integer => {
                matches!(val, JsValue::Number(n) if n.is_finite() && n.fract() == 0.0)
            }
            ValueType::Number => matches!(val, JsValue::Number(n) if n.is_finite()),
            ValueType::NonFinite => matches!(val, JsValue::Number(n) if !n.is_finite()),
            ValueType::Object => val.truthy() && val.type_of() == "object",
            ValueType::Array => matches!(val, JsValue::Doc(Json::Array(_)) | JsValue::Array(_)),
            ValueType::Null => matches!(val, JsValue::Null),
        }
    }
}
