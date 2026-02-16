use crate::cli::SendArgs;
use crate::commands::request;
use crate::context::CliContext;

pub async fn run(ctx: &CliContext, args: SendArgs, environment: Option<&str>, verbose: bool) {
    request::send_request_by_id(ctx, &args.request_id, environment, verbose).await;
}
