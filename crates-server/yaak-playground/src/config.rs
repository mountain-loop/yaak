use clap::Parser;
use std::net::{SocketAddr, ToSocketAddrs};

/// A small, disposable API for trying Yaak against.
#[derive(Parser, Debug, Clone)]
#[command(name = "yaak-playground", version, about, long_about = None)]
pub struct Config {
    /// Interface to listen on. 0.0.0.0 inside a container.
    #[arg(long, env = "HOST", default_value = "127.0.0.1")]
    pub host: String,

    #[arg(long, env = "PORT", default_value_t = 9228)]
    pub port: u16,

    /// Requests allowed per client IP per minute. 0 disables the limit.
    #[arg(
        long,
        env = "YAAK_PLAYGROUND_RATE_LIMIT_PER_MINUTE",
        default_value_t = 300
    )]
    pub rate_limit_per_minute: u32,

    /// Take the client IP from `X-Forwarded-For` (first hop) instead of the socket. Only behind
    /// a load balancer that sets the header.
    #[arg(
        long,
        env = "YAAK_PLAYGROUND_TRUST_FORWARDED_FOR",
        default_value_t = false
    )]
    pub trust_forwarded_for: bool,

    /// Seconds after a client's first write before its posts go back to the sample data.
    #[arg(long, env = "YAAK_PLAYGROUND_RESET_AFTER_SECS", default_value_t = 3600)]
    pub reset_after_secs: u64,

    /// Clients whose writes are kept at once. The oldest is reset early to make room.
    #[arg(long, env = "YAAK_PLAYGROUND_MAX_CLIENTS", default_value_t = 2000)]
    pub max_clients: usize,

    #[arg(
        long,
        env = "YAAK_PLAYGROUND_MAX_POSTS_PER_CLIENT",
        default_value_t = 100
    )]
    pub max_posts_per_client: usize,

    #[arg(long, env = "YAAK_PLAYGROUND_MAX_REQUEST_BYTES", default_value_t = 64 * 1024)]
    pub max_request_bytes: usize,
}

impl Config {
    pub fn listen_addr(&self) -> Result<SocketAddr, String> {
        (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|e| format!("Invalid HOST {:?}: {e}", self.host))?
            .next()
            .ok_or_else(|| format!("HOST {:?} resolved to no address", self.host))
    }
}
