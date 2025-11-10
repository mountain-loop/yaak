use crate::client::HttpConnectionOptions;
use crate::error::Result;
use log::info;
use reqwest::Client;
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct HttpConnectionManager {
    connections: Arc<RwLock<BTreeMap<String, Client>>>,
}

impl HttpConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }

    pub async fn get_client(&self, id: &str, opt: &HttpConnectionOptions) -> Result<Client> {
        let mut connections = self.connections.write().await;
        if let Some(c) = connections.get(id).cloned() {
            info!("Re-using HTTP client {id}");
            return Ok(c);
        }

        info!("Building new HTTP client {id}");
        let c = opt.build_client()?;
        connections.insert(id.into(), c.clone());
        Ok(c)
    }

    pub async fn add_client(&self, id: impl Into<String>, client: Client) {
        let mut connections = self.connections.write().await;
        connections.insert(id.into(), client);
    }

    pub async fn remove_client(&self, id: &str) {
        let mut connections = self.connections.write().await;
        connections.remove(id);
    }
}
