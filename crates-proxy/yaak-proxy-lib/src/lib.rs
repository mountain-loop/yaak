pub mod actions;
pub mod attribution;
pub mod bodies;
pub mod ca;
pub mod client;
pub mod control;
pub mod convert;
pub mod db;
pub mod flows;
pub mod grpc;
pub mod har;
pub mod helper;
pub mod macos;
pub mod messages;
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
use crate::grpc::{DecodedGrpcMessage, GrpcSchema, GrpcState};
use crate::helper::HelperState;
use crate::macos::{SystemProxyBackend, SystemProxyStatus};
use crate::messages::FlowMessage;
use crate::models::{Flow, FlowBody, FlowIden, ModelPayload, ProxyHeader, StreamKind, find_header};
use crate::save::{ClientDb, SaveFlowRequest, SaveFlowResponse, WorkspaceSummary};
use crate::settings::{HttpVersion, ProxySettings};
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
pub use yaak_grpc::GrpcConfig;
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
    /// gRPC schemas as decoded, and the protoc that compiles attached protos.
    pub grpc: GrpcState,
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
            grpc: GrpcState::default(),
        })
    }

    /// The protoc that compiles `.proto` files attached for gRPC decoding, as the app bundles
    /// it. Without one, a `protoc` on `PATH` is used.
    pub fn with_protoc(self, config: yaak_grpc::GrpcConfig) -> Self {
        self.grpc.set_protoc(config);
        self
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
        self.end_stale_streams();
        let ca = CaStore::load_or_create(&self.ca_dir())
            .map_err(|e| format!("Failed to load proxy CA: {e}"))?;
        let mut config = ProxyConfig::new(port.unwrap_or(settings.port), Arc::new(ca));
        config.capture_body_limit = settings.capture_body_limit;
        config.http2 = settings.http_version == HttpVersion::Auto;
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

    /// Marks streams an engine left open, as one that crashed does, as ended. Only the engine's
    /// owner, about to start it, may: until then another process's streams may be open.
    fn end_stale_streams(&self) {
        let ended = self.db.with_tx(|c| {
            c.conn().resolve().execute(
                "UPDATE flows SET error = ?1 WHERE stream_kind IS NOT NULL \
                AND elapsed_ms IS NULL AND error IS NULL AND NOT cancelled",
                [STOPPED_MID_STREAM],
            )?;
            Ok::<_, yaak_database::Error>(())
        });
        if let Err(e) = ended {
            warn!("Failed to end streams left open: {e}");
        }
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
            // Stopped through the control API, another app halts its engine but keeps the claim,
            // so only the CLI daemon, which exits on it, can be taken over.
            if owner.owner == Owner::App {
                return Err(ANOTHER_APP_OWNS.to_string());
            }
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

    /// The helper once it is enabled; until then, and while the password dialog still has the
    /// user's settings to put back, the dialog. The CLI daemon always uses `sudo`.
    pub fn system_proxy_backend(&self) -> SystemProxyBackend {
        self.backend_for(self.helper_state())
    }

    fn backend_for(&self, helper: HelperState) -> SystemProxyBackend {
        match self.owner {
            Owner::Cli => SystemProxyBackend::Sudo,
            // What the dialog saved only it can restore, as the helper never saw it: settings
            // for routing it turned on, and settings parked for a service that was missing,
            // which its next capture uses if the service is back.
            Owner::App if helper == HelperState::Enabled && !self.snapshot_path().exists() => {
                SystemProxyBackend::Helper
            }
            Owner::App => SystemProxyBackend::AdminPrompt,
        }
    }

    /// The helper's registration, as far as this process can use it.
    pub fn helper_state(&self) -> HelperState {
        match self.owner {
            Owner::App => helper::state(),
            Owner::Cli => HelperState::Unavailable,
        }
    }

    /// Where the password dialog and `sudo` keep the settings they replaced.
    fn snapshot_path(&self) -> PathBuf {
        self.data_dir.join(macos::SNAPSHOT_FILE)
    }

    /// Judged against the running engine's port, or the configured one while it is stopped.
    /// Blocks.
    pub fn system_proxy_status(&self) -> Result<SystemProxyStatus, String> {
        let port = self.port().unwrap_or(self.settings()?.port);
        let helper = self.helper_state();
        macos::status(port, self.backend_for(helper), helper)
    }

    /// Registers the helper, opening System Settings for the user to allow it. Blocks.
    pub fn register_helper(&self) -> Result<SystemProxyStatus, String> {
        helper::register()?;
        self.system_proxy_status()
    }

    /// Removes the helper, which first puts back the settings it replaced, so the system proxy
    /// is off afterwards. Blocks.
    pub fn unregister_helper(&self) -> Result<SystemProxyStatus, String> {
        let turn = self.system_proxy_turn.lock().map_err(|_| "lock poisoned".to_string())?;
        let restores = self.system_proxy_backend() == SystemProxyBackend::Helper;
        helper::unregister()?;
        if restores {
            self.system_proxy_on.store(false, Ordering::SeqCst);
        }
        drop(turn);
        self.system_proxy_status()
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

    /// The HTTP versions offered to clients, saved in `settings.json` and applied to the running
    /// engine's next connections.
    pub fn set_http_version(&self, version: HttpVersion) -> Result<(), String> {
        let mut settings = self.settings()?;
        settings.http_version = version;
        settings.save(&self.settings_path())?;
        if let Ok(handle) = self.handle.lock()
            && let Some(handle) = handle.as_ref()
        {
            handle.set_http2(version == HttpVersion::Auto);
        }
        Ok(())
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
        macos::set(enabled, port, self.system_proxy_backend(), &self.snapshot_path())
    }

    /// Turns off a system proxy left pointing at one of `ports` by an owner that crashed, so
    /// the Mac is not left offline, putting back the settings it replaced when they were
    /// saved. Leaves it alone when something is serving on the port. Blocks.
    pub fn reset_stale_system_proxy(&self, ports: &[u16]) -> Result<(), String> {
        let mut ports = ports.to_vec();
        ports.extend(macos::saved_port(&self.snapshot_path()));
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
            macos::set(false, port, self.system_proxy_backend(), &self.snapshot_path())?;
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
        let body =
            bodies::read_body(&self.db, &self.blobs, &flow, FlowBody::Request, limit).await?;
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
    /// The HTTP versions offered to clients.
    pub http_version: HttpVersion,
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
#[serde(rename_all = "camelCase")]
pub struct SetHttpVersionRequest {
    pub http_version: HttpVersion,
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
    /// When it fails to decode, the bytes as they were on the wire instead.
    pub data: String,
    /// The body is incomplete: cut on the wire, or decoded past the capture limit.
    pub truncated: bool,
    /// Bytes stored for the body, as they were on the wire.
    #[ts(type = "number")]
    pub stored_size: usize,
    /// Why the body failed to decode, in which case `data` is as it was on the wire.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decode_error: Option<String>,
    /// What to know about the body beyond its bytes, as that a WebSocket has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SaveFlowBodyRequest {
    pub flow_id: String,
    pub which: FlowBody,
    /// The file to write.
    pub path: String,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SaveFlowBodyResponse {
    /// Bytes written.
    #[ts(type = "number")]
    pub size: usize,
    /// What was written is incomplete, as `GetFlowBodyResponse.truncated` is.
    pub truncated: bool,
    /// The body failed to decode, so the file has it as it was on the wire.
    pub raw: bool,
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

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct HelperRegisterRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct HelperUnregisterRequest {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesRequest {
    pub flow_id: String,
    /// Only messages after this `seq`, for following a stream as it grows.
    #[ts(optional, type = "number")]
    pub after_seq: Option<i64>,
    /// At most this many, the first after `afterSeq`.
    #[ts(optional, type = "number")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesResponse {
    /// In order, by `seq`.
    pub messages: Vec<FlowMessage>,
    /// Messages the flow has in all.
    #[ts(type = "number")]
    pub total: i64,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetMessagePayloadRequest {
    pub flow_id: String,
    #[ts(type = "number")]
    pub seq: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetMessagePayloadResponse {
    /// The payload as stored (unmasked, inflated, decompressed), in base64.
    pub data: String,
    /// It is cut at the capture limit.
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct DecodeGrpcMessageRequest {
    pub flow_id: String,
    #[ts(type = "number")]
    pub seq: i64,
    /// Decode without a schema even when one is found.
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub schemaless: bool,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListGrpcSchemasRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct AddGrpcSchemaRequest {
    /// `api.example.com`, `localhost:50051`, `*.example.com` or `*`.
    pub host_pattern: String,
    /// `.proto` files, and directories they import from.
    pub proto_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct RemoveGrpcSchemaRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ReflectGrpcHostRequest {
    /// `host` or `host:port`, over TLS on 443 unless a port is given, or either after
    /// `http://` to ask without TLS.
    pub host: String,
}

/// A message of a streaming flow was recorded.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct MessagePayload {
    pub message: FlowMessage,
}

// -- Handlers --

fn list_messages(
    ctx: &ProxyCtx,
    req: ListMessagesRequest,
) -> Result<ListMessagesResponse, RpcError> {
    find_flow(ctx, &req.flow_id)?;
    let messages =
        messages::list(&ctx.db, &req.flow_id, req.after_seq, req.limit).map_err(rpc_error)?;
    let total = messages::count(&ctx.db, &req.flow_id).map_err(rpc_error)?;
    Ok(ListMessagesResponse { messages, total })
}

fn get_message_payload(
    ctx: &ProxyCtx,
    req: GetMessagePayloadRequest,
) -> Result<GetMessagePayloadResponse, RpcError> {
    let message = messages::get(&ctx.db, &req.flow_id, req.seq).map_err(rpc_error)?;
    let data = messages::payload(&ctx.db, &ctx.blobs, &message).map_err(rpc_error)?;
    Ok(GetMessagePayloadResponse { data: BASE64.encode(data), truncated: message.truncated })
}

async fn decode_grpc_message(
    ctx: ProxyCtx,
    req: DecodeGrpcMessageRequest,
) -> Result<DecodedGrpcMessage, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    grpc::decode(&ctx.db, &ctx.blobs, &ctx.grpc, &flow, req.seq, req.schemaless)
        .await
        .map_err(rpc_error)
}

fn list_grpc_schemas(
    ctx: &ProxyCtx,
    _req: ListGrpcSchemasRequest,
) -> Result<Vec<GrpcSchema>, RpcError> {
    grpc::list(&ctx.db).map_err(rpc_error)
}

async fn add_grpc_schema(ctx: ProxyCtx, req: AddGrpcSchemaRequest) -> Result<GrpcSchema, RpcError> {
    grpc::add(&ctx.db, &ctx.grpc, &req.host_pattern, &req.proto_paths).await.map_err(rpc_error)
}

fn remove_grpc_schema(ctx: &ProxyCtx, req: RemoveGrpcSchemaRequest) -> Result<bool, RpcError> {
    grpc::remove(&ctx.db, &ctx.grpc, &req.id).map_err(rpc_error)
}

async fn reflect_grpc_host(
    ctx: ProxyCtx,
    req: ReflectGrpcHostRequest,
) -> Result<GrpcSchema, RpcError> {
    let (host, plaintext) = grpc::reflection_host(&req.host);
    grpc::reflect(&ctx.db, &ctx.grpc, &host, plaintext).await.map_err(rpc_error)
}

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
            http_version: settings.http_version,
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

fn set_http_version(ctx: &ProxyCtx, req: SetHttpVersionRequest) -> Result<HttpVersion, RpcError> {
    ctx.set_http_version(req.http_version).map_err(rpc_error)?;
    Ok(req.http_version)
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
    let body = bodies::read_body(&ctx.db, &ctx.blobs, &flow, FlowBody::Request, limit)
        .await
        .map_err(rpc_error)?;
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
    let har = har::export(&ctx.db, &ctx.blobs, &flows, limit).await.map_err(rpc_error)?;
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
    let body = bodies::read_body_or_raw(&ctx.db, &ctx.blobs, &flow, req.which, limit)
        .await
        .map_err(rpc_error)?;
    Ok(GetFlowBodyResponse {
        data: BASE64.encode(&body.data),
        truncated: body.truncated,
        stored_size: body.stored_size,
        decode_error: body.decode_error,
        note: body.note,
    })
}

/// Writes a body to a file the person picked: decoded, as the viewer shows it, or as it was on
/// the wire when it fails to decode.
async fn save_flow_body(
    ctx: ProxyCtx,
    req: SaveFlowBodyRequest,
) -> Result<SaveFlowBodyResponse, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let body = bodies::read_body_or_raw(&ctx.db, &ctx.blobs, &flow, req.which, limit)
        .await
        .map_err(rpc_error)?;
    // Nothing to save; an empty file would say the body was empty.
    if let Some(note) = body.note.filter(|_| body.data.is_empty()) {
        return Err(rpc_error(note));
    }
    let saved = SaveFlowBodyResponse {
        size: body.data.len(),
        truncated: body.truncated,
        raw: body.decode_error.is_some(),
    };
    let path = PathBuf::from(req.path);
    blocking(move || {
        std::fs::write(&path, &body.data)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))
    })
    .await?;
    Ok(saved)
}

/// A body to filter, which fails when the body failed to decode rather than filtering what
/// decoded before the failure.
async fn viewer_body(
    ctx: &ProxyCtx,
    flow: &Flow,
    which: FlowBody,
    limit: usize,
) -> Result<bodies::DecodedBody, RpcError> {
    let body =
        bodies::read_body(&ctx.db, &ctx.blobs, flow, which, limit).await.map_err(rpc_error)?;
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
    let content_type = find_header(flow.headers(req.which), "content-type");
    // The text the viewer shows, so the filter's results match it
    let text = bodies::body_text(&body.data, content_type, body.truncated);
    let language = match req.language {
        Some(FilterLanguage::JsonPath) => yaak_filter::Language::JsonPath,
        Some(FilterLanguage::XPath) => yaak_filter::Language::XPath,
        None => yaak_filter::Language::for_content_type(content_type.unwrap_or_default()),
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

async fn helper_register(
    ctx: ProxyCtx,
    _req: HelperRegisterRequest,
) -> Result<SystemProxyStatus, RpcError> {
    blocking(move || ctx.register_helper()).await
}

async fn helper_unregister(
    ctx: ProxyCtx,
    _req: HelperUnregisterRequest,
) -> Result<SystemProxyStatus, RpcError> {
    blocking(move || ctx.unregister_helper()).await
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

/// Why the engine cannot be taken over from another app.
pub const ANOTHER_APP_OWNS: &str =
    "Another Yaak Proxy window owns the engine. Quit it to use this one.";

/// How long taking over waits for the owner to let go of the engine.
const TAKE_OVER_WAIT: Duration = Duration::from_secs(10);

/// The longest a new client connection waits for its app to be found before it is served.
const ACCEPT_ATTRIBUTION_WAIT: Duration = Duration::from_millis(20);

/// The longest a flow's end waits for its app to be found, which almost always it already is:
/// the lookup starts with the request and takes a few milliseconds.
const ATTRIBUTION_WAIT: Duration = Duration::from_millis(100);

/// The most often a streaming flow is written again as its messages land. Each message is
/// sent to the app as it is written; the flow's count follows at this pace.
const STREAM_FLOW_WRITE_INTERVAL: Duration = Duration::from_millis(250);

/// Messages written in one transaction at most. Messages arriving together are batched up to
/// this, so a busy WebSocket does not cost a transaction a frame.
const MESSAGE_BATCH: usize = 256;

/// How often the event loop looks for streaming flows due to be written while events keep
/// coming.
const DUE_CHECK_INTERVAL: Duration = Duration::from_millis(50);

/// Why a stream still open when the engine stopped ended.
const STOPPED_MID_STREAM: &str = "Yaak Proxy stopped before the stream ended";

/// A flow between its `RequestStart` and its end, with its bodies being written as they
/// stream.
struct InFlight {
    flow: Flow,
    /// The client connection it came on.
    connection: u64,
    request_body: Option<BodyChunkWriter>,
    response_body: Option<BodyChunkWriter>,
    /// Written to the database already, as a streaming flow is when its stream opens.
    persisted: bool,
    /// Cleared while it streamed: nothing more of it is kept.
    cleared: bool,
    next_seq: i64,
    /// Changed since it was last written, by a message or a status.
    dirty: bool,
    last_write: Option<std::time::Instant>,
}

impl InFlight {
    /// Stops writing the bodies its stream's messages carry, which are read back from them.
    /// One whose bytes come encoded is kept until its first message shows they decode, as a
    /// body that fails to has only its bytes to show.
    fn drop_message_bodies(&mut self) {
        for which in [FlowBody::Request, FlowBody::Response] {
            if bodies::from_messages(&self.flow, which) && !encoded(&self.flow, which) {
                *self.body_writer(which) = None;
            }
        }
    }

    fn body_writer(&mut self, which: FlowBody) -> &mut Option<BodyChunkWriter> {
        match which {
            FlowBody::Request => &mut self.request_body,
            FlowBody::Response => &mut self.response_body,
        }
    }

    /// Something shown of the flow changed: one written while it streams is written again on
    /// the stream flow interval, so it does not wait for a message to show it.
    fn changed(&mut self) {
        if self.persisted {
            self.dirty = true;
        }
    }
}

/// A message waiting to be written, with its payload.
struct PendingMessage {
    id: u64,
    message: messages::FlowMessage,
    data: bytes::Bytes,
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
    use std::sync::mpsc::{RecvTimeoutError, TryRecvError};
    let mut in_flight: HashMap<u64, InFlight> = HashMap::new();
    let mut pending: Vec<PendingMessage> = Vec::new();
    let mut last_due_check = std::time::Instant::now();

    loop {
        // Messages are written once no more are waiting, or a batch is full; flows changed by
        // them once their interval is up.
        let event = if !pending.is_empty() {
            match rx.try_recv() {
                Ok(event) => event,
                Err(TryRecvError::Empty) => {
                    sink.write_messages(&mut in_flight, &mut pending);
                    sink.write_due_flows(&mut in_flight);
                    continue;
                }
                Err(TryRecvError::Disconnected) => break,
            }
        } else if let Some(due) = next_flow_write(&in_flight) {
            let wait = due.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(wait) {
                Ok(event) => event,
                Err(RecvTimeoutError::Timeout) => {
                    sink.write_due_flows(&mut in_flight);
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.recv() {
                Ok(event) => event,
                Err(_) => break,
            }
        };
        if let ProxyEvent::Message { id, message } = event {
            record_message(&mut in_flight, &mut pending, id, &message);
            if pending.len() >= MESSAGE_BATCH {
                sink.write_messages(&mut in_flight, &mut pending);
            }
        } else {
            // Before anything else of the flows, so a flow's messages are in before it ends.
            sink.write_messages(&mut in_flight, &mut pending);
            sink.handle(&mut in_flight, event);
        }
        // Traffic that never lets up never empties the queue, so flows due to be written are
        // looked for here too, every so often, their messages written first.
        if last_due_check.elapsed() >= DUE_CHECK_INTERVAL {
            last_due_check = std::time::Instant::now();
            sink.write_messages(&mut in_flight, &mut pending);
            sink.write_due_flows(&mut in_flight);
        }
    }

    sink.write_messages(&mut in_flight, &mut pending);
    // The engine stopped: a stream still open ends with it. Other flows in flight are dropped,
    // as they always have been.
    for (_, mut f) in in_flight.drain() {
        if f.persisted {
            f.flow.error = Some(STOPPED_MID_STREAM.to_string());
            sink.finish_flow(f);
        }
    }
}

/// When the next changed streaming flow is due to be written.
fn next_flow_write(in_flight: &HashMap<u64, InFlight>) -> Option<std::time::Instant> {
    in_flight
        .values()
        .filter(|f| f.dirty)
        .map(|f| {
            f.last_write.map_or_else(std::time::Instant::now, |t| t + STREAM_FLOW_WRITE_INTERVAL)
        })
        .min()
}

fn record_message(
    in_flight: &mut HashMap<u64, InFlight>,
    pending: &mut Vec<PendingMessage>,
    id: u64,
    message: &yaak_proxy::StreamMessage,
) {
    let Some(f) = in_flight.get_mut(&id).filter(|f| !f.cleared) else {
        return;
    };
    if let yaak_proxy::MessageKind::GrpcTrailers { status, message } = &message.kind {
        f.flow.grpc_status = *status;
        f.flow.grpc_message = message.clone();
    }
    // A body read back from its messages is cut where they are.
    if message.truncated {
        match message.direction {
            yaak_proxy::MessageDirection::Client
                if bodies::from_messages(&f.flow, FlowBody::Request) =>
            {
                f.flow.request_truncated = true
            }
            yaak_proxy::MessageDirection::Server
                if bodies::from_messages(&f.flow, FlowBody::Response) =>
            {
                f.flow.response_truncated = true
            }
            _ => {}
        }
    }
    let seq = f.next_seq;
    f.next_seq += 1;
    f.flow.message_count += 1;
    f.dirty = true;
    pending.push(PendingMessage {
        id,
        message: messages::FlowMessage::from_engine(&f.flow.id, seq, message),
        data: message.data.clone(),
    });
}

impl FlowSink {
    fn handle(&self, in_flight: &mut HashMap<u64, InFlight>, event: ProxyEvent) {
        let FlowSink { blobs, attribution, recording, .. } = self;
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
                    return;
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
                        persisted: false,
                        cleared: false,
                        next_seq: 0,
                        dirty: false,
                        last_write: None,
                    },
                );
            }
            ProxyEvent::StreamStart { id, kind } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    let kind = StreamKind::from(kind);
                    f.flow.stream_kind = Some(kind);
                    if kind.is_grpc()
                        && let Ok(url) = url::Url::parse(&f.flow.url)
                        && let Some((service, method)) = yaak_proxy::service_and_method(url.path())
                    {
                        f.flow.grpc_service = Some(service.to_string());
                        f.flow.grpc_method = Some(method.to_string());
                    }
                    // Its messages are the record of the bodies they carry, which are not
                    // written again on their own. A gRPC response's body is known to be messages
                    // once its headers are, at its first chunk.
                    f.drop_message_bodies();
                    // Shown while it streams, rather than only once it ends.
                    self.write_stream_flow(f);
                }
            }
            // Recorded by the loop, which batches them.
            ProxyEvent::Message { .. } => {}
            ProxyEvent::StreamEnd { id, elapsed_ms, error } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = error;
                    self.finish_flow(f);
                }
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
                    if !bodies::from_messages(&f.flow, FlowBody::Request) {
                        f.flow.request_truncated |= data.len() < len;
                    }
                    write_body_chunk(&mut f.request_body, &data);
                    f.changed();
                }
            }
            ProxyEvent::RequestBodyComplete { id, size, truncated } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_size = size as i64;
                    if !bodies::from_messages(&f.flow, FlowBody::Request) {
                        f.flow.request_truncated = truncated;
                    }
                    finish_body(f.request_body.take());
                    f.changed();
                }
            }
            ProxyEvent::ResponseStart { id, status, http_version, remote_addr, elapsed_ms } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.status = Some(status as i32);
                    f.flow.upstream_http_version = Some(http_version);
                    f.flow.remote_addr = remote_addr.map(|a| a.to_string());
                    f.flow.elapsed_headers_ms = Some(clamp_ms(elapsed_ms));
                    f.changed();
                }
            }
            ProxyEvent::ResponseHeader { id, name, value } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.response_headers.push(ProxyHeader { name, value });
                    f.changed();
                }
            }
            // Counted per chunk too, for a stream written while it is open.
            ProxyEvent::ResponseBodyChunk { id, len, data } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.response_size += len as i64;
                    f.drop_message_bodies();
                    if !bodies::from_messages(&f.flow, FlowBody::Response) {
                        f.flow.response_truncated |= data.len() < len;
                    }
                    write_body_chunk(&mut f.response_body, &data);
                    f.changed();
                }
            }
            ProxyEvent::ResponseBodyComplete {
                id,
                size,
                truncated,
                elapsed_ms,
                error,
                cancelled,
            } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.response_size = size as i64;
                    if !bodies::from_messages(&f.flow, FlowBody::Response) {
                        f.flow.response_truncated = truncated;
                    }
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = error;
                    f.flow.cancelled = cancelled;
                    self.finish_flow(f);
                }
            }
            ProxyEvent::Cancelled { id, elapsed_ms } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.cancelled = true;
                    self.finish_flow(f);
                }
            }
            ProxyEvent::Error { id, error, elapsed_ms } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = Some(error);
                    self.finish_flow(f);
                }
            }
        }
    }

    /// Writes `pending` in one transaction, each payload over [`messages::INLINE_LIMIT`] first
    /// to `blobs.sqlite`, and tells the app of each. A flow cleared meanwhile keeps nothing more.
    fn write_messages(
        &self,
        in_flight: &mut HashMap<u64, InFlight>,
        pending: &mut Vec<PendingMessage>,
    ) {
        if pending.is_empty() {
            return;
        }
        let batch = std::mem::take(pending);
        let mut rows = Vec::with_capacity(batch.len());
        for PendingMessage { id, mut message, data } in batch {
            let inline = if data.len() > messages::INLINE_LIMIT {
                let mut writer = BodyChunkWriter::new(self.blobs.clone(), message.blob_id());
                if let Err(e) = writer.write(&data).and_then(|_| writer.finish()) {
                    warn!("Failed to store a proxy message payload: {e}");
                    message.stored_size = 0;
                    message
                        .error
                        .get_or_insert_with(|| format!("Failed to store the payload: {e}"));
                }
                None
            } else {
                Some(data)
            };
            rows.push((id, message, inline));
        }

        // An encoded body's messages decoded: they are its record now, and the bytes kept until
        // they did are not kept.
        let mut decoded_bodies = Vec::new();
        for (id, message, _) in &rows {
            let Some(f) = in_flight.get_mut(id) else {
                continue;
            };
            let which = match message.direction {
                messages::MessageDirection::Client => FlowBody::Request,
                messages::MessageDirection::Server => FlowBody::Response,
            };
            if bodies::from_messages(&f.flow, which) && f.body_writer(which).take().is_some() {
                decoded_bodies.push(Flow::body_id(&f.flow.id, which));
            }
        }
        if !decoded_bodies.is_empty() {
            let deleted = self
                .blobs
                .with_tx(|b| decoded_bodies.iter().try_for_each(|id| b.delete_chunks(id)));
            if let Err(e) = deleted {
                warn!("Failed to delete a stream's body bytes: {e}");
            }
        }

        let mut orphaned = Vec::new();
        let mut newly_cleared = Vec::new();
        let written = self.db.with_tx(|ctx| {
            let conn = ctx.conn().resolve();
            let mut checked = std::collections::HashSet::new();
            for (id, message, inline) in &rows {
                let Some(f) = in_flight.get_mut(id) else {
                    continue;
                };
                // Cleared since it was written: what comes after is not kept either.
                if f.persisted && checked.insert(*id) && !flow_exists(conn, &f.flow.id) {
                    f.cleared = true;
                    newly_cleared.push(*id);
                }
                if f.cleared {
                    orphaned.push(message.blob_id());
                    continue;
                }
                messages::insert(conn, message, inline.as_deref())?;
                // Before the commit, as flows are, so a clear's event comes after it.
                self.events.emit("message_write", &MessagePayload { message: message.clone() });
            }
            Ok::<_, yaak_database::Error>(())
        });
        if let Err(e) = written {
            warn!("Failed to write proxy messages: {e}");
        }
        if !orphaned.is_empty() {
            let _ = self.blobs.with_tx(|b| orphaned.iter().try_for_each(|id| b.delete_chunks(id)));
        }
        for id in newly_cleared {
            if let Some(f) = in_flight.get_mut(&id) {
                self.stop_cleared(f);
            }
        }
    }

    /// A stream cleared while open keeps nothing more: its bodies stop being written, and what
    /// they wrote since the clear is deleted, as the stream may run long before it ends.
    fn stop_cleared(&self, f: &mut InFlight) {
        f.cleared = true;
        f.request_body = None;
        f.response_body = None;
        self.forget_cleared(&f.flow.id);
    }

    /// Writes the streaming flows whose messages or status changed, at most once per
    /// [`STREAM_FLOW_WRITE_INTERVAL`] each.
    fn write_due_flows(&self, in_flight: &mut HashMap<u64, InFlight>) {
        let now = std::time::Instant::now();
        for f in in_flight.values_mut() {
            let due = f.last_write.is_none_or(|t| now >= t + STREAM_FLOW_WRITE_INTERVAL);
            if f.dirty && due {
                self.write_stream_flow(f);
            }
        }
    }

    /// Writes a streaming flow as it is so far, for the app to show while it streams. Unless it
    /// was cleared since it was last written: then nothing more of it is kept.
    fn write_stream_flow(&self, f: &mut InFlight) {
        f.dirty = false;
        f.last_write = Some(std::time::Instant::now());
        if f.cleared {
            return;
        }
        let mut flow = f.flow.clone();
        flow.content_type = find_header(&flow.response_headers, "content-type").map(String::from);
        // Not waited for here; the flow's end waits for it.
        if let Some(app) = self.attribution.get(f.connection, Duration::ZERO) {
            flow.client_pid = Some(app.pid);
            flow.client_name = Some(app.name);
            flow.client_bundle_id = app.bundle_id;
            flow.client_path = Some(app.path);
        }
        let persisted = f.persisted;
        let written = self.db.with_tx(|ctx| self.write_flow(ctx, flow, persisted));
        match written {
            Ok(true) => f.persisted = true,
            Ok(false) => self.stop_cleared(f),
            Err(e) => warn!("Failed to write proxy flow: {e}"),
        }
    }

    fn finish_flow(&self, f: InFlight) {
        finish_body(f.request_body);
        finish_body(f.response_body);
        let id = f.flow.id.clone();
        if f.cleared {
            self.forget_cleared(&id);
            return;
        }

        let mut flow = f.flow;
        flow.content_type = find_header(&flow.response_headers, "content-type").map(String::from);
        if let Some(app) = self.attribution.get(f.connection, ATTRIBUTION_WAIT) {
            flow.client_pid = Some(app.pid);
            flow.client_name = Some(app.name);
            flow.client_bundle_id = app.bundle_id;
            flow.client_path = Some(app.path);
        }
        let written = self.db.with_tx(|ctx| self.write_flow(ctx, flow, f.persisted));
        match written {
            Ok(true) => {}
            Ok(false) => self.forget_cleared(&id),
            Err(e) => warn!("Failed to write proxy flow: {e}"),
        }
    }

    /// Writes `flow` and tells the app. One written before, as a stream is while open, keeps
    /// what was recorded on it since, the request it was saved as; one cleared since stays
    /// cleared, and this returns false.
    fn write_flow(
        &self,
        ctx: &yaak_database::DbContext,
        mut flow: Flow,
        persisted: bool,
    ) -> Result<bool, yaak_database::Error> {
        if persisted {
            let Some(stored) = ctx.find_optional::<Flow>(FlowIden::Id, &flow.id) else {
                return Ok(false);
            };
            flow.saved_request_id = stored.saved_request_id;
        }
        let (saved, created) = ctx.upsert(&flow, &UpdateSource::Background)?;
        // Sent while this holds the writer, before the commit, so a clear's event, sent after
        // its own commit, always comes after it.
        self.events.emit(
            "model_write",
            &ModelPayload { model: saved, change: ModelChangeEvent::Upsert { created } },
        );
        Ok(true)
    }

    /// Deletes what a flow cleared while it streamed wrote after the clear.
    fn forget_cleared(&self, flow_id: &str) {
        let deleted = self.blobs.with_tx(|b| {
            b.delete_chunks(&Flow::body_id(flow_id, FlowBody::Request))?;
            b.delete_chunks(&Flow::body_id(flow_id, FlowBody::Response))?;
            b.delete_chunks_like(&format!("{flow_id}.msg.%"))
        });
        if let Err(e) = deleted {
            warn!("Failed to delete a cleared flow's bodies: {e}");
        }
    }
}

/// The body names a Content-Encoding.
fn encoded(flow: &Flow, which: FlowBody) -> bool {
    find_header(flow.headers(which), "content-encoding")
        .is_some_and(|e| !e.trim().is_empty() && !e.trim().eq_ignore_ascii_case("identity"))
}

fn flow_exists(conn: &rusqlite::Connection, flow_id: &str) -> bool {
    conn.query_row("SELECT 1 FROM flows WHERE id = ?1", [flow_id], |_| Ok(())).is_ok()
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

// -- Router + Schema --

define_rpc! {
    ProxyCtx;
    commands {
        execute_action(ActionInvocation) -> bool,
        format_body(FormatBodyRequest) -> String,
        get_message_payload(GetMessagePayloadRequest) -> GetMessagePayloadResponse,
        list_actions(ListActionsRequest) -> ListActionsResponse,
        list_flows(flows::FlowFilter) -> ListFlowsResponse,
        list_grpc_schemas(ListGrpcSchemasRequest) -> Vec<GrpcSchema>,
        list_messages(ListMessagesRequest) -> ListMessagesResponse,
        remove_grpc_schema(RemoveGrpcSchemaRequest) -> bool,
        set_recording(SetRecordingRequest) -> bool,
        set_system_proxy_at_launch(SetSystemProxyAtLaunchRequest) -> bool,
        set_http_version(SetHttpVersionRequest) -> HttpVersion,
    }
    async_commands {
        add_grpc_schema(AddGrpcSchemaRequest) -> GrpcSchema,
        app_icon(AppIconRequest) -> Option<String>,
        ca_status(CaStatusRequest) -> CaStatus,
        ca_trust(CaTrustRequest) -> CaStatus,
        clear_flows(ClearFlowsRequest) -> usize,
        decode_grpc_message(DecodeGrpcMessageRequest) -> DecodedGrpcMessage,
        export_har(ExportHarRequest) -> usize,
        filter_body(FilterBodyRequest) -> FilterBodyResponse,
        get_flow_body(GetFlowBodyRequest) -> GetFlowBodyResponse,
        get_proxy_state(GetProxyStateRequest) -> GetProxyStateResponse,
        helper_register(HelperRegisterRequest) -> SystemProxyStatus,
        helper_unregister(HelperUnregisterRequest) -> SystemProxyStatus,
        list_workspaces(ListWorkspacesRequest) -> ListWorkspacesResponse,
        preview_save(PreviewSaveRequest) -> SavePreview,
        reflect_grpc_host(ReflectGrpcHostRequest) -> GrpcSchema,
        save_flow(SaveFlowToYaakRequest) -> SavedFlow,
        save_flow_body(SaveFlowBodyRequest) -> SaveFlowBodyResponse,
        system_proxy_set(SystemProxySetRequest) -> SystemProxyStatus,
        system_proxy_status(SystemProxyStatusRequest) -> SystemProxyStatus,
        take_over(TakeOverRequest) -> bool,
    }
    events {
        flows_cleared(FlowsClearedPayload),
        message_write(MessagePayload),
        model_write(ModelPayload),
        proxy_state_changed(ProxyStatePayload),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_the_password_prompt_parked_keep_it_over_the_helper() {
        use yaak_proxy_helper::networksetup::{ProxySetting, ServiceProxy, Snapshot};
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        assert_eq!(ctx.backend_for(HelperState::Enabled), SystemProxyBackend::Helper);

        // A restore parked an unplugged adapter's settings, at port 0.
        let corp = ProxySetting { enabled: true, server: "corp-proxy".into(), port: 3128 };
        let parked = Snapshot {
            services: vec![ServiceProxy::new("USB LAN", corp.clone(), corp)],
            ..Snapshot::default()
        };
        std::fs::write(ctx.snapshot_path(), serde_json::to_vec(&parked).unwrap()).unwrap();
        assert_eq!(macos::saved_port(&ctx.snapshot_path()), None, "routes nothing");
        // Only the password prompt's capture would use them when the adapter is back.
        assert_eq!(ctx.backend_for(HelperState::Enabled), SystemProxyBackend::AdminPrompt);
        assert_eq!(ctx.backend_for(HelperState::NotRegistered), SystemProxyBackend::AdminPrompt);
    }

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

    /// An event loop writing to `ctx`'s databases, fed by the returned sender.
    fn event_loop(
        ctx: &ProxyCtx,
    ) -> (std::sync::mpsc::Sender<ProxyEvent>, std::thread::JoinHandle<()>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let sink = FlowSink {
            db: ctx.db.clone(),
            blobs: ctx.blobs.clone(),
            events: ctx.events.clone(),
            attribution: Attribution::new(0),
            recording: ctx.recording.clone(),
        };
        (tx, std::thread::spawn(move || run_event_loop(rx, sink)))
    }

    fn open_websocket(tx: &std::sync::mpsc::Sender<ProxyEvent>, id: u64, url: &str) {
        tx.send(ProxyEvent::RequestStart {
            id,
            started_at: SystemTime::now(),
            method: "GET".into(),
            url: url.into(),
            http_version: "HTTP/1.1".into(),
            connection: id,
            client_addr: "127.0.0.1:1".parse().unwrap(),
        })
        .unwrap();
        tx.send(ProxyEvent::ResponseStart {
            id,
            status: 101,
            http_version: "HTTP/1.1".into(),
            remote_addr: None,
            elapsed_ms: 1,
        })
        .unwrap();
        tx.send(ProxyEvent::StreamStart { id, kind: yaak_proxy::StreamKind::WebSocket }).unwrap();
    }

    fn ws_message(
        id: u64,
        direction: yaak_proxy::MessageDirection,
        kind: yaak_proxy::MessageKind,
        data: &[u8],
    ) -> ProxyEvent {
        ProxyEvent::Message {
            id,
            message: yaak_proxy::StreamMessage {
                direction,
                kind,
                at: SystemTime::now(),
                size: data.len() as u64,
                data: bytes::Bytes::copy_from_slice(data),
                truncated: false,
                compressed: false,
                error: None,
            },
        }
    }

    fn wait_for_flow(ctx: &ProxyCtx, check: impl Fn(&Flow) -> bool) -> Flow {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let flows = ctx.db.with_conn(|c| c.find_all::<Flow>().unwrap());
            if let Some(flow) = flows.into_iter().find(&check) {
                return flow;
            }
            assert!(std::time::Instant::now() < deadline, "no flow as expected");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// A gRPC call's bodies are its messages: neither is written to the blob store, and each
    /// reads back framed again, cut where a message was cut.
    #[tokio::test(flavor = "multi_thread")]
    async fn grpc_bodies_are_read_back_from_their_messages() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let send = |event| tx.send(event).unwrap();
        send(ProxyEvent::RequestStart {
            id: 1,
            started_at: SystemTime::now(),
            method: "POST".into(),
            url: "https://api.example.com/pkg.Greeter/SayHello".into(),
            http_version: "HTTP/2.0".into(),
            connection: 1,
            client_addr: "127.0.0.1:1".parse().unwrap(),
        });
        send(ProxyEvent::RequestHeader {
            id: 1,
            name: "content-type".into(),
            value: "application/grpc".into(),
        });
        send(ProxyEvent::StreamStart { id: 1, kind: yaak_proxy::StreamKind::Grpc });
        let request = b"\x00\x00\x00\x00\x05\x0a\x03Ada";
        send(ProxyEvent::RequestBodyChunk {
            id: 1,
            len: request.len(),
            data: bytes::Bytes::from_static(request),
        });
        send(ws_message(1, D::Client, K::GrpcMessage, b"\x0a\x03Ada"));
        send(ProxyEvent::RequestBodyComplete {
            id: 1,
            size: request.len() as u64,
            truncated: false,
        });
        send(ProxyEvent::ResponseStart {
            id: 1,
            status: 200,
            http_version: "HTTP/2.0".into(),
            remote_addr: None,
            elapsed_ms: 1,
        });
        send(ProxyEvent::ResponseHeader {
            id: 1,
            name: "content-type".into(),
            value: "application/grpc+proto".into(),
        });
        // Over the capture limit on the wire: the body stored only the limit's worth before.
        let response = b"\x00\x00\x00\x00\x0b\x0a\x09Hello Ada";
        send(ProxyEvent::ResponseBodyChunk {
            id: 1,
            len: response.len(),
            data: bytes::Bytes::from_static(&response[..4]),
        });
        let mut cut = ws_message(1, D::Server, K::GrpcMessage, b"\x0a\x09Hel");
        if let ProxyEvent::Message { message, .. } = &mut cut {
            message.truncated = true;
        }
        send(cut);
        let trailers = K::GrpcTrailers { status: Some(0), message: None };
        send(ws_message(1, D::Server, trailers, b"grpc-status: 0\r\n"));
        send(ProxyEvent::ResponseBodyComplete {
            id: 1,
            size: response.len() as u64,
            truncated: true,
            elapsed_ms: 5,
            error: None,
            cancelled: false,
        });
        drop(tx);
        event_loop.join().unwrap();

        let flow = flows::list(&ctx.db, &Default::default()).unwrap().remove(0);
        assert_eq!((flow.message_count, flow.grpc_status), (3, Some(0)));
        assert_eq!((flow.request_size, flow.response_size), (10, 16), "sizes on the wire");
        assert_eq!((flow.request_truncated, flow.response_truncated), (false, true));
        let blobs = ctx.blobs.connect();
        assert!(!blobs.body_exists(&Flow::body_id(&flow.id, FlowBody::Request)).unwrap());
        assert!(!blobs.body_exists(&Flow::body_id(&flow.id, FlowBody::Response)).unwrap());

        let read = |which| bodies::read_body(&ctx.db, &ctx.blobs, &flow, which, 1 << 20);
        let request_body = read(FlowBody::Request).await.unwrap();
        assert_eq!((request_body.data.as_slice(), request_body.truncated), (&request[..], false));
        // HTTP/2 trailers are no part of the body.
        let response_body = read(FlowBody::Response).await.unwrap();
        assert_eq!(response_body.data, b"\x00\x00\x00\x00\x05\x0a\x09Hel");
        assert!(response_body.truncated);
        let har = har::export(&ctx.db, &ctx.blobs, &[flow], 1 << 20).await.unwrap();
        assert_eq!(har.log.entries[0].response.content.size, 10);
    }

    /// A gzipped event stream keeps its bytes until an event shows they decode; one whose bytes
    /// never do keeps them, so its body still reads, with why it didn't decode.
    #[tokio::test(flavor = "multi_thread")]
    async fn encoded_event_streams_keep_their_bytes_until_they_decode() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        for (id, url) in [
            (1, "https://a.example.com/events"),
            (2, "https://b.example.com/events"),
        ] {
            tx.send(ProxyEvent::RequestStart {
                id,
                started_at: SystemTime::now(),
                method: "GET".into(),
                url: url.into(),
                http_version: "HTTP/1.1".into(),
                connection: id,
                client_addr: "127.0.0.1:1".parse().unwrap(),
            })
            .unwrap();
            tx.send(ProxyEvent::ResponseStart {
                id,
                status: 200,
                http_version: "HTTP/1.1".into(),
                remote_addr: None,
                elapsed_ms: 1,
            })
            .unwrap();
            for (name, value) in [
                ("content-type", "text/event-stream"),
                ("content-encoding", "gzip"),
            ] {
                let (name, value) = (name.into(), value.into());
                tx.send(ProxyEvent::ResponseHeader { id, name, value }).unwrap();
            }
            tx.send(ProxyEvent::StreamStart { id, kind: yaak_proxy::StreamKind::Sse }).unwrap();
            let data = bytes::Bytes::from_static(b"\x1f\x8b not really gzip");
            tx.send(ProxyEvent::ResponseBodyChunk { id, len: data.len(), data }).unwrap();
        }
        // The first one's bytes decoded into an event; the second's never did.
        let raw = "data: hi\n\n".to_string();
        let event = K::SseEvent { event: None, id: None, retry: None, raw: raw.clone() };
        let mut message = ws_message(1, D::Server, event, b"hi");
        if let ProxyEvent::Message { message, .. } = &mut message {
            message.size = raw.len() as u64;
        }
        tx.send(message).unwrap();
        for id in [1, 2] {
            tx.send(ProxyEvent::ResponseBodyComplete {
                id,
                size: 20,
                truncated: false,
                elapsed_ms: 5,
                error: None,
                cancelled: false,
            })
            .unwrap();
        }
        drop(tx);
        event_loop.join().unwrap();

        let flows = flows::list(&ctx.db, &Default::default()).unwrap();
        let flow = |host: &str| flows.iter().find(|f| f.url.contains(host)).unwrap().clone();
        let (decoded, undecoded) = (flow("a.example"), flow("b.example"));
        let blobs = ctx.blobs.connect();
        assert!(!blobs.body_exists(&Flow::body_id(&decoded.id, FlowBody::Response)).unwrap());
        assert!(blobs.body_exists(&Flow::body_id(&undecoded.id, FlowBody::Response)).unwrap());

        let read =
            |flow| bodies::read_body_or_raw(&ctx.db, &ctx.blobs, flow, FlowBody::Response, 1024);
        assert_eq!(read(&decoded).await.unwrap().data, raw.as_bytes());
        let body = read(&undecoded).await.unwrap();
        assert_eq!(body.data, b"\x1f\x8b not really gzip");
        assert!(body.decode_error.is_some());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn websocket_messages_are_stored_and_exported() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        open_websocket(&tx, 1, "https://example.com/socket");
        let big: Vec<u8> = (0..10_000u32).map(|i| i as u8).collect();
        tx.send(ws_message(1, D::Client, K::WebSocketText, b"hi")).unwrap();
        tx.send(ws_message(1, D::Server, K::WebSocketBinary, &big)).unwrap();
        let close = K::WebSocketClose { code: Some(1000), reason: "bye".into() };
        tx.send(ws_message(1, D::Client, close, b"\x03\xe8bye")).unwrap();

        // Written while open, its count following its messages.
        let open = wait_for_flow(&ctx, |f| f.message_count == 3);
        assert_eq!((open.stream_kind, open.elapsed_ms), (Some(StreamKind::Websocket), None));
        tx.send(ProxyEvent::StreamEnd { id: 1, elapsed_ms: 50, error: None }).unwrap();
        drop(tx);
        event_loop.join().unwrap();

        let flow = flows::list(&ctx.db, &Default::default()).unwrap().remove(0);
        assert_eq!((flow.elapsed_ms, flow.error.as_deref()), (Some(50), None));
        let stored = messages::list(&ctx.db, &flow.id, None, None).unwrap();
        let kinds: Vec<_> = stored.iter().map(|m| (m.seq, m.kind, m.direction)).collect();
        assert_eq!(
            kinds,
            vec![
                (0, messages::MessageKind::WebsocketText, messages::MessageDirection::Client),
                (1, messages::MessageKind::WebsocketBinary, messages::MessageDirection::Server),
                (2, messages::MessageKind::WebsocketClose, messages::MessageDirection::Client),
            ]
        );
        assert_eq!(stored[0].preview.as_deref(), Some("hi"));
        assert_eq!(stored[1].preview, None);
        assert_eq!(
            (stored[2].meta.close_code, stored[2].meta.close_reason.as_deref()),
            (Some(1000), Some("bye"))
        );
        // The large payload is in the blob store, the small ones in their rows.
        assert_eq!(messages::payload(&ctx.db, &ctx.blobs, &stored[1]).unwrap(), big);
        assert!(ctx.blobs.connect().body_exists(&stored[1].blob_id()).unwrap());
        assert!(!ctx.blobs.connect().body_exists(&stored[0].blob_id()).unwrap());
        assert_eq!(messages::payload(&ctx.db, &ctx.blobs, &stored[0]).unwrap(), b"hi");

        let har =
            har::export(&ctx.db, &ctx.blobs, std::slice::from_ref(&flow), 1 << 20).await.unwrap();
        let har = serde_json::to_value(&har).unwrap();
        let sent = &har["log"]["entries"][0]["_webSocketMessages"];
        assert_eq!(sent.as_array().unwrap().len(), 2, "data messages only, as devtools exports");
        assert_eq!((sent[0]["type"].as_str(), sent[0]["opcode"].as_u64()), (Some("send"), Some(1)));
        assert_eq!(sent[0]["data"], "hi");
        assert_eq!(
            (sent[1]["type"].as_str(), sent[1]["opcode"].as_u64()),
            (Some("receive"), Some(2))
        );
        assert_eq!(sent[1]["data"], BASE64.encode(&big));
        // No body after the 101, and it says why.
        let body = bodies::read_body(&ctx.db, &ctx.blobs, &flow, FlowBody::Response, 1 << 20)
            .await
            .unwrap();
        assert_eq!((body.data.len(), body.note.as_deref()), (0, Some(bodies::WEBSOCKET_BODY_NOTE)));

        let names: Vec<_> = event_rx.try_iter().map(|e| e.event).collect();
        assert_eq!(names.iter().filter(|n| **n == "message_write").count(), 3, "{names:?}");

        ctx.clear_flows().unwrap();
        assert!(!ctx.blobs.connect().body_exists(&stored[1].blob_id()).unwrap());
    }

    #[test]
    fn a_stream_cleared_while_open_stays_cleared() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        open_websocket(&tx, 1, "https://example.com/socket");
        tx.send(ws_message(1, D::Client, K::WebSocketText, b"before")).unwrap();
        let flow = wait_for_flow(&ctx, |f| f.message_count == 1);
        ctx.clear_flows().unwrap();

        tx.send(ws_message(1, D::Server, K::WebSocketBinary, &[7; 8192])).unwrap();
        // A body chunk past a blob chunk's size would be written at once, were it kept.
        let data = bytes::Bytes::from(vec![b'x'; 2 << 20]);
        tx.send(ProxyEvent::ResponseBodyChunk { id: 1, len: data.len(), data }).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let blobs = ctx.blobs.connect().list_body_ids().unwrap();
        assert!(blobs.iter().all(|b| !b.starts_with(&flow.id)), "while open: {blobs:?}");

        tx.send(ProxyEvent::StreamEnd { id: 1, elapsed_ms: 9, error: None }).unwrap();
        drop(tx);
        event_loop.join().unwrap();
        assert_eq!(flows::count(&ctx.db).unwrap(), 0, "not brought back by its end");
        assert_eq!(messages::count(&ctx.db, &flow.id).unwrap(), 0);
        let blobs = ctx.blobs.connect().list_body_ids().unwrap();
        assert!(blobs.iter().all(|b| !b.starts_with(&flow.id)), "{blobs:?}");
    }

    #[test]
    fn an_open_stream_is_written_while_events_never_let_up() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        open_websocket(&tx, 1, "https://example.com/socket");
        wait_for_flow(&ctx, |f| f.stream_kind.is_some());

        // A backlog of messages, each followed by another event, which costs the loop a
        // transaction for the message before it, so its queue does not empty for a while.
        const SENT: i64 = 10_000;
        for _ in 0..SENT {
            tx.send(ws_message(1, D::Client, K::WebSocketText, b"tick")).unwrap();
            let data = bytes::Bytes::from_static(b"x");
            tx.send(ProxyEvent::ResponseBodyChunk { id: 1, len: 1, data }).unwrap();
        }
        let counted = wait_for_flow(&ctx, |f| f.message_count > 0);
        assert!(counted.message_count < SENT, "written before the backlog was through");
        drop(tx);
        event_loop.join().unwrap();
    }

    #[test]
    fn an_open_call_shows_its_response_before_any_message() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        tx.send(ProxyEvent::RequestStart {
            id: 1,
            started_at: SystemTime::now(),
            method: "POST".into(),
            url: "https://example.com/pkg.Greeter/Watch".into(),
            http_version: "HTTP/2".into(),
            connection: 1,
            client_addr: "127.0.0.1:1".parse().unwrap(),
        })
        .unwrap();
        tx.send(ProxyEvent::StreamStart { id: 1, kind: yaak_proxy::StreamKind::Grpc }).unwrap();
        wait_for_flow(&ctx, |f| f.stream_kind.is_some());
        tx.send(ProxyEvent::ResponseStart {
            id: 1,
            status: 200,
            http_version: "HTTP/2".into(),
            remote_addr: None,
            elapsed_ms: 3,
        })
        .unwrap();
        tx.send(ProxyEvent::ResponseHeader {
            id: 1,
            name: "content-type".into(),
            value: "application/grpc".into(),
        })
        .unwrap();
        // No message yet, and the server may send none for a long while.
        let open = wait_for_flow(&ctx, |f| f.status == Some(200));
        assert_eq!(
            (open.elapsed_ms, open.content_type.as_deref()),
            (None, Some("application/grpc"))
        );
        drop(tx);
        event_loop.join().unwrap();
    }

    #[test]
    fn streams_still_open_end_when_the_engine_stops() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        open_websocket(&tx, 1, "https://example.com/socket");
        wait_for_flow(&ctx, |f| f.stream_kind.is_some());
        drop(tx);
        event_loop.join().unwrap();
        let flow = flows::list(&ctx.db, &Default::default()).unwrap().remove(0);
        assert_eq!(flow.error.as_deref(), Some(STOPPED_MID_STREAM));
    }

    /// A flow whose response is `body` under `content_type`, stored in `ctx`
    fn flow_with_response(ctx: &ProxyCtx, id: &str, content_type: &str, body: &[u8]) {
        let flow = Flow {
            id: id.into(),
            status: Some(200),
            response_size: body.len() as i64,
            response_headers: vec![ProxyHeader {
                name: "Content-Type".into(),
                value: content_type.into(),
            }],
            ..Default::default()
        };
        ctx.db.with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        let mut writer =
            BodyChunkWriter::new(ctx.blobs.clone(), Flow::body_id(id, FlowBody::Response));
        writer.write(body).unwrap();
        writer.finish().unwrap();
    }

    /// The filter reads the text the viewer shows: in the body's charset, not UTF-8 alone.
    #[tokio::test]
    async fn filter_reads_the_body_in_its_charset() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events).unwrap();

        let xml = "<cities><city>Zürich</city><city>Kraków</city></cities>";
        let utf16: Vec<u8> = xml.encode_utf16().flat_map(u16::to_le_bytes).collect();
        flow_with_response(&ctx, "fl_utf16", "application/xml; charset=utf-16le", &utf16);
        let json = r#"{"items":[{"name":"Café"},{"name":"Crème brûlée"}]}"#;
        let latin1: Vec<u8> = json.chars().map(|c| c as u8).collect();
        flow_with_response(&ctx, "fl_latin1", "application/json; charset=iso-8859-1", &latin1);
        flow_with_response(&ctx, "fl_unlabeled", "application/json", &latin1);

        let filter = |flow_id: &str, expression: &str, language| FilterBodyRequest {
            flow_id: flow_id.into(),
            which: FlowBody::Response,
            expression: expression.into(),
            language: Some(language),
        };
        let xpath = filter("fl_utf16", "//city[2]", FilterLanguage::XPath);
        let result = filter_body(ctx.clone(), xpath).await.unwrap();
        assert_eq!((result.content.as_str(), result.error), ("<city>Kraków</city>", None));
        for flow_id in ["fl_latin1", "fl_unlabeled"] {
            let names = filter(flow_id, "$.items[*].name", FilterLanguage::JsonPath);
            let result = filter_body(ctx.clone(), names).await.unwrap();
            assert_eq!(result.error, None, "{flow_id}");
            assert_eq!(result.content, "[\n  \"Café\",\n  \"Crème brûlée\"\n]", "{flow_id}");
        }
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

        // The viewer gets the bytes as they were on the wire, and why they didn't decode.
        let req = GetFlowBodyRequest { flow_id: "fl_bad".into(), which: FlowBody::Response };
        let body = get_flow_body(ctx.clone(), req).await.unwrap();
        let error = body.decode_error.unwrap();
        assert!(error.starts_with("Failed to decode Gzip body"), "{error}");
        assert_eq!(BASE64.decode(body.data).unwrap(), b"not a gzip stream");
        assert!(!body.truncated);

        // Saving writes those same bytes.
        let path = dir.path().join("body.bin");
        let req = SaveFlowBodyRequest {
            flow_id: "fl_bad".into(),
            which: FlowBody::Response,
            path: path.to_string_lossy().into_owned(),
        };
        let saved = save_flow_body(ctx.clone(), req).await.unwrap();
        assert_eq!((saved.size, saved.truncated, saved.raw), (17, false, true));
        assert_eq!(std::fs::read(&path).unwrap(), b"not a gzip stream");

        let req = FilterBodyRequest {
            flow_id: "fl_bad".into(),
            which: FlowBody::Response,
            expression: "$".into(),
            language: None,
        };
        assert!(filter_body(ctx, req).await.is_err());
    }
}
