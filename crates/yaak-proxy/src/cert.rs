use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rcgen::{BasicConstraints, Certificate, CertificateParams, IsCa, KeyPair, KeyUsagePurpose};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

pub struct CertificateAuthority {
    ca_cert: Certificate,
    ca_cert_der: CertificateDer<'static>,
    ca_key: KeyPair,
    cache: Mutex<HashMap<String, Arc<ServerConfig>>>,
}

impl CertificateAuthority {
    pub fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages.push(KeyUsagePurpose::KeyCertSign);
        params.key_usages.push(KeyUsagePurpose::CrlSign);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Debug Proxy CA");
        params
            .distinguished_name
            .push(rcgen::DnType::OrganizationName, "Debug Proxy");

        let key = KeyPair::generate()?;
        let ca_cert = params.self_signed(&key)?;
        let ca_cert_der = ca_cert.der().clone();

        Ok(Self {
            ca_cert,
            ca_cert_der,
            ca_key: key,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn ca_pem(&self) -> String {
        pem::encode(&pem::Pem::new("CERTIFICATE", self.ca_cert_der.to_vec()))
    }

    pub fn server_config(
        &self,
        domain: &str,
    ) -> Result<Arc<ServerConfig>, Box<dyn std::error::Error + Send + Sync>> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some(config) = cache.get(domain) {
                return Ok(config.clone());
            }
        }

        let mut params = CertificateParams::new(vec![domain.to_string()])?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, domain);

        let leaf_key = KeyPair::generate()?;
        let leaf_cert = params.signed_by(&leaf_key, &self.ca_cert, &self.ca_key)?;

        let cert_der = leaf_cert.der().clone();
        let key_der = leaf_key.serialize_der();

        let mut config = ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_single_cert(
                vec![cert_der, self.ca_cert_der.clone()],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der)),
            )?;
        config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

        let config = Arc::new(config);
        self.cache
            .lock()
            .unwrap()
            .insert(domain.to_string(), config.clone());
        Ok(config)
    }
}
