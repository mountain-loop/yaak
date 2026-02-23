use serde_json::{Value, json};

pub fn append_agent_hints(schema: &mut Value) {
    let Some(schema_obj) = schema.as_object_mut() else {
        return;
    };

    schema_obj.insert(
        "x-yaak-agent-hints".to_string(),
        json!({
            "templateVariableSyntax": "${[ my_var ]}",
            "templateFunctionSyntax": "${[ namespace.my_func(a='aaa',b='bbb') ]}",
        }),
    );
}
