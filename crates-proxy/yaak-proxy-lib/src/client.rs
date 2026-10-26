//! The other side of the control API, for the CLI and the MCP tools: find the owner through
//! `control.json` and call it with its token, or, when nothing owns the engine, read `proxy.db`
//! and `blobs.sqlite` read-only so captured traffic stays reachable.

use crate::bodies::{self, DecodedBody};
use crate::ca::CaStatus;
use crate::control::{
    self, ControlInfo, ControlStatus, ErrorBody, StartRequest, SystemProxyRequest, TRUNCATED_HEADER,
};
use crate::db::ProxyQueryManager;
use crate::flows::{self, FlowDetail, FlowFilter};
use crate::har::{self, Har};
use crate::macos::SystemProxyStatus;
use crate::models::{Flow, FlowBody};
use crate::save::{SaveFlowRequest, SaveFlowResponse, WorkspaceSummary};
use crate::settings::ProxySettings;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::path::Path;
use yaak_models::blob_manager::BlobManager;

/// Where captured traffic is read from.
pub enum ProxyConnection {
    /// A process owns the engine; everything goes through its control API.
    Live(ControlClient),
    /// Nothing owns the engine; flows are read from disk.
    Offline(OfflineStore),
}

impl ProxyConnection {
    /// The live owner in `data_dir`, or its databases when there is none.
    pub fn connect(data_dir: &Path) -> Result<Self, String> {
        match control::live_owner(data_dir) {
            Some(info) => Ok(Self::Live(ControlClient::new(info))),
            None => Ok(Self::Offline(OfflineStore::open(data_dir)?)),
        }
    }

    pub async fn flows(&self, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
        match self {
            Self::Live(c) => c.flows(filter).await,
            Self::Offline(s) => s.flows(filter),
        }
    }

    pub async fn flow(&self, id: &str, body_limit: usize) -> Result<FlowDetail, String> {
        match self {
            Self::Live(c) => c.flow(id, body_limit).await,
            Self::Offline(s) => s.flow(id, body_limit).await,
        }
    }

    pub async fn body(&self, id: &str, which: FlowBody) -> Result<DecodedBody, String> {
        match self {
            Self::Live(c) => c.body(id, which).await,
            Self::Offline(s) => s.body(id, which).await,
        }
    }

    pub async fn har(&self, filter: &FlowFilter) -> Result<Har, String> {
        match self {
            Self::Live(c) => c.har(filter).await,
            Self::Offline(s) => s.har(filter).await,
        }
    }
}

/// Calls the control API of the owner `control.json` names.
pub struct ControlClient {
    info: ControlInfo,
    http: reqwest::Client,
}

impl ControlClient {
    pub fn new(info: ControlInfo) -> Self {
        // Never through the system proxy, which may be the engine itself.
        let http = reqwest::Client::builder().no_proxy().build().unwrap_or_default();
        Self { info, http }
    }

    pub fn info(&self) -> &ControlInfo {
        &self.info
    }

    pub async fn status(&self) -> Result<ControlStatus, String> {
        self.get("/status").await
    }

    pub async fn start(&self, port: Option<u16>) -> Result<ControlStatus, String> {
        self.post("/start", &StartRequest { port }).await
    }

    pub async fn stop(&self) -> Result<ControlStatus, String> {
        self.post("/stop", &serde_json::json!({})).await
    }

    pub async fn flows(&self, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
        self.get(&format!("/flows?{}", filter.to_query())).await
    }

    pub async fn flow(&self, id: &str, body_limit: usize) -> Result<FlowDetail, String> {
        self.get(&format!("/flows/{}?bodyLimit={body_limit}", encode(id))).await
    }

    pub async fn body(&self, id: &str, which: FlowBody) -> Result<DecodedBody, String> {
        let side = match which {
            FlowBody::Request => "request-body",
            FlowBody::Response => "response-body",
        };
        let resp =
            self.send(self.http.get(self.url(&format!("/flows/{}/{side}", encode(id))))).await?;
        let truncated = resp.headers().get(TRUNCATED_HEADER).is_some_and(|v| v == "true");
        let data = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
        Ok(DecodedBody { stored_size: data.len(), data, truncated, decode_error: None })
    }

    pub async fn har(&self, filter: &FlowFilter) -> Result<Har, String> {
        self.get(&format!("/har?{}", filter.to_query())).await
    }

    pub async fn ca_pem(&self) -> Result<String, String> {
        let resp = self.send(self.http.get(self.url("/ca"))).await?;
        resp.text().await.map_err(|e| e.to_string())
    }

    pub async fn trust_ca(&self) -> Result<CaStatus, String> {
        self.post("/ca/trust", &serde_json::json!({})).await
    }

    pub async fn system_proxy(&self) -> Result<SystemProxyStatus, String> {
        self.get("/system-proxy").await
    }

    pub async fn set_system_proxy(&self, enabled: bool) -> Result<SystemProxyStatus, String> {
        self.post("/system-proxy", &SystemProxyRequest { enabled }).await
    }

    pub async fn workspaces(&self) -> Result<Vec<WorkspaceSummary>, String> {
        self.get("/workspaces").await
    }

    pub async fn save(&self, id: &str, req: &SaveFlowRequest) -> Result<SaveFlowResponse, String> {
        self.post(&format!("/flows/{}/save", encode(id)), req).await
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.info.base_url())
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self.send(self.http.get(self.url(path))).await?;
        resp.json().await.map_err(|e| format!("Invalid response from the proxy: {e}"))
    }

    async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, String> {
        let body = serde_json::to_vec(body).map_err(|e| e.to_string())?;
        let req =
            self.http.post(self.url(path)).header("content-type", "application/json").body(body);
        let resp = self.send(req).await?;
        resp.json().await.map_err(|e| format!("Invalid response from the proxy: {e}"))
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
        let resp = req
            .bearer_auth(&self.info.token)
            .send()
            .await
            .map_err(|e| format!("Failed to reach the proxy's control API: {e}"))?;
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(serde_json::from_str::<ErrorBody>(&text)
            .map(|e| e.error)
            .unwrap_or_else(|_| format!("The proxy answered {status}: {text}")))
    }
}

fn encode(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}

/// `proxy.db` and `blobs.sqlite`, opened read-only while no process owns the engine.
pub struct OfflineStore {
    db: ProxyQueryManager,
    blobs: BlobManager,
    capture_body_limit: usize,
}

impl OfflineStore {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        let db_path = data_dir.join("proxy.db");
        if !db_path.exists() {
            return Err(format!(
                "No captured traffic yet: {} does not exist. Start Yaak Proxy to capture some.",
                db_path.display()
            ));
        }
        let db = ProxyQueryManager::open_read_only(&db_path)
            .map_err(|e| format!("Failed to open {}: {e}", db_path.display()))?;
        let blobs = crate::db::open_blobs_read_only(&data_dir.join("blobs.sqlite"))
            .map_err(|e| format!("Failed to open the proxy's blob store: {e}"))?;
        let settings = ProxySettings::load(&data_dir.join("settings.json"))?;
        Ok(Self { db, blobs, capture_body_limit: settings.capture_body_limit })
    }

    pub fn flows(&self, filter: &FlowFilter) -> Result<Vec<Flow>, String> {
        flows::list(&self.db, filter)
    }

    pub async fn flow(&self, id: &str, body_limit: usize) -> Result<FlowDetail, String> {
        flows::detail(&self.db, &self.blobs, id, body_limit).await
    }

    pub async fn body(&self, id: &str, which: FlowBody) -> Result<DecodedBody, String> {
        let flow = flows::get(&self.db, id)?;
        bodies::read_body(&self.blobs, &flow, which, self.capture_body_limit).await
    }

    pub async fn har(&self, filter: &FlowFilter) -> Result<Har, String> {
        let flows = flows::list(&self.db, filter)?;
        har::export(&self.blobs, &flows, self.capture_body_limit).await
    }
}
