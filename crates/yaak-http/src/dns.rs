use crate::sender::HttpResponseEvent;
use hyper_util::client::legacy::connect::dns::{
    GaiResolver as HyperGaiResolver, Name as HyperName,
};
use log::info;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{RwLock, mpsc};
use tower_service::Service;
use yaak_models::models::DnsOverride;

/// Stores resolved addresses for a hostname override
#[derive(Clone)]
pub struct ResolvedOverride {
    pub ipv4: Vec<Ipv4Addr>,
    pub ipv6: Vec<Ipv6Addr>,
}

/// A veto on the addresses a hostname resolves to, consulted after resolution
/// and before any connection is made. Returning `Err` refuses the whole lookup
/// with that message; a hostname is never partially allowed.
///
/// A hosted sender uses this to refuse private and metadata ranges no matter
/// what name they hide behind. Checking here rather than on the URL is what
/// catches a public hostname that resolves to an internal address.
pub type AddressFilter = Arc<dyn Fn(IpAddr) -> std::result::Result<(), String> + Send + Sync>;

#[derive(Clone)]
pub struct LocalhostResolver {
    fallback: HyperGaiResolver,
    event_tx: Arc<RwLock<Option<mpsc::Sender<HttpResponseEvent>>>>,
    overrides: Arc<HashMap<String, ResolvedOverride>>,
    address_filter: Option<AddressFilter>,
}

impl LocalhostResolver {
    pub fn new(dns_overrides: Vec<DnsOverride>) -> Arc<Self> {
        Self::with_address_filter(dns_overrides, None)
    }

    pub fn with_address_filter(
        dns_overrides: Vec<DnsOverride>,
        address_filter: Option<AddressFilter>,
    ) -> Arc<Self> {
        let resolver = HyperGaiResolver::new();

        // Pre-parse DNS overrides into a lookup map
        let mut overrides = HashMap::new();
        for o in dns_overrides {
            if !o.enabled {
                continue;
            }
            let hostname = o.hostname.to_lowercase();

            let ipv4: Vec<Ipv4Addr> =
                o.ipv4.iter().filter_map(|s| s.parse::<Ipv4Addr>().ok()).collect();

            let ipv6: Vec<Ipv6Addr> =
                o.ipv6.iter().filter_map(|s| s.parse::<Ipv6Addr>().ok()).collect();

            // Only add if at least one address is valid
            if !ipv4.is_empty() || !ipv6.is_empty() {
                overrides.insert(hostname, ResolvedOverride { ipv4, ipv6 });
            }
        }

        Arc::new(Self {
            fallback: resolver,
            event_tx: Arc::new(RwLock::new(None)),
            overrides: Arc::new(overrides),
            address_filter,
        })
    }

    /// Apply the address filter, if any, to a resolved address list.
    fn filter_addrs(
        filter: &Option<AddressFilter>,
        addrs: &[SocketAddr],
    ) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(filter) = filter {
            for addr in addrs {
                if let Err(reason) = filter(addr.ip()) {
                    return Err(Box::new(std::io::Error::other(reason)));
                }
            }
        }
        Ok(())
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
        let overrides = self.overrides.clone();
        let address_filter = self.address_filter.clone();

        info!("DNS resolve called for: {}", host);

        // Check for DNS override first
        if let Some(resolved) = overrides.get(&host) {
            log::debug!("DNS override found for: {}", host);
            let hostname = host.clone();
            let mut addrs: Vec<SocketAddr> = Vec::new();

            // Add IPv4 addresses
            for ip in &resolved.ipv4 {
                addrs.push(SocketAddr::new(IpAddr::V4(*ip), 0));
            }

            // Add IPv6 addresses
            for ip in &resolved.ipv6 {
                addrs.push(SocketAddr::new(IpAddr::V6(*ip), 0));
            }

            let addresses: Vec<String> = addrs.iter().map(|a| a.ip().to_string()).collect();

            return Box::pin(async move {
                Self::filter_addrs(&address_filter, &addrs)?;

                // Emit DNS event for override
                let guard = event_tx.read().await;
                if let Some(tx) = guard.as_ref() {
                    let _ = tx
                        .send(HttpResponseEvent::DnsResolved {
                            hostname,
                            addresses,
                            duration: 0,
                            overridden: true,
                        })
                        .await;
                }

                Ok::<Addrs, Box<dyn std::error::Error + Send + Sync>>(Box::new(addrs.into_iter()))
            });
        }

        // Check for .localhost suffix
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
                Self::filter_addrs(&address_filter, &addrs)?;

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

        // Fall back to system DNS
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
                    Self::filter_addrs(&address_filter, &addr_vec)?;
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
