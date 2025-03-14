use crate::events::{
    FormInputBase, FormInputSecureText, FormInputTemplateFunction, TemplateFunction,
    TemplateFunctionArg,
};

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
