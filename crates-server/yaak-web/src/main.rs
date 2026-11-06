//! Standalone server for Yaak in a browser.

use clap::Parser;
use log::info;
use std::net::SocketAddr;
use yaak_web::{Config, router};

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or(yaak_web::DEFAULT_LOG_FILTER),
    )
    .init();
    let config = Config::parse();
    let bind = config.listen_addr().unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });
    let rate_limit_per_minute = config.rate_limit_per_minute;
    let app = router(config);

    let listener = tokio::net::TcpListener::bind(bind).await.unwrap_or_else(|e| {
        eprintln!("Failed to bind {bind}: {e}");
        std::process::exit(1);
    });
    info!(target: "yaak_web::startup", "yaak-web listening on http://{bind} (rate limit: {}/min)", rate_limit_per_minute,);

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            info!("Shutting down");
        })
        .await
        .expect("server error");
}
