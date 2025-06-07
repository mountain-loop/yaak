use crate::error::Error::{RenderStackExceededError, VariableNotFound};
use crate::error::Result;
use crate::{Parser, Token, Tokens, Val};
use serde_json::json;
use std::collections::HashMap;
use std::future::Future;

const MAX_DEPTH: usize = 50;

pub trait TemplateCallback {
    fn run(
        &self,
        fn_name: &str,
        args: HashMap<String, serde_json::Value>,
    ) -> impl Future<Output = Result<String>> + Send;

    fn transform_arg(&self, fn_name: &str, arg_name: &str, arg_value: &str) -> Result<String>;
}

pub async fn render_json_value_raw<T: TemplateCallback>(
    v: serde_json::Value,
    vars: &HashMap<String, String>,
    cb: &T,
) -> Result<serde_json::Value> {
    let v = match v {
        serde_json::Value::String(s) => json!(parse_and_render(&s, vars, cb).await?),
        serde_json::Value::Array(a) => {
            let mut new_a = Vec::new();
            for v in a {
                new_a.push(Box::pin(render_json_value_raw(v, vars, cb)).await?)
            }
            json!(new_a)
        }
        serde_json::Value::Object(o) => {
            let mut new_o = serde_json::Map::new();
            for (k, v) in o {
                let key = Box::pin(parse_and_render(&k, vars, cb)).await?;
                let value = Box::pin(render_json_value_raw(v, vars, cb)).await?;
                new_o.insert(key, value);
            }
            json!(new_o)
        }
        v => v,
    };
    Ok(v)
}

async fn parse_and_render_at_depth<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
    depth: usize,
) -> Result<String> {
    let mut p = Parser::new(template);
    let tokens = p.parse()?;
    render(tokens, vars, cb, depth + 1).await
}

pub async fn parse_and_render<T: TemplateCallback>(
    template: &str,
    vars: &HashMap<String, String>,
    cb: &T,
) -> Result<String> {
    parse_and_render_at_depth(template, vars, cb, 1).await
}

pub async fn render<T: TemplateCallback>(
    tokens: Tokens,
    vars: &HashMap<String, String>,
    cb: &T,
    mut depth: usize,
) -> Result<String> {
    depth += 1;
    if depth > MAX_DEPTH {
        return Err(RenderStackExceededError);
    }

    let mut doc_str: Vec<String> = Vec::new();

    for t in tokens.tokens {
        match t {
            Token::Raw { text } => doc_str.push(text),
            Token::Tag { val } => doc_str.push(render_value(val, &vars, cb, depth).await?),
            Token::Eof => {}
        }
    }

    Ok(doc_str.join(""))
}

async fn render_value<T: TemplateCallback>(
    val: Val,
    vars: &HashMap<String, String>,
    cb: &T,
    depth: usize,
) -> Result<String> {
    let v = match val {
        Val::Str { text } => {
            let r = Box::pin(parse_and_render_at_depth(&text, vars, cb, depth)).await?;
            r.to_string()
        }
        Val::Var { name } => match vars.get(name.as_str()) {
            Some(v) => {
                let r = Box::pin(parse_and_render_at_depth(v, vars, cb, depth)).await?;
                r.to_string()
            }
            None => return Err(VariableNotFound(name)),
        },
        Val::Fn { name, args } => {
            let mut resolved_args: HashMap<String, serde_json::Value> = HashMap::new();
            for a in args {
                let v = match a.value.clone() {
                    Val::Bool { value } => serde_json::Value::Bool(value),
                    Val::Null => serde_json::Value::Null,
                    _ => serde_json::Value::String(
                        Box::pin(render_value(a.value, vars, cb, depth)).await?,
                    ),
                };
                resolved_args.insert(a.name, v);
            }
            let result = cb.run(name.as_str(), resolved_args.clone()).await?;
            Box::pin(parse_and_render_at_depth(&result, vars, cb, depth)).await?
        }
        Val::Bool { value } => value.to_string(),
        Val::Null => "".into(),
    };

    Ok(v)
}

#[cfg(test)]
mod parse_and_render_tests {
    use crate::error::Error::{RenderError, RenderStackExceededError, VariableNotFound};
    use crate::error::Result;
    use crate::renderer::TemplateCallback;
    use crate::*;
    use std::collections::HashMap;

    struct EmptyCB {}

    impl TemplateCallback for EmptyCB {
        async fn run(
            &self,
            _fn_name: &str,
            _args: HashMap<String, serde_json::Value>,
        ) -> Result<String> {
            todo!()
        }

        fn transform_arg(
            &self,
            _fn_name: &str,
            _arg_name: &str,
            arg_value: &str,
        ) -> Result<String> {
            Ok(arg_value.to_string())
        }
    }

    #[tokio::test]
    async fn render_empty() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "";
        let vars = HashMap::new();
        let result = "";
        assert_eq!(parse_and_render(template, &vars, &empty_cb).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_text_only() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "Hello World!";
        let vars = HashMap::new();
        let result = "Hello World!";
        assert_eq!(parse_and_render(template, &vars, &empty_cb).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_simple() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let vars = HashMap::from([("foo".to_string(), "bar".to_string())]);
        let result = "bar";
        assert_eq!(parse_and_render(template, &vars, &empty_cb).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_recursive_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "foo: ${[ bar ]}".to_string());
        vars.insert("bar".to_string(), "bar: ${[ baz ]}".to_string());
        vars.insert("baz".to_string(), "baz".to_string());

        let result = "foo: bar: baz";
        assert_eq!(parse_and_render(template, &vars, &empty_cb).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_missing_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let vars = HashMap::new();

        assert_eq!(
            parse_and_render(template, &vars, &empty_cb).await,
            Err(VariableNotFound("foo".to_string()))
        );
        Ok(())
    }

    #[tokio::test]
    async fn render_self_referencing_var() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "${[ foo ]}";
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "${[ foo ]}".to_string());

        assert_eq!(
            parse_and_render(template, &vars, &empty_cb).await,
            Err(RenderStackExceededError)
        );
        Ok(())
    }

    #[tokio::test]
    async fn render_surrounded() -> Result<()> {
        let empty_cb = EmptyCB {};
        let template = "hello ${[ word ]} world!";
        let vars = HashMap::from([("word".to_string(), "cruel".to_string())]);
        let result = "hello cruel world!";
        assert_eq!(parse_and_render(template, &vars, &empty_cb).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_valid_fn() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"${[ say_hello(a='John', b='Kate') ]}"#;
        let result = r#"say_hello: 2, Some(String("John")) Some(String("Kate"))"#;

        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(format!("{fn_name}: {}, {:?} {:?}", args.len(), args.get("a"), args.get("b")))
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                arg_value: &str,
            ) -> Result<String> {
                Ok(arg_value.to_string())
            }
        }
        assert_eq!(parse_and_render(template, &vars, &CB {}).await?, result);
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_arg() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"${[ upper(foo='bar') ]}"#;
        let result = r#""BAR""#;
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(
                &self,
                fn_name: &str,
                args: HashMap<String, serde_json::Value>,
            ) -> Result<String> {
                Ok(match fn_name {
                    "secret" => "abc".to_string(),
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_b64_arg_template() -> Result<()> {
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "bar".to_string());
        let template = r#"${[ upper(foo=b64'Zm9vICdiYXInIGJheg') ]}"#;
        let result = r#""FOO 'BAR' BAZ""#;
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(&self, fn_name: &str, args: HashMap<String, serde_json::Value>) -> Result<String> {
                Ok(match fn_name {
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_arg_template() -> Result<()> {
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "bar".to_string());
        let template = r#"${[ upper(foo='${[ foo ]}') ]}"#;
        let result = r#""BAR""#;
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(&self, fn_name: &str, args: HashMap<String, serde_json::Value>) -> Result<String> {
                Ok(match fn_name {
                    "secret" => "abc".to_string(),
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_return_template() -> Result<()> {
        let mut vars = HashMap::new();
        vars.insert("foo".to_string(), "bar".to_string());
        let template = r#"${[ no_op(inner='${[ foo ]}') ]}"#;
        let result = r#""bar""#;
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(&self, fn_name: &str, args: HashMap<String, serde_json::Value>) -> Result<String> {
                Ok(match fn_name {
                    "no_op" => args["inner"].to_string(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                _arg_value: &str,
            ) -> Result<String> {
                todo!()
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_nested_fn() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"${[ upper(foo=secret()) ]}"#;
        let result = r#""ABC""#;
        struct CB {}
        impl TemplateCallback for CB {
            async fn run(&self, fn_name: &str, args: HashMap<String, serde_json::Value>) -> Result<String> {
                Ok(match fn_name {
                    "secret" => "abc".to_string(),
                    "upper" => args["foo"].to_string().to_uppercase(),
                    _ => "".to_string(),
                })
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                arg_value: &str,
            ) -> Result<String> {
                Ok(arg_value.to_string())
            }
        }

        assert_eq!(parse_and_render(template, &vars, &CB {}).await?, result.to_string());
        Ok(())
    }

    #[tokio::test]
    async fn render_fn_err() -> Result<()> {
        let vars = HashMap::new();
        let template = r#"hello ${[ error() ]}"#;

        struct CB {}
        impl TemplateCallback for CB {
            async fn run(&self, _fn_name: &str, _args: HashMap<String, serde_json::Value>) -> Result<String> {
                Err(RenderError("Failed to do it!".to_string()))
            }

            fn transform_arg(
                &self,
                _fn_name: &str,
                _arg_name: &str,
                arg_value: &str,
            ) -> Result<String> {
                Ok(arg_value.to_string())
            }
        }

        assert_eq!(
            parse_and_render(template, &vars, &CB {}).await,
            Err(RenderError("Failed to do it!".to_string()))
        );
        Ok(())
    }
}

#[cfg(test)]
mod render_json_value_raw_tests {
    use crate::error::Result;
    use crate::{TemplateCallback, render_json_value_raw};
    use serde_json::json;
    use std::collections::HashMap;

    struct EmptyCB {}

    impl TemplateCallback for EmptyCB {
        async fn run(&self, _fn_name: &str, _args: HashMap<String, serde_json::Value>) -> Result<String> {
            todo!()
        }

        fn transform_arg(
            &self,
            _fn_name: &str,
            _arg_name: &str,
            arg_value: &str,
        ) -> Result<String> {
            Ok(arg_value.to_string())
        }
    }

    #[tokio::test]
    async fn render_json_value_string() -> Result<()> {
        let v = json!("${[a]}");
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        assert_eq!(render_json_value_raw(v, &vars, &EmptyCB {}).await?, json!("aaa"));
        Ok(())
    }

    #[tokio::test]
    async fn render_json_value_array() -> Result<()> {
        let v = json!(["${[a]}", "${[a]}"]);
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = render_json_value_raw(v, &vars, &EmptyCB {}).await?;
        assert_eq!(result, json!(["aaa", "aaa"]));

        Ok(())
    }

    #[tokio::test]
    async fn render_json_value_object() -> Result<()> {
        let v = json!({"${[a]}": "${[a]}"});
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = render_json_value_raw(v, &vars, &EmptyCB {}).await?;
        assert_eq!(result, json!({"aaa": "aaa"}));

        Ok(())
    }

    #[tokio::test]
    async fn render_json_value_nested() -> Result<()> {
        let v = json!([
            123,
            {"${[a]}": "${[a]}"},
            null,
            "${[a]}",
            false,
            {"x": ["${[a]}"]}
        ]);
        let mut vars = HashMap::new();
        vars.insert("a".to_string(), "aaa".to_string());

        let result = render_json_value_raw(v, &vars, &EmptyCB {}).await?;
        assert_eq!(
            result,
            json!([
                123,
                {"aaa": "aaa"},
                null,
                "aaa",
                false,
                {"x": ["aaa"]}
            ])
        );

        Ok(())
    }
}
