use crate::error::Result;
use crate::events::{
    FormInputBase, FormInputSecureText, FormInputTemplateFunction, TemplateFunction,
    TemplateFunctionArg,
};
use std::collections::HashMap;

pub(crate) fn template_function_encrypt() -> TemplateFunction {
    TemplateFunction {
        name: "secure".to_string(),
        description: Some("Encrypt values".to_string()),
        aliases: None,
        args: vec![TemplateFunctionArg::Extra(
            FormInputTemplateFunction::SecureText(FormInputSecureText {
                base: FormInputBase {
                    name: "value".to_string(),
                    hidden: None,
                    optional: None,
                    label: None,
                    hide_label: None,
                    default_value: None,
                    disabled: None,
                },
            }),
        )],
    }
}

pub(crate) fn template_function_encrypt_on_change(args: HashMap<String, String>) -> Result<String> {
    let value = args.get("value").map(|v| v.to_owned()).unwrap_or_default();
    Ok(format!("ENCRYPTED___{value}"))
}

pub(crate) fn template_function_encrypt_on_render(args: HashMap<String, String>) -> Result<String> {
    let value = args.get("value").map(|v| v.to_owned()).unwrap_or_default();
    Ok(value.replace("ENCRYPTED___", ""))
}
