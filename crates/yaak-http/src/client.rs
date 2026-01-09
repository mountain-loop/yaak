use crate::dns::LocalhostResolver;
use crate::error::Result;
use log::{debug, info, warn};
use reqwest::{Client, Proxy, redirect};
use yaak_tls::{ClientCertificateConfig, get_tls_config};

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
    pub id: String,
    pub validate_certificates: bool,
    pub proxy: HttpConnectionProxySetting,
    pub client_certificate: Option<ClientCertificateConfig>,
}

impl HttpConnectionOptions {
    pub(crate) fn build_client(&self) -> Result<Client> {
        let mut client = Client::builder()
            .connection_verbose(true)
            .redirect(redirect::Policy::none())
            // Decompression is handled by HttpTransaction, not reqwest
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .referer(false)
            .tls_info(true);

        // Configure TLS with optional client certificate
        let config =
            get_tls_config(self.validate_certificates, true, self.client_certificate.clone())?;
        client = client.use_preconfigured_tls(config);

        // Configure DNS resolver
        client = client.dns_resolver(LocalhostResolver::new());

        // Configure proxy
        match self.proxy.clone() {
            HttpConnectionProxySetting::System => { /* Default */ }
            HttpConnectionProxySetting::Disabled => {
                client = client.no_proxy();
            }
            HttpConnectionProxySetting::Enabled { http, https, auth, bypass } => {
                for p in build_enabled_proxy(http, https, auth, bypass) {
                    client = client.proxy(p)
                }
            }
        }

        info!(
            "Building new HTTP client validate_certificates={} client_cert={}",
            self.validate_certificates,
            self.client_certificate.is_some()
        );

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
