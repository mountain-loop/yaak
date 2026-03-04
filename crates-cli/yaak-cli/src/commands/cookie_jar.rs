use crate::cli::{CookieJarArgs, CookieJarCommands};
use crate::context::CliContext;
use crate::utils::workspace::resolve_workspace_id;

type CommandResult<T = ()> = std::result::Result<T, String>;

pub fn run(ctx: &CliContext, args: CookieJarArgs) -> i32 {
    let result = match args.command {
        CookieJarCommands::List { workspace_id } => list(ctx, workspace_id.as_deref()),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

fn list(ctx: &CliContext, workspace_id: Option<&str>) -> CommandResult {
    let workspace_id = resolve_workspace_id(ctx, workspace_id, "cookie-jar list")?;
    let cookie_jars = ctx
        .db()
        .list_cookie_jars(&workspace_id)
        .map_err(|e| format!("Failed to list cookie jars: {e}"))?;

    if cookie_jars.is_empty() {
        println!("No cookie jars found in workspace {}", workspace_id);
    } else {
        for cookie_jar in cookie_jars {
            println!(
                "{} - {} ({} cookies)",
                cookie_jar.id,
                cookie_jar.name,
                cookie_jar.cookies.len()
            );
        }
    }

    Ok(())
}
