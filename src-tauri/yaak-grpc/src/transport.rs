use crate::error::Result;
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use log::info;
use tonic::body::BoxBody;
use yaak_tls::{ClientCertificateConfig, get_tls_config};

// I think ALPN breaks this because we're specifying http2_only
const WITH_ALPN: bool = false;

pub(crate) fn get_transport(
    validate_certificates: bool,
    client_cert: Option<ClientCertificateConfig>,
) -> Result<Client<HttpsConnector<HttpConnector>, BoxBody>> {
    let tls_config = get_tls_config(validate_certificates, WITH_ALPN, client_cert.clone())?;

    let mut http = HttpConnector::new();
    http.enforce_http(false);

    let connector = HttpsConnectorBuilder::new()
        .with_tls_config(tls_config)
        .https_or_http()
        .enable_http2()
        .build();

    let client = Client::builder(TokioExecutor::new())
        .pool_max_idle_per_host(0)
        .http2_only(true)
        .build(connector);

    info!(
        "Created gRPC client validate_certs={} client_cert={}",
        validate_certificates,
        client_cert.is_some()
    );

    Ok(client)
}
