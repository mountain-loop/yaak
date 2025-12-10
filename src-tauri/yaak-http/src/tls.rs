use log::warn;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::ring;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use rustls_platform_verifier::BuilderVerifierExt;
use std::fs;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct ClientCertificateConfig {
    pub crt_file: Option<String>,
    pub key_file: Option<String>,
    pub pfx_file: Option<String>,
    pub passphrase: Option<String>,
}

pub fn get_config(
    validate_certificates: bool,
    with_alpn: bool,
    client_cert: Option<&ClientCertificateConfig>,
) -> ClientConfig {
    let maybe_client_cert = load_client_cert(client_cert);

    let mut client = if validate_certificates {
        build_with_validation(maybe_client_cert)
    } else {
        build_without_validation(maybe_client_cert)
    };

    if with_alpn {
        client.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    }

    client
}

fn build_with_validation(
    client_cert: Option<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)>,
) -> ClientConfig {
    let arc_crypto_provider = Arc::new(ring::default_provider());
    let builder = ClientConfig::builder_with_provider(arc_crypto_provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_platform_verifier()
        .unwrap();

    if let Some((certs, key)) = client_cert {
        match builder.with_client_auth_cert(certs, key) {
            Ok(cfg) => return cfg,
            Err(err) => {
                warn!("Failed to configure client certificate: {:?}", err);
                // Rebuild without client auth
                let arc_crypto_provider = Arc::new(ring::default_provider());
                return ClientConfig::builder_with_provider(arc_crypto_provider)
                    .with_safe_default_protocol_versions()
                    .unwrap()
                    .with_platform_verifier()
                    .unwrap()
                    .with_no_client_auth();
            }
        }
    }

    builder.with_no_client_auth()
}

fn build_without_validation(
    client_cert: Option<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)>,
) -> ClientConfig {
    let arc_crypto_provider = Arc::new(ring::default_provider());
    let builder = ClientConfig::builder_with_provider(arc_crypto_provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerifier));

    if let Some((certs, key)) = client_cert {
        match builder.with_client_auth_cert(certs, key) {
            Ok(cfg) => return cfg,
            Err(err) => {
                warn!("Failed to configure client certificate: {:?}", err);
                // Rebuild without client auth
                let arc_crypto_provider = Arc::new(ring::default_provider());
                return ClientConfig::builder_with_provider(arc_crypto_provider)
                    .with_safe_default_protocol_versions()
                    .unwrap()
                    .dangerous()
                    .with_custom_certificate_verifier(Arc::new(NoVerifier))
                    .with_no_client_auth();
            }
        }
    }

    builder.with_no_client_auth()
}

fn load_client_cert(
    client_cert: Option<&ClientCertificateConfig>,
) -> Option<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)> {
    let config = client_cert?;

    // Try PFX/PKCS12 first
    if let Some(pfx_path) = &config.pfx_file {
        if !pfx_path.is_empty() {
            match load_pkcs12(pfx_path, config.passphrase.as_deref().unwrap_or("")) {
                Ok(result) => return Some(result),
                Err(e) => warn!("Failed to load PFX file: {}", e),
            }
        }
    }

    // Try CRT + KEY files
    if let (Some(crt_path), Some(key_path)) = (&config.crt_file, &config.key_file) {
        if !crt_path.is_empty() && !key_path.is_empty() {
            match load_pem_files(crt_path, key_path) {
                Ok(result) => return Some(result),
                Err(e) => warn!("Failed to load PEM files: {}", e),
            }
        }
    }

    None
}

fn load_pem_files(
    crt_path: &str,
    key_path: &str,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), String> {
    // Load certificates
    let crt_file = fs::File::open(Path::new(crt_path)).map_err(|e| e.to_string())?;
    let mut crt_reader = BufReader::new(crt_file);
    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut crt_reader)
        .filter_map(|r| r.ok())
        .collect();

    if certs.is_empty() {
        return Err("No certificates found in CRT file".to_string());
    }

    // Load private key
    let key_data = fs::read(Path::new(key_path)).map_err(|e| e.to_string())?;
    let key = load_private_key(&key_data)?;

    Ok((certs, key))
}

fn load_private_key(data: &[u8]) -> Result<PrivateKeyDer<'static>, String> {
    let mut reader = BufReader::new(data);

    // Try PKCS8 first
    if let Some(key) = rustls_pemfile::pkcs8_private_keys(&mut reader)
        .filter_map(|r| r.ok())
        .next()
    {
        return Ok(PrivateKeyDer::Pkcs8(key));
    }

    // Reset reader and try RSA
    let mut reader = BufReader::new(data);
    if let Some(key) = rustls_pemfile::rsa_private_keys(&mut reader)
        .filter_map(|r| r.ok())
        .next()
    {
        return Ok(PrivateKeyDer::Pkcs1(key));
    }

    // Reset reader and try EC
    let mut reader = BufReader::new(data);
    if let Some(key) = rustls_pemfile::ec_private_keys(&mut reader)
        .filter_map(|r| r.ok())
        .next()
    {
        return Ok(PrivateKeyDer::Sec1(key));
    }

    Err("Could not parse private key".to_string())
}

fn load_pkcs12(
    path: &str,
    passphrase: &str,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), String> {
    let data = fs::read(Path::new(path)).map_err(|e| e.to_string())?;

    let pfx = p12::PFX::parse(&data).map_err(|e| format!("Failed to parse PFX: {:?}", e))?;

    let keys = pfx
        .key_bags(passphrase)
        .map_err(|e| format!("Failed to extract keys: {:?}", e))?;

    let certs = pfx
        .cert_x509_bags(passphrase)
        .map_err(|e| format!("Failed to extract certs: {:?}", e))?;

    if keys.is_empty() {
        return Err("No private key found in PFX".to_string());
    }

    if certs.is_empty() {
        return Err("No certificates found in PFX".to_string());
    }

    // Convert certificates - p12 crate returns Vec<u8> for each cert
    let cert_ders: Vec<CertificateDer<'static>> = certs
        .into_iter()
        .map(|c| CertificateDer::from(c))
        .collect();

    // Convert key - the p12 crate returns raw key bytes
    let key_bytes = keys.into_iter().next().unwrap();
    let key = PrivateKeyDer::Pkcs8(key_bytes.into());

    Ok((cert_ders, key))
}

// Copied from reqwest: https://github.com/seanmonstar/reqwest/blob/595c80b1fbcdab73ac2ae93e4edc3406f453df25/src/tls.rs#L608
#[derive(Debug)]
struct NoVerifier;

impl ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer,
        _intermediates: &[CertificateDer],
        _server_name: &ServerName,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA1,
            SignatureScheme::ECDSA_SHA1_Legacy,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
            SignatureScheme::ED448,
        ]
    }
}
