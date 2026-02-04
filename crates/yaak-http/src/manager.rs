use crate::client::HttpConnectionOptions;
use crate::dns::LocalhostResolver;
use crate::error::Result;
use log::info;
use reqwest::Client;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// A cached HTTP client along with its DNS resolver.
/// The resolver is needed to set the event sender per-request.
pub struct CachedClient {
    pub client: Client,
    pub resolver: Arc<LocalhostResolver>,
}

pub struct HttpConnectionManager {
    connections: Arc<RwLock<BTreeMap<String, (CachedClient, Instant)>>>,
    ttl: Duration,
}

impl HttpConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(BTreeMap::new())),
            ttl: Duration::from_secs(10 * 60),
        }
    }

    pub async fn get_client(&self, opt: &HttpConnectionOptions) -> Result<CachedClient> {
        let mut connections = self.connections.write().await;
        let id = opt.id.clone();

        // Clean old connections
        connections.retain(|_, (_, last_used)| last_used.elapsed() <= self.ttl);

        if let Some((cached, last_used)) = connections.get_mut(&id) {
            info!("Re-using HTTP client {id}");
            *last_used = Instant::now();
            return Ok(CachedClient {
                client: cached.client.clone(),
                resolver: cached.resolver.clone(),
            });
        }

        let (client, resolver) = opt.build_client()?;
        let cached = CachedClient { client: client.clone(), resolver: resolver.clone() };
        connections.insert(id.into(), (cached, Instant::now()));

        Ok(CachedClient { client, resolver })
    }
}
