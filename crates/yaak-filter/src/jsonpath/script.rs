//! jsonpath-plus's safe evaluator: jsep's grammar (with its regex plugin,
//! `typeof`, `void`, `undefined`) and Safe-Script's semantics, minus what it
//! would let a filter do beyond reading the document.

use super::Engine;
use super::regex::JsRegex;
use super::rfc::{Query, RfcFunction, scan_query};
use super::value::{JsValue, call_method, get_property, is_allowed_method_name, is_js_whitespace};
use std::rc::Rc;

const MAX_DEPTH: usize = 100;

#[derive(Debug)]
pub enum Expr {
    Literal(Literal),
    Ident(String),
    Member(Box<Expr>, Property),
    Call(Box<Expr>, Vec<Expr>),
    Rfc(RfcFunction, Vec<RfcArg>),
    Array(Vec<Expr>),
    Unary(UnaryOp, Box<Expr>),
    Binary(BinaryOp, Box<Expr>, Box<Expr>),
    Conditional(Box<Expr>, Box<Expr>, Box<Expr>),
}

#[derive(Debug)]
pub enum Literal {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Regex(Rc<JsRegex>),
}

#[derive(Debug)]
pub enum Property {
    Name(String),
    Computed(Box<Expr>),
}

#[derive(Debug)]
pub enum RfcArg {
    Value(Expr),
    Nodes(Query),
}

#[derive(Clone, Copy, Debug)]
pub enum UnaryOp {
    Neg,
    Plus,
    Not,
    BitNot,
    TypeOf,
    Void,
}

#[derive(Clone, Copy, Debug)]
pub enum BinaryOp {
    Or,
    And,
    BitOr,
    BitXor,
    BitAnd,
    Eq,
    Ne,
    StrictEq,
    StrictNe,
    Lt,
    Gt,
    Le,
    Ge,
    Shl,
    Shr,
    UShr,
    Add,
    Sub,
    Mul,
    Div,
    Rem,
}

impl BinaryOp {
    fn precedence(self) -> u8 {
        match self {
            BinaryOp::Or => 1,
            BinaryOp::And => 2,
            BinaryOp::BitOr => 3,
            BinaryOp::BitXor => 4,
            BinaryOp::BitAnd => 5,
            BinaryOp::Eq | BinaryOp::Ne | BinaryOp::StrictEq | BinaryOp::StrictNe => 6,
            BinaryOp::Lt | BinaryOp::Gt | BinaryOp::Le | BinaryOp::Ge => 7,
            BinaryOp::Shl | BinaryOp::Shr | BinaryOp::UShr => 8,
            BinaryOp::Add | BinaryOp::Sub => 9,
            BinaryOp::Mul | BinaryOp::Div | BinaryOp::Rem => 10,
        }
    }
}

const BINARY_OPS: &[(&str, Option<BinaryOp>)] = &[
    (">>>=", None),
    ("===", Some(BinaryOp::StrictEq)),
    ("!==", Some(BinaryOp::StrictNe)),
    (">>>", Some(BinaryOp::UShr)),
    ("**=", None),
    ("<<=", None),
    (">>=", None),
    ("||=", None),
    ("&&=", None),
    ("??=", None),
    ("||", Some(BinaryOp::Or)),
    ("&&", Some(BinaryOp::And)),
    ("==", Some(BinaryOp::Eq)),
    ("!=", Some(BinaryOp::Ne)),
    ("<=", Some(BinaryOp::Le)),
    (">=", Some(BinaryOp::Ge)),
    ("<<", Some(BinaryOp::Shl)),
    (">>", Some(BinaryOp::Shr)),
    ("**", None),
    ("??", None),
    ("*=", None),
    ("/=", None),
    ("%=", None),
    ("+=", None),
    ("-=", None),
    ("&=", None),
    ("^=", None),
    ("|=", None),
    ("|", Some(BinaryOp::BitOr)),
    ("^", Some(BinaryOp::BitXor)),
    ("&", Some(BinaryOp::BitAnd)),
    ("<", Some(BinaryOp::Lt)),
    (">", Some(BinaryOp::Gt)),
    ("+", Some(BinaryOp::Add)),
    ("-", Some(BinaryOp::Sub)),
    ("*", Some(BinaryOp::Mul)),
    ("/", Some(BinaryOp::Div)),
    ("%", Some(BinaryOp::Rem)),
    ("=", None),
];

const UNARY_OPS: &[(&str, UnaryOp)] = &[
    ("typeof", UnaryOp::TypeOf),
    ("void", UnaryOp::Void),
    ("-", UnaryOp::Neg),
    ("!", UnaryOp::Not),
    ("~", UnaryOp::BitNot),
    ("+", UnaryOp::Plus),
];

pub fn parse(code: &str) -> Result<Expr, String> {
    let mut parser = Parser { chars: code.chars().collect(), index: 0, depth: 0 };
    let mut nodes = parser.expressions(None)?;
    match nodes.len() {
        0 => Ok(Expr::Literal(Literal::Undefined)),
        1 => Ok(nodes.remove(0)),
        _ => match &nodes[0] {
            Expr::Ident(name) if matches!(name.as_str(), "var" | "let" | "const") => {
                Err(format!("variable declarations ({name}) are not supported"))
            }
            _ => {
                Err("multiple expressions (separated by `;` or `,`) are not supported".to_string())
            }
        },
    }
}

fn is_identifier_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '$' || c == '_' || (c as u32) >= 128
}

fn is_identifier_part(c: char) -> bool {
    is_identifier_start(c) || c.is_ascii_digit()
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

    fn peek_at(&self, offset: usize) -> Option<char> {
        self.chars.get(self.index + offset).copied()
    }

    fn rest_starts_with(&self, s: &str) -> bool {
        s.chars().enumerate().all(|(i, c)| self.peek_at(i) == Some(c))
    }

    fn error(&self, message: &str) -> String {
        format!("{message} at character {}", self.index)
    }

    fn unexpected(&self) -> String {
        self.error(&format!("Unexpected \"{}\"", self.peek().map(String::from).unwrap_or_default()))
    }

    fn spaces(&mut self) {
        while let Some(' ' | '\t' | '\n' | '\r') = self.peek() {
            self.index += 1;
        }
    }

    fn enter(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            Err("expression is nested too deeply".to_string())
        } else {
            Ok(())
        }
    }

    fn expressions(&mut self, until: Option<char>) -> Result<Vec<Expr>, String> {
        let mut nodes = Vec::new();
        while let Some(c) = self.peek() {
            if c == ';' || c == ',' {
                self.index += 1;
                continue;
            }
            match self.expression()? {
                Some(node) => nodes.push(node),
                None if self.index < self.chars.len() => {
                    if Some(c) == until {
                        break;
                    }
                    return Err(self.unexpected());
                }
                None => {}
            }
        }
        Ok(nodes)
    }

    fn expression(&mut self) -> Result<Option<Expr>, String> {
        self.enter()?;
        let node = self.binary_expression()?;
        self.spaces();
        let node = match node {
            Some(test) if self.peek() == Some('?') => {
                self.index += 1;
                let consequent =
                    self.expression()?.ok_or_else(|| self.error("Expected expression"))?;
                self.spaces();
                if self.peek() != Some(':') {
                    return Err(self.error("Expected :"));
                }
                self.index += 1;
                let alternate =
                    self.expression()?.ok_or_else(|| self.error("Expected expression"))?;
                Some(Expr::Conditional(Box::new(test), Box::new(consequent), Box::new(alternate)))
            }
            node => node,
        };
        self.depth -= 1;
        Ok(node)
    }

    fn binary_op(&mut self) -> Result<Option<BinaryOp>, String> {
        self.spaces();
        let Some((text, op)) = BINARY_OPS.iter().find(|(text, _)| self.rest_starts_with(text))
        else {
            return Ok(None);
        };
        match op {
            Some(op) => {
                self.index += text.chars().count();
                Ok(Some(*op))
            }
            None if text.ends_with('=') => Err(format!("assignment ({text}) is not supported")),
            None => Err(format!("the {text} operator is not supported")),
        }
    }

    fn binary_expression(&mut self) -> Result<Option<Expr>, String> {
        enum Item {
            Node(Expr),
            Op(BinaryOp),
        }
        let Some(left) = self.token()? else {
            return Ok(None);
        };
        let Some(op) = self.binary_op()? else {
            return Ok(Some(left));
        };
        let right =
            self.token()?.ok_or_else(|| self.error("Expected expression after operator"))?;
        let mut stack = vec![Item::Node(left), Item::Op(op), Item::Node(right)];
        let mut operators = 1;
        while let Some(op) = self.binary_op()? {
            operators += 1;
            if operators > MAX_DEPTH {
                return Err("expression has too many operators".to_string());
            }
            while stack.len() > 2
                && matches!(&stack[stack.len() - 2], Item::Op(prev) if op.precedence() <= prev.precedence())
            {
                let (Some(Item::Node(right)), Some(Item::Op(prev)), Some(Item::Node(left))) =
                    (stack.pop(), stack.pop(), stack.pop())
                else {
                    return Err(self.error("malformed expression"));
                };
                stack.push(Item::Node(Expr::Binary(prev, Box::new(left), Box::new(right))));
            }
            let node =
                self.token()?.ok_or_else(|| self.error("Expected expression after operator"))?;
            stack.push(Item::Op(op));
            stack.push(Item::Node(node));
        }
        let mut node = match stack.pop() {
            Some(Item::Node(node)) => node,
            _ => return Err(self.error("malformed expression")),
        };
        while let (Some(Item::Op(op)), Some(Item::Node(left))) = (stack.pop(), stack.pop()) {
            node = Expr::Binary(op, Box::new(left), Box::new(node));
        }
        Ok(Some(node))
    }

    fn after_token(&self, node: Option<Expr>) -> Result<Option<Expr>, String> {
        if node.is_some() && (self.rest_starts_with("++") || self.rest_starts_with("--")) {
            return Err("increment and decrement (++, --) are not supported".to_string());
        }
        Ok(node)
    }

    fn token(&mut self) -> Result<Option<Expr>, String> {
        self.spaces();
        self.enter()?;
        let node = self.token_inner();
        self.depth -= 1;
        node
    }

    fn token_inner(&mut self) -> Result<Option<Expr>, String> {
        if self.peek() == Some('/') {
            let regex = self.regex_literal()?;
            let node = self.token_property(regex)?;
            return self.after_token(Some(node));
        }
        if self.rest_starts_with("++") || self.rest_starts_with("--") {
            return Err("increment and decrement (++, --) are not supported".to_string());
        }
        let Some(c) = self.peek() else {
            return Ok(None);
        };
        if c.is_ascii_digit() || c == '.' {
            return self.number().map(Some);
        }
        let node = if c == '\'' || c == '"' {
            Expr::Literal(Literal::String(self.string_literal()?))
        } else if c == '[' {
            self.index += 1;
            let items = self.arguments(']')?;
            Expr::Array(items)
        } else {
            for (text, op) in UNARY_OPS {
                let len = text.chars().count();
                let word = is_identifier_start(c);
                if self.rest_starts_with(text)
                    && (!word || self.peek_at(len).is_some_and(|next| !is_identifier_part(next)))
                {
                    self.index += len;
                    let argument =
                        self.token()?.ok_or_else(|| self.error("missing unaryOp argument"))?;
                    return self.after_token(Some(Expr::Unary(*op, Box::new(argument))));
                }
            }
            if is_identifier_start(c) {
                let name = self.identifier()?;
                match name.as_str() {
                    "true" => Expr::Literal(Literal::Bool(true)),
                    "false" => Expr::Literal(Literal::Bool(false)),
                    "null" => Expr::Literal(Literal::Null),
                    "undefined" => Expr::Literal(Literal::Undefined),
                    "this" => return Err("`this` is not supported".to_string()),
                    _ => Expr::Ident(name),
                }
            } else if c == '(' {
                match self.group()? {
                    Some(node) => node,
                    None => return Ok(None),
                }
            } else {
                return Ok(None);
            }
        };
        let node = self.token_property(node)?;
        self.after_token(Some(node))
    }

    fn token_property(&mut self, mut node: Expr) -> Result<Expr, String> {
        self.spaces();
        let depth = self.depth;
        while let Some(mut c) = self.peek() {
            if !matches!(c, '.' | '[' | '(' | '?') {
                break;
            }
            self.enter()?;
            let mut optional = false;
            if c == '?' {
                if self.peek_at(1) != Some('.') {
                    break;
                }
                optional = true;
                self.index += 2;
                self.spaces();
                c = self.peek().unwrap_or(' ');
            }
            self.index += 1;
            if c == '[' {
                let property = self.expression()?.ok_or_else(|| self.unexpected())?;
                self.spaces();
                if self.peek() != Some(']') {
                    return Err(self.error("Unclosed ["));
                }
                self.index += 1;
                node = Expr::Member(Box::new(node), Property::Computed(Box::new(property)));
            } else if c == '(' {
                node = self.call(node)?;
            } else if c == '.' || optional {
                if optional {
                    self.index -= 1;
                }
                self.spaces();
                let name = self.identifier()?;
                node = Expr::Member(Box::new(node), Property::Name(name));
            }
            self.spaces();
        }
        self.depth = depth;
        Ok(node)
    }

    fn call(&mut self, callee: Expr) -> Result<Expr, String> {
        let function = match &callee {
            Expr::Ident(name) => match RfcFunction::from_name(name) {
                Some(function) => function,
                None => return Err(format!("unknown function {name}()")),
            },
            Expr::Member(_, Property::Name(name)) if !is_allowed_method_name(name) => {
                return Err(format!("unsupported method {name}()"));
            }
            _ => {
                let args = self.arguments(')')?;
                return Ok(Expr::Call(Box::new(callee), args));
            }
        };
        if !function.takes_nodes() {
            let args = self.arguments(')')?;
            if args.len() != function.arity() {
                return Err(format!(
                    "{}() takes {} argument(s)",
                    function.name(),
                    function.arity()
                ));
            }
            return Ok(Expr::Rfc(function, args.into_iter().map(RfcArg::Value).collect()));
        }
        self.spaces();
        let start = self.index;
        let (prefix_len, root) = if self.rest_starts_with("_$_root") {
            (7, true)
        } else if self.rest_starts_with("_$_v") {
            (4, false)
        } else if self.rest_starts_with("@") {
            (1, false)
        } else if self.rest_starts_with("$") {
            (1, true)
        } else {
            return Err(self.error(&format!("{}() takes a query (@ or $)", function.name())));
        };
        if self.peek_at(prefix_len).is_some_and(|c| is_identifier_part(c) && c != '$') {
            return Err(self.error(&format!("{}() takes a query (@ or $)", function.name())));
        }
        let (end, query) = scan_query(&self.chars, start + prefix_len, root);
        self.index = end;
        self.spaces();
        if self.peek() != Some(')') {
            return Err(self.error(&format!("{}() takes one query", function.name())));
        }
        self.index += 1;
        Ok(Expr::Rfc(function, vec![RfcArg::Nodes(query)]))
    }

    fn number(&mut self) -> Result<Expr, String> {
        let mut number = String::new();
        while let Some(c) = self.peek().filter(char::is_ascii_digit) {
            number.push(c);
            self.index += 1;
        }
        if self.peek() == Some('.') {
            number.push('.');
            self.index += 1;
            while let Some(c) = self.peek().filter(char::is_ascii_digit) {
                number.push(c);
                self.index += 1;
            }
        }
        if let Some(e @ ('e' | 'E')) = self.peek() {
            number.push(e);
            self.index += 1;
            if let Some(sign @ ('+' | '-')) = self.peek() {
                number.push(sign);
                self.index += 1;
            }
            while let Some(c) = self.peek().filter(char::is_ascii_digit) {
                number.push(c);
                self.index += 1;
            }
            if !number.ends_with(|c: char| c.is_ascii_digit()) {
                return Err(self.error(&format!("Expected exponent ({number})")));
            }
        }
        match self.peek() {
            Some(c) if is_identifier_start(c) => {
                return Err(
                    self.error(&format!("Variable names cannot start with a number ({number}{c})"))
                );
            }
            Some('.') => return Err(self.error("Unexpected period")),
            _ if number == "." => return Err(self.error("Unexpected period")),
            _ => {}
        }
        let mantissa = number.split(['e', 'E']).next().unwrap_or("");
        let value = if mantissa.chars().any(|c| c.is_ascii_digit()) {
            number
                .trim_end_matches('.')
                .replace(".e", "e")
                .replace(".E", "E")
                .parse::<f64>()
                .unwrap_or(f64::NAN)
        } else {
            f64::NAN
        };
        Ok(Expr::Literal(Literal::Number(value)))
    }

    fn string_literal(&mut self) -> Result<String, String> {
        let quote = self.peek();
        self.index += 1;
        let mut out = String::new();
        while let Some(c) = self.peek() {
            self.index += 1;
            if Some(c) == quote {
                return Ok(out);
            }
            if c == '\\' {
                let escaped = self.peek();
                self.index += 1;
                match escaped {
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('b') => out.push('\u{8}'),
                    Some('f') => out.push('\u{c}'),
                    Some('v') => out.push('\u{b}'),
                    Some(other) => out.push(other),
                    None => {}
                }
            } else {
                out.push(c);
            }
        }
        Err(self.error(&format!("Unclosed quote after \"{out}\"")))
    }

    fn regex_literal(&mut self) -> Result<Expr, String> {
        self.index += 1;
        let start = self.index;
        let mut in_class = false;
        while let Some(c) = self.peek() {
            if c == '/' && !in_class {
                let pattern: String = self.chars[start..self.index].iter().collect();
                self.index += 1;
                let mut flags = String::new();
                while let Some(f) = self.peek().filter(char::is_ascii_alphanumeric) {
                    flags.push(f);
                    self.index += 1;
                }
                let regex = JsRegex::new(&pattern, &flags).map_err(|e| self.error(&e))?;
                return Ok(Expr::Literal(Literal::Regex(Rc::new(regex))));
            }
            if c == '[' {
                in_class = true;
            } else if in_class && c == ']' {
                in_class = false;
            }
            self.index += if c == '\\' { 2 } else { 1 };
        }
        Err(self.error("Unclosed Regex"))
    }

    fn identifier(&mut self) -> Result<String, String> {
        match self.peek() {
            Some(c) if is_identifier_start(c) => self.index += 1,
            _ => {
                return Err(self.error(&format!(
                    "Unexpected {}",
                    self.peek().map(String::from).unwrap_or_default()
                )));
            }
        }
        let start = self.index - 1;
        while self.peek().is_some_and(is_identifier_part) {
            self.index += 1;
        }
        Ok(self.chars[start..self.index].iter().collect())
    }

    fn arguments(&mut self, terminator: char) -> Result<Vec<Expr>, String> {
        let mut args: Vec<Option<Expr>> = Vec::new();
        let mut separators = 0;
        loop {
            self.spaces();
            let Some(c) = self.peek() else {
                return Err(self.error(&format!("Expected {terminator}")));
            };
            if c == terminator {
                self.index += 1;
                if terminator == ')' && separators > 0 && separators >= args.len() {
                    return Err(self.error("Unexpected token )"));
                }
                break;
            } else if c == ',' {
                self.index += 1;
                separators += 1;
                if separators != args.len() {
                    if terminator == ')' {
                        return Err(self.error("Unexpected token ,"));
                    }
                    while args.len() < separators {
                        args.push(None);
                    }
                }
            } else if args.len() != separators && separators != 0 {
                return Err(self.error("Expected comma"));
            } else {
                let node = self.expression()?.ok_or_else(|| self.error("Expected comma"))?;
                args.push(Some(node));
            }
        }
        args.into_iter()
            .map(|arg| arg.ok_or_else(|| "array holes are not supported".to_string()))
            .collect()
    }

    fn group(&mut self) -> Result<Option<Expr>, String> {
        self.index += 1;
        let mut nodes = self.expressions(Some(')'))?;
        if self.peek() != Some(')') {
            return Err(self.error("Unclosed ("));
        }
        self.index += 1;
        match nodes.len() {
            0 => Ok(None),
            1 => Ok(Some(nodes.remove(0))),
            _ => Err("sequence expressions (a, b) are not supported".to_string()),
        }
    }
}

/// jsonpath-plus's textual substitution of `@` forms before jsep sees the code.
pub fn substitute(code: &str) -> String {
    let code = code
        .replace("@parentProperty", "_$_parentProperty")
        .replace("@parent", "_$_parent")
        .replace("@property", "_$_property")
        .replace("@root", "_$_root");
    let mut out = String::with_capacity(code.len());
    let mut chars = code.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '@'
            && chars.peek().is_some_and(|n| matches!(n, '.' | ')' | '[') || is_js_whitespace(*n))
        {
            out.push_str("_$_v");
        } else {
            out.push(c);
        }
    }
    if code.contains("@path") { out.replace("@path", "_$_path") } else { out }
}

pub struct Scope<'a> {
    pub value: JsValue<'a>,
    pub property: JsValue<'a>,
    pub parent: JsValue<'a>,
    pub parent_property: JsValue<'a>,
    pub path: Option<String>,
}

pub fn eval<'a>(
    expr: &Expr,
    scope: &Scope<'a>,
    engine: &Engine<'a>,
) -> Result<JsValue<'a>, String> {
    Ok(match expr {
        Expr::Literal(literal) => match literal {
            Literal::Undefined => JsValue::Undefined,
            Literal::Null => JsValue::Null,
            Literal::Bool(b) => JsValue::Bool(*b),
            Literal::Number(n) => JsValue::Number(*n),
            Literal::String(s) => JsValue::string(s.clone()),
            Literal::Regex(re) => JsValue::Regex(re.clone()),
        },
        Expr::Ident(name) => match name.as_str() {
            "_$_v" => scope.value.clone(),
            "_$_property" => scope.property.clone(),
            "_$_parent" => scope.parent.clone(),
            "_$_parentProperty" => scope.parent_property.clone(),
            "_$_root" => JsValue::from_doc(engine.root),
            "_$_path" if scope.path.is_some() => {
                JsValue::string(scope.path.clone().unwrap_or_default())
            }
            _ => return Err(format!("{name} is not defined")),
        },
        Expr::Member(object, property) => {
            let key = match property {
                Property::Name(name) => name.clone(),
                Property::Computed(expr) => eval(expr, scope, engine)?.to_js_string(),
            };
            let object = eval(object, scope, engine)?;
            get_property(&object, &key)?
        }
        Expr::Call(callee, args) => {
            let args =
                args.iter().map(|arg| eval(arg, scope, engine)).collect::<Result<Vec<_>, _>>()?;
            match eval(callee, scope, engine)? {
                JsValue::Function(bound) => call_method(&bound, &args)?,
                other => return Err(format!("{} is not a function", other.type_of())),
            }
        }
        Expr::Rfc(function, args) => {
            let args = args
                .iter()
                .map(|arg| match arg {
                    RfcArg::Value(expr) => eval(expr, scope, engine).map(|v| vec![v]),
                    RfcArg::Nodes(query) => engine.query(query, &scope.value),
                })
                .collect::<Result<Vec<_>, _>>()?;
            function.call_js(&args, engine)
        }
        Expr::Array(items) => JsValue::array(
            items.iter().map(|item| eval(item, scope, engine)).collect::<Result<_, _>>()?,
        ),
        Expr::Unary(op, argument) => {
            let value = eval(argument, scope, engine)?;
            match op {
                UnaryOp::Neg => JsValue::Number(-value.to_number()),
                UnaryOp::Plus => JsValue::Number(value.to_number()),
                UnaryOp::Not => JsValue::Bool(!value.truthy()),
                UnaryOp::BitNot => JsValue::Number(f64::from(!value.to_int32())),
                UnaryOp::TypeOf => JsValue::string(value.type_of()),
                UnaryOp::Void => JsValue::Undefined,
            }
        }
        Expr::Binary(op, left, right) => {
            let left = eval(left, scope, engine)?;
            if matches!(op, BinaryOp::Or | BinaryOp::And) {
                let short_circuits = left.truthy() == matches!(op, BinaryOp::Or);
                return if short_circuits { Ok(left) } else { eval(right, scope, engine) };
            }
            let right = eval(right, scope, engine)?;
            binary(*op, &left, &right)
        }
        Expr::Conditional(test, consequent, alternate) => {
            if eval(test, scope, engine)?.truthy() {
                eval(consequent, scope, engine)?
            } else {
                eval(alternate, scope, engine)?
            }
        }
    })
}

fn binary<'a>(op: BinaryOp, a: &JsValue<'a>, b: &JsValue<'a>) -> JsValue<'a> {
    match op {
        BinaryOp::Or | BinaryOp::And => JsValue::Undefined,
        BinaryOp::BitOr => JsValue::Number(f64::from(a.to_int32() | b.to_int32())),
        BinaryOp::BitXor => JsValue::Number(f64::from(a.to_int32() ^ b.to_int32())),
        BinaryOp::BitAnd => JsValue::Number(f64::from(a.to_int32() & b.to_int32())),
        BinaryOp::Eq => JsValue::Bool(a.loose_eq(b)),
        BinaryOp::Ne => JsValue::Bool(!a.loose_eq(b)),
        BinaryOp::StrictEq => JsValue::Bool(a.strict_eq(b)),
        BinaryOp::StrictNe => JsValue::Bool(!a.strict_eq(b)),
        BinaryOp::Lt => JsValue::Bool(a.less_than(b) == Some(true)),
        BinaryOp::Gt => JsValue::Bool(b.less_than(a) == Some(true)),
        BinaryOp::Le => JsValue::Bool(b.less_than(a) == Some(false)),
        BinaryOp::Ge => JsValue::Bool(a.less_than(b) == Some(false)),
        BinaryOp::Shl => JsValue::Number(f64::from(a.to_int32().wrapping_shl(b.to_uint32() & 31))),
        BinaryOp::Shr => JsValue::Number(f64::from(a.to_int32() >> (b.to_uint32() & 31))),
        BinaryOp::UShr => JsValue::Number(f64::from(a.to_uint32() >> (b.to_uint32() & 31))),
        BinaryOp::Add => a.add(b),
        BinaryOp::Sub => JsValue::Number(a.to_number() - b.to_number()),
        BinaryOp::Mul => JsValue::Number(a.to_number() * b.to_number()),
        BinaryOp::Div => JsValue::Number(a.to_number() / b.to_number()),
        BinaryOp::Rem => JsValue::Number(a.to_number() % b.to_number()),
    }
}
