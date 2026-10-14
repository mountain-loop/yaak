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
    leaf_configs: Mutex<HashMap<String, Arc<ServerConfig>>>,
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

    pub(crate) fn server_config(
        &self,
        host: &str,
    ) -> Result<Arc<ServerConfig>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(config) = self.leaf_configs.lock().unwrap().get(host) {
            return Ok(config.clone());
        }

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

        let mut config =
            ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()?
                .with_no_client_auth()
                .with_single_cert(
                    vec![leaf_cert.der().clone(), self.cert_der.clone()],
                    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der())),
                )?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];

        let config = Arc::new(config);
        self.leaf_configs.lock().unwrap().insert(host.to_string(), config.clone());
        Ok(config)
    }
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
