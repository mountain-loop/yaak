use crate::sender::HttpResponseEvent;
use hyper_util::client::legacy::connect::dns::{
    GaiResolver as HyperGaiResolver, Name as HyperName,
};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{RwLock, mpsc};
use tower_service::Service;

#[derive(Clone)]
pub struct LocalhostResolver {
    fallback: HyperGaiResolver,
    event_tx: Arc<RwLock<Option<mpsc::Sender<HttpResponseEvent>>>>,
}

impl LocalhostResolver {
    pub fn new() -> Arc<Self> {
        let resolver = HyperGaiResolver::new();
        Arc::new(Self { fallback: resolver, event_tx: Arc::new(RwLock::new(None)) })
    }

    /// Set the event sender for the current request.
    /// This should be called before each request to direct DNS events
    /// to the appropriate channel.
    pub async fn set_event_sender(&self, tx: Option<mpsc::Sender<HttpResponseEvent>>) {
        let mut guard = self.event_tx.write().await;
        *guard = tx;
    }
}

impl Resolve for LocalhostResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_lowercase();
        let event_tx = self.event_tx.clone();

        let is_localhost = host.ends_with(".localhost");
        if is_localhost {
            let hostname = host.clone();
            // Port 0 is fine; reqwest replaces it with the URL's explicit
            // port or the scheme's default (80/443, etc.).
            let addrs: Vec<SocketAddr> = vec![
                SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
                SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 0),
            ];

            let addresses: Vec<String> = addrs.iter().map(|a| a.ip().to_string()).collect();

            return Box::pin(async move {
                // Emit DNS event for localhost resolution
                let guard = event_tx.read().await;
                if let Some(tx) = guard.as_ref() {
                    let _ = tx
                        .send(HttpResponseEvent::DnsResolved {
                            hostname,
                            addresses,
                            duration: 0,
                            overridden: false,
                        })
                        .await;
                }

                Ok::<Addrs, Box<dyn std::error::Error + Send + Sync>>(Box::new(addrs.into_iter()))
            });
        }

        let mut fallback = self.fallback.clone();
        let name_str = name.as_str().to_string();
        let hostname = host.clone();

        Box::pin(async move {
            let start = Instant::now();

            let result = match HyperName::from_str(&name_str) {
                Ok(n) => fallback.call(n).await,
                Err(e) => return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
            };

            let duration = start.elapsed().as_millis() as u64;

            match result {
                Ok(addrs) => {
                    // Collect addresses for event emission
                    let addr_vec: Vec<SocketAddr> = addrs.collect();
                    let addresses: Vec<String> =
                        addr_vec.iter().map(|a| a.ip().to_string()).collect();

                    // Emit DNS event
                    let guard = event_tx.read().await;
                    if let Some(tx) = guard.as_ref() {
                        let _ = tx
                            .send(HttpResponseEvent::DnsResolved {
                                hostname,
                                addresses,
                                duration,
                                overridden: false,
                            })
                            .await;
                    }

                    Ok(Box::new(addr_vec.into_iter()) as Addrs)
                }
                Err(err) => Err(Box::new(err) as Box<dyn std::error::Error + Send + Sync>),
            }
        })
    }
}
