use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use rustls::crypto::ring;
use rustls::ClientConfig;
use rustls_platform_verifier::BuilderVerifierExt;
use std::sync::Arc;
use tonic::body::BoxBody;

pub(crate) fn get_transport() -> Client<HttpsConnector<HttpConnector>, BoxBody> {
    let arc_crypto_provider = Arc::new(ring::default_provider());
    let config = ClientConfig::builder_with_provider(arc_crypto_provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_platform_verifier()
        .with_no_client_auth();

    let mut http = HttpConnector::new();
    http.enforce_http(false);

    let connector =
        HttpsConnectorBuilder::new().with_tls_config(config).https_or_http().enable_http2().build();

    let client = Client::builder(TokioExecutor::new())
        .pool_max_idle_per_host(0)
        .http2_only(true)
        .build(connector);

    client
}
