//! Yaak Bridge — the local companion that runs the real Yaak engine for a
//! browser tab.
//!
//! The tab is the Yaak UI, unchanged. Everything it cannot do in a page —
//! sending an HTTP request and seeing every response header, following
//! redirects, keeping a cookie jar, running plugins, reading a response body
//! off disk — happens in this process, over a local HTTP and WebSocket
//! connection.
//!
//! Loopback only, and every route needs the token printed at startup.

mod events;
mod http;
mod model_writes;
mod plugin_events;
mod rpc;
mod session;
mod state;

use clap::Parser;
use rand::Rng;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

const APP_ID: &str = "app.yaak.bridge";

#[derive(Parser, Debug)]
#[command(name = "yaak-bridge", about = "Run the Yaak engine for a browser tab")]
struct Args {
    /// Port to listen on. Loopback only, always.
    #[arg(long, default_value_t = 9444, env = "YAAK_BRIDGE_PORT")]
    port: u16,

    /// Where the database, plugins and response bodies live.
    #[arg(long, env = "YAAK_BRIDGE_DATA_DIR")]
    data_dir: Option<PathBuf>,

    /// Use a fixed token instead of generating one. For scripted dev loops.
    #[arg(long, env = "YAAK_BRIDGE_TOKEN")]
    token: Option<String>,

    /// Where the frontend was built to. Serving it makes this the only process
    /// to run; without it, point a Vite dev server at this bridge instead.
    #[arg(long, env = "YAAK_BRIDGE_WEB_DIR")]
    web_dir: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args = Args::parse();

    let data_dir = args.data_dir.unwrap_or_else(default_data_dir);
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        eprintln!("Error: failed to create data dir {}: {e}", data_dir.display());
        std::process::exit(1);
    }

    if let Some(web_dir) = &args.web_dir {
        // Read back by the router; keeping it in the environment avoids
        // threading an option through every layer for a dev-mode convenience.
        unsafe { std::env::set_var("YAAK_BRIDGE_WEB_DIR", web_dir) };
    }

    let token = args.token.unwrap_or_else(generate_token);
    let is_dev = cfg!(debug_assertions);

    let mut state = state::BridgeState::new(data_dir.clone(), APP_ID, token.clone(), is_dev);
    state.init_plugins().await;
    let state = Arc::new(state);

    let router = Arc::new(rpc::build_router());
    let app = http::build_app(state.clone(), router);

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("Error: failed to bind {addr}: {e}");
            std::process::exit(1);
        }
    };

    let base = format!("http://127.0.0.1:{}", args.port);
    println!();
    println!("  Yaak Bridge listening on {base}");
    println!("  Data dir: {}", data_dir.display());
    println!("  Plugins:  {}", if state.capabilities.plugins { "running" } else { "unavailable" });
    println!();
    if std::env::var("YAAK_BRIDGE_WEB_DIR").is_ok() {
        println!("  Open: {base}/?bridgeToken={token}");
    } else {
        println!("  Token: {token}");
        println!("  Open your dev server with ?bridgeToken={token}");
    }
    println!();

    let shutdown_state = state.clone();
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = tokio::signal::ctrl_c().await;
        log::info!("Shutting down");
        shutdown_state.shutdown().await;
    });

    if let Err(e) = server.await {
        eprintln!("Error: server failed: {e}");
        std::process::exit(1);
    }
}

fn default_data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("yaak-bridge")
}

/// A 256-bit random token, hex encoded. Per process, never written to disk.
fn generate_token() -> String {
    let bytes: [u8; 32] = rand::thread_rng().r#gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
