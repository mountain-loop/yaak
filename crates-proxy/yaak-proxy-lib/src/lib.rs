pub mod actions;
pub mod attribution;
pub mod bodies;
pub mod ca;
pub mod client;
pub mod control;
pub mod convert;
pub mod db;
pub mod flows;
pub mod har;
pub mod macos;
pub mod models;
pub mod save;
pub mod settings;

use crate::actions::{ActionInvocation, ActionMetadata, GlobalAction};
use crate::attribution::Attribution;
use crate::ca::CaStatus;
use crate::client::ControlClient;
use crate::control::{ControlFile, ControlInfo, ControlServer, Owner};
use crate::convert::DroppedHeader;
use crate::db::ProxyQueryManager;
use crate::macos::{SystemProxyBackend, SystemProxyStatus};
use crate::models::{Flow, FlowBody, FlowIden, ModelPayload, ProxyHeader, find_header};
use crate::save::{ClientDb, SaveFlowRequest, SaveFlowResponse, WorkspaceSummary};
use crate::settings::ProxySettings;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::{DateTime, Utc};
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use ts_rs::TS;
use yaak_database::{ModelChangeEvent, UpdateSource, UpsertModelInfo};
use yaak_models::blob_manager::{BlobManager, BodyChunkWriter};
use yaak_proxy::{CaStore, ProxyConfig, ProxyEvent, ProxyHandle};
use yaak_rpc::{RpcError, RpcEventEmitter, define_rpc};

// -- Context --

// Cloned once per dispatched command, so shared state lives behind an `Arc`.
#[derive(Clone)]
pub struct ProxyCtx {
    handle: Arc<Mutex<Option<ProxyHandle>>>,
    data_dir: PathBuf,
    owner: Owner,
    client_data_dir: PathBuf,
    control: Arc<Mutex<Option<ControlFile>>>,
    /// The control API this app serves while it owns the engine. Not the CLI daemon's, which
    /// holds its own.
    control_server: Arc<Mutex<Option<ControlServer>>>,
    /// Held through each system proxy change, password dialog included, so they apply in turn.
    system_proxy_turn: Arc<Mutex<()>>,
    /// The port the engine last ran on, which the system proxy may still point at.
    last_port: Arc<Mutex<Option<u16>>>,
    /// Flows are stored. While paused, traffic still passes through, untouched and unrecorded.
    recording: Arc<Mutex<RecordingLog>>,
    /// This Mac's web traffic is meant to point at the running engine.
    system_proxy_on: Arc<AtomicBool>,
    /// Why the engine last failed to start, until it starts.
    start_error: Arc<Mutex<Option<String>>>,
    pub db: ProxyQueryManager,
    pub blobs: BlobManager,
    pub events: RpcEventEmitter,
}

impl ProxyCtx {
    /// Opens `proxy.db` and `blobs.sqlite` in `data_dir`, the proxy app's data directory.
    pub fn new(data_dir: &Path, events: RpcEventEmitter) -> Result<Self, String> {
        let db = ProxyQueryManager::new(&data_dir.join("proxy.db"))
            .map_err(|e| format!("Failed to open proxy database: {e}"))?;
        let blobs = yaak_models::init_blob_store(data_dir.join("blobs.sqlite"))
            .map_err(|e| format!("Failed to open proxy blob store: {e}"))?;
        Ok(Self {
            handle: Arc::new(Mutex::new(None)),
            data_dir: data_dir.to_path_buf(),
            owner: Owner::App,
            client_data_dir: save::client_data_dir(),
            control: Arc::new(Mutex::new(None)),
            control_server: Arc::new(Mutex::new(None)),
            system_proxy_turn: Arc::new(Mutex::new(())),
            last_port: Arc::new(Mutex::new(None)),
            recording: Arc::new(Mutex::new(RecordingLog::default())),
            system_proxy_on: Arc::new(AtomicBool::new(false)),
            start_error: Arc::new(Mutex::new(None)),
            db,
            blobs,
            events,
        })
    }

    /// The process this runs in, which decides how the system proxy gets admin rights.
    pub fn with_owner(mut self, owner: Owner) -> Self {
        self.owner = owner;
        self
    }

    /// Yaak's data directory, where flows are saved as requests.
    pub fn with_client_data_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.client_data_dir = dir.into();
        self
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn owner(&self) -> Owner {
        self.owner
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn settings(&self) -> Result<ProxySettings, String> {
        ProxySettings::load(&self.settings_path())
    }

    pub fn capture_body_limit(&self) -> Result<usize, String> {
        Ok(self.settings()?.capture_body_limit)
    }

    /// Starts the engine with the current `settings.json`. Does nothing if it is running.
    pub fn start(&self) -> Result<(), String> {
        self.start_on(None)
    }

    /// Starts the engine on `port`, or the one in `settings.json`. Does nothing if it is
    /// running. Points the system proxy at it when the settings ask for that. Refused while
    /// another process owns the engine, so there are never two. A failure is kept until the
    /// next start, for the app to show.
    pub fn start_on(&self, port: Option<u16>) -> Result<(), String> {
        let started = self.start_engine(port);
        if let Ok(mut start_error) = self.start_error.lock() {
            *start_error = started.as_ref().err().cloned();
        }
        if started.is_err() {
            self.events
                .emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Stopped });
        }
        started
    }

    /// Why the engine last failed to start, if it has not started since.
    pub fn start_error(&self) -> Option<String> {
        self.start_error.lock().ok()?.clone()
    }

    fn start_engine(&self, port: Option<u16>) -> Result<(), String> {
        if let Some(owner) = control::live_owner(&self.data_dir)
            && owner.pid != std::process::id()
        {
            return Err(control::already_owned(&owner));
        }
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        if handle.is_some() {
            return Ok(());
        }

        let settings = self.settings()?;
        let ca = CaStore::load_or_create(&self.ca_dir())
            .map_err(|e| format!("Failed to load proxy CA: {e}"))?;
        let mut config = ProxyConfig::new(port.unwrap_or(settings.port), Arc::new(ca));
        config.capture_body_limit = settings.capture_body_limit;
        // Filled once the engine has bound, since the lookup matches sockets by its port.
        let attribution_slot: Arc<OnceLock<Attribution>> = Arc::new(OnceLock::new());
        let slot = attribution_slot.clone();
        config.on_accept = Some(Arc::new(move |connection, client_addr| {
            // A client that is answered quickly may exit soon after, so it is found before
            // anything is read from it: a few milliseconds once per connection at most.
            if let Some(attribution) = slot.get() {
                attribution.begin(connection, client_addr);
                attribution.get(connection, ACCEPT_ATTRIBUTION_WAIT);
            }
        }));
        let mut proxy_handle = yaak_proxy::start_proxy(config)?;
        let attribution = Attribution::new(proxy_handle.port);
        let _ = attribution_slot.set(attribution.clone());

        if let Some(event_rx) = proxy_handle.take_event_rx() {
            let sink = FlowSink {
                db: self.db.clone(),
                blobs: self.blobs.clone(),
                events: self.events.clone(),
                attribution,
                recording: self.recording.clone(),
            };
            std::thread::spawn(move || run_event_loop(event_rx, sink));
        }

        let bound = proxy_handle.port;
        *handle = Some(proxy_handle);
        drop(handle);
        self.set_control_proxy_port(Some(bound));
        if let Ok(mut last_port) = self.last_port.lock() {
            *last_port = Some(bound);
        }
        self.system_proxy_on.store(settings.system_proxy_at_launch, Ordering::SeqCst);
        if settings.system_proxy_at_launch {
            // The password dialog can sit open for a while; the engine is up regardless.
            let ctx = self.clone();
            std::thread::spawn(move || {
                if let Err(e) = ctx.change_system_proxy(true, bound, true) {
                    warn!("Failed to turn on the system proxy: {e}");
                    ctx.system_proxy_on.store(false, Ordering::SeqCst);
                }
                // So the app reads the system proxy again once the dialog is answered.
                ctx.events
                    .emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Running });
            });
        }
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Running });
        Ok(())
    }

    /// Stops the engine and turns off a system proxy that points at it.
    pub fn stop(&self) -> Result<(), String> {
        self.system_proxy_on.store(false, Ordering::SeqCst);
        let port = self.take_handle()?;
        if let Some(port) = port {
            let ctx = self.clone();
            std::thread::spawn(move || {
                if let Err(e) = ctx.change_system_proxy(false, port, true) {
                    warn!("Failed to turn off the system proxy: {e}");
                }
            });
        }
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Stopped });
        Ok(())
    }

    /// [`Self::stop`] for a process about to exit: waits for the system proxy to be off, also
    /// when a `stop` just before is still turning it off.
    pub fn shutdown(&self) {
        let running = self.take_handle().ok().flatten();
        let last = self.last_port.lock().ok().and_then(|p| *p);
        if let Some(port) = running.or(last)
            && let Err(e) = self.change_system_proxy(false, port, false)
        {
            warn!("Failed to turn off the system proxy: {e}");
        }
    }

    /// Stops the engine, returning the port it was on.
    fn take_handle(&self) -> Result<Option<u16>, String> {
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        // Dropping the handle stops the listener and joins its thread.
        let port = handle.take().map(|h| h.port);
        drop(handle);
        self.set_control_proxy_port(None);
        Ok(port)
    }

    /// The port the engine is bound to, while it runs.
    pub fn port(&self) -> Option<u16> {
        self.handle.lock().ok()?.as_ref().map(|h| h.port)
    }

    pub fn ca_dir(&self) -> PathBuf {
        self.data_dir.join("ca")
    }

    pub(crate) fn set_control_file(&self, file: Option<ControlFile>) {
        if let Ok(mut control) = self.control.lock() {
            *control = file;
        }
    }

    /// This process's `control.json`, while it serves the control API.
    pub fn control_info(&self) -> Option<ControlInfo> {
        self.control.lock().ok()?.as_ref().map(|c| c.info.clone())
    }

    /// Claims the engine for this app and serves the control API, unless it already does.
    /// Fails while another live owner, the CLI daemon, has it. Resets a system proxy a crashed
    /// owner left pointing at its port.
    pub fn serve_control_api(&self) -> Result<(), String> {
        let mut slot = self.control_server.lock().map_err(|_| "lock poisoned".to_string())?;
        if slot.is_some() {
            return Ok(());
        }
        // Read first: a crashed owner's file names the port its system proxy may still point at.
        let previous = control::read(&self.data_dir);
        *slot = Some(ControlServer::start(self.clone())?);
        drop(slot);

        let mut ports: Vec<u16> = previous.and_then(|p| p.proxy_port).into_iter().collect();
        ports.extend(self.settings().ok().map(|s| s.port));
        let ctx = self.clone();
        std::thread::spawn(move || {
            if let Err(e) = ctx.reset_stale_system_proxy(&ports) {
                warn!("Failed to reset a stale system proxy: {e}");
            }
        });
        Ok(())
    }

    /// Stops serving the control API and gives up the claim on the engine.
    pub fn stop_control_api(&self) {
        let server = self.control_server.lock().ok().and_then(|mut s| s.take());
        drop(server);
    }

    /// Another live owner of the engine, such as the CLI daemon.
    pub fn other_owner(&self) -> Option<ControlInfo> {
        let ours = self.control_info().map(|c| c.token);
        control::live_owner(&self.data_dir).filter(|o| Some(&o.token) != ours.as_ref())
    }

    /// Stops the engine in the process that owns it, waits for that process to give it up,
    /// then claims it here and starts it. Fails, leaving things as they are, when the owner
    /// does not let go.
    pub async fn take_over(&self) -> Result<(), String> {
        if let Some(owner) = self.other_owner() {
            ControlClient::new(owner.clone()).stop().await?;
            let ctx = self.clone();
            let released = tokio::task::spawn_blocking(move || {
                let deadline = std::time::Instant::now() + TAKE_OVER_WAIT;
                while std::time::Instant::now() < deadline {
                    if ctx.other_owner().is_none() {
                        return true;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                false
            })
            .await
            .map_err(|e| e.to_string())?;
            if !released {
                return Err(format!(
                    "The proxy in {} (pid {}) stopped but did not let go of it",
                    control::owner_name(owner.owner),
                    owner.pid
                ));
            }
        }
        let ctx = self.clone();
        tokio::task::spawn_blocking(move || {
            ctx.serve_control_api()?;
            ctx.start()
        })
        .await
        .map_err(|e| e.to_string())?
    }

    fn set_control_proxy_port(&self, port: Option<u16>) {
        if let Ok(mut control) = self.control.lock()
            && let Some(control) = control.as_mut()
        {
            control.set_proxy_port(port);
        }
    }

    pub fn system_proxy_backend(&self) -> SystemProxyBackend {
        match self.owner {
            Owner::App => SystemProxyBackend::AdminPrompt,
            Owner::Cli => SystemProxyBackend::Sudo,
        }
    }

    /// Judged against the running engine's port, or the configured one while it is stopped.
    /// Blocks.
    pub fn system_proxy_status(&self) -> Result<SystemProxyStatus, String> {
        let port = self.port().unwrap_or(self.settings()?.port);
        macos::status(port, self.system_proxy_backend())
    }

    /// Points this Mac's web traffic at the running engine, or stops, at once, through the
    /// password dialog. Not saved: the `systemProxyAtLaunch` setting decides whether it turns
    /// on as the engine starts. Blocks.
    pub fn set_system_proxy(&self, enabled: bool) -> Result<SystemProxyStatus, String> {
        let Some(port) = self.port() else {
            if enabled {
                return Err("The proxy is not running, so there is nothing to route to".into());
            }
            // Clears one left pointing at the configured port; asks for nothing otherwise.
            self.change_system_proxy(false, self.settings()?.port, false)?;
            return self.system_proxy_status();
        };
        let previous = self.system_proxy_on.swap(enabled, Ordering::SeqCst);
        if let Err(e) = self.change_system_proxy(enabled, port, enabled) {
            self.system_proxy_on.store(previous, Ordering::SeqCst);
            return Err(e);
        }
        self.system_proxy_status()
    }

    /// Whether the system proxy turns on as the engine starts, saved in `settings.json`.
    pub fn set_system_proxy_at_launch(&self, enabled: bool) -> Result<(), String> {
        let mut settings = self.settings()?;
        settings.system_proxy_at_launch = enabled;
        settings.save(&self.settings_path())
    }

    /// Intercepts again the hosts passed through after clients rejected the CA, as they no
    /// longer will once it is trusted.
    pub fn forget_passthrough(&self) {
        if let Ok(handle) = self.handle.lock()
            && let Some(handle) = handle.as_ref()
        {
            handle.forget_passthrough();
        }
    }

    /// Flows are being stored.
    pub fn recording(&self) -> bool {
        self.recording.lock().map(|r| r.is_on()).unwrap_or(true)
    }

    /// Resumes or pauses storing flows. Paused, traffic still passes through the engine, but no
    /// new flow is stored; one already under way is finished.
    pub fn set_recording(&self, recording: bool) {
        let changed = self.recording.lock().map(|mut r| r.set(recording)).unwrap_or(false);
        if changed {
            let state =
                if self.port().is_some() { ProxyState::Running } else { ProxyState::Stopped };
            self.events.emit("proxy_state_changed", &ProxyStatePayload { state });
        }
    }

    /// Points the system proxy at `port`, or turns it off there, once the changes before it
    /// are done. With `follow_engine`, the change is dropped if the engine has moved on by its
    /// turn: an enable once the engine is off `port` or the setting is off, a disable once the
    /// engine is back on `port`. A start and a stop in quick succession then end in the state
    /// the engine is in, whichever password dialog is answered first.
    fn change_system_proxy(
        &self,
        enabled: bool,
        port: u16,
        follow_engine: bool,
    ) -> Result<(), String> {
        let _turn = self.system_proxy_turn.lock().map_err(|_| "lock poisoned".to_string())?;
        if follow_engine {
            let on_port = self.port() == Some(port);
            let wanted = self.system_proxy_on.load(Ordering::SeqCst);
            let current = if enabled { on_port && wanted } else { !on_port };
            if !current {
                return Ok(());
            }
        }
        macos::set(enabled, port, self.system_proxy_backend())
    }

    /// Turns off a system proxy left pointing at one of `ports` by an owner that crashed, so
    /// the Mac is not left offline. Leaves it alone when something is serving on the port.
    /// Blocks.
    pub fn reset_stale_system_proxy(&self, ports: &[u16]) -> Result<(), String> {
        let mut ports = ports.to_vec();
        ports.sort_unstable();
        ports.dedup();
        for port in ports {
            if port == 0 {
                continue;
            }
            // Checked in its turn, so an engine started on the port meanwhile keeps its proxy.
            let _turn = self.system_proxy_turn.lock().map_err(|_| "lock poisoned".to_string())?;
            if Some(port) == self.port() || is_listening(port) {
                continue;
            }
            // Covers disabled services too, and asks for nothing when none point at the port.
            debug!("Turning off any stale system proxy on port {port}");
            macos::set(false, port, self.system_proxy_backend())?;
        }
        Ok(())
    }

    /// Yaak has run on this machine, so there is a database to save into.
    pub fn client_exists(&self) -> bool {
        ClientDb::exists(&self.client_data_dir)
    }

    /// Yaak's workspaces and their folders, to save a flow into.
    pub fn workspaces(&self) -> Result<Vec<WorkspaceSummary>, String> {
        ClientDb::open(&self.client_data_dir)?.workspaces()
    }

    /// Saves a flow as a request in Yaak and records the request on the flow.
    pub async fn save_flow(
        &self,
        flow_id: &str,
        req: &SaveFlowRequest,
    ) -> Result<SaveFlowResponse, String> {
        let flow = flows::get(&self.db, flow_id)?;
        let limit = self.capture_body_limit()?;
        let body = bodies::read_body(&self.blobs, &flow, FlowBody::Request, limit).await?;
        let saved = ClientDb::open(&self.client_data_dir)?.save(&flow, &body, req)?;

        let flow = Flow { saved_request_id: Some(saved.request.id.clone()), ..flow };
        self.db
            .with_tx(|tx| {
                // Cleared while saving: recording it would bring the flow back without bodies.
                if tx.find_optional::<Flow>(FlowIden::Id, flow_id).is_none() {
                    return Ok(());
                }
                let (flow, created) = tx.upsert(&flow, &UpdateSource::Background)?;
                // Sent before the commit, so it cannot reach the app after a clear that follows.
                self.events.emit(
                    "model_write",
                    &ModelPayload { model: flow, change: ModelChangeEvent::Upsert { created } },
                );
                Ok::<_, yaak_database::Error>(())
            })
            .map_err(|e| format!("Failed to record the saved request on the flow: {e}"))?;
        Ok(saved)
    }

    /// Deletes every flow and its bodies, and tells the app so its list empties. Returns how
    /// many there were.
    pub fn clear_flows(&self) -> Result<usize, String> {
        let cleared = flows::clear(&self.db, &self.blobs)?;
        // After the commit, so the app reloads what is left. Flows written before the clear sent
        // their events before it began.
        self.events.emit("flows_cleared", &FlowsClearedPayload {});
        Ok(cleared)
    }
}

/// Something accepts connections on `127.0.0.1:<port>`.
fn is_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

// -- Recording --

/// Changes to recording kept, so a request whose events are read late is still judged by when
/// it started.
const RECORDING_CHANGES: usize = 64;

/// Whether flows are stored, and when that changed.
struct RecordingLog {
    /// Oldest first, starting from recording since the beginning.
    changes: std::collections::VecDeque<(SystemTime, bool)>,
}

impl Default for RecordingLog {
    fn default() -> Self {
        Self { changes: [(SystemTime::UNIX_EPOCH, true)].into() }
    }
}

impl RecordingLog {
    fn is_on(&self) -> bool {
        self.changes.back().is_none_or(|(_, on)| *on)
    }

    /// Returns whether it changed.
    fn set(&mut self, on: bool) -> bool {
        if self.is_on() == on {
            return false;
        }
        self.changes.push_back((SystemTime::now(), on));
        while self.changes.len() > RECORDING_CHANGES {
            self.changes.pop_front();
        }
        true
    }

    /// Whether flows were stored at `time`.
    fn was_on_at(&self, time: SystemTime) -> bool {
        self.changes
            .iter()
            .rev()
            .find(|(at, _)| *at <= time)
            .or(self.changes.front())
            .is_none_or(|(_, on)| *on)
    }
}

// -- Proxy state --

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum ProxyState {
    Running,
    Stopped,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ProxyStatePayload {
    pub state: ProxyState,
}

// -- Request/response types --

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListActionsRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListActionsResponse {
    pub actions: Vec<(ActionInvocation, ActionMetadata)>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ListFlowsResponse {
    /// Newest first.
    pub flows: Vec<Flow>,
    /// Flows in the database, whatever the filter.
    #[ts(type = "number")]
    pub total: usize,
    /// Flows the filter covers, whatever the limit, when it narrows to fewer than all of them.
    #[ts(type = "number | null")]
    pub matching: Option<usize>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ClearFlowsRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowsClearedPayload {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetProxyStateRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetProxyStateResponse {
    pub state: ProxyState,
    /// The port the engine is bound to, while it runs.
    pub port: Option<u16>,
    /// The port the engine starts on.
    pub configured_port: u16,
    /// Flows are stored. Paused, traffic still passes through, unrecorded.
    pub recording: bool,
    /// The system proxy turns on as the engine starts.
    pub system_proxy_at_launch: bool,
    /// Why the engine last failed to start, until it starts.
    pub start_error: Option<String>,
    /// Another process that owns the engine, such as the CLI daemon. While one does, this app
    /// cannot start its own, and new flows reach it only through the database.
    pub other_owner: Option<OtherOwner>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct OtherOwner {
    pub owner: Owner,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    /// The engine's port while it runs.
    pub proxy_port: Option<u16>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct TakeOverRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetRecordingRequest {
    pub enabled: bool,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetSystemProxyAtLaunchRequest {
    pub enabled: bool,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct AppIconRequest {
    /// A flow's `clientPath`.
    pub path: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListWorkspacesRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspacesResponse {
    /// Yaak has run on this machine. Without it there is nothing to save into.
    pub yaak_found: bool,
    pub workspaces: Vec<WorkspaceSummary>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct PreviewSaveRequest {
    pub flow_id: String,
}

/// What saving a flow as a Yaak request writes, for the save dialog.
#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SavePreview {
    pub method: String,
    pub url: String,
    /// The URL as saved, its query split out into parameters, which Yaak shows for an unnamed
    /// request.
    pub request_url: String,
    /// The saved body type, which Yaak shows for an unnamed GraphQL request with no URL.
    pub body_type: Option<String>,
    /// Headers Yaak sets itself or that only meant something to the proxy.
    pub dropped_headers: Vec<DroppedHeader>,
    /// Headers saved as captured, Authorization among them.
    #[ts(type = "number")]
    pub kept_headers: usize,
    /// The body as it is saved: "JSON", "form URL-encoded with 7 fields". None without a body.
    pub body: Option<String>,
    /// What does not carry over exactly, one sentence each.
    pub warnings: Vec<String>,
    /// An Authorization header is saved in plain text.
    pub authorization: bool,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SaveFlowToYaakRequest {
    pub flow_id: String,
    pub workspace_id: String,
    #[ts(optional)]
    pub folder_id: Option<String>,
    /// None or blank leaves the request unnamed, and Yaak shows its URL.
    #[ts(optional)]
    pub name: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SavedFlow {
    pub request_id: String,
    pub name: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ExportHarRequest {
    /// The file to write.
    pub path: String,
    /// These flows, or else every flow the filter covers.
    #[ts(optional)]
    pub ids: Option<Vec<String>>,
    #[ts(optional)]
    pub filter: Option<flows::FlowFilter>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetFlowBodyRequest {
    pub flow_id: String,
    pub which: FlowBody,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetFlowBodyResponse {
    /// The body decoded with its Content-Encoding, at most the capture limit of it, in base64.
    pub data: String,
    /// The body is incomplete: cut on the wire, or decoded past the capture limit.
    pub truncated: bool,
    /// Bytes stored for the body, as they were on the wire.
    #[ts(type = "number")]
    pub stored_size: usize,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FormatBodyRequest {
    pub text: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct FilterBodyRequest {
    pub flow_id: String,
    pub which: FlowBody,
    /// JSONPath, or XPath for an XML or HTML body.
    pub expression: String,
    /// The language the viewer detected from the body. Without it, the Content-Type decides.
    #[ts(optional)]
    pub language: Option<FilterLanguage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "lowercase")]
pub enum FilterLanguage {
    JsonPath,
    XPath,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FilterBodyResponse {
    pub content: String,
    pub error: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CaStatusRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CaTrustRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SystemProxyStatusRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SystemProxySetRequest {
    pub enabled: bool,
}

// -- Handlers --

fn execute_action(ctx: &ProxyCtx, invocation: ActionInvocation) -> Result<bool, RpcError> {
    match invocation {
        ActionInvocation::Global { action } => match action {
            GlobalAction::RecordingToggle => ctx.set_recording(!ctx.recording()),
            GlobalAction::FlowsClear => {
                ctx.clear_flows().map_err(|message| RpcError { message })?;
            }
        },
    }
    Ok(true)
}

async fn get_proxy_state(
    ctx: ProxyCtx,
    _req: GetProxyStateRequest,
) -> Result<GetProxyStateResponse, RpcError> {
    // The owner check takes a file lock and a connection, so off the async threads.
    blocking(move || {
        let port = ctx.port();
        let state = if port.is_some() { ProxyState::Running } else { ProxyState::Stopped };
        let settings = ctx.settings()?;
        let other_owner = ctx.other_owner().map(|o| OtherOwner {
            owner: o.owner,
            pid: o.pid,
            started_at: o.started_at,
            proxy_port: o.proxy_port,
        });
        Ok(GetProxyStateResponse {
            state,
            port,
            configured_port: settings.port,
            recording: ctx.recording(),
            system_proxy_at_launch: settings.system_proxy_at_launch,
            start_error: ctx.start_error(),
            other_owner,
        })
    })
    .await
}

fn set_recording(ctx: &ProxyCtx, req: SetRecordingRequest) -> Result<bool, RpcError> {
    ctx.set_recording(req.enabled);
    Ok(ctx.recording())
}

fn set_system_proxy_at_launch(
    ctx: &ProxyCtx,
    req: SetSystemProxyAtLaunchRequest,
) -> Result<bool, RpcError> {
    ctx.set_system_proxy_at_launch(req.enabled).map_err(rpc_error)?;
    Ok(req.enabled)
}

async fn take_over(ctx: ProxyCtx, _req: TakeOverRequest) -> Result<bool, RpcError> {
    ctx.take_over().await.map_err(rpc_error)?;
    Ok(true)
}

async fn app_icon(_ctx: ProxyCtx, req: AppIconRequest) -> Result<Option<String>, RpcError> {
    let png = blocking(move || attribution::app_icon_png(&req.path)).await?;
    Ok(png.map(|png| BASE64.encode(png)))
}

async fn list_workspaces(
    ctx: ProxyCtx,
    _req: ListWorkspacesRequest,
) -> Result<ListWorkspacesResponse, RpcError> {
    blocking(move || {
        if !ctx.client_exists() {
            return Ok(ListWorkspacesResponse { yaak_found: false, workspaces: Vec::new() });
        }
        Ok(ListWorkspacesResponse { yaak_found: true, workspaces: ctx.workspaces()? })
    })
    .await
}

async fn preview_save(ctx: ProxyCtx, req: PreviewSaveRequest) -> Result<SavePreview, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let body =
        bodies::read_body(&ctx.blobs, &flow, FlowBody::Request, limit).await.map_err(rpc_error)?;
    let conversion = convert::flow_to_request(&flow, &body);
    let request = conversion.request;
    let body = request.body_type.as_deref().map(|body_type| match body_type {
        "application/json" => "JSON".to_string(),
        "text/xml" => "XML".to_string(),
        "graphql" => "GraphQL".to_string(),
        "application/x-www-form-urlencoded" => {
            let fields = request.body.get("form").and_then(|f| f.as_array()).map_or(0, Vec::len);
            match fields {
                1 => "form URL-encoded with 1 field".to_string(),
                n => format!("form URL-encoded with {n} fields"),
            }
        }
        _ => "text".to_string(),
    });
    let authorization =
        request.headers.iter().any(|h| h.name.eq_ignore_ascii_case("authorization"));
    Ok(SavePreview {
        method: flow.method.clone(),
        url: flow.url.clone(),
        request_url: request.url.clone(),
        body_type: request.body_type.clone(),
        dropped_headers: conversion.dropped_headers,
        kept_headers: request.headers.len(),
        body,
        warnings: conversion.warnings,
        authorization,
    })
}

async fn save_flow(ctx: ProxyCtx, req: SaveFlowToYaakRequest) -> Result<SavedFlow, RpcError> {
    let target = SaveFlowRequest {
        workspace_id: req.workspace_id,
        folder_id: req.folder_id,
        name: req.name,
    };
    let saved = ctx.save_flow(&req.flow_id, &target).await.map_err(rpc_error)?;
    Ok(SavedFlow { request_id: saved.request.id, name: saved.request.name })
}

async fn export_har(ctx: ProxyCtx, req: ExportHarRequest) -> Result<usize, RpcError> {
    let flows = match req.ids {
        Some(ids) => ids.iter().map(|id| flows::get(&ctx.db, id)).collect::<Result<Vec<_>, _>>(),
        None => {
            let filter = flows::FlowFilter { limit: None, ..req.filter.unwrap_or_default() };
            flows::list(&ctx.db, &filter)
        }
    }
    .map_err(rpc_error)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let har = har::export(&ctx.blobs, &flows, limit).await.map_err(rpc_error)?;
    let path = PathBuf::from(req.path);
    blocking(move || {
        let file = std::fs::File::create(&path)
            .map_err(|e| format!("Failed to create {}: {e}", path.display()))?;
        let mut out = std::io::BufWriter::new(file);
        serde_json::to_writer_pretty(&mut out, &har)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
        out.flush().map_err(|e| format!("Failed to write {}: {e}", path.display()))
    })
    .await?;
    Ok(flows.len())
}

fn format_body(_ctx: &ProxyCtx, req: FormatBodyRequest) -> Result<String, RpcError> {
    Ok(yaak_templates::format_json::format_json(&req.text, "  "))
}

async fn get_flow_body(
    ctx: ProxyCtx,
    req: GetFlowBodyRequest,
) -> Result<GetFlowBodyResponse, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let body = viewer_body(&ctx, &flow, req.which, limit).await?;
    Ok(GetFlowBodyResponse {
        data: BASE64.encode(&body.data),
        truncated: body.truncated,
        stored_size: body.stored_size,
    })
}

/// A body for the app's viewer, which shows a body that failed to decode as its error, as it
/// always has, rather than as what decoded before the failure.
async fn viewer_body(
    ctx: &ProxyCtx,
    flow: &Flow,
    which: FlowBody,
    limit: usize,
) -> Result<bodies::DecodedBody, RpcError> {
    let body = bodies::read_body(&ctx.blobs, flow, which, limit).await.map_err(rpc_error)?;
    match body.decode_error {
        Some(e) => Err(rpc_error(e)),
        None => Ok(body),
    }
}

async fn filter_body(
    ctx: ProxyCtx,
    req: FilterBodyRequest,
) -> Result<FilterBodyResponse, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let body = viewer_body(&ctx, &flow, req.which, limit).await?;
    let text = String::from_utf8_lossy(&body.data);
    let language = match req.language {
        Some(FilterLanguage::JsonPath) => yaak_filter::Language::JsonPath,
        Some(FilterLanguage::XPath) => yaak_filter::Language::XPath,
        None => {
            let content_type = find_header(flow.headers(req.which), "content-type");
            yaak_filter::Language::for_content_type(content_type.unwrap_or_default())
        }
    };
    let result = yaak_filter::filter(language, &text, &req.expression);
    Ok(FilterBodyResponse { content: result.content, error: result.error })
}

async fn ca_status(ctx: ProxyCtx, _req: CaStatusRequest) -> Result<CaStatus, RpcError> {
    ca::status(&ctx.ca_dir().join("ca.pem")).await.map_err(rpc_error)
}

async fn ca_trust(ctx: ProxyCtx, _req: CaTrustRequest) -> Result<CaStatus, RpcError> {
    // Creates the CA when the engine has never run, so there is something to trust.
    let ca = CaStore::load_or_create(&ctx.ca_dir())
        .map_err(|e| rpc_error(format!("Failed to load proxy CA: {e}")))?;
    ca::trust(ca.cert_path()).await.map_err(rpc_error)?;
    ctx.forget_passthrough();
    ca::status(ca.cert_path()).await.map_err(rpc_error)
}

async fn system_proxy_status(
    ctx: ProxyCtx,
    _req: SystemProxyStatusRequest,
) -> Result<SystemProxyStatus, RpcError> {
    blocking(move || ctx.system_proxy_status()).await
}

async fn system_proxy_set(
    ctx: ProxyCtx,
    req: SystemProxySetRequest,
) -> Result<SystemProxyStatus, RpcError> {
    blocking(move || ctx.set_system_proxy(req.enabled)).await
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, RpcError> {
    tokio::task::spawn_blocking(f).await.map_err(rpc_error)?.map_err(rpc_error)
}

fn settings(ctx: &ProxyCtx) -> Result<ProxySettings, RpcError> {
    ctx.settings().map_err(rpc_error)
}

fn find_flow(ctx: &ProxyCtx, flow_id: &str) -> Result<Flow, RpcError> {
    ctx.db.with_conn(|db| db.find_one::<Flow>(FlowIden::Id, flow_id)).map_err(rpc_error)
}

fn rpc_error(e: impl ToString) -> RpcError {
    RpcError { message: e.to_string() }
}

fn list_actions(
    _ctx: &ProxyCtx,
    _req: ListActionsRequest,
) -> Result<ListActionsResponse, RpcError> {
    Ok(ListActionsResponse { actions: crate::actions::all_global_actions() })
}

fn list_flows(ctx: &ProxyCtx, req: flows::FlowFilter) -> Result<ListFlowsResponse, RpcError> {
    let (flows, total, matching) = flows::page(&ctx.db, &req).map_err(rpc_error)?;
    Ok(ListFlowsResponse { flows, total, matching })
}

async fn clear_flows(ctx: ProxyCtx, _req: ClearFlowsRequest) -> Result<usize, RpcError> {
    blocking(move || ctx.clear_flows()).await
}

// -- Event loop --

/// How long taking over waits for the owner to let go of the engine.
const TAKE_OVER_WAIT: Duration = Duration::from_secs(10);

/// The longest a new client connection waits for its app to be found before it is served.
const ACCEPT_ATTRIBUTION_WAIT: Duration = Duration::from_millis(20);

/// The longest a flow's end waits for its app to be found, which almost always it already is:
/// the lookup starts with the request and takes a few milliseconds.
const ATTRIBUTION_WAIT: Duration = Duration::from_millis(100);

/// A flow between its `RequestStart` and its end, with its bodies being written as they
/// stream.
struct InFlight {
    flow: Flow,
    /// The client connection it came on.
    connection: u64,
    request_body: Option<BodyChunkWriter>,
    response_body: Option<BodyChunkWriter>,
}

/// Where the event loop stores flows, and whether it does.
struct FlowSink {
    db: ProxyQueryManager,
    blobs: BlobManager,
    events: RpcEventEmitter,
    attribution: Attribution,
    recording: Arc<Mutex<RecordingLog>>,
}

fn run_event_loop(rx: std::sync::mpsc::Receiver<ProxyEvent>, sink: FlowSink) {
    let FlowSink { db, blobs, events, attribution, recording } = sink;
    let mut in_flight: HashMap<u64, InFlight> = HashMap::new();

    while let Ok(event) = rx.recv() {
        match event {
            ProxyEvent::RequestStart {
                id,
                started_at,
                method,
                url,
                http_version,
                connection,
                client_addr,
            } => {
                // Paused when it started: it passes through, and none of its events are kept.
                // Judged by its start rather than now, as the loop can run behind.
                if !recording.lock().map(|r| r.was_on_at(started_at)).unwrap_or(true) {
                    continue;
                }
                // Begun as the connection was accepted; this covers one accepted before the
                // engine's port was known.
                attribution.begin(connection, client_addr);
                let flow_id = Flow::generate_id();
                let request_body = Flow::body_id(&flow_id, FlowBody::Request);
                let response_body = Flow::body_id(&flow_id, FlowBody::Response);
                let flow = Flow {
                    id: flow_id,
                    started_at: DateTime::<Utc>::from(started_at).naive_utc(),
                    method,
                    url,
                    client_http_version: http_version,
                    ..Default::default()
                };
                in_flight.insert(
                    id,
                    InFlight {
                        flow,
                        connection,
                        request_body: Some(BodyChunkWriter::new(blobs.clone(), request_body)),
                        response_body: Some(BodyChunkWriter::new(blobs.clone(), response_body)),
                    },
                );
            }
            ProxyEvent::RequestHeader { id, name, value } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_headers.push(ProxyHeader { name, value });
                }
            }
            // Counted per chunk too: the response can end, and the flow with it, before the
            // upload does.
            ProxyEvent::RequestBodyChunk { id, len, data } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_size += len as i64;
                    f.flow.request_truncated |= data.len() < len;
                    write_body_chunk(&mut f.request_body, &data);
                }
            }
            ProxyEvent::RequestBodyComplete { id, size, truncated } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_size = size as i64;
                    f.flow.request_truncated = truncated;
                    finish_body(f.request_body.take());
                }
            }
            ProxyEvent::ResponseStart { id, status, http_version, remote_addr, elapsed_ms } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.status = Some(status as i32);
                    f.flow.upstream_http_version = Some(http_version);
                    f.flow.remote_addr = remote_addr.map(|a| a.to_string());
                    f.flow.elapsed_headers_ms = Some(clamp_ms(elapsed_ms));
                }
            }
            ProxyEvent::ResponseHeader { id, name, value } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.response_headers.push(ProxyHeader { name, value });
                }
            }
            ProxyEvent::ResponseBodyChunk { id, data, .. } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    write_body_chunk(&mut f.response_body, &data);
                }
            }
            ProxyEvent::ResponseBodyComplete { id, size, truncated, elapsed_ms, error } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.response_size = size as i64;
                    f.flow.response_truncated = truncated;
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = error;
                    finish_flow(&db, &events, &attribution, f);
                }
            }
            ProxyEvent::Error { id, error, elapsed_ms } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = Some(error);
                    finish_flow(&db, &events, &attribution, f);
                }
            }
        }
    }
}

fn clamp_ms(ms: u64) -> i32 {
    i32::try_from(ms).unwrap_or(i32::MAX)
}

/// Stops writing a body after its first failed write, keeping the chunks before it.
fn write_body_chunk(writer: &mut Option<BodyChunkWriter>, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    if let Some(w) = writer.as_mut()
        && let Err(e) = w.write(data)
    {
        warn!("Failed to store proxy body chunk: {e}");
        *writer = None;
    }
}

fn finish_body(writer: Option<BodyChunkWriter>) {
    if let Some(w) = writer
        && let Err(e) = w.finish()
    {
        warn!("Failed to store proxy body chunk: {e}");
    }
}

fn finish_flow(
    db: &ProxyQueryManager,
    events: &RpcEventEmitter,
    attribution: &Attribution,
    f: InFlight,
) {
    finish_body(f.request_body);
    finish_body(f.response_body);

    let mut flow = f.flow;
    flow.content_type = find_header(&flow.response_headers, "content-type").map(String::from);
    if let Some(app) = attribution.get(f.connection, ATTRIBUTION_WAIT) {
        flow.client_pid = Some(app.pid);
        flow.client_name = Some(app.name);
        flow.client_bundle_id = app.bundle_id;
        flow.client_path = Some(app.path);
    }
    let written = db.with_tx(|ctx| {
        let (saved, created) = ctx.upsert(&flow, &UpdateSource::Background)?;
        // Sent while this holds the writer, before the commit, so a clear's event, sent after
        // its own commit, always comes after it.
        events.emit(
            "model_write",
            &ModelPayload { model: saved, change: ModelChangeEvent::Upsert { created } },
        );
        Ok::<_, yaak_database::Error>(())
    });
    if let Err(e) = written {
        warn!("Failed to write proxy flow: {e}");
    }
}

// -- Router + Schema --

define_rpc! {
    ProxyCtx;
    commands {
        execute_action(ActionInvocation) -> bool,
        format_body(FormatBodyRequest) -> String,
        list_actions(ListActionsRequest) -> ListActionsResponse,
        list_flows(flows::FlowFilter) -> ListFlowsResponse,
        set_recording(SetRecordingRequest) -> bool,
        set_system_proxy_at_launch(SetSystemProxyAtLaunchRequest) -> bool,
    }
    async_commands {
        app_icon(AppIconRequest) -> Option<String>,
        ca_status(CaStatusRequest) -> CaStatus,
        ca_trust(CaTrustRequest) -> CaStatus,
        clear_flows(ClearFlowsRequest) -> usize,
        export_har(ExportHarRequest) -> usize,
        filter_body(FilterBodyRequest) -> FilterBodyResponse,
        get_flow_body(GetFlowBodyRequest) -> GetFlowBodyResponse,
        get_proxy_state(GetProxyStateRequest) -> GetProxyStateResponse,
        list_workspaces(ListWorkspacesRequest) -> ListWorkspacesResponse,
        preview_save(PreviewSaveRequest) -> SavePreview,
        save_flow(SaveFlowToYaakRequest) -> SavedFlow,
        system_proxy_set(SystemProxySetRequest) -> SystemProxyStatus,
        system_proxy_status(SystemProxyStatusRequest) -> SystemProxyStatus,
        take_over(TakeOverRequest) -> bool,
    }
    events {
        flows_cleared(FlowsClearedPayload),
        model_write(ModelPayload),
        proxy_state_changed(ProxyStatePayload),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_is_recorded_by_the_state_when_it_started() {
        let mut log = RecordingLog::default();
        let before = SystemTime::now();
        std::thread::sleep(Duration::from_millis(5));
        assert!(log.set(false));
        assert!(!log.set(false), "no change");
        std::thread::sleep(Duration::from_millis(5));
        let while_paused = SystemTime::now();
        std::thread::sleep(Duration::from_millis(5));
        assert!(log.set(true));
        // Read after recording resumed, each is judged by when it started.
        assert!(log.is_on());
        assert!(log.was_on_at(before));
        assert!(!log.was_on_at(while_paused));
        assert!(log.was_on_at(SystemTime::now()));
    }

    #[tokio::test]
    async fn the_app_still_hears_why_a_body_failed_to_decode() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let flow = Flow {
            id: "fl_bad".into(),
            status: Some(200),
            response_headers: vec![ProxyHeader {
                name: "Content-Encoding".into(),
                value: "gzip".into(),
            }],
            ..Default::default()
        };
        ctx.db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        let mut writer =
            BodyChunkWriter::new(ctx.blobs.clone(), Flow::body_id("fl_bad", FlowBody::Response));
        writer.write(b"not a gzip stream").unwrap();
        writer.finish().unwrap();

        let req = GetFlowBodyRequest { flow_id: "fl_bad".into(), which: FlowBody::Response };
        let err = get_flow_body(ctx.clone(), req).await.err().unwrap();
        assert!(err.message.starts_with("Failed to decode"), "{}", err.message);
        let req = FilterBodyRequest {
            flow_id: "fl_bad".into(),
            which: FlowBody::Response,
            expression: "$".into(),
            language: None,
        };
        assert!(filter_body(ctx, req).await.is_err());
    }
}
