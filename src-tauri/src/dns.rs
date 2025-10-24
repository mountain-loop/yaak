use hyper_util::client::legacy::connect::dns::{
    GaiResolver as HyperGaiResolver, Name as HyperName,
};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use tower_service::Service;

#[derive(Clone)]
pub(crate) struct LocalhostResolver {
    fallback: HyperGaiResolver,
}

impl LocalhostResolver {
    pub fn new() -> Arc<Self> {
        let resolver = HyperGaiResolver::new();
        Arc::new(Self { fallback: resolver })
    }
}

impl Resolve for LocalhostResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_lowercase();

        let is_localhost = host.ends_with(".localhost");
        if is_localhost {
            // Port 0 is fine; reqwest replaces it with the URL's explicit
            // port or the scheme’s default (80/443, etc.).
            // (See docs note below.)
            let addrs: Vec<SocketAddr> = vec![
                SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
                SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 0),
            ];

            return Box::pin(async move {
                Ok::<Addrs, Box<dyn std::error::Error + Send + Sync>>(Box::new(addrs.into_iter()))
            });
        }

        let mut fallback = self.fallback.clone();
        let name_str = name.as_str().to_string();
        Box::pin(async move {
            match HyperName::from_str(&name_str) {
                Ok(n) => fallback
                    .call(n)
                    .await
                    .map(|addrs| Box::new(addrs) as Addrs)
                    .map_err(|err| Box::new(err) as Box<dyn std::error::Error + Send + Sync>),
                Err(e) => Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>),
            }
        })
    }
}
