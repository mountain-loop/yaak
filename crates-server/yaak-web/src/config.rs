use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;

/// The server behind Yaak running in a browser.
///
/// The tab renders the request and owns the data; this binary puts the bytes on the network
/// and streams back what came back, and with `--serve` hands the browser the app as well.
/// Nothing is written to disk or a database.
#[derive(Parser, Debug, Clone)]
#[command(name = "yaak-web", version, about, long_about = None)]
pub struct Config {
    /// Address to listen on. 127.0.0.1 for a local instance; 0.0.0.0 inside a container.
    #[arg(long, env = "YAAK_WEB_BIND", default_value = "127.0.0.1:9227")]
    pub bind: SocketAddr,

    /// Also serve a built web client from this directory, on the same origin as the API.
    /// Unknown paths fall back to `index.html` so the app's own routes work on a refresh.
    /// Without this the binary is only the send executor.
    #[arg(long, env = "YAAK_WEB_SERVE", value_name = "DIR")]
    pub serve: Option<PathBuf>,

    /// Allow sends to loopback, private and link-local addresses. Off by default, because a
    /// server reachable by strangers is an open relay into the network it sits on. Turn it on
    /// only for an instance whose users are meant to reach that network — a self-hosted one
    /// on a LAN, where the point is to call the API on the next machine.
    #[arg(long, env = "YAAK_WEB_ALLOW_PRIVATE_NETWORKS", default_value_t = false)]
    pub allow_private_networks: bool,

    /// Browser origins allowed to call this server (CORS), comma-separated. `*` allows any.
    /// A local dev instance wants the Vite origin; a hosted instance wants its own web origin.
    #[arg(
        long,
        env = "YAAK_WEB_ALLOWED_ORIGINS",
        default_value = "*",
        value_delimiter = ','
    )]
    pub allowed_origins: Vec<String>,

    /// Largest request the server accepts from the tab (the rendered request JSON, body included).
    #[arg(long, env = "YAAK_WEB_MAX_REQUEST_BYTES", default_value_t = 16 * 1024 * 1024)]
    pub max_request_bytes: usize,

    /// Largest upstream response body the server will relay before cutting the send off.
    #[arg(long, env = "YAAK_WEB_MAX_RESPONSE_BYTES", default_value_t = 64 * 1024 * 1024)]
    pub max_response_bytes: usize,

    /// Ceiling on a send's timeout, in seconds. A request asking for longer (or for no timeout)
    /// gets this instead.
    #[arg(long, env = "YAAK_WEB_MAX_TIMEOUT_SECS", default_value_t = 60)]
    pub max_timeout_secs: u64,

    /// Sends allowed per client IP per minute. 0 disables the limit. This and the concurrency
    /// cap are the whole of what protects an instance: there is no authentication.
    #[arg(long, env = "YAAK_WEB_RATE_LIMIT_PER_MINUTE", default_value_t = 120)]
    pub rate_limit_per_minute: u32,

    /// Sends in flight at once across all clients.
    #[arg(long, env = "YAAK_WEB_MAX_CONCURRENT", default_value_t = 256)]
    pub max_concurrent: usize,

    /// Take the client IP from `X-Forwarded-For` (first hop) instead of the socket. Only turn
    /// this on behind a load balancer that sets the header; otherwise anyone can spoof their way
    /// past the rate limit.
    #[arg(long, env = "YAAK_WEB_TRUST_FORWARDED_FOR", default_value_t = false)]
    pub trust_forwarded_for: bool,
}
