use serde::{Deserialize, Serialize};
use std::fmt::Display;
use ts_rs::TS;

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to="parser.ts")]
pub struct Tokens {
    pub tokens: Vec<Token>,
}

impl Display for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = self
            .tokens
            .iter()
            .map(|t| t.to_string())
            .collect::<Vec<String>>()
            .join("");
        write!(f, "{}", str)
    }
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to="parser.ts")]
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
#[ts(export, export_to="parser.ts")]
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
            Val::Str { text } => format!("'{}'", text.to_string().replace("'", "\'")),
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
#[ts(export, export_to="parser.ts")]
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

    pub fn parse(&mut self) -> Tokens {
        let start_pos = self.pos;

        while self.pos < self.chars.len() {
            if self.match_str("${[") {
                let start_curr = self.pos;
                if let Some(t) = self.parse_tag() {
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
        Tokens {
            tokens: self.tokens.clone(),
        }
    }

    fn parse_tag(&mut self) -> Option<Token> {
        // Parse up to first identifier
        //    ${[ my_var...
        self.skip_whitespace();

        let val = match self.parse_value() {
            Some(v) => v,
            None => return None,
        };

        // Parse to closing tag
        //    ${[ my_var(a, b, c) ]}
        self.skip_whitespace();
        if !self.match_str("]}") {
            return None;
        }

        Some(Token::Tag { val })
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

    fn parse_value(&mut self) -> Option<Val> {
        if let Some((name, args)) = self.parse_fn() {
            Some(Val::Fn { name, args })
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
        } else if let Some(v) = self.parse_string() {
            Some(Val::Str { text: v })
        } else {
            None
        }
    }

    fn parse_fn(&mut self) -> Option<(String, Vec<FnArg>)> {
        let start_pos = self.pos;

        let name = match self.parse_fn_name() {
            Some(v) => v,
            None => {
                self.pos = start_pos;
                return None;
            }
        };

        let args = match self.parse_fn_args() {
            Some(args) => args,
            None => {
                self.pos = start_pos;
                return None;
            }
        };

        Some((name, args))
    }

    fn parse_fn_args(&mut self) -> Option<Vec<FnArg>> {
        if !self.match_str("(") {
            return None;
        }

        let start_pos = self.pos;

        let mut args: Vec<FnArg> = Vec::new();

        // Fn closed immediately
        self.skip_whitespace();
        if self.match_str(")") {
            return Some(args);
        }

        while self.pos < self.chars.len() {
            self.skip_whitespace();

            let name = self.parse_ident();
            self.skip_whitespace();
            self.match_str("=");
            self.skip_whitespace();
            let value = self.parse_value();
            self.skip_whitespace();

            if let (Some(name), Some(value)) = (name.clone(), value.clone()) {
                args.push(FnArg { name, value });
            } else {
                // Didn't find valid thing, so return
                self.pos = start_pos;
                return None;
            }

            if self.match_str(")") {
                break;
            }

            self.skip_whitespace();

            // If we don't find a comma, that's bad
            if !args.is_empty() && !self.match_str(",") {
                self.pos = start_pos;
                return None;
            }

            if start_pos == self.pos {
                panic!("Parser stuck!");
            }
        }

        Some(args)
    }

    fn parse_ident(&mut self) -> Option<String> {
        let start_pos = self.pos;

        let mut text = String::new();
        while self.pos < self.chars.len() {
            let ch = self.peek_char();
            if ch.is_alphanumeric() || ch == '_' {
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

    fn parse_string(&mut self) -> Option<String> {
        let start_pos = self.pos;

        let mut text = String::new();
        if !self.match_str("'") {
            return None;
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
            return None;
        }

        Some(text)
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

        let cmp = self.chars[self.pos..self.pos + value.len()]
            .iter()
            .collect::<String>();

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
    use crate::*;

    #[test]
    fn var_simple() {
        let mut p = Parser::new("${[ foo ]}");
        assert_eq!(
            p.parse().tokens,
            vec![
                Token::Tag {
                    val: Val::Var { name: "foo".into() }
                },
                Token::Eof
            ]
        );
    }

    #[test]
    fn var_boolean() {
        let mut p = Parser::new("${[ true ]}${[ false ]}");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn var_multiple_names_invalid() {
        let mut p = Parser::new("${[ foo bar ]}");
        assert_eq!(
            p.parse().tokens,
            vec![
                Token::Raw {
                    text: "${[ foo bar ]}".into()
                },
                Token::Eof
            ]
        );
    }

    #[test]
    fn tag_string() {
        let mut p = Parser::new(r#"${[ 'foo \'bar\' baz' ]}"#);
        assert_eq!(
            p.parse().tokens,
            vec![
                Token::Tag {
                    val: Val::Str {
                        text: r#"foo 'bar' baz"#.into()
                    }
                },
                Token::Eof
            ]
        );
    }

    #[test]
    fn var_surrounded() {
        let mut p = Parser::new("Hello ${[ foo ]}!");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_simple() {
        let mut p = Parser::new("${[ foo() ]}");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_dot_name() {
        let mut p = Parser::new("${[ foo.bar.baz() ]}");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_ident_arg() {
        let mut p = Parser::new("${[ foo(a=bar) ]}");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_ident_args() {
        let mut p = Parser::new("${[ foo(a=bar,b = baz, c =qux ) ]}");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_mixed_args() {
        let mut p = Parser::new(r#"${[ foo(aaa=bar,bb='baz \'hi\'', c=qux, z=true ) ]}"#);
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_nested() {
        let mut p = Parser::new("${[ foo(b=bar()) ]}");
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn fn_nested_args() {
        let mut p = Parser::new(r#"${[ outer(a=inner(a=foo, b='i'), c='o') ]}"#);
        assert_eq!(
            p.parse().tokens,
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
    }

    #[test]
    fn token_display_var() {
        assert_eq!(
            Val::Var {
                name: "foo".to_string()
            }
            .to_string(),
            "foo"
        );
    }

    #[test]
    fn token_display_str() {
        assert_eq!(
            Val::Str {
                text: "Hello 'You'".to_string()
            }
            .to_string(),
            "'Hello \'You\''"
        );
    }

    #[test]
    fn token_null_fn_arg() {
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
    }

    #[test]
    fn token_display_fn() {
        assert_eq!(
            Token::Tag {
                val: Val::Fn {
                    name: "foo".to_string(),
                    args: vec![
                        FnArg {
                            name: "arg".to_string(),
                            value: Val::Str {
                                text: "v".to_string()
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
            r#"${[ foo(arg='v', arg2=my_var) ]}"#
        );
    }

    #[test]
    fn tokens_display() {
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
    }
}
