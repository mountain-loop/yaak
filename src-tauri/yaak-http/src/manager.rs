use crate::client::HttpConnectionOptions;
use crate::error::Result;
use log::info;
use reqwest::Client;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

pub struct HttpConnectionManager {
    connections: Arc<RwLock<BTreeMap<String, (Client, Instant)>>>,
    ttl: Duration,
}

impl HttpConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(BTreeMap::new())),
            ttl: Duration::from_mins(10),
        }
    }

    pub async fn get_client(&self, id: &str, opt: &HttpConnectionOptions) -> Result<Client> {
        let mut connections = self.connections.write().await;

        // Clean old connections
        connections.retain(|_, (_, last_used)| last_used.elapsed() <= self.ttl);

        if let Some((c, last_used)) = connections.get_mut(id) {
            info!("Re-using HTTP client {id}");
            *last_used = Instant::now();
            return Ok(c.clone());
        }

        info!("Building new HTTP client {id}");
        let c = opt.build_client()?;
        connections.insert(id.into(), (c.clone(), Instant::now()));
        Ok(c)
    }
}
