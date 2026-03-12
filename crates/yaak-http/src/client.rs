use crate::dns::LocalhostResolver;
use crate::error::Result;
use log::{debug, info, warn};
use reqwest::{Client, Proxy, redirect};
use std::sync::Arc;
use yaak_models::models::DnsOverride;
use yaak_tls::{ClientCertificateConfig, get_tls_config};

/// Build a native-tls connector for maximum compatibility when certificate
/// validation is disabled. Unlike rustls, native-tls uses the OS TLS stack
/// (Secure Transport on macOS, SChannel on Windows, OpenSSL on Linux) which
/// supports TLS 1.0+ for legacy servers.
fn build_native_tls_connector(
    client_cert: Option<ClientCertificateConfig>,
) -> Result<native_tls::TlsConnector> {
    let mut builder = native_tls::TlsConnector::builder();
    builder.danger_accept_invalid_certs(true);
    builder.danger_accept_invalid_hostnames(true);
    builder.min_protocol_version(Some(native_tls::Protocol::Tlsv10));

    if let Some(identity) = build_native_tls_identity(client_cert)? {
        builder.identity(identity);
    }

    Ok(builder.build()?)
}

fn build_native_tls_identity(
    client_cert: Option<ClientCertificateConfig>,
) -> Result<Option<native_tls::Identity>> {
    let config = match client_cert {
        None => return Ok(None),
        Some(c) => c,
    };

    // Try PFX/PKCS12 first
    if let Some(pfx_path) = &config.pfx_file {
        if !pfx_path.is_empty() {
            let pfx_data = std::fs::read(pfx_path)?;
            let password = config.passphrase.as_deref().unwrap_or("");
            let identity = native_tls::Identity::from_pkcs12(&pfx_data, password)?;
            return Ok(Some(identity));
        }
    }

    // Try CRT + KEY files
    if let (Some(crt_path), Some(key_path)) = (&config.crt_file, &config.key_file) {
        if !crt_path.is_empty() && !key_path.is_empty() {
            let crt_data = std::fs::read(crt_path)?;
            let key_data = std::fs::read(key_path)?;
            let identity = native_tls::Identity::from_pkcs8(&crt_data, &key_data)?;
            return Ok(Some(identity));
        }
    }

    Ok(None)
}

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
    pub dns_overrides: Vec<DnsOverride>,
}

impl HttpConnectionOptions {
    /// Build a reqwest Client and return it along with the DNS resolver.
    /// The resolver is returned separately so it can be configured per-request
    /// to emit DNS timing events to the appropriate channel.
    pub(crate) fn build_client(&self) -> Result<(Client, Arc<LocalhostResolver>)> {
        let mut client = Client::builder()
            .connection_verbose(true)
            .redirect(redirect::Policy::none())
            // Decompression is handled by HttpTransaction, not reqwest
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .referer(false)
            .tls_info(true)
            // Disable connection pooling to ensure DNS resolution happens on each request
            // This is needed so we can emit DNS timing events for each request
            .pool_max_idle_per_host(0);

        // Configure TLS
        if self.validate_certificates {
            // Use rustls with platform certificate verification (TLS 1.2+ only)
            let config = get_tls_config(true, true, self.client_certificate.clone())?;
            client = client.use_preconfigured_tls(config);
        } else {
            // Use native TLS for maximum compatibility (supports TLS 1.0+)
            let connector =
                build_native_tls_connector(self.client_certificate.clone())?;
            client = client.use_preconfigured_tls(connector);
        }

        // Configure DNS resolver - keep a reference to configure per-request
        let resolver = LocalhostResolver::new(self.dns_overrides.clone());
        client = client.dns_resolver(resolver.clone());

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

        Ok((client.build()?, resolver))
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
