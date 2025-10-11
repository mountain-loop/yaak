use crate::TemplateCallback;
use crate::error::Error::RenderError;
use crate::error::Result;
use base64::Engine;
use base64::prelude::BASE64_URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use std::fmt::Display;
use ts_rs::TS;

#[derive(Default, Clone, PartialEq, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "parser.ts")]
pub struct Tokens {
    pub tokens: Vec<Token>,
}

impl Display for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = self.tokens.iter().map(|t| t.to_string()).collect::<Vec<String>>().join("");
        write!(f, "{}", str)
    }
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "parser.ts")]
pub struct FnArg {
    pub name: String,
    pub value: Val,
}

impl Display for FnArg {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = format!("{}={}", self.name, self.value);
        write!(f, "{}", str)
    }
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "parser.ts")]
pub enum Val {
    Str { text: String },
    Var { name: String },
    Bool { value: bool },
    Fn { name: String, args: Vec<FnArg> },
    Null,
}

impl Display for Val {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            Val::Str { text } => {
                if text.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '_') {
                    format!("'{}'", text)
                } else {
                    format!("b64'{}'", BASE64_URL_SAFE_NO_PAD.encode(text))
                }
            }
            Val::Var { name } => name.to_string(),
            Val::Bool { value } => value.to_string(),
            Val::Fn { name, args } => {
                format!(
                    "{name}({})",
                    args.iter()
                        .filter_map(|a| match a.value.clone() {
                            Val::Null => None,
                            _ => Some(a.to_string()),
                        })
                        .collect::<Vec<String>>()
                        .join(", ")
                )
            }
            Val::Null => "null".to_string(),
        };
        write!(f, "{}", str)
    }
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "parser.ts")]
pub enum Token {
    Raw { text: String },
    Tag { val: Val },
    Eof,
}

impl Display for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            Token::Raw { text } => text.to_string(),
            Token::Tag { val } => format!("${{[ {} ]}}", val.to_string()),
            Token::Eof => "".to_string(),
        };
        write!(f, "{}", str)
    }
}

fn transform_val<T: TemplateCallback>(val: &Val, cb: &T) -> Result<Val> {
    let val = match val {
        Val::Fn {
            name: fn_name,
            args,
        } => {
            let mut new_args: Vec<FnArg> = Vec::new();
            for arg in args {
                let value = match arg.clone().value {
                    Val::Str { text } => {
                        let text = cb.transform_arg(&fn_name, &arg.name, &text)?;
                        Val::Str { text }
                    }
                    v => transform_val(&v, cb)?,
                };

                let arg_name = arg.name.clone();
                new_args.push(FnArg {
                    name: arg_name,
                    value,
                });
            }
            Val::Fn {
                name: fn_name.clone(),
                args: new_args,
            }
        }
        _ => val.clone(),
    };
    Ok(val)
}

pub fn transform_args<T: TemplateCallback>(tokens: Tokens, cb: &T) -> Result<Tokens> {
    let mut new_tokens = Tokens::default();
    for t in tokens.tokens.iter() {
        new_tokens.tokens.push(match t {
            Token::Tag { val } => {
                let val = transform_val(val, cb)?;
                Token::Tag { val }
            }
            _ => t.clone(),
        });
    }

    Ok(new_tokens)
}

// Template Syntax
//
//  ${[ my_var ]}
//  ${[ my_fn() ]}
//  ${[ my_fn(my_var) ]}
//  ${[ my_fn(my_var, "A String") ]}

// default
#[derive(Default)]
pub struct Parser {
    tokens: Vec<Token>,
    chars: Vec<char>,
    pos: usize,
    curr_text: String,
}

impl Parser {
    pub fn new(text: &str) -> Parser {
        Parser {
            chars: text.chars().collect(),
            ..Parser::default()
        }
    }

    pub fn parse(&mut self) -> Result<Tokens> {
        let start_pos = self.pos;

        while self.pos < self.chars.len() {
            if self.match_str(r#"\\"#) {
                // Skip double-escapes so we don't trigger our own escapes in the next case
                self.curr_text += r#"\\"#;
            } else if self.match_str(r#"\${["#) {
                // Unescaped template syntax so we treat it as a string
                self.curr_text += "${[";
            } else if self.match_str("${[") {
                let start_curr = self.pos;
                if let Some(t) = self.parse_tag()? {
                    self.push_token(t);
                } else {
                    self.pos = start_curr;
                    self.curr_text += "${[";
                }
            } else {
                let ch = self.next_char();
                self.curr_text.push(ch);
            }

            if start_pos == self.pos {
                panic!("Parser stuck!");
            }
        }

        self.push_token(Token::Eof);
        Ok(Tokens {
            tokens: self.tokens.clone(),
        })
    }

    fn parse_tag(&mut self) -> Result<Option<Token>> {
        // Parse up to first identifier
        //    ${[ my_var...
        self.skip_whitespace();

        let val = match self.parse_value()? {
            Some(v) => v,
            None => return Ok(None),
        };

        // Parse to closing tag
        //    ${[ my_var(a, b, c) ]}
        self.skip_whitespace();
        if !self.match_str("]}") {
            return Ok(None);
        }

        Ok(Some(Token::Tag { val }))
    }

    #[allow(dead_code)]
    fn debug_pos(&self, x: &str) {
        println!(
            r#"Position: {x}: text[{}]='{}' → "{}" → {:?}"#,
            self.pos,
            self.chars[self.pos],
            self.chars.iter().collect::<String>(),
            self.tokens,
        );
    }

    fn parse_value(&mut self) -> Result<Option<Val>> {
        let v = if let Some((name, args)) = self.parse_fn()? {
            Some(Val::Fn { name, args })
        } else if let Some(v) = self.parse_string()? {
            Some(Val::Str { text: v })
        } else if let Some(v) = self.parse_ident() {
            if v == "null" {
                Some(Val::Null)
            } else if v == "true" {
                Some(Val::Bool { value: true })
            } else if v == "false" {
                Some(Val::Bool { value: false })
            } else {
                Some(Val::Var { name: v })
            }
        } else {
            None
        };

        Ok(v)
    }

    fn parse_fn(&mut self) -> Result<Option<(String, Vec<FnArg>)>> {
        let start_pos = self.pos;

        let name = match self.parse_fn_name() {
            Some(v) => v,
            None => {
                self.pos = start_pos;
                return Ok(None);
            }
        };

        let args = match self.parse_fn_args()? {
            Some(args) => args,
            None => {
                self.pos = start_pos;
                return Ok(None);
            }
        };

        Ok(Some((name, args)))
    }

    fn parse_fn_args(&mut self) -> Result<Option<Vec<FnArg>>> {
        if !self.match_str("(") {
            return Ok(None);
        }

        let start_pos = self.pos;

        let mut args: Vec<FnArg> = Vec::new();

        // Fn closed immediately
        self.skip_whitespace();
        if self.match_str(")") {
            return Ok(Some(args));
        }

        while self.pos < self.chars.len() {
            self.skip_whitespace();

            let name = self.parse_ident();
            self.skip_whitespace();
            self.match_str("=");
            self.skip_whitespace();
            let value = self.parse_value()?;
            self.skip_whitespace();

            if let (Some(name), Some(value)) = (name.clone(), value.clone()) {
                args.push(FnArg { name, value });
            } else {
                // Didn't find valid thing, so return
                self.pos = start_pos;
                return Ok(None);
            }

            if self.match_str(")") {
                break;
            }

            self.skip_whitespace();

            // If we don't find a comma, that's bad
            if !args.is_empty() && !self.match_str(",") {
                self.pos = start_pos;
                return Ok(None);
            }

            if start_pos == self.pos {
                panic!("Parser stuck!");
            }
        }

        Ok(Some(args))
    }

    fn parse_ident(&mut self) -> Option<String> {
        let start_pos = self.pos;

        let mut text = String::new();
        while self.pos < self.chars.len() {
            let ch = self.peek_char();
            let is_valid = if start_pos == self.pos {
                ch.is_alphabetic() || ch == '_' // First is more restrictive
            } else {
                ch.is_alphanumeric() || ch == '_' || ch == '-'
            };
            if is_valid {
                text.push(ch);
                self.pos += 1;
            } else {
                break;
            }

            if start_pos == self.pos {
                panic!("Parser stuck!");
            }
        }

        if text.is_empty() {
            self.pos = start_pos;
            return None;
        }

        Some(text)
    }

    fn parse_fn_name(&mut self) -> Option<String> {
        let start_pos = self.pos;

        let mut text = String::new();
        while self.pos < self.chars.len() {
            let ch = self.peek_char();
            if ch.is_alphanumeric() || ch == '_' || ch == '.' {
                text.push(ch);
                self.pos += 1;
            } else {
                break;
            }

            if start_pos == self.pos {
                panic!("Parser stuck!");
            }
        }

        if text.is_empty() {
            self.pos = start_pos;
            return None;
        }

        Some(text)
    }

    fn parse_string(&mut self) -> Result<Option<String>> {
        let start_pos = self.pos;

        let mut text = String::new();
        let mut is_b64 = false;
        if self.match_str("b64'") {
            is_b64 = true;
        } else if self.match_str("'") {
            // Nothing
        } else {
            return Ok(None);
        }

        let mut found_closing = false;
        while self.pos < self.chars.len() {
            let ch = self.next_char();
            match ch {
                '\\' => {
                    text.push(self.next_char());
                }
                '\'' => {
                    found_closing = true;
                    break;
                }
                _ => {
                    text.push(ch);
                }
            }

            if start_pos == self.pos {
                panic!("Parser stuck!");
            }
        }

        if !found_closing {
            self.pos = start_pos;
            return Ok(None);
        }

        let final_text = if is_b64 {
            let decoded = BASE64_URL_SAFE_NO_PAD
                .decode(text.clone())
                .map_err(|_| RenderError(format!("Failed to decode string {text}")))?;
            let decoded = String::from_utf8(decoded)
                .map_err(|_| RenderError(format!("Failed to decode utf8 string {text}")))?;
            decoded
        } else {
            text
        };

        Ok(Some(final_text))
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.chars.len() {
            if self.peek_char().is_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn next_char(&mut self) -> char {
        let ch = self.peek_char();

        self.pos += 1;
        ch
    }

    fn peek_char(&self) -> char {
        let ch = self.chars[self.pos];
        ch
    }

    fn push_token(&mut self, token: Token) {
        // Push any text we've accumulated
        if !self.curr_text.is_empty() {
            let text_token = Token::Raw {
                text: self.curr_text.clone(),
            };
            self.tokens.push(text_token);
            self.curr_text.clear();
        }

        self.tokens.push(token);
    }

    fn match_str(&mut self, value: &str) -> bool {
        if self.pos + value.len() > self.chars.len() {
            return false;
        }

        let cmp = self.chars[self.pos..self.pos + value.len()].iter().collect::<String>();

        if cmp == value {
            // We have a match, so advance the current index
            self.pos += value.len();
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::Val::Null;
    use crate::error::Result;
    use crate::*;

    #[test]
    fn escaped() -> Result<()> {
        let mut p = Parser::new(r#"\${[ foo ]}"#);
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Raw {
                    text: "${[ foo ]}".to_string()
                },
                Token::Eof
            ]
        );
        Ok(())
    }

    #[test]
    fn escaped_tricky() -> Result<()> {
        let mut p = Parser::new(r#"\\${[ foo ]}"#);
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Raw {
                    text: r#"\\"#.to_string()
                },
                Token::Tag {
                    val: Val::Var { name: "foo".into() }
                },
                Token::Eof
            ]
        );
        Ok(())
    }

    #[test]
    fn var_simple() -> Result<()> {
        let mut p = Parser::new("${[ foo ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Var { name: "foo".into() }
                },
                Token::Eof
            ]
        );
        Ok(())
    }

    #[test]
    fn var_dashes() -> Result<()> {
        let mut p = Parser::new("${[ a-b ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Var { name: "a-b".into() }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn var_underscores() -> Result<()> {
        let mut p = Parser::new("${[ a_b ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Var { name: "a_b".into() }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn var_prefixes() -> Result<()> {
        let mut p = Parser::new("${[ -a ]}${[ 0a ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Raw {
                    // Shouldn't be parsed, because they're invalid
                    text: "${[ -a ]}${[ 0a ]}".into()
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn var_underscore_prefix() -> Result<()> {
        let mut p = Parser::new("${[ _a ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Var { name: "_a".into() }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn var_boolean() -> Result<()> {
        let mut p = Parser::new("${[ true ]}${[ false ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Bool { value: true },
                },
                Token::Tag {
                    val: Val::Bool { value: false },
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn var_multiple_names_invalid() -> Result<()> {
        let mut p = Parser::new("${[ foo bar ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Raw {
                    text: "${[ foo bar ]}".into()
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn tag_string() -> Result<()> {
        let mut p = Parser::new(r#"${[ 'foo \'bar\' baz' ]}"#);
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Str {
                        text: r#"foo 'bar' baz"#.into()
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn tag_b64_string() -> Result<()> {
        let mut p = Parser::new(r#"${[ b64'Zm9vICdiYXInIGJheg' ]}"#);
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Str {
                        text: r#"foo 'bar' baz"#.into()
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn var_surrounded() -> Result<()> {
        let mut p = Parser::new("Hello ${[ foo ]}!");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Raw {
                    text: "Hello ".to_string()
                },
                Token::Tag {
                    val: Val::Var { name: "foo".into() }
                },
                Token::Raw {
                    text: "!".to_string()
                },
                Token::Eof,
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_simple() -> Result<()> {
        let mut p = Parser::new("${[ foo() ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "foo".into(),
                        args: Vec::new(),
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_dot_name() -> Result<()> {
        let mut p = Parser::new("${[ foo.bar.baz() ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "foo.bar.baz".into(),
                        args: Vec::new(),
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_ident_arg() -> Result<()> {
        let mut p = Parser::new("${[ foo(a=bar) ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "foo".into(),
                        args: vec![FnArg {
                            name: "a".into(),
                            value: Val::Var { name: "bar".into() }
                        }],
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_ident_args() -> Result<()> {
        let mut p = Parser::new("${[ foo(a=bar,b = baz, c =qux ) ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "foo".into(),
                        args: vec![
                            FnArg {
                                name: "a".into(),
                                value: Val::Var { name: "bar".into() }
                            },
                            FnArg {
                                name: "b".into(),
                                value: Val::Var { name: "baz".into() }
                            },
                            FnArg {
                                name: "c".into(),
                                value: Val::Var { name: "qux".into() }
                            },
                        ],
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_mixed_args() -> Result<()> {
        let mut p = Parser::new(r#"${[ foo(aaa=bar,bb='baz \'hi\'', c=qux, z=true ) ]}"#);
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "foo".into(),
                        args: vec![
                            FnArg {
                                name: "aaa".into(),
                                value: Val::Var { name: "bar".into() }
                            },
                            FnArg {
                                name: "bb".into(),
                                value: Val::Str {
                                    text: r#"baz 'hi'"#.into()
                                }
                            },
                            FnArg {
                                name: "c".into(),
                                value: Val::Var { name: "qux".into() }
                            },
                            FnArg {
                                name: "z".into(),
                                value: Val::Bool { value: true }
                            },
                        ],
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_nested() -> Result<()> {
        let mut p = Parser::new("${[ foo(b=bar()) ]}");
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "foo".into(),
                        args: vec![FnArg {
                            name: "b".into(),
                            value: Val::Fn {
                                name: "bar".into(),
                                args: vec![],
                            }
                        }],
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn fn_nested_args() -> Result<()> {
        let mut p = Parser::new(r#"${[ outer(a=inner(a=foo, b='i'), c='o') ]}"#);
        assert_eq!(
            p.parse()?.tokens,
            vec![
                Token::Tag {
                    val: Val::Fn {
                        name: "outer".into(),
                        args: vec![
                            FnArg {
                                name: "a".into(),
                                value: Val::Fn {
                                    name: "inner".into(),
                                    args: vec![
                                        FnArg {
                                            name: "a".into(),
                                            value: Val::Var { name: "foo".into() }
                                        },
                                        FnArg {
                                            name: "b".into(),
                                            value: Val::Str { text: "i".into() },
                                        },
                                    ],
                                }
                            },
                            FnArg {
                                name: "c".into(),
                                value: Val::Str { text: "o".into() }
                            },
                        ],
                    }
                },
                Token::Eof
            ]
        );

        Ok(())
    }

    #[test]
    fn token_display_var() -> Result<()> {
        assert_eq!(
            Val::Var {
                name: "foo".to_string()
            }
            .to_string(),
            "foo"
        );

        Ok(())
    }

    #[test]
    fn token_display_str() -> Result<()> {
        assert_eq!(
            Val::Str {
                text: "Hello You".to_string()
            }
            .to_string(),
            "'Hello You'"
        );

        Ok(())
    }

    #[test]
    fn token_display_complex_str() -> Result<()> {
        assert_eq!(
            Val::Str {
                text: "Hello 'You'".to_string()
            }
            .to_string(),
            "b64'SGVsbG8gJ1lvdSc'"
        );

        Ok(())
    }

    #[test]
    fn token_null_fn_arg() -> Result<()> {
        assert_eq!(
            Val::Fn {
                name: "fn".to_string(),
                args: vec![
                    FnArg {
                        name: "n".to_string(),
                        value: Null,
                    },
                    FnArg {
                        name: "a".to_string(),
                        value: Val::Str {
                            text: "aaa".to_string()
                        }
                    }
                ]
            }
            .to_string(),
            r#"fn(a='aaa')"#
        );

        Ok(())
    }

    #[test]
    fn token_display_fn() -> Result<()> {
        assert_eq!(
            Token::Tag {
                val: Val::Fn {
                    name: "foo".to_string(),
                    args: vec![
                        FnArg {
                            name: "arg".to_string(),
                            value: Val::Str {
                                text: "v 'x'".to_string()
                            }
                        },
                        FnArg {
                            name: "arg2".to_string(),
                            value: Val::Var {
                                name: "my_var".to_string()
                            }
                        }
                    ]
                }
            }
            .to_string(),
            r#"${[ foo(arg=b64'diAneCc', arg2=my_var) ]}"#
        );

        Ok(())
    }

    #[test]
    fn tokens_display() -> Result<()> {
        assert_eq!(
            Tokens {
                tokens: vec![
                    Token::Tag {
                        val: Val::Var {
                            name: "my_var".to_string()
                        }
                    },
                    Token::Raw {
                        text: " Some cool text ".to_string(),
                    },
                    Token::Tag {
                        val: Val::Str {
                            text: "Hello World".to_string()
                        }
                    }
                ]
            }
            .to_string(),
            r#"${[ my_var ]} Some cool text ${[ 'Hello World' ]}"#
        );

        Ok(())
    }
}
