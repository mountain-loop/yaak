use serde_json::Value;
use std::collections::BTreeMap;
use yaak_models::util::BatchUpsertResult;
use yaak_templates::{Parser, Token, Val};

/// Rewrite request references at each ID-assignment step (initial import and linked reimport).
/// Literal text, missing targets and arguments to unrelated functions must not be rewritten.
pub(crate) fn remap_request_references(
    resources: &mut BatchUpsertResult,
    ids: &BTreeMap<String, String>,
) -> serde_json::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut value = serde_json::to_value(&resources)?;
    remap_value(&mut value, ids);
    *resources = serde_json::from_value(value)?;
    Ok(())
}

fn remap_value(value: &mut Value, ids: &BTreeMap<String, String>) {
    match value {
        Value::String(text) => *text = remap_text(text, ids),
        Value::Array(values) => values.iter_mut().for_each(|v| remap_value(v, ids)),
        Value::Object(values) => values.values_mut().for_each(|v| remap_value(v, ids)),
        _ => {}
    }
}

fn remap_argument(value: &mut Val, ids: &BTreeMap<String, String>) -> bool {
    let Val::Fn { name, args } = value else {
        return false;
    };
    let request_arg = match name.as_str() {
        "response" | "response.body.raw" | "response.body.path" | "response.header" => "request",
        "request.body" | "request.body.raw" | "request.body.path" | "request.header"
        | "request.param" | "request.name" => "requestId",
        _ => "",
    };
    let mut changed = false;
    for arg in args {
        if arg.name == request_arg
            && let Val::Str { text } = &mut arg.value
            && let Some(id) = ids.get(text)
            && id != text
        {
            *text = id.clone();
            changed = true;
        }
        changed |= remap_argument(&mut arg.value, ids);
    }
    changed
}

fn remap_text(text: &str, ids: &BTreeMap<String, String>) -> String {
    // Parse individual unescaped tags. Parsing/reprinting the whole string would unescape raw
    // template-looking text, and change formatting even when no reference needs updating.
    let bytes = text.as_bytes();
    let mut output = String::new();
    let mut copied = 0;
    let mut cursor = 0;
    while let Some(relative) = text[cursor..].find("${[") {
        let start = cursor + relative;
        cursor = start + 3;
        let escapes = bytes[..start].iter().rev().take_while(|&&b| b == b'\\').count();
        if escapes % 2 != 0 {
            continue;
        }
        let mut end = cursor;
        let mut quoted = false;
        while end < bytes.len() {
            if quoted && bytes[end] == b'\\' {
                end += 2;
                continue;
            }
            if bytes[end] == b'\'' {
                quoted = !quoted;
            }
            if !quoted && bytes[end..].starts_with(b"]}") {
                end += 2;
                break;
            }
            end += 1;
        }
        if end > bytes.len() || !text[start..end].ends_with("]}") {
            continue;
        }
        if let Ok(mut tokens) = Parser::new(&text[start..end]).parse()
            && let [Token::Tag { val }, Token::Eof] = tokens.tokens.as_mut_slice()
            && remap_argument(val, ids)
        {
            output.push_str(&text[copied..start]);
            output.push_str(&tokens.to_string());
            copied = end;
        }
        cursor = end;
    }
    output.push_str(&text[copied..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> BTreeMap<String, String> {
        BTreeMap::from([("req_old".into(), "rq_new".into())])
    }

    #[test]
    fn only_remaps_known_literal_request_arguments() {
        let text = "${[ response.header(request='req_old', header='req_old') ]}";
        assert_eq!(
            remap_text(text, &ids()),
            "${[ response.header(request='rq_new', header='req_old') ]}"
        );
        for text in [
            "req_old",
            "${[ custom(request='req_old') ]}",
            "${[ response.header(request=req_old) ]}",
            "${[ response.header(request='req_missing') ]}",
            "${[ response.header(request='req_old' ]}",
        ] {
            assert_eq!(remap_text(text, &ids()), text);
        }
    }

    #[test]
    fn handles_encoded_nested_and_escaped_tags_without_changing_surrounding_text() {
        let text = r#"café \${[ response.header(request='req_old') ]} ${[ json.jsonpath(input=response.body.raw(request=b64'cmVxX29sZA')) ]} end"#;
        assert_eq!(
            remap_text(text, &ids()),
            r#"café \${[ response.header(request='req_old') ]} ${[ json.jsonpath(input=response.body.raw(request='rq_new')) ]} end"#
        );
        let text = "${[ response.header(request='req_old', header=']}' ) ]}";
        assert!(remap_text(text, &ids()).contains("request='rq_new'"));
    }
}
