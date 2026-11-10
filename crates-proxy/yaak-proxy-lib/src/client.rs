//! The other side of the control API, for the CLI and the MCP tools: find the owner through
//! `control.json` and call it with its token, or, when nothing owns the engine, read `proxy.db`
//! and `blobs.sqlite` read-only so captured traffic stays reachable.

use crate::bodies::{self, DecodedBody};
use crate::ca::CaTrustResult;
use crate::control::{
    self, ControlInfo, ControlStatus, DecryptRequest, ErrorBody, NOTE_HEADER, RecordingRequest,
    StartRequest, SystemProxyRequest, TRUNCATED_HEADER,
};
use crate::db::ProxyQueryManager;
use crate::db::Stores;
use crate::flows::{self, FlowDetail, FlowFilter};
use crate::har::{self, Har};
use crate::macos::SystemProxyStatus;
use crate::models::{Flow, FlowBody};
use crate::save::{SaveFlowRequest, SaveFlowResponse, WorkspaceSummary};
use crate::settings::{DecryptList, ProxySettings};
use crate::tunnels::{OpenTunnel, TunnelScope};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::path::Path;
use yaak_crypto::MasterKeySource;
use yaak_models::blob_manager::BlobManager;

/// Where captured traffic is read from.
pub enum ProxyConnection {
    /// A process owns the engine; everything goes through its control API.
    Live(ControlClient),
    /// Nothing owns the engine; flows are read from disk.
    Offline(OfflineStore),
}

impl ProxyConnection {
    /// The live owner in `data_dir`, or its databases when there is none, read with the data
    /// key the master key in `keys` unwraps. The app's keychain item, so on macOS a CLI asking
    /// for it is prompted to be allowed.
    pub fn connect(data_dir: &Path, keys: &MasterKeySource) -> Result<Self, String> {
        match control::live_owner(data_dir) {
            Some(info) => Ok(Self::Live(ControlClient::new(info))),
            None => Ok(Self::Offline(OfflineStore::open(data_dir, keys)?)),
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
        let note = resp.headers().get(NOTE_HEADER).and_then(|v| v.to_str().ok()).map(String::from);
        let data = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
        Ok(DecodedBody { note, ..DecodedBody::new(data, truncated) })
    }

    pub async fn har(&self, filter: &FlowFilter) -> Result<Har, String> {
        self.get(&format!("/har?{}", filter.to_query())).await
    }

    pub async fn ca_pem(&self) -> Result<String, String> {
        let resp = self.send(self.http.get(self.url("/ca"))).await?;
        resp.text().await.map_err(|e| e.to_string())
    }

    pub async fn trust_ca(&self) -> Result<CaTrustResult, String> {
        self.post("/ca/trust", &serde_json::json!({})).await
    }

    /// The addresses the owner's engine passes through after clients rejected the CA.
    pub async fn passthrough(&self) -> Result<crate::PassthroughResponse, String> {
        self.get("/passthrough").await
    }

    /// Has the owner's engine intercept one passed-through address again.
    pub async fn forget_passthrough(
        &self,
        req: &crate::ForgetPassthroughRequest,
    ) -> Result<crate::ForgetPassthroughResponse, String> {
        self.post("/passthrough/forget", req).await
    }

    /// The owner's open tunnels its decrypt list would decrypt if their clients reconnected.
    pub async fn reconnectable_tunnels(
        &self,
        scope: &TunnelScope,
    ) -> Result<Vec<OpenTunnel>, String> {
        let query = {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            if let Some(entry) = &scope.entry {
                query.append_pair("entry", entry);
            }
            if let Some(flow_id) = &scope.flow_id {
                query.append_pair("flowId", flow_id);
            }
            query.finish()
        };
        self.get(&format!("/tunnels/reconnectable?{query}")).await
    }

    /// Closes tunnels in the owner's engine so their clients reconnect.
    pub async fn reconnect_tunnels(
        &self,
        req: &crate::ReconnectTunnelsRequest,
    ) -> Result<crate::ReconnectTunnelsResponse, String> {
        self.post("/tunnels/reconnect", req).await
    }

    /// Resumes or pauses storing flows in the owner's engine.
    pub async fn set_recording(&self, enabled: bool) -> Result<ControlStatus, String> {
        self.post("/recording", &RecordingRequest { enabled }).await
    }

    pub async fn system_proxy(&self) -> Result<SystemProxyStatus, String> {
        self.get("/system-proxy").await
    }

    pub async fn set_system_proxy(&self, enabled: bool) -> Result<SystemProxyStatus, String> {
        self.post("/system-proxy", &SystemProxyRequest { enabled }).await
    }

    pub async fn decrypt_list(&self) -> Result<DecryptList, String> {
        self.get("/decrypt").await
    }

    /// Adds and removes entries in the owner's decrypt list as it is there.
    pub async fn edit_decrypt_list(
        &self,
        edit: &crate::EditDecryptListRequest,
    ) -> Result<crate::DecryptListSaved, String> {
        let body = serde_json::to_vec(edit).map_err(|e| e.to_string())?;
        let req = self
            .http
            .patch(self.url("/decrypt"))
            .header("content-type", "application/json")
            .body(body);
        let resp = self.send(req).await?;
        resp.json().await.map_err(|e| format!("Invalid response from the proxy: {e}"))
    }

    /// Replaces the decrypt list in the owner, which saves it and applies it to its engine.
    pub async fn set_decrypt_list(
        &self,
        entries: &[String],
    ) -> Result<crate::DecryptListSaved, String> {
        let body = serde_json::to_vec(&DecryptRequest { entries: entries.to_vec() })
            .map_err(|e| e.to_string())?;
        let req = self
            .http
            .put(self.url("/decrypt"))
            .header("content-type", "application/json")
            .body(body);
        let resp = self.send(req).await?;
        resp.json().await.map_err(|e| format!("Invalid response from the proxy: {e}"))
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
    /// Opens the databases in `data_dir`, decrypting with the data key the master key in `keys`
    /// unwraps. Ones from before encryption, not yet converted, are read as they are.
    pub fn open(data_dir: &Path, keys: &MasterKeySource) -> Result<Self, String> {
        let db_path = data_dir.join(crate::db::PROXY_DB);
        if !db_path.exists() {
            return Err(format!(
                "No captured traffic yet: {} does not exist. Start Yaak Proxy to capture some.",
                db_path.display()
            ));
        }
        let Stores { db, blobs, .. } = Stores::open_read_only(data_dir, keys)?;
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
        bodies::read_body(&self.db, &self.blobs, &flow, which, self.capture_body_limit).await
    }

    pub async fn har(&self, filter: &FlowFilter) -> Result<Har, String> {
        let flows = flows::list(&self.db, filter)?;
        har::export(&self.db, &self.blobs, &flows, self.capture_body_limit).await
    }
}
