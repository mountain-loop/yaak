use crate::error::Error::GenericError;
use crate::error::Result;
use log::debug;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::ring;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use rustls_platform_verifier::BuilderVerifierExt;
use std::fs;
use std::io::BufReader;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use yasna::models::ObjectIdentifier;

pub mod error;

const OID_RSA_ENCRYPTION: &[u64] = &[1, 2, 840, 113549, 1, 1, 1];
const OID_EC_PUBLIC_KEY: &[u64] = &[1, 2, 840, 10045, 2, 1];

/// Password for the PKCS#12 blob [`load_native_client_identity`] builds from PEM
/// files. The blob never leaves the process, so the value only has to agree with
/// the caller that immediately re-parses it.
const IN_MEMORY_PKCS12_PASSWORD: &str = "yaak";

#[derive(Clone, Default)]
pub struct ClientCertificateConfig {
    pub crt_file: Option<String>,
    pub key_file: Option<String>,
    pub pfx_file: Option<String>,
    pub passphrase: Option<String>,
}

pub fn get_tls_config(
    validate_certificates: bool,
    with_alpn: bool,
    client_cert: Option<ClientCertificateConfig>,
) -> Result<ClientConfig> {
    let maybe_client_cert = load_client_cert(client_cert)?;

    let mut client = if validate_certificates {
        build_with_validation(maybe_client_cert)
    } else {
        build_without_validation(maybe_client_cert)
    }?;

    if with_alpn {
        client.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    }

    Ok(client)
}

fn build_with_validation(
    client_cert: Option<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)>,
) -> Result<ClientConfig> {
    let arc_crypto_provider = Arc::new(ring::default_provider());
    let builder = ClientConfig::builder_with_provider(arc_crypto_provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?;

    if let Some((certs, key)) = client_cert {
        return Ok(builder.with_client_auth_cert(certs, key)?);
    }

    Ok(builder.with_no_client_auth())
}

fn build_without_validation(
    client_cert: Option<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)>,
) -> Result<ClientConfig> {
    let arc_crypto_provider = Arc::new(ring::default_provider());
    let builder = ClientConfig::builder_with_provider(arc_crypto_provider)
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerifier));

    if let Some((certs, key)) = client_cert {
        return Ok(builder.with_client_auth_cert(certs, key)?);
    }

    Ok(builder.with_no_client_auth())
}

fn load_client_cert(
    client_cert: Option<ClientCertificateConfig>,
) -> Result<Option<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)>> {
    let config = match client_cert {
        None => return Ok(None),
        Some(c) => c,
    };

    // Try PFX/PKCS12 first
    if let Some(pfx_path) = &config.pfx_file {
        if !pfx_path.is_empty() {
            return Ok(Some(load_pkcs12(pfx_path, config.passphrase.as_deref().unwrap_or(""))?));
        }
    }

    // Try CRT + KEY files
    if let (Some(crt_path), Some(key_path)) = (&config.crt_file, &config.key_file) {
        if !crt_path.is_empty() && !key_path.is_empty() {
            return Ok(Some(load_pem_files(crt_path, key_path)?));
        }
    }

    Ok(None)
}

/// A client identity in one of the encodings a native TLS stack accepts.
pub enum NativeClientIdentity {
    /// A PKCS#12 archive, with the password needed to open it.
    Pkcs12 { data: Vec<u8>, password: String },
    /// A PEM certificate chain, leaf first, with a PKCS#8 PEM private key.
    Pkcs8 {
        chain_pem: Vec<u8>,
        key_pem: Vec<u8>,
    },
}

/// Whether the platform's native TLS stack should be handed PEM material as
/// PKCS#12 rather than PKCS#8.
///
/// Both encodings lose something. PKCS#8 is rejected for EC keys by Security
/// Framework on macOS and by SChannel on Windows, which imports keys through an
/// RSA-only provider. PKCS#12 as the `p12` crate emits it is encrypted with
/// SHA1/40-bit-RC2 (certificates) and SHA1/3DES (key), and OpenSSL 3 moved RC2
/// into the legacy provider, so on Linux it fails to decrypt what we just
/// wrote. Each platform therefore gets the encoding its own stack can read.
const NATIVE_TLS_WANTS_PKCS12: bool = cfg!(any(target_vendor = "apple", target_os = "windows"));

/// Load the configured client certificate in whichever encoding this platform's
/// native TLS stack accepts.
pub fn load_native_client_identity(
    client_cert: Option<ClientCertificateConfig>,
) -> Result<Option<NativeClientIdentity>> {
    let config = match client_cert {
        None => return Ok(None),
        Some(c) => c,
    };

    // Pass a user-supplied PFX through untouched. The OS parser understands more
    // encryption algorithms than re-encoding it here would preserve.
    if let Some(pfx_path) = &config.pfx_file {
        if !pfx_path.is_empty() {
            let data = fs::read(Path::new(pfx_path))?;
            return Ok(Some(NativeClientIdentity::Pkcs12 {
                data,
                password: config.passphrase.clone().unwrap_or_default(),
            }));
        }
    }

    let Some((certs, key)) = load_client_cert(Some(config))? else {
        return Ok(None);
    };

    let key_der = to_pkcs8_der(&key)?;

    if !NATIVE_TLS_WANTS_PKCS12 {
        return Ok(Some(to_pkcs8_identity(&certs, &key_der)));
    }

    let (leaf, cas) = certs.split_first().ok_or(GenericError("No certificates found".into()))?;
    let cas: Vec<&[u8]> = cas.iter().map(|c| c.as_ref()).collect();

    let pfx = p12::PFX::new_with_cas(leaf, &key_der, &cas, IN_MEMORY_PKCS12_PASSWORD, "yaak")
        .ok_or(GenericError("Failed to build PKCS#12 from client certificate".into()))?;

    Ok(Some(NativeClientIdentity::Pkcs12 {
        data: pfx.to_der(),
        password: IN_MEMORY_PKCS12_PASSWORD.to_string(),
    }))
}

/// Re-encode a certificate chain and PKCS#8 key as the PEM pair native-tls
/// expects. It only recognises a key whose first line is the PKCS#8 header, so
/// the key has to arrive already converted by [`to_pkcs8_der`].
fn to_pkcs8_identity(certs: &[CertificateDer<'static>], key_der: &[u8]) -> NativeClientIdentity {
    let config = pem::EncodeConfig::new().set_line_ending(pem::LineEnding::LF);
    let chain: Vec<pem::Pem> =
        certs.iter().map(|c| pem::Pem::new("CERTIFICATE", c.as_ref())).collect();

    NativeClientIdentity::Pkcs8 {
        chain_pem: pem::encode_many_config(&chain, config).into_bytes(),
        key_pem: pem::encode_config(&pem::Pem::new("PRIVATE KEY", key_der), config).into_bytes(),
    }
}

/// Re-encode a private key as PKCS#8 DER, wrapping PKCS#1 and SEC1 keys.
fn to_pkcs8_der(key: &PrivateKeyDer<'_>) -> Result<Vec<u8>> {
    match key {
        PrivateKeyDer::Pkcs8(k) => Ok(k.secret_pkcs8_der().to_vec()),
        PrivateKeyDer::Pkcs1(k) => Ok(wrap_pkcs8(OID_RSA_ENCRYPTION, None, k.secret_pkcs1_der())),
        PrivateKeyDer::Sec1(k) => {
            let (curve, inner) = split_sec1(k.secret_sec1_der())?;
            Ok(wrap_pkcs8(OID_EC_PUBLIC_KEY, Some(curve), &inner))
        }
        _ => Err(GenericError("Unsupported private key format".into())),
    }
}

/// Build a PKCS#8 `PrivateKeyInfo` (RFC 5208) around an already-encoded key.
fn wrap_pkcs8(algorithm: &[u64], parameters: Option<ObjectIdentifier>, key_der: &[u8]) -> Vec<u8> {
    yasna::construct_der(|w| {
        w.write_sequence(|w| {
            w.next().write_u8(0);
            w.next().write_sequence(|w| {
                w.next().write_oid(&ObjectIdentifier::from_slice(algorithm));
                match &parameters {
                    Some(oid) => w.next().write_oid(oid),
                    None => w.next().write_null(),
                }
            });
            w.next().write_bytes(key_der);
        })
    })
}

/// Split a SEC1 `ECPrivateKey` (RFC 5915) into its named curve and a copy of the
/// key with that curve removed. PKCS#8 carries the curve in the algorithm
/// identifier, and RFC 5915 says it should not also be repeated inside the key.
fn split_sec1(der: &[u8]) -> Result<(ObjectIdentifier, Vec<u8>)> {
    yasna::parse_der(der, |r| {
        r.read_sequence(|r| {
            let version = r.next().read_u8()?;
            let private_key = r.next().read_bytes()?;
            let curve = r.next().read_tagged(yasna::Tag::context(0), |r| r.read_oid())?;
            let public_key = r.read_optional(|r| r.read_tagged_der())?;

            let inner = yasna::construct_der(|w| {
                w.write_sequence(|w| {
                    w.next().write_u8(version);
                    w.next().write_bytes(&private_key);
                    if let Some(public_key) = &public_key {
                        w.next().write_tagged_der(public_key);
                    }
                })
            });

            Ok((curve, inner))
        })
    })
    .map_err(|e| GenericError(format!("EC private key is missing a named curve: {e}")))
}

fn load_pem_files(
    crt_path: &str,
    key_path: &str,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)> {
    // Load certificates
    let crt_file = fs::File::open(Path::new(crt_path))?;
    let mut crt_reader = BufReader::new(crt_file);
    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut crt_reader).filter_map(|r| r.ok()).collect();

    if certs.is_empty() {
        return Err(GenericError("No certificates found in CRT file".to_string()));
    }

    // Load private key
    let key_data = fs::read(Path::new(key_path))?;
    let key = load_private_key(&key_data)?;

    Ok((certs, key))
}

fn load_private_key(data: &[u8]) -> Result<PrivateKeyDer<'static>> {
    let mut reader = BufReader::new(data);

    // Try PKCS8 first
    if let Some(key) = rustls_pemfile::pkcs8_private_keys(&mut reader).filter_map(|r| r.ok()).next()
    {
        return Ok(PrivateKeyDer::Pkcs8(key));
    }

    // Reset reader and try RSA
    let mut reader = BufReader::new(data);
    if let Some(key) = rustls_pemfile::rsa_private_keys(&mut reader).filter_map(|r| r.ok()).next() {
        return Ok(PrivateKeyDer::Pkcs1(key));
    }

    // Reset reader and try EC
    let mut reader = BufReader::new(data);
    if let Some(key) = rustls_pemfile::ec_private_keys(&mut reader).filter_map(|r| r.ok()).next() {
        return Ok(PrivateKeyDer::Sec1(key));
    }

    Err(GenericError("Could not parse private key".to_string()))
}

fn load_pkcs12(
    path: &str,
    passphrase: &str,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>)> {
    let data = fs::read(Path::new(path))?;

    let pfx = p12::PFX::parse(&data)
        .map_err(|e| GenericError(format!("Failed to parse PFX: {:?}", e)))?;

    let keys = pfx
        .key_bags(passphrase)
        .map_err(|e| GenericError(format!("Failed to extract keys: {:?}", e)))?;

    let certs = pfx
        .cert_x509_bags(passphrase)
        .map_err(|e| GenericError(format!("Failed to extract certs: {:?}", e)))?;

    if keys.is_empty() {
        return Err(GenericError("No private key found in PFX".to_string()));
    }

    if certs.is_empty() {
        return Err(GenericError("No certificates found in PFX".to_string()));
    }

    // Convert certificates - p12 crate returns Vec<u8> for each cert
    let cert_ders: Vec<CertificateDer<'static>> =
        certs.into_iter().map(|c| CertificateDer::from(c)).collect();

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
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer,
        _dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer,
        _dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
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

pub fn find_client_certificate(
    url_string: &str,
    certificates: &[yaak_models::models::ClientCertificate],
) -> Option<ClientCertificateConfig> {
    let url = url::Url::from_str(url_string).ok()?;
    let host = url.host_str()?;
    let port = url.port_or_known_default();

    for cert in certificates {
        if !cert.enabled {
            debug!("Client certificate is disabled, skipping");
            continue;
        }

        // Match host (case-insensitive)
        if !cert.host.eq_ignore_ascii_case(host) {
            continue;
        }

        // Match port if specified in the certificate config
        let cert_port = cert.port.unwrap_or(443);
        if let Some(url_port) = port {
            if cert_port != url_port as i32 {
                debug!(
                    "Client certificate port does not match {} != {} (cert)",
                    url_port, cert_port
                );
                continue;
            }
        }

        // Found a matching certificate
        debug!("Found matching client certificate host={} port={}", host, port.unwrap_or(443));
        return Some(ClientCertificateConfig {
            crt_file: cert.crt_file.clone(),
            key_file: cert.key_file.clone(),
            pfx_file: cert.pfx_file.clone(),
            passphrase: cert.passphrase.clone(),
        });
    }

    None
}

#[cfg(test)]
mod pkcs8_identity_tests {
    use super::*;

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

    fn pkcs8_identity(crt: &str, key: &str) -> (Vec<u8>, Vec<u8>) {
        let certs: Vec<CertificateDer<'static>> =
            rustls_pemfile::certs(&mut BufReader::new(crt.as_bytes()))
                .map(|c| c.unwrap())
                .collect();
        let key_der = to_pkcs8_der(&load_private_key(key.as_bytes()).unwrap()).unwrap();

        match to_pkcs8_identity(&certs, &key_der) {
            NativeClientIdentity::Pkcs8 { chain_pem, key_pem } => (chain_pem, key_pem),
            NativeClientIdentity::Pkcs12 { .. } => unreachable!("asked for PKCS#8"),
        }
    }

    /// native-tls matches the PKCS#8 header as a literal prefix and rejects the
    /// key outright when it does not line up, so pin it on every platform even
    /// though only the OpenSSL backend is handed this encoding.
    #[test]
    fn every_key_format_re_encodes_to_a_pkcs8_pem() {
        for (name, key) in [("SEC1", EC_SEC1_KEY), ("PKCS#8", EC_PKCS8_KEY)] {
            let (chain_pem, key_pem) = pkcs8_identity(EC_CRT, key);

            assert!(
                key_pem.starts_with(b"-----BEGIN PRIVATE KEY-----\n"),
                "{name} key did not re-encode to a PKCS#8 PEM"
            );

            let round_tripped: Vec<CertificateDer<'static>> =
                rustls_pemfile::certs(&mut BufReader::new(chain_pem.as_slice()))
                    .map(|c| c.unwrap())
                    .collect();
            let original: Vec<CertificateDer<'static>> =
                rustls_pemfile::certs(&mut BufReader::new(EC_CRT.as_bytes()))
                    .map(|c| c.unwrap())
                    .collect();
            assert_eq!(round_tripped, original, "{name} chain did not round-trip");
        }
    }

    /// The two on-disk spellings of one EC key have to converge, because only
    /// the PKCS#8 one survives the re-encode.
    #[test]
    fn sec1_and_pkcs8_spellings_of_one_key_agree() {
        let (_, from_sec1) = pkcs8_identity(EC_CRT, EC_SEC1_KEY);
        let (_, from_pkcs8) = pkcs8_identity(EC_CRT, EC_PKCS8_KEY);
        assert_eq!(from_sec1, from_pkcs8);
    }
}
