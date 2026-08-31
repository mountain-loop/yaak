use crate::dns::{AddressFilter, LocalhostResolver};
use crate::error::Result;
use log::{debug, info, warn};
use reqwest::{Client, ClientBuilder, Proxy, redirect};
use std::sync::{Arc, Mutex};
use yaak_models::models::{DnsOverride, HttpVersion};
use yaak_tls::{
    ClientCertificateConfig, NativeClientIdentity, get_tls_config, load_native_client_identity,
};

pub const HTTP2_MAX_RESPONSE_HEADER_LIST_SIZE: u32 = 1024 * 1024;

fn client_builder() -> ClientBuilder {
    Client::builder().http2_max_header_list_size(HTTP2_MAX_RESPONSE_HEADER_LIST_SIZE)
}

#[derive(Clone)]
pub struct ConfiguredClient {
    inner: Client,
}

impl ConfiguredClient {
    pub(crate) fn build_default() -> Result<Self> {
        Ok(Self { inner: client_builder().build()? })
    }

    pub(crate) fn from_inner(inner: Client) -> Self {
        Self { inner }
    }

    pub(crate) fn inner(&self) -> &Client {
        &self.inner
    }
}

/// Build a native-tls connector for maximum compatibility when certificate
/// validation is disabled. Unlike rustls, native-tls uses the OS TLS stack
/// (Secure Transport on macOS, SChannel on Windows, OpenSSL on Linux) which
/// supports TLS 1.0+ for legacy servers.
fn build_native_tls_connector(
    client_cert: Option<ClientCertificateConfig>,
    http_version: HttpVersion,
) -> Result<native_tls::TlsConnector> {
    let mut builder = native_tls::TlsConnector::builder();
    builder.danger_accept_invalid_certs(true);
    builder.danger_accept_invalid_hostnames(true);
    builder.min_protocol_version(Some(native_tls::Protocol::Tlsv10));
    // reqwest cannot add ALPN to a connector it did not build, so without this
    // the native path would silently negotiate HTTP/1.1 for every request.
    match http_version {
        HttpVersion::Auto => builder.request_alpns(&["h2", "http/1.1"]),
        HttpVersion::Http1 => builder.request_alpns(&["http/1.1"]),
        HttpVersion::Http2 => builder.request_alpns(&["h2"]),
    };

    if let Some(identity) = build_native_tls_identity(client_cert)? {
        builder.identity(identity);
    }

    Ok(builder.build()?)
}

/// Serializes PKCS#12 imports. On macOS native-tls imports every identity into
/// one process-wide temporary keychain, and it releases its own lock before
/// importing, so concurrent imports fail with an opaque OSStatus.
static IDENTITY_IMPORT: Mutex<()> = Mutex::new(());

fn build_native_tls_identity(
    client_cert: Option<ClientCertificateConfig>,
) -> Result<Option<native_tls::Identity>> {
    let Some(material) = load_native_client_identity(client_cert)? else {
        return Ok(None);
    };

    let _guard = IDENTITY_IMPORT.lock().unwrap_or_else(|e| e.into_inner());
    Ok(Some(match material {
        NativeClientIdentity::Pkcs12 { data, password } => {
            native_tls::Identity::from_pkcs12(&data, &password)?
        }
        NativeClientIdentity::Pkcs8 { chain_pem, key_pem } => {
            native_tls::Identity::from_pkcs8(&chain_pem, &key_pem)?
        }
    }))
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
    pub http_version: HttpVersion,
    pub proxy: HttpConnectionProxySetting,
    pub client_certificate: Option<ClientCertificateConfig>,
    pub dns_overrides: Vec<DnsOverride>,
    /// Refuse connections to addresses a hostname resolves to. `None` means
    /// every resolved address is connectable, which is what the desktop wants:
    /// a user sending to their own machine or their own network is the point.
    /// A hosted sender is the caller that supplies one.
    pub address_filter: Option<AddressFilter>,
}

impl HttpConnectionOptions {
    /// Build a reqwest Client and return it along with the DNS resolver.
    /// The resolver is returned separately so it can be configured per-request
    /// to emit DNS timing events to the appropriate channel.
    pub fn build_client(&self) -> Result<(ConfiguredClient, Arc<LocalhostResolver>)> {
        let mut client = client_builder()
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

        match self.http_version {
            HttpVersion::Auto => {}
            HttpVersion::Http1 => client = client.http1_only(),
            HttpVersion::Http2 => client = client.http2_prior_knowledge(),
        }

        // Configure TLS
        if self.validate_certificates {
            // Use rustls with platform certificate verification (TLS 1.2+ only)
            let mut config = get_tls_config(true, true, self.client_certificate.clone())?;
            // A forced version must also constrain ALPN, or the server may
            // negotiate a protocol the client then refuses to speak
            match self.http_version {
                HttpVersion::Auto => {}
                HttpVersion::Http1 => config.alpn_protocols = vec![b"http/1.1".to_vec()],
                HttpVersion::Http2 => config.alpn_protocols = vec![b"h2".to_vec()],
            }
            client = client.use_preconfigured_tls(config);
        } else {
            // Use native TLS for maximum compatibility (supports TLS 1.0+)
            let connector =
                build_native_tls_connector(self.client_certificate.clone(), self.http_version)?;
            client = client.use_preconfigured_tls(connector);
        }

        // Configure DNS resolver - keep a reference to configure per-request
        let resolver = LocalhostResolver::with_address_filter(
            self.dns_overrides.clone(),
            self.address_filter.clone(),
        );
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

        Ok((ConfiguredClient::from_inner(client.build()?), resolver))
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

#[cfg(test)]
mod client_certificate_tests {
    use super::*;
    use yaak_tls::get_tls_config;

    // Self-signed throwaway certificates, generated only for these tests.
    const RSA_CRT: &str = r#"-----BEGIN CERTIFICATE-----
MIIDEzCCAfugAwIBAgIUI3A1FyWKpilH/z1Ehnd68J9bpeEwDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNeWFhay10ZXN0LXJzYTAgFw0yNjA4MTQyMDQ2MjRaGA8y
MTI2MDcyMTIwNDYyNFowGDEWMBQGA1UEAwwNeWFhay10ZXN0LXJzYTCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBAK6o+exvMUs02ChHi81ILcaDkEaCzgFP
of6yDTF2m7jU1CUVwAcH4R0OKPetPVVqxPF+b/+LMdIeRIT/F5yaJgzWI6LQGmkZ
2hBrqQwuHKJq7g01+OuY0nQ13j/6HKRNKGdOiQRsKomMao1tcFYo1QMgD3lvhroO
Kr+zXPG8BP1T+b3taYyc9apeNaCouVBlY8cHk5/JxDjzOAP2s2oWBUGMSIFdjvQ+
h0oCJ5MavHXC9mMf/7nUi9bdfClZKfitUOuLiPf4qAjPW0zsyj+6IVzOG69ds5CV
/yM5B30fZxpRBqOlklisLW3r+aU1X8PsUeNyM31n8HfUzJMN+QBVmAkCAwEAAaNT
MFEwHQYDVR0OBBYEFBN40FBTuNs2ITuWp54ydZjYEx8YMB8GA1UdIwQYMBaAFBN4
0FBTuNs2ITuWp54ydZjYEx8YMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEL
BQADggEBAHdr7OgkQueHqkV31MyZAZQqOkEn6SnNo1lKwCdl5Axby2gNbSCdZLey
sHoQwEI1nbeRjXhK/Un+UB/aPBSpNTXjh7kLC6EhEj+xL1moUqcxEBxpSHY6awim
vAqRVnxA9IeZPDQy6si6W7nomaZzvdS5YBEDh9xFwsfbo/HGaHIGtngQwnglVKt2
XedN38Z71J0ZPPdBcod5trSkJGJwsh5q4i9h1TbLvVT4Am/3IU/WsPldmQs654cn
Vaj38PL32yhzo2HUUndf+4XRQezQXcqgAZBqJTpZShXXoJuvqYobB9gdeS8HvBoa
c9aYuXK5sppEg3haLax8XRWjhra/yAI=
-----END CERTIFICATE-----"#;

    const RSA_PKCS1_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEArqj57G8xSzTYKEeLzUgtxoOQRoLOAU+h/rINMXabuNTUJRXA
BwfhHQ4o9609VWrE8X5v/4sx0h5EhP8XnJomDNYjotAaaRnaEGupDC4comruDTX4
65jSdDXeP/ocpE0oZ06JBGwqiYxqjW1wVijVAyAPeW+Gug4qv7Nc8bwE/VP5ve1p
jJz1ql41oKi5UGVjxweTn8nEOPM4A/azahYFQYxIgV2O9D6HSgInkxq8dcL2Yx//
udSL1t18KVkp+K1Q64uI9/ioCM9bTOzKP7ohXM4br12zkJX/IzkHfR9nGlEGo6WS
WKwtbev5pTVfw+xR43IzfWfwd9TMkw35AFWYCQIDAQABAoIBAATW9PvpR6BrnFr0
QwM/i4MrbJhgB1cFIIFeL3/Kkf10YyoorjY+VB89g4Lto/++cmOndaoup3blO8HD
j6hneLzU0dyw/a8+so4kwnL8l1YkdovpcbLVw5dX0cdE/vZYa/wMK4aA7gK0GRvb
oIuNwCZkjA9x1TXl/PxsXpu/1fc5j/CUj0Kk3f/5Rj5cxM/nLqxVvd+EzVgt9TVv
fyspUPK0uRz2PK4ZXIVFAbJXVcpV3V3nY7UGjy8OukOVfEbAXtYeSq/eoI4H5Biu
gS1AnfST8ESe8r4OKl0Ii1sdhVS9etmBx+/EQjyjAGDe9Q38AgJL/6kPR7fuDdvU
SJ1ZM20CgYEA2NR01F2Yt8Z8/+02v213NPK+WYqFfOq7qusnBYdcibaivbszFNKO
kAzkaiWs4seou7ga9BbF5/kKjSlx2ud3Ks548IYg6/05XddXdiN4MT2rNn9m3IAm
zis5Sk/Elhw6HIilBJJgISjQVNj19nq1o2YTCSrvlccZNqn205DAEtUCgYEAzjZT
8OBaLcF1sEGY7hpVOeOe7377dG5B0ZO3k/q9IeW8f/W0xP6rcxdK+Rdun25Uig9H
36t2VYpboWTh1adTRUQRgcTFlFjulZilvofvFIgErLpRELqSghrd/O+0e1DPvx1w
YiMjZ5VMfvoOIvoYrNtgAmRBrkq/ohDvFEIGgmUCgYAPTh/ZBapL/pTAM+xTYtSx
RhktlNuLT75jeCnO+BkOF3gxUE9wvtQVUvOkkng7ocBFT9+HLzxU/X1DLZO90ezV
drGOuMkGH1+3QgYIbsSDJUk6lY+bLOiQUPjASBUmS2PGs9aCFhr2/DyIYLAr78l2
eTQKx58VwXIEK8cic+s66QKBgQC0VdyIvZr/gr0KPAOizpKTwpS+u1zqEHYs8rLL
ja6TE1cKzHSfBlwnlUoyliRe9tyltAFWAJvG6O2DMjcxYlg3LfTleJCVUEStvMXN
3xDc8qqr53B3YcI4V4ik53f9k8lqSDN9D1+p+W3haYqtWev0VxEaZlTuOF5oO8jo
/Wi15QKBgQDOc9FRdEPrW6KEA9QJROjt8vEmElWgJu14KxMpK8Jq6HgZ2/CqC6Hl
wdphddrz57mWSuJtrAnmbSiiGyw3uUZFSQV8CLW12k5qaulxR9ODdosNjaEjJ/Rl
yUXONJ+DpurH+/ZzRKM5q1AqMG54EeX/WoCQbBOPB9zfYJJ1AKuZ5g==
-----END RSA PRIVATE KEY-----"#;

    const RSA_PKCS8_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCuqPnsbzFLNNgo
R4vNSC3Gg5BGgs4BT6H+sg0xdpu41NQlFcAHB+EdDij3rT1VasTxfm//izHSHkSE
/xecmiYM1iOi0BppGdoQa6kMLhyiau4NNfjrmNJ0Nd4/+hykTShnTokEbCqJjGqN
bXBWKNUDIA95b4a6Diq/s1zxvAT9U/m97WmMnPWqXjWgqLlQZWPHB5OfycQ48zgD
9rNqFgVBjEiBXY70PodKAieTGrx1wvZjH/+51IvW3XwpWSn4rVDri4j3+KgIz1tM
7Mo/uiFczhuvXbOQlf8jOQd9H2caUQajpZJYrC1t6/mlNV/D7FHjcjN9Z/B31MyT
DfkAVZgJAgMBAAECggEABNb0++lHoGucWvRDAz+LgytsmGAHVwUggV4vf8qR/XRj
KiiuNj5UHz2Dgu2j/75yY6d1qi6nduU7wcOPqGd4vNTR3LD9rz6yjiTCcvyXViR2
i+lxstXDl1fRx0T+9lhr/AwrhoDuArQZG9ugi43AJmSMD3HVNeX8/Gxem7/V9zmP
8JSPQqTd//lGPlzEz+curFW934TNWC31NW9/KylQ8rS5HPY8rhlchUUBsldVylXd
XedjtQaPLw66Q5V8RsBe1h5Kr96gjgfkGK6BLUCd9JPwRJ7yvg4qXQiLWx2FVL16
2YHH78RCPKMAYN71DfwCAkv/qQ9Ht+4N29RInVkzbQKBgQDY1HTUXZi3xnz/7Ta/
bXc08r5ZioV86ruq6ycFh1yJtqK9uzMU0o6QDORqJazix6i7uBr0FsXn+QqNKXHa
53cqznjwhiDr/Tld11d2I3gxPas2f2bcgCbOKzlKT8SWHDociKUEkmAhKNBU2PX2
erWjZhMJKu+Vxxk2qfbTkMAS1QKBgQDONlPw4FotwXWwQZjuGlU5457vfvt0bkHR
k7eT+r0h5bx/9bTE/qtzF0r5F26fblSKD0ffq3ZViluhZOHVp1NFRBGBxMWUWO6V
mKW+h+8UiASsulEQupKCGt3877R7UM+/HXBiIyNnlUx++g4i+his22ACZEGuSr+i
EO8UQgaCZQKBgA9OH9kFqkv+lMAz7FNi1LFGGS2U24tPvmN4Kc74GQ4XeDFQT3C+
1BVS86SSeDuhwEVP34cvPFT9fUMtk73R7NV2sY64yQYfX7dCBghuxIMlSTqVj5ss
6JBQ+MBIFSZLY8az1oIWGvb8PIhgsCvvyXZ5NArHnxXBcgQrxyJz6zrpAoGBALRV
3Ii9mv+CvQo8A6LOkpPClL67XOoQdizyssuNrpMTVwrMdJ8GXCeVSjKWJF723KW0
AVYAm8bo7YMyNzFiWDct9OV4kJVQRK28xc3fENzyqqvncHdhwjhXiKTnd/2TyWpI
M30PX6n5beFpiq1Z6/RXERpmVO44Xmg7yOj9aLXlAoGBAM5z0VF0Q+tbooQD1AlE
6O3y8SYSVaAm7XgrEykrwmroeBnb8KoLoeXB2mF12vPnuZZK4m2sCeZtKKIbLDe5
RkVJBXwItbXaTmpq6XFH04N2iw2NoSMn9GXJRc40n4Om6sf79nNEozmrUCowbngR
5f9agJBsE48H3N9gknUAq5nm
-----END PRIVATE KEY-----"#;

    const EC_CRT: &str = r#"-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIUB8703dqXCUOJQbhbyaMUMbVFOjwwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMeWFhay10ZXN0LWVjMCAXDTI2MDgxNDIwNDYyNFoYDzIxMjYw
NzIxMjA0NjI0WjAXMRUwEwYDVQQDDAx5YWFrLXRlc3QtZWMwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATCYYKhzgHEaRaGsYVjJSoXvoroL8qe1yeEA0VtfxFzMBg+
+bkPQ0nCtMyFfvQQtXWYIakxzsWJyhI8wPjUj6QSo1MwUTAdBgNVHQ4EFgQUKq40
Hl+2DziVkBVR/tGsPj9FRo0wHwYDVR0jBBgwFoAUKq40Hl+2DziVkBVR/tGsPj9F
Ro0wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEAj1dx5XLl9iCZ
rD0CW+a3RTluxQ5icXno9WJ9qaS6L08CIFx2t0y9znQr7n5x+SmfXbfZtkDola8e
8nEZga/HXSeu
-----END CERTIFICATE-----"#;

    const EC_SEC1_KEY: &str = r#"-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIIoiiZ/hb4h6eHkZUVBTQFz7KLrVKJqQtWee2ygOjijNoAoGCCqGSM49
AwEHoUQDQgAEwmGCoc4BxGkWhrGFYyUqF76K6C/KntcnhANFbX8RczAYPvm5D0NJ
wrTMhX70ELV1mCGpMc7FicoSPMD41I+kEg==
-----END EC PRIVATE KEY-----"#;

    const EC_PKCS8_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgiiKJn+FviHp4eRlR
UFNAXPsoutUompC1Z57bKA6OKM2hRANCAATCYYKhzgHEaRaGsYVjJSoXvoroL8qe
1yeEA0VtfxFzMBg++bkPQ0nCtMyFfvQQtXWYIakxzsWJyhI8wPjUj6QS
-----END PRIVATE KEY-----"#;

    /// Every key format the rustls path accepts, in the encodings users
    /// actually have on disk.
    fn key_formats() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            ("RSA cert with PKCS#8 key", RSA_CRT, RSA_PKCS8_KEY),
            ("RSA cert with PKCS#1 key", RSA_CRT, RSA_PKCS1_KEY),
            ("EC cert with PKCS#8 key", EC_CRT, EC_PKCS8_KEY),
            ("EC cert with SEC1 key", EC_CRT, EC_SEC1_KEY),
        ]
    }

    fn write_pair(dir: &tempfile::TempDir, crt: &str, key: &str) -> ClientCertificateConfig {
        let crt_path = dir.path().join("client.crt");
        let key_path = dir.path().join("client.key");
        std::fs::write(&crt_path, crt).unwrap();
        std::fs::write(&key_path, key).unwrap();
        ClientCertificateConfig {
            crt_file: Some(crt_path.to_str().unwrap().to_string()),
            key_file: Some(key_path.to_str().unwrap().to_string()),
            pfx_file: None,
            passphrase: None,
        }
    }

    #[test]
    fn native_tls_accepts_every_format_rustls_accepts() {
        for (name, crt, key) in key_formats() {
            let dir = tempfile::TempDir::new().unwrap();
            let config = write_pair(&dir, crt, key);

            get_tls_config(false, true, Some(config.clone()))
                .unwrap_or_else(|e| panic!("rustls rejected {name}: {e}"));

            let identity = build_native_tls_identity(Some(config))
                .unwrap_or_else(|e| panic!("native-tls rejected {name}: {e}"));
            assert!(identity.is_some(), "no identity built for {name}");
        }
    }

    #[test]
    fn a_leading_header_line_before_the_key_is_tolerated() {
        let dir = tempfile::TempDir::new().unwrap();
        let key = format!("Bag Attributes: friendlyName=client\n{RSA_PKCS8_KEY}");
        let config = write_pair(&dir, RSA_CRT, &key);
        assert!(build_native_tls_identity(Some(config)).unwrap().is_some());
    }

    #[test]
    fn no_identity_is_built_without_a_configured_certificate() {
        assert!(build_native_tls_identity(None).unwrap().is_none());

        let empty = ClientCertificateConfig {
            crt_file: Some("".into()),
            key_file: Some("".into()),
            pfx_file: Some("".into()),
            passphrase: None,
        };
        assert!(build_native_tls_identity(Some(empty)).unwrap().is_none());
    }
}
