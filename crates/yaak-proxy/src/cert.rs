use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rcgen::{
    BasicConstraints, Certificate, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa,
    KeyPair, KeyUsagePurpose,
};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use time::{Duration, OffsetDateTime};

const CA_COMMON_NAME: &str = "Yaak Proxy CA";
const CA_VALIDITY_DAYS: i64 = 3650;
const LEAF_VALIDITY_DAYS: i64 = 365;

/// The proxy's root CA, kept on disk as `ca.pem` and `ca.key` so trust survives restarts.
pub struct CaStore {
    cert_path: PathBuf,
    key_path: PathBuf,
    pem: String,
    cert_der: CertificateDer<'static>,
    issuer: Certificate,
    key: KeyPair,
    /// Keyed by host and whether HTTP/2 is offered.
    leaf_configs: Mutex<HashMap<(String, bool), Arc<ServerConfig>>>,
}

impl CaStore {
    /// Loads the CA from `dir`, or creates one there (key mode 0600) if either file is missing.
    /// Safe to call from several processes at once: `ca.lock` serializes them.
    pub fn load_or_create(dir: &Path) -> io::Result<Self> {
        let cert_path = dir.join("ca.pem");
        let key_path = dir.join("ca.key");

        fs::create_dir_all(dir)?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join("ca.lock"))?;
        lock.lock()?;

        let (pem, key) = if cert_path.exists() && key_path.exists() {
            let key =
                KeyPair::from_pem(&fs::read_to_string(&key_path)?).map_err(io::Error::other)?;
            (fs::read_to_string(&cert_path)?, key)
        } else {
            log::info!("Creating proxy CA in {}", dir.display());
            let key = KeyPair::generate().map_err(io::Error::other)?;
            let now = OffsetDateTime::now_utc();
            let mut params = ca_params();
            params.not_before = now - Duration::days(1);
            params.not_after = now + Duration::days(CA_VALIDITY_DAYS);
            let pem = params.self_signed(&key).map_err(io::Error::other)?.pem();
            remove_if_exists(&cert_path)?;
            write_atomic(&key_path, key.serialize_pem().as_bytes(), true)?;
            write_atomic(&cert_path, pem.as_bytes(), false)?;
            (pem, key)
        };
        drop(lock);

        let cert_der = pem::parse(&pem)
            .map_err(io::Error::other)
            .map(|p| CertificateDer::from(p.into_contents()))?;
        let issuer = ca_params().self_signed(&key).map_err(io::Error::other)?;

        Ok(Self {
            cert_path,
            key_path,
            pem,
            cert_der,
            issuer,
            key,
            leaf_configs: Mutex::new(HashMap::new()),
        })
    }

    /// The CA certificate as PEM, for installing into a trust store.
    pub fn pem(&self) -> &str {
        &self.pem
    }

    /// Path of `ca.pem`.
    pub fn cert_path(&self) -> &Path {
        &self.cert_path
    }

    /// Path of `ca.key`.
    pub fn key_path(&self) -> &Path {
        &self.key_path
    }

    /// The TLS config presented to clients of `host`, offering `h2` in ALPN when `http2` is set
    /// and `http/1.1` always.
    pub(crate) fn server_config(
        &self,
        host: &str,
        http2: bool,
    ) -> Result<Arc<ServerConfig>, BoxError> {
        self.server_config_with(host, http2, || self.sign_leaf(host))
    }

    /// [`Self::server_config`], with `sign` making a new leaf. It runs outside the cache's lock,
    /// so a host being signed holds up no other host's lookup. Connections racing to the same
    /// new host may each sign one; the first stored is the one kept.
    fn server_config_with(
        &self,
        host: &str,
        http2: bool,
        sign: impl FnOnce() -> Result<ServerConfig, BoxError>,
    ) -> Result<Arc<ServerConfig>, BoxError> {
        let key = (host.to_string(), http2);
        {
            let mut configs = self.leaf_configs.lock().unwrap();
            if let Some(config) = configs.get(&key) {
                return Ok(config.clone());
            }
            // The same leaf serves both, so switching HTTP/2 off and on signs nothing new.
            if let Some(other) = configs.get(&(host.to_string(), !http2)) {
                let mut config = ServerConfig::clone(other);
                config.alpn_protocols = alpn(http2);
                let config = Arc::new(config);
                configs.insert(key, config.clone());
                return Ok(config);
            }
        }

        let mut config = sign()?;
        config.alpn_protocols = alpn(http2);
        let mut configs = self.leaf_configs.lock().unwrap();
        Ok(configs.entry(key).or_insert_with(|| Arc::new(config)).clone())
    }

    /// A TLS config with a new leaf for `host`, signed by the CA. Key generation and signing
    /// take a few milliseconds.
    fn sign_leaf(&self, host: &str) -> Result<ServerConfig, BoxError> {
        let now = OffsetDateTime::now_utc();
        let mut params = CertificateParams::new(vec![host.to_string()])?;
        params.distinguished_name.push(DnType::CommonName, host);
        params.key_usages = vec![
            KeyUsagePurpose::DigitalSignature,
            KeyUsagePurpose::KeyEncipherment,
        ];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        params.use_authority_key_identifier_extension = true;
        params.not_before = now - Duration::days(1);
        params.not_after = now + Duration::days(LEAF_VALIDITY_DAYS);

        let leaf_key = KeyPair::generate()?;
        let leaf_cert = params.signed_by(&leaf_key, &self.issuer, &self.key)?;

        Ok(ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_single_cert(
                vec![leaf_cert.der().clone(), self.cert_der.clone()],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der())),
            )?)
    }
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

fn alpn(http2: bool) -> Vec<Vec<u8>> {
    if http2 { vec![b"h2".to_vec(), b"http/1.1".to_vec()] } else { vec![b"http/1.1".to_vec()] }
}

/// Issuer fields for the CA. Leaf certificates are signed against these, so they must stay
/// identical to what was written to `ca.pem`.
fn ca_params() -> CertificateParams {
    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.distinguished_name.push(DnType::CommonName, CA_COMMON_NAME);
    params.distinguished_name.push(DnType::OrganizationName, "Yaak");
    params
}

fn remove_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Writes through a temporary file and a rename, so readers never see a partial file.
fn write_atomic(path: &Path, contents: &[u8], private: bool) -> io::Result<()> {
    use std::io::Write;
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    if private {
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut file = options.open(&tmp)?;
    #[cfg(unix)]
    if private {
        file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    }
    file.write_all(contents)?;
    file.sync_all()?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A host whose leaf is still being signed holds up no lookup of another host's.
    #[test]
    fn signing_one_host_does_not_block_another() {
        let dir = tempfile::tempdir().unwrap();
        let ca = Arc::new(CaStore::load_or_create(dir.path()).unwrap());
        let cached = ca.server_config("cached.test", true).unwrap();

        let (signing_tx, signing_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let slow = std::thread::spawn({
            let ca = ca.clone();
            move || {
                ca.server_config_with("slow.test", true, || {
                    signing_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    ca.sign_leaf("slow.test")
                })
            }
        });
        signing_rx.recv().unwrap();

        let (found_tx, found_rx) = mpsc::channel();
        std::thread::spawn({
            let ca = ca.clone();
            move || found_tx.send(ca.server_config("cached.test", true).unwrap())
        });
        let found = found_rx.recv_timeout(std::time::Duration::from_secs(5));
        release_tx.send(()).unwrap();
        let found = found.expect("the cached lookup waited for another host's signing");
        assert!(Arc::ptr_eq(&found, &cached));

        let slow = slow.join().unwrap().unwrap();
        assert_eq!(slow.alpn_protocols, alpn(true));
        assert!(Arc::ptr_eq(&slow, &ca.server_config("slow.test", true).unwrap()), "kept");
    }
}
