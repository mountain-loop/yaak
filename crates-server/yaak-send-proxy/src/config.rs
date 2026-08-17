use clap::Parser;
use std::net::SocketAddr;

/// A stateless HTTP send executor for Yaak running in a browser.
///
/// The tab renders the request and owns the data; this binary only puts bytes on the
/// network and streams back what came back. Nothing is written to disk or a database.
#[derive(Parser, Debug, Clone)]
#[command(name = "yaak-send-proxy", version, about, long_about = None)]
pub struct Config {
    /// Address to listen on. 127.0.0.1 for a local instance; 0.0.0.0 inside a container.
    #[arg(long, env = "YAAK_PROXY_BIND", default_value = "127.0.0.1:9227")]
    pub bind: SocketAddr,

    /// Browser origins allowed to call this proxy (CORS), comma-separated. `*` allows any.
    /// A local dev instance wants the Vite origin; a hosted instance wants its own web origin.
    #[arg(
        long,
        env = "YAAK_PROXY_ALLOWED_ORIGINS",
        default_value = "*",
        value_delimiter = ','
    )]
    pub allowed_origins: Vec<String>,

    /// Require `Authorization: Bearer <token>` on every send. Unset means anonymous access,
    /// which is what the hosted funnel wants alongside the rate limit.
    #[arg(long, env = "YAAK_PROXY_TOKEN")]
    pub token: Option<String>,

    /// Allow sends to private, loopback, link-local and other non-public addresses.
    ///
    /// Off by default: a hosted instance must not become a relay into its own network. A
    /// self-hosted instance on a private network legitimately needs this on to reach the
    /// services next to it.
    #[arg(
        long,
        env = "YAAK_PROXY_ALLOW_PRIVATE_NETWORKS",
        default_value_t = false
    )]
    pub allow_private_networks: bool,

    /// Only allow sends to these hosts (exact host, or `*.suffix`), comma-separated. Empty means
    /// every host not on the deny list.
    #[arg(long, env = "YAAK_PROXY_ALLOW_HOSTS", value_delimiter = ',')]
    pub allow_hosts: Vec<String>,

    /// Never send to these hosts (exact host, or `*.suffix`), comma-separated. Checked before the
    /// allow list.
    #[arg(long, env = "YAAK_PROXY_DENY_HOSTS", value_delimiter = ',')]
    pub deny_hosts: Vec<String>,

    /// Largest request the proxy accepts from the tab (the rendered request JSON, body included).
    #[arg(long, env = "YAAK_PROXY_MAX_REQUEST_BYTES", default_value_t = 16 * 1024 * 1024)]
    pub max_request_bytes: usize,

    /// Largest upstream response body the proxy will relay before cutting the send off.
    #[arg(long, env = "YAAK_PROXY_MAX_RESPONSE_BYTES", default_value_t = 64 * 1024 * 1024)]
    pub max_response_bytes: usize,

    /// Ceiling on a send's timeout, in seconds. A request asking for longer (or for no timeout)
    /// gets this instead.
    #[arg(long, env = "YAAK_PROXY_MAX_TIMEOUT_SECS", default_value_t = 60)]
    pub max_timeout_secs: u64,

    /// Sends allowed per client IP per minute. 0 disables the limit.
    #[arg(long, env = "YAAK_PROXY_RATE_LIMIT_PER_MINUTE", default_value_t = 120)]
    pub rate_limit_per_minute: u32,

    /// Sends in flight at once across all clients.
    #[arg(long, env = "YAAK_PROXY_MAX_CONCURRENT", default_value_t = 256)]
    pub max_concurrent: usize,

    /// Take the client IP from `X-Forwarded-For` (first hop) instead of the socket. Only turn
    /// this on behind a load balancer that sets the header; otherwise anyone can spoof their way
    /// past the rate limit.
    #[arg(long, env = "YAAK_PROXY_TRUST_FORWARDED_FOR", default_value_t = false)]
    pub trust_forwarded_for: bool,
}
