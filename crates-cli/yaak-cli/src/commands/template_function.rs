use crate::cli::{TemplateFunctionArgs, TemplateFunctionCommands};
use crate::context::CliContext;
use yaak_plugins::events::{PluginContext, TemplateFunction};

type CommandResult<T = ()> = std::result::Result<T, String>;

pub async fn run(ctx: &CliContext, args: TemplateFunctionArgs) -> i32 {
    let result = match args.command {
        TemplateFunctionCommands::List { filter } => list(ctx, filter.as_deref()).await,
        TemplateFunctionCommands::Show { name, pretty } => show(ctx, &name, pretty).await,
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

/// Template functions come from plugins, so the only accurate list is the one the
/// installed plugins report right now.
async fn all(ctx: &CliContext) -> CommandResult<Vec<TemplateFunction>> {
    let plugin_context = PluginContext::new_empty();
    let summaries = ctx
        .plugin_manager()
        .get_template_function_summaries(&plugin_context)
        .await
        .map_err(|e| format!("Failed to list template functions: {e}"))?;

    let mut functions: Vec<TemplateFunction> =
        summaries.into_iter().flat_map(|summary| summary.functions).collect();
    functions.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(functions)
}

async fn list(ctx: &CliContext, filter: Option<&str>) -> CommandResult {
    let mut functions = all(ctx).await?;

    if let Some(filter) = filter {
        let needle = filter.to_lowercase();
        functions.retain(|f| f.name.to_lowercase().contains(&needle));
    }

    if functions.is_empty() {
        match filter {
            Some(filter) => println!("No template functions matching '{filter}'"),
            None => println!("No template functions found"),
        }
        return Ok(());
    }

    for function in functions {
        let args = function.args.iter().filter_map(arg_name).collect::<Vec<_>>().join(", ");
        match function.description {
            Some(description) if !description.is_empty() => {
                println!("{}({}) - {}", function.name, args, description)
            }
            _ => println!("{}({})", function.name, args),
        }
    }

    Ok(())
}

async fn show(ctx: &CliContext, name: &str, pretty: bool) -> CommandResult {
    let functions = all(ctx).await?;
    let function = functions
        .iter()
        .find(|f| {
            f.name == name
                || f.aliases.as_ref().is_some_and(|aliases| aliases.iter().any(|a| a == name))
        })
        .ok_or_else(|| {
            let names = functions.iter().map(|f| f.name.as_str()).collect::<Vec<_>>();
            format!("No template function named '{name}'. Available: {}", names.join(", "))
        })?;

    let output = if pretty {
        serde_json::to_string_pretty(function)
    } else {
        serde_json::to_string(function)
    }
    .map_err(|e| format!("Failed to serialize template function: {e}"))?;

    println!("{output}");
    Ok(())
}

fn arg_name(arg: &yaak_plugins::events::TemplateFunctionArg) -> Option<String> {
    use yaak_plugins::events::{FormInput, TemplateFunctionArg};

    let TemplateFunctionArg::FormInput(input) = arg;
    let base = match input {
        FormInput::Text(v) => &v.base,
        FormInput::Editor(v) => &v.base,
        FormInput::Select(v) => &v.base,
        FormInput::Checkbox(v) => &v.base,
        FormInput::File(v) => &v.base,
        FormInput::HttpRequest(v) => &v.base,
        FormInput::KeyValue(v) => &v.base,
        // Layout-only inputs have no value of their own
        FormInput::Accordion(_)
        | FormInput::HStack(_)
        | FormInput::Banner(_)
        | FormInput::Markdown(_) => return None,
    };

    if base.name.trim().is_empty() { None } else { Some(base.name.clone()) }
}
