use crate::dns::LocalhostResolver;
use crate::error::Result;
use crate::tls;
use log::{debug, warn};
use reqwest::redirect::Policy;
use reqwest::{Client, Proxy};
use reqwest_cookie_store::CookieStoreMutex;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct HttpConnectionProxySettingAuth {
    pub user: String,
    pub password: String,
}

#[derive(Clone)]
pub enum HttpConnectionProxySetting {
    Disabled,
    System,
    Enabled {
        http: String,
        https: String,
        auth: Option<HttpConnectionProxySettingAuth>,
        bypass: String,
    },
}

#[derive(Clone)]
pub struct HttpConnectionOptions {
    pub follow_redirects: bool,
    pub validate_certificates: bool,
    pub proxy: HttpConnectionProxySetting,
    pub cookie_provider: Option<Arc<CookieStoreMutex>>,
    pub timeout: Option<Duration>,
}

impl HttpConnectionOptions {
    pub(crate) fn build_client(&self) -> Result<Client> {
        let mut client = Client::builder()
            .connection_verbose(true)
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .referer(false)
            .tls_info(true);

        // Configure TLS
        client = client.use_preconfigured_tls(tls::get_config(self.validate_certificates, true));

        // Configure DNS resolver
        client = client.dns_resolver(LocalhostResolver::new());

        // Configure redirects
        client = client.redirect(match self.follow_redirects {
            true => Policy::limited(10), // TODO: Handle redirects natively
            false => Policy::none(),
        });

        // Configure cookie provider
        if let Some(p) = &self.cookie_provider {
            client = client.cookie_provider(Arc::clone(&p));
        }

        // Configure proxy
        match self.proxy.clone() {
            HttpConnectionProxySetting::System => { /* Default */ }
            HttpConnectionProxySetting::Disabled => {
                client = client.no_proxy();
            }
            HttpConnectionProxySetting::Enabled {
                http,
                https,
                auth,
                bypass,
            } => {
                for p in build_enabled_proxy(http, https, auth, bypass) {
                    client = client.proxy(p)
                }
            }
        }

        // Configure timeout
        if let Some(d) = self.timeout {
            client = client.timeout(d);
        }

        Ok(client.build()?)
    }
}

fn build_enabled_proxy(
    http: String,
    https: String,
    auth: Option<HttpConnectionProxySettingAuth>,
    bypass: String,
) -> Vec<Proxy> {
    debug!("Using proxy http={http} https={https} bypass={bypass}");

    let mut proxies = Vec::new();

    if !http.is_empty() {
        match Proxy::http(http) {
            Ok(mut proxy) => {
                if let Some(HttpConnectionProxySettingAuth { user, password }) = auth.clone() {
                    debug!("Using http proxy auth");
                    proxy = proxy.basic_auth(user.as_str(), password.as_str());
                }
                proxies.push(proxy.no_proxy(reqwest::NoProxy::from_string(&bypass)));
            }
            Err(e) => {
                warn!("Failed to apply http proxy {e:?}");
            }
        };
    }

    if !https.is_empty() {
        match Proxy::https(https) {
            Ok(mut proxy) => {
                if let Some(HttpConnectionProxySettingAuth { user, password }) = auth {
                    debug!("Using https proxy auth");
                    proxy = proxy.basic_auth(user.as_str(), password.as_str());
                }
                proxies.push(proxy.no_proxy(reqwest::NoProxy::from_string(&bypass)));
            }
            Err(e) => {
                warn!("Failed to apply https proxy {e:?}");
            }
        };
    }

    proxies
}
