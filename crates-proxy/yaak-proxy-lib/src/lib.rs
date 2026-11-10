pub mod actions;
pub mod attribution;
pub mod bodies;
pub mod ca;
pub mod client;
pub mod control;
pub mod convert;
pub mod db;
mod exit_gate;
pub mod filter_history;
pub mod flows;
pub mod grpc;
pub mod har;
pub mod helper;
pub mod macos;
pub mod messages;
pub mod models;
pub mod query;
pub mod save;
pub mod saved_queries;
pub mod settings;
pub mod terminal;
pub mod tunnels;

use crate::actions::{ActionInvocation, ActionMetadata, GlobalAction};
use crate::attribution::Attribution;
use crate::ca::CaStatus;
use crate::client::ControlClient;
use crate::control::{ControlFile, ControlInfo, ControlServer, Owner};
use crate::convert::DroppedHeader;
use crate::db::{ProxyQueryManager, Stores};
use crate::grpc::{DecodedGrpcMessage, GrpcSchema, GrpcState};
use crate::helper::HelperState;
use crate::macos::{SystemProxyBackend, SystemProxyStatus};
use crate::messages::FlowMessage;
use crate::models::{
    Flow, FlowBody, ModelPayload, ProxyHeader, StreamKind, TunnelReason, find_header,
};
use crate::save::{ClientDb, SaveFlowRequest, SaveFlowResponse, WorkspaceSummary};
use crate::settings::{DecryptList, HttpVersion, ProxySettings, TrafficRetention};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::{DateTime, Utc};
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock, PoisonError, RwLock, Weak};
use std::time::{Duration, SystemTime};
use ts_rs::TS;
pub use yaak_crypto::MasterKeySource;
use yaak_crypto::data_key::DataKey;
use yaak_database::{UpdateSource, UpsertModelInfo};
pub use yaak_grpc::GrpcConfig;
use yaak_models::blob_manager::{BlobManager, BodyChunkWriter};
use yaak_proxy::{CaStore, KeyCipher, ProxyConfig, ProxyEvent, ProxyHandle};
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
    /// Cleared flows are being deleted in the background. Held while the deleter decides it is
    /// done, so a clear either sees it running or starts another.
    deleting_cleared: Arc<Mutex<bool>>,
    /// This context's name as the one deleting cleared flows, which the database leases to one
    /// process at a time.
    cleaner_id: String,
    /// Held through each change to the decrypt list, so concurrent edits apply in turn, each to
    /// the list the last one left.
    decrypt_edits: Arc<Mutex<()>>,
    /// Where the master key that unwraps the data key is kept: the keychain, normally.
    keys: MasterKeySource,
    /// The data key, once read. Held while it is read and the databases converted and opened,
    /// so that happens once, and whoever needs them waits for it.
    unlocked: Arc<Mutex<Option<DataKey>>>,
    /// How far converting plain databases has got, from 0 to 1, while it runs.
    encrypting: Arc<Mutex<Option<f64>>>,
    /// Stops so far, for a start that waited for the databases to tell one came meanwhile.
    stops: Arc<AtomicU64>,
    /// `proxy.db` and `blobs.sqlite`, once unlocked. None while the data key is unavailable or
    /// they are being converted: nothing is read or written then.
    stores: Arc<RwLock<Option<Stores>>>,
    /// Why they could not be unlocked, the last time it was tried.
    lock_reason: Arc<Mutex<Option<String>>>,
    /// Resets of the captured data so far, so a thread deleting from databases since deleted
    /// stops.
    resets: Arc<AtomicU64>,
    /// The thread keeping captured traffic under the keep-traffic cap, while there is one.
    sweeper: Arc<(Mutex<Sweeper>, Condvar)>,
    /// Captured traffic is to be emptied as the databases are first unlocked, this launch
    /// being set to clear it. Taken once it is.
    clear_at_launch: Arc<AtomicBool>,
    /// The window's places, as it last sent them, for a reload of it to take back. Held in
    /// memory only, as filters can hold captured values, and gone when the app quits.
    window_places: Arc<Mutex<Option<String>>>,
    /// `traffic.lock`, locked shared for as long as this process has the databases open, so
    /// another launch can't delete them from under it: clearing them takes it alone.
    traffic_lock: Arc<Mutex<Option<std::fs::File>>>,
    /// Held while `system_proxy_on` is set and changes are counted pending, and while the
    /// watch applies what it read, so what it read never overwrites a change decided since.
    system_proxy_intent: Arc<Mutex<()>>,
    /// The system proxy watch is running, so it is started once.
    watching_system_proxy: Arc<AtomicBool>,
    /// System proxy changes decided but not yet made, from when `system_proxy_on` is set until
    /// the change is done. Until then the system proxy is not yet as meant, and following it
    /// would undo the change before it is made.
    system_proxy_pending: Arc<AtomicU64>,
    pub events: RpcEventEmitter,
    /// gRPC schemas as decoded, and the protoc that compiles attached protos.
    pub grpc: GrpcState,
    /// The search the app shows, which written flows' events are matched against.
    live_search: Arc<query::LiveSearch>,
    /// The HTTPS connections the running engine passes through undecrypted now.
    tunnels: Arc<tunnels::OpenTunnels>,
}

impl ProxyCtx {
    /// Opens `proxy.db` and `blobs.sqlite` in `data_dir`, the proxy app's data directory,
    /// encrypted with a data key the master key in `keys` wraps, made the first time. Without
    /// it nothing is captured, so this asks the keychain at launch; when it refuses, no database
    /// is open and everything that reads or writes one is refused as [`Locked`], until starting
    /// tries again. Databases a build from before left plain are converted in the background,
    /// and the engine starts once they are.
    pub fn new(
        data_dir: &Path,
        events: RpcEventEmitter,
        keys: MasterKeySource,
    ) -> Result<Self, String> {
        // Before any database is opened, as it must be.
        yaak_database::encryption::init_crypto();
        let ctx = Self {
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
            deleting_cleared: Arc::new(Mutex::new(false)),
            cleaner_id: yaak_database::generate_prefixed_id("cln"),
            decrypt_edits: Arc::new(Mutex::new(())),
            keys,
            unlocked: Arc::new(Mutex::new(None)),
            encrypting: Arc::new(Mutex::new(None)),
            stops: Arc::new(AtomicU64::new(0)),
            stores: Arc::new(RwLock::new(None)),
            lock_reason: Arc::new(Mutex::new(None)),
            resets: Arc::new(AtomicU64::new(0)),
            sweeper: Default::default(),
            clear_at_launch: Arc::new(AtomicBool::new(false)),
            window_places: Arc::new(Mutex::new(None)),
            traffic_lock: Arc::new(Mutex::new(None)),
            system_proxy_intent: Arc::new(Mutex::new(())),
            watching_system_proxy: Arc::new(AtomicBool::new(false)),
            system_proxy_pending: Arc::new(AtomicU64::new(0)),
            events,
            grpc: GrpcState::default(),
            live_search: Default::default(),
            tunnels: Default::default(),
        };
        // Unreadable settings keep the traffic: nothing is deleted on a guess. Nor is traffic
        // another process is capturing as this launches, which this one may take over later.
        let clear = ctx.settings().is_ok_and(|s| s.traffic() == TrafficRetention::ClearOnLaunch)
            && control::live_owner(data_dir).is_none_or(|o| o.pid == std::process::id());
        ctx.clear_at_launch.store(clear, Ordering::SeqCst);
        if db::needs_encrypting(data_dir) {
            let unlocking = ctx.clone();
            std::thread::spawn(move || {
                if let Err(e) = unlocking.unlock() {
                    warn!("{e}");
                }
            });
        } else if let Err(e) = ctx.unlock() {
            // Kept as the reason the databases are locked; starting tries again.
            warn!("{e}");
        }
        Ok(ctx)
    }

    /// `proxy.db`, or why it is locked.
    pub fn db(&self) -> Result<ProxyQueryManager, Locked> {
        Ok(self.stores()?.db)
    }

    /// `blobs.sqlite`, or why it is locked.
    pub fn blobs(&self) -> Result<BlobManager, Locked> {
        Ok(self.stores()?.blobs)
    }

    fn stores(&self) -> Result<Stores, Locked> {
        let stores = self.stores.read().unwrap_or_else(PoisonError::into_inner);
        stores.clone().ok_or_else(|| Locked(self.lock_reason()))
    }

    /// Why the databases are locked, or None once they are open.
    pub fn locked(&self) -> Option<ProxyLock> {
        if self.stores.read().unwrap_or_else(PoisonError::into_inner).is_some() {
            return None;
        }
        let reason = self.lock_reason.lock().unwrap_or_else(PoisonError::into_inner).clone();
        Some(ProxyLock {
            keychain: reason.as_deref().is_none_or(db::is_key_unavailable),
            message: Locked(self.lock_reason()).to_string(),
        })
    }

    fn lock_reason(&self) -> String {
        if self.encrypting().is_some() {
            return "traffic captured before this version is being encrypted.".to_string();
        }
        let reason = self.lock_reason.lock().unwrap_or_else(PoisonError::into_inner).clone();
        reason.unwrap_or_else(|| "its key has not been read yet.".to_string())
    }

    /// How far converting databases from before encryption has got, from 0 to 1, while it runs.
    pub fn encrypting(&self) -> Option<f64> {
        *self.encrypting.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The data key, read the first time it is asked for, with the databases converted when
    /// they are plain, then opened. The CA's key is encrypted on the spot. Callers meanwhile
    /// wait for it, so capture starts after any conversion. Why it failed is kept, for what the
    /// databases' absence refuses to say.
    fn unlock(&self) -> Result<DataKey, String> {
        let unlocked = self.try_unlock();
        let reason = unlocked.as_ref().err().cloned();
        let mut kept = self.lock_reason.lock().unwrap_or_else(PoisonError::into_inner);
        if *kept != reason {
            *kept = reason;
            drop(kept);
            self.emit_state();
        }
        unlocked
    }

    fn try_unlock(&self) -> Result<DataKey, String> {
        let mut unlocked = self.unlocked.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(key) = unlocked.as_ref() {
            return Ok(key.clone());
        }
        let key = db::load_or_create_data_key(&self.keys, &self.data_dir)?;
        let converting = db::needs_encrypting(&self.data_dir);
        // A build from before encryption that owns the engine, a CLI daemon, has the plain
        // databases and CA open, and converting them would pull them away from under it. They
        // are converted once it lets go, which starting here asks it to.
        if converting
            && let Some(owner) = control::live_owner(&self.data_dir)
            && owner.pid != std::process::id()
        {
            return Err(format!(
                "{}, so the traffic it stored can't be encrypted yet. Take over or quit it, then \
                retry.",
                control::already_owned(&owner)
            ));
        }
        if self.ca_dir().join("ca.key").exists()
            && let Err(e) = self.ca_with(&key)
        {
            warn!("{e}");
        }

        let db_key = db::database_key(&key);
        // Before converting, so bodies about to be deleted aren't encrypted first.
        let clearing = self.lock_traffic(self.take_clear_at_launch());
        // Shared again once cleared, or on the way out should opening fail.
        let _share = clearing.then(|| ShareOnDrop(&self.traffic_lock));
        if clearing && let Err(e) = db::remove_blobs(&self.data_dir) {
            warn!("{e}");
        }
        let converting = converting && db::needs_encrypting(&self.data_dir);
        if converting {
            let converted = self.encrypt_existing(&db_key);
            self.set_encrypting(None);
            converted?;
        }
        let stores = Stores::open(&self.data_dir, &db_key)?;
        if clearing {
            match flows::delete_all(&stores.db) {
                Ok(()) => log::info!("Cleared captured traffic at launch"),
                Err(e) => warn!("{e}"),
            }
        }
        // SQLCipher's exit handler is registered by now, so the gate's runs before it.
        exit_gate::install();
        *self.stores.write().unwrap_or_else(PoisonError::into_inner) = Some(stores);
        *unlocked = Some(key.clone());
        drop(unlocked);

        // Nothing could be read while locked, so the app reads again.
        self.events.emit("flows_cleared", &FlowsClearedPayload {});
        // A clear the last run did not finish deleting.
        if self.db().is_ok_and(|db| db.with_conn(|c| flows::clear_mark(c.conn().resolve())) > 0) {
            self.delete_cleared();
        }
        self.sweep_soon();
        Ok(key)
    }

    /// Whether this unlock empties the captured traffic: the first to get this far since a
    /// launch set to clear it. Not while another process owns the engine, as the CLI daemon
    /// may: the traffic is its, still being written, and this app takes it over as it is. Asked
    /// at launch too, as the first unlock may come later, once the keychain allows it.
    fn take_clear_at_launch(&self) -> bool {
        if !self.clear_at_launch.swap(false, Ordering::SeqCst) {
            return false;
        }
        match control::live_owner(&self.data_dir) {
            Some(owner) if owner.pid != std::process::id() => {
                log::info!("Keeping captured traffic: {}", control::already_owned(&owner));
                false
            }
            _ => true,
        }
    }

    /// Takes `traffic.lock` for this process's life, the first time the databases open: alone
    /// when `clear` asks to empty them and no other process has them open, so the clear goes
    /// ahead; shared otherwise, waiting out another launch's clear. Returns whether to clear.
    /// A launch racing this one, before either has claimed the engine, then never deletes a
    /// database the other already has open.
    fn lock_traffic(&self, clear: bool) -> bool {
        let mut held = self.traffic_lock.lock().unwrap_or_else(PoisonError::into_inner);
        if held.is_some() {
            return false;
        }
        let path = self.data_dir.join(TRAFFIC_LOCK);
        let file = match std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(e) => {
                warn!("Failed to open {}, keeping captured traffic: {e}", path.display());
                return false;
            }
        };
        let alone = clear && file.try_lock().is_ok();
        if clear && !alone {
            log::info!("Keeping captured traffic: another process has it open");
        }
        if !alone && let Err(e) = file.lock_shared() {
            warn!("Failed to lock {}: {e}", path.display());
        }
        *held = Some(file);
        alone
    }

    /// Converts the plain databases, telling the app how far it has got a few times a second.
    fn encrypt_existing(&self, key: &yaak_database::encryption::DatabaseKey) -> Result<(), String> {
        let started = std::time::Instant::now();
        self.set_encrypting(Some(0.0));
        db::encrypt_existing(&self.data_dir, key, &|fraction| self.set_encrypting(Some(fraction)))?;
        log::info!("Encrypted the proxy's databases in {:?}", started.elapsed());
        Ok(())
    }

    fn set_encrypting(&self, fraction: Option<f64>) {
        *self.encrypting.lock().unwrap_or_else(PoisonError::into_inner) = fraction;
        self.emit_state();
    }

    /// Tells the app to read the proxy's state again.
    fn emit_state(&self) {
        let state = if self.port().is_some() { ProxyState::Running } else { ProxyState::Stopped };
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state });
    }

    /// The proxy's CA, made the first time, its private key encrypted with the data key.
    pub fn load_ca(&self) -> Result<CaStore, String> {
        let key = self.unlock()?;
        self.ca_with(&key)
    }

    fn ca_with(&self, key: &DataKey) -> Result<CaStore, String> {
        CaStore::load_or_create_encrypted(&self.ca_dir(), &CaKeyCipher(key.clone()))
            .map_err(|e| format!("Failed to load proxy CA: {e}"))
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
        self.start_routing(port, None)
    }

    /// [`Self::start_on`], the system proxy pointed at the engine when `system_proxy` says so,
    /// or as the settings ask at launch when it is None.
    fn start_routing(&self, port: Option<u16>, system_proxy: Option<bool>) -> Result<(), String> {
        let started = self.start_engine(port, system_proxy);
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

    fn start_engine(&self, port: Option<u16>, system_proxy: Option<bool>) -> Result<(), String> {
        if let Some(owner) = control::live_owner(&self.data_dir)
            && owner.pid != std::process::id()
        {
            return Err(control::already_owned(&owner));
        }
        // Refused without the key, so nothing is ever stored unencrypted. Waits for databases
        // from before encryption to be converted, outside the handle's lock so the state reads
        // meanwhile, and so a stop may come meanwhile too.
        let stops = self.stops.load(Ordering::SeqCst);
        let ca = self.load_ca()?;
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        // Stopped while waiting: the stop was answered, so this start is not.
        if handle.is_some() || self.stops.load(Ordering::SeqCst) != stops {
            return Ok(());
        }

        let settings = self.settings()?;
        self.end_stale_streams();
        let mut config = ProxyConfig::new(port.unwrap_or(settings.port), Arc::new(ca));
        config.capture_body_limit = settings.capture_body_limit;
        config.http2 = settings.http_version == HttpVersion::Auto;
        config.decrypt = settings.decrypt_policy();
        // Filled once the engine has bound, since the lookup matches sockets by its port.
        let attribution_slot: Arc<OnceLock<Attribution>> = Arc::new(OnceLock::new());
        let slot = attribution_slot.clone();
        config.app_of = Some(Arc::new(move |connection| {
            let app = slot.get()?.get(connection, ATTRIBUTION_WAIT)?;
            Some(yaak_proxy::DecryptApp { name: app.name, bundle_id: app.bundle_id })
        }));
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
        let tunnel_run = self.tunnels.begin_run(Some(attribution.clone()));

        if let Some(event_rx) = proxy_handle.take_event_rx() {
            let sink = FlowSink {
                db: self.db()?,
                blobs: self.blobs()?,
                events: self.events.clone(),
                live_search: self.live_search.clone(),
                attribution,
                recording: self.recording.clone(),
                finished: Default::default(),
                clock: BatchClock::Real,
                tunnels: self.tunnels.clone(),
                tunnel_run,
                handle: Arc::downgrade(&self.handle),
                rejections: Default::default(),
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
        let route = system_proxy.unwrap_or(settings.system_proxy_at_launch);
        let (pending, _) = self.intend_system_proxy(route);
        if route {
            // The password dialog can sit open for a while; the engine is up regardless.
            let ctx = self.detached();
            std::thread::spawn(move || {
                let _pending = pending;
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
        // Only after unlocking, so open.
        let Ok(db) = self.db() else {
            return;
        };
        let ended = db.with_tx(|c| {
            let conn = c.conn().resolve();
            conn.execute(
                "UPDATE flows SET error = ?1 WHERE stream_kind IS NOT NULL \
                AND elapsed_ms IS NULL AND error IS NULL AND NOT cancelled",
                [STOPPED_MID_STREAM],
            )?;
            conn.execute(
                "UPDATE flows SET error = ?1 WHERE tunnelled \
                AND elapsed_ms IS NULL AND error IS NULL",
                [STOPPED_MID_TUNNEL],
            )?;
            Ok::<_, yaak_database::Error>(())
        });
        if let Err(e) = ended {
            warn!("Failed to end streams left open: {e}");
        }
    }

    /// Stops the engine and turns off a system proxy that points at it.
    pub fn stop(&self) -> Result<(), String> {
        let (pending, _) = self.intend_system_proxy(false);
        let port = self.take_handle()?;
        if let Some(port) = port {
            let ctx = self.detached();
            std::thread::spawn(move || {
                let _pending = pending;
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
        // Under the handle's lock, so a start waiting for the databases sees it.
        self.stops.fetch_add(1, Ordering::SeqCst);
        // Its tunnels go with it, in the same turn of the lock, so nothing reads them as open
        // once it is gone.
        self.tunnels.stop_run();
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
        let ctx = self.detached();
        std::thread::spawn(move || {
            if let Err(e) = ctx.reset_stale_system_proxy(&ports) {
                warn!("Failed to reset a stale system proxy: {e}");
            }
        });
        // The owner turns the system proxy on and off, so it follows changes made underneath.
        self.watch_system_proxy();
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
        let (_pending, previous) = self.intend_system_proxy(enabled);
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
        settings.save(&self.settings_path())?;
        self.emit_state();
        Ok(())
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
        self.emit_state();
        Ok(())
    }

    /// The port the engine starts on, saved in `settings.json`. A running engine is restarted on
    /// it at once, the system proxy following. When it cannot bind there, the port before is put
    /// back and the engine restarted on it, and why is returned. Another process's engine takes
    /// it at its next start.
    pub fn set_port(&self, port: u16) -> Result<u16, String> {
        if port == 0 {
            return Err("The port must be from 1 to 65535".to_string());
        }
        let mut settings = self.settings()?;
        let previous = settings.port;
        settings.port = port;
        settings.save(&self.settings_path())?;
        if self.port().is_none_or(|running| running == port) {
            self.emit_state();
            return Ok(port);
        }
        // Read once: stopping clears it, and a failed start would leave the rollback reading
        // the cleared value, so the old port would come back without the system proxy.
        let proxy_on = self.system_proxy_on.load(Ordering::SeqCst);
        if let Err(e) = self.restart(proxy_on) {
            settings.port = previous;
            settings.save(&self.settings_path())?;
            if let Err(e) = self.restart(proxy_on) {
                warn!("Failed to restart the proxy on port {previous}: {e}");
            }
            return Err(e);
        }
        Ok(port)
    }

    /// Stops the engine and starts it again as `settings.json` has it, routing the system proxy
    /// to it only when `proxy_on`, as it was before the first stop: a restart keeps the routing
    /// as the user left it rather than applying the launch setting again.
    fn restart(&self, proxy_on: bool) -> Result<(), String> {
        self.stop()?;
        self.start_routing(None, Some(proxy_on))
    }

    /// Bytes of each body stored per flow, saved in `settings.json` and applied to the running
    /// engine's bodies from now on.
    pub fn set_capture_body_limit(&self, bytes: usize) -> Result<usize, String> {
        let mut settings = self.settings()?;
        settings.capture_body_limit = bytes;
        settings.save(&self.settings_path())?;
        if let Ok(handle) = self.handle.lock()
            && let Some(handle) = handle.as_ref()
        {
            handle.set_capture_body_limit(bytes);
        }
        self.emit_state();
        Ok(bytes)
    }

    /// The most captured traffic kept, saved in `settings.json`, or None to keep everything.
    /// Swept down to it soon after.
    pub fn set_keep_traffic(&self, bytes: Option<u64>) -> Result<Option<u64>, String> {
        if bytes == Some(0) {
            return Err("Keep more than 0 bytes of traffic, or all of it".to_string());
        }
        let mut settings = self.settings()?;
        settings.keep_traffic_bytes = bytes;
        settings.save(&self.settings_path())?;
        self.sweep_soon();
        self.emit_state();
        Ok(bytes)
    }

    /// Whether captured traffic is cleared at the next launch or kept, saved in `settings.json`.
    /// Kept, the keep-traffic cap applies from now on; cleared, it is remembered but not
    /// applied, and nothing already captured goes until the next launch.
    pub fn set_traffic(&self, traffic: TrafficRetention) -> Result<TrafficRetention, String> {
        let mut settings = self.settings()?;
        settings.traffic = Some(traffic);
        settings.save(&self.settings_path())?;
        self.sweep_soon();
        self.emit_state();
        Ok(traffic)
    }

    /// Bytes the captured traffic takes, as the keep-traffic cap counts them: the databases'
    /// used pages, so it shrinks as flows are deleted though the files do not. Locked, the
    /// files' sizes instead, as nothing in them can be read.
    pub fn storage_size(&self) -> Result<u64, String> {
        match self.stores() {
            Ok(stores) => stores.used_bytes(),
            Err(_) => Ok(db::file_bytes(&self.data_dir)),
        }
    }

    /// Deletes every flow, body and message for good, with the data key that encrypts them, and
    /// opens new databases under a new one, so the app goes on, empty. Works while locked, as
    /// the way out of a key the keychain lost. The master key in the keychain stays: it wraps
    /// only the data key, and wraps the new one, or a new one is made when it is gone. The CA is
    /// kept, its key encrypted again, while the old key can read it; locked, it goes too, and a
    /// new one has to be trusted. Refused while another process owns the engine, as it has the
    /// databases open. A running engine is restarted on the new ones.
    pub fn reset_captured_data(&self) -> Result<(), String> {
        if let Some(owner) = control::live_owner(&self.data_dir)
            && owner.pid != std::process::id()
        {
            return Err(format!("{}. Quit it first.", control::already_owned(&owner)));
        }
        let running = self.port().is_some();
        let proxy_on = self.system_proxy_on.load(Ordering::SeqCst);
        if running {
            self.stop()?;
        }
        {
            // Held so nothing unlocks the old databases meanwhile.
            let mut unlocked = self.unlocked.lock().unwrap_or_else(PoisonError::into_inner);
            let old_key = unlocked.take();
            *self.stores.write().unwrap_or_else(PoisonError::into_inner) = None;
            self.resets.fetch_add(1, Ordering::SeqCst);
            *self.deleting_cleared.lock().unwrap_or_else(PoisonError::into_inner) = false;

            let ca_key = self.ca_dir().join("ca.key");
            let ca_pem = old_key.and_then(|key| match std::fs::read(&ca_key) {
                Ok(stored) => key.decrypt(&stored).ok(),
                Err(_) => None,
            });
            // The event loop and a clear's batch let go of the databases moments after the
            // engine stops; until then Windows refuses to delete files still open.
            if let Err(e) = remove_captured_when_closed(&self.data_dir) {
                drop(unlocked);
                // What is left opens again, so the app is not left without its databases.
                if let Err(e) = self.unlock() {
                    warn!("Failed to reopen the proxy's databases: {e}");
                }
                if running {
                    self.start_routing(None, Some(proxy_on))?;
                }
                return Err(e);
            }
            let new_key = db::load_or_create_data_key(&self.keys, &self.data_dir);
            match (ca_pem, &new_key) {
                (Some(pem), Ok(new_key)) => {
                    let sealed = new_key.encrypt(&pem).map_err(|e| e.to_string())?;
                    write_private(&ca_key, &sealed)?;
                }
                // Unreadable without the old key: a new CA is made as the databases open.
                _ => {
                    for name in ["ca.key", "ca.pem"] {
                        let _ = std::fs::remove_file(self.ca_dir().join(name));
                    }
                }
            }
            *self.lock_reason.lock().unwrap_or_else(PoisonError::into_inner) = None;
        }
        log::info!("Reset the proxy's captured traffic in {}", self.data_dir.display());
        let unlocked = self.unlock();
        // Whatever the app had is gone, opened again or not.
        self.events.emit("flows_cleared", &FlowsClearedPayload {});
        self.emit_state();
        unlocked?;
        if running {
            self.start_routing(None, Some(proxy_on))?;
        }
        Ok(())
    }

    /// A clone sharing everything but the databases, for a thread that may outlive every
    /// context that owns them, like one turning the system proxy off as the engine stops. Were
    /// it the last to hold them, it would close them itself, and at a process's exit that races
    /// SQLCipher's own teardown and crashes; this way they close where their owner lets go.
    fn detached(&self) -> Self {
        Self { stores: Arc::new(RwLock::new(None)), ..self.clone() }
    }

    /// Has the sweeper look at the captured traffic's size now, started when the keep-traffic
    /// cap is set and it is not running. Without a cap nothing runs, and a sweeper running
    /// stops.
    fn sweep_soon(&self) {
        let (state, wake) = &*self.sweeper;
        let mut sweeper = state.lock().unwrap_or_else(PoisonError::into_inner);
        if sweeper.running {
            sweeper.poked = true;
            wake.notify_all();
            return;
        }
        if self.keep_traffic().is_none() {
            return;
        }
        sweeper.running = true;
        drop(sweeper);
        let ctx = self.detached();
        let stores = Arc::downgrade(&self.stores);
        let spawned = std::thread::Builder::new().name("proxy-sweep".into()).spawn(move || {
            lower_thread_priority();
            ctx.run_sweeper(&stores);
        });
        if let Err(e) = spawned {
            warn!("Failed to start keeping captured traffic under its cap: {e}");
            state.lock().unwrap_or_else(PoisonError::into_inner).running = false;
        }
    }

    /// The keep-traffic cap, as `settings.json` has it, while traffic is kept between launches.
    fn keep_traffic(&self) -> Option<u64> {
        self.settings().ok().and_then(|s| s.keep_traffic_cap())
    }

    /// Sweeps the oldest flows while the captured traffic is over the cap, then waits for
    /// [`SWEEP_INTERVAL`] or a nudge, until the cap is taken away. The cap is read under the
    /// sweeper's lock, so one set as this stops finds it stopped and starts another.
    fn run_sweeper(&self, stores: &Weak<RwLock<Option<Stores>>>) {
        let (state, wake) = &*self.sweeper;
        loop {
            let cap = {
                let mut sweeper = state.lock().unwrap_or_else(PoisonError::into_inner);
                let Some(cap) = self.keep_traffic() else {
                    sweeper.running = false;
                    return;
                };
                sweeper.poked = false;
                cap
            };
            self.sweep_under(cap, stores);
            let sweeper = state.lock().unwrap_or_else(PoisonError::into_inner);
            if !sweeper.poked {
                drop(wake.wait_timeout(sweeper, SWEEP_INTERVAL));
            }
        }
    }

    /// Deletes the oldest flows a batch at a time, yielding the writer between, until the
    /// captured traffic is under `cap`, telling the app of each batch. Stops early when the
    /// sweeper is nudged, to read the cap again. `stores` is the context's databases, held
    /// weakly so the sweeper never keeps them open past the context that owns them.
    fn sweep_under(&self, cap: u64, stores: &Weak<RwLock<Option<Stores>>>) {
        loop {
            // Held through the batch, letting go of the databases included.
            let gate = exit_gate::hold();
            // Each batch from the databases open now, which a reset replaces.
            let Some(stores) = stores
                .upgrade()
                .and_then(|s| s.read().unwrap_or_else(PoisonError::into_inner).clone())
            else {
                return;
            };
            match flows::sweep_oldest(&stores, cap) {
                Ok(ids) if ids.is_empty() => return,
                Ok(ids) => {
                    // After the commit, as a clear's is.
                    self.events.emit("flows_removed", &FlowsRemovedPayload { ids });
                }
                Err(e) => {
                    warn!("{e}");
                    return;
                }
            }
            drop(stores);
            drop(gate);
            if self.sweeper.0.lock().unwrap_or_else(PoisonError::into_inner).poked {
                return;
            }
            std::thread::sleep(DELETE_PAUSE);
        }
    }

    /// What HTTPS is decrypted, as `settings.json` has it.
    pub fn decrypt_list(&self) -> Result<DecryptList, String> {
        Ok(self.settings()?.decrypt_list())
    }

    /// Replaces the decrypt list, saved in `settings.json` and applied to the running engine's
    /// next connections. Connections already open stay as they were.
    pub fn set_decrypt_list(&self, entries: &[String]) -> Result<DecryptListSaved, String> {
        self.change_decrypt_list(|settings| settings.set_decrypt_list(entries))
    }

    /// Adds and removes entries in the list as it is now, so edits made together each keep
    /// the other's, unlike replacing the whole list from a copy read earlier.
    pub fn edit_decrypt_list(
        &self,
        add: &[String],
        remove: &[String],
    ) -> Result<DecryptListSaved, String> {
        self.change_decrypt_list(|settings| settings.edit_decrypt_list(add, remove))
    }

    /// Changes the list in `settings.json`, one change at a time, applies it to the running
    /// engine, and tells the app. Connections already open are left as they are; the reply
    /// counts those the new list would decrypt if they reconnected.
    fn change_decrypt_list(
        &self,
        change: impl FnOnce(&mut ProxySettings) -> Result<(), String>,
    ) -> Result<DecryptListSaved, String> {
        let _turn = self.decrypt_edits.lock().map_err(|_| "lock poisoned".to_string())?;
        let mut settings = self.settings()?;
        change(&mut settings)?;
        settings.save(&self.settings_path())?;
        let policy = settings.decrypt_policy();
        // Applied and counted against the one engine running, whose tunnels these are.
        let still_encrypted = self.with_engine(|engine| {
            let Some(engine) = engine else {
                return Ok::<_, String>(0);
            };
            engine.set_decrypt_policy(policy.clone());
            let all = tunnels::TunnelScope::default();
            Ok(self.reconnectable_in(engine, &policy, &all)?.len())
        })?;
        let list = settings.decrypt_list();
        self.events.emit("decrypt_list_changed", &DecryptListChangedPayload { list: list.clone() });
        Ok(DecryptListSaved { list, still_encrypted })
    }

    /// `f` with the engine running now, if any, under its lock. Starting and stopping the engine
    /// swap it and the open-tunnel registry's run under this same lock, so what `f` reads of
    /// the engine's tunnels and pass-through set and what it does to them belong to one run.
    fn with_engine<T>(&self, f: impl FnOnce(Option<&ProxyHandle>) -> T) -> T {
        let handle = self.handle.lock().unwrap_or_else(PoisonError::into_inner);
        f(handle.as_ref())
    }

    /// The open tunnels of `engine` within `scope` that `policy` would decrypt if their clients
    /// reconnected. For a caller holding the engine's lock.
    fn reconnectable_in(
        &self,
        engine: &ProxyHandle,
        policy: &yaak_proxy::DecryptPolicy,
        scope: &tunnels::TunnelScope,
    ) -> Result<Vec<tunnels::OpenTunnel>, String> {
        tunnels::reconnectable(&self.tunnels.list(), policy, &engine.passthrough(), scope)
    }

    /// Intercepts again the hosts passed through after clients rejected the CA, as they no
    /// longer will once it is trusted.
    pub fn forget_passthrough(&self) {
        let addresses = self.with_engine(|engine| {
            let engine = engine?;
            engine.forget_passthrough();
            Some(engine.passthrough())
        });
        let addresses = addresses.unwrap_or_default();
        self.events.emit("passthrough_changed", &PassthroughChangedPayload { addresses });
    }

    /// Intercepts again one address (`host:port`) passed through after a client rejected the
    /// CA. Returns whether it was passed through, and what still is, read from the same engine.
    pub fn forget_passthrough_address(&self, address: &str) -> (bool, Vec<String>) {
        let (forgotten, addresses) = self.with_engine(|engine| match engine {
            Some(e) => (e.forget_passthrough_address(address), e.passthrough()),
            None => (false, Vec::new()),
        });
        if forgotten {
            let payload = PassthroughChangedPayload { addresses: addresses.clone() };
            self.events.emit("passthrough_changed", &payload);
        }
        (forgotten, addresses)
    }

    /// The addresses (`host:port`) the running engine passes through after clients rejected
    /// the CA. Empty while it is stopped.
    pub fn passthrough(&self) -> Vec<String> {
        self.with_engine(|engine| engine.map(ProxyHandle::passthrough).unwrap_or_default())
    }

    /// [`Self::forget_passthrough_address`] for an address as the app or the control API names
    /// it, with what is still passed through.
    pub fn forget_passthrough_request(
        &self,
        req: &ForgetPassthroughRequest,
    ) -> Result<ForgetPassthroughResponse, String> {
        let address = passthrough_address(&req.address)
            .ok_or_else(|| format!("Invalid address {:?}", req.address))?;
        let (forgotten, addresses) = self.forget_passthrough_address(&address);
        Ok(ForgetPassthroughResponse { forgotten, addresses })
    }

    /// Trusts the CA, made first when the engine has never run so there is one to trust. Once
    /// trusted, the addresses passed through after clients rejected it are intercepted again.
    pub async fn trust_ca(&self) -> Result<ca::CaTrustResult, String> {
        // Off the async threads: it may wait for the keychain or a conversion.
        let ca = {
            let ctx = self.clone();
            blocking(move || ctx.load_ca()).await.map_err(|e| e.message)?
        };
        let trusted = ca::trust(ca.cert_path()).await?;
        if trusted == ca::Trusted::Yes {
            self.forget_passthrough();
        }
        let status = ca::status(ca.cert_path()).await?;
        Ok(ca::CaTrustResult { status, cancelled: trusted == ca::Trusted::Cancelled })
    }

    /// The process that owns the engine, while it is another one: commands about the running
    /// engine go there.
    fn engine_elsewhere(&self) -> Option<ControlInfo> {
        if self.port().is_some() {
            return None;
        }
        self.other_owner()
    }

    /// The HTTPS connections open now that the decrypt list would decrypt if their clients
    /// reconnected, within `scope`. Not those passed through after a client rejected the CA.
    pub fn reconnectable_tunnels(
        &self,
        scope: &tunnels::TunnelScope,
    ) -> Result<Vec<tunnels::OpenTunnel>, String> {
        let policy = self.settings()?.decrypt_policy();
        self.with_engine(|engine| match engine {
            Some(engine) => self.reconnectable_in(engine, &policy, scope),
            None => Ok(Vec::new()),
        })
    }

    /// Closes tunnels so their clients reconnect, decrypted as the list now says: those in
    /// `ids` this run of the engine gave out, or, without ids, those
    /// [`Self::reconnectable_tunnels`] finds in `scope`. Each ends with its flow marked
    /// `reconnectRequested`. Returns how many were open. Looked up and closed under the engine's
    /// lock, so a restart can't come between and have another run's tunnels closed.
    pub fn reconnect_tunnels(
        &self,
        ids: Option<&[String]>,
        scope: &tunnels::TunnelScope,
    ) -> Result<usize, String> {
        let policy = match ids {
            Some(_) => None,
            None => Some(self.settings()?.decrypt_policy()),
        };
        self.with_engine(|engine| {
            let Some(engine) = engine else {
                return Ok(0);
            };
            let ids = match (ids, &policy) {
                (Some(ids), _) => self.tunnels.engine_ids(ids),
                (None, Some(policy)) => {
                    let found = self.reconnectable_in(engine, policy, scope)?;
                    found.iter().map(|t| t.engine_id).collect()
                }
                (None, None) => Vec::new(),
            };
            #[cfg(test)]
            tests::pause_between_lookup_and_close();
            Ok(engine.close_tunnels(&ids))
        })
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

    /// Decides that this Mac's web traffic is meant to point at the running engine, or not,
    /// returning what was meant before. The change counts as pending until the guard is
    /// dropped, once it is made: until then the watch leaves `system_proxy_on` alone.
    fn intend_system_proxy(&self, on: bool) -> (PendingChange, bool) {
        let _intent = self.system_proxy_intent.lock().unwrap_or_else(PoisonError::into_inner);
        self.system_proxy_pending.fetch_add(1, Ordering::SeqCst);
        let previous = self.system_proxy_on.swap(on, Ordering::SeqCst);
        (PendingChange(self.system_proxy_pending.clone()), previous)
    }

    /// Follows the system proxy as macOS reports changes to it, for as long as the process
    /// runs, so a change made underneath the app, by hand or by another app such as Proxyman,
    /// shows at once. Started once; a failure leaves the app reading it when the window is
    /// focused, as before.
    pub fn watch_system_proxy(&self) {
        if self.watching_system_proxy.swap(true, Ordering::SeqCst) {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        if let Err(e) = macos::watch(move || {
            let _ = tx.send(());
        }) {
            warn!("Not following the system proxy: {e}");
            return;
        }
        let ctx = self.detached();
        let spawned =
            std::thread::Builder::new().name("system-proxy-follow".into()).spawn(move || {
                while rx.recv().is_ok() {
                    // One change comes as several notices, a service at a time.
                    while rx.recv_timeout(SYSTEM_PROXY_SETTLE).is_ok() {}
                    while !ctx.follow_system_proxy() {
                        std::thread::sleep(SYSTEM_PROXY_SETTLE);
                    }
                }
            });
        if let Err(e) = spawned {
            warn!("Not following the system proxy: {e}");
        }
    }

    /// Takes the system proxy as it is now: meant to point at the running engine while every
    /// service sends its traffic there, and not otherwise. With nothing left pointing at the
    /// engine's port, the settings saved for putting back are dropped, so stopping or quitting
    /// restores nothing over a change someone else made. Tells the app either way. Returns
    /// false, doing nothing, while a change of the app's own is under way, to be tried again.
    /// Blocks.
    fn follow_system_proxy(&self) -> bool {
        if self.system_proxy_pending.load(Ordering::SeqCst) > 0 {
            return false;
        }
        // Held so no change starts meanwhile, nor a change of ours is mistaken for another's.
        let _turn = match self.system_proxy_turn.try_lock() {
            Ok(turn) => turn,
            Err(std::sync::TryLockError::Poisoned(turn)) => turn.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return false,
        };
        if self.system_proxy_pending.load(Ordering::SeqCst) > 0 {
            return false;
        }
        let running = self.port();
        let Some(port) = running.or_else(|| self.settings().ok().map(|s| s.port)) else {
            return true;
        };
        match macos::routing(port) {
            Ok(routing) => {
                // Applied only if nothing was decided, and the engine didn't move, while it was
                // read: a change asked for meanwhile wins, and is read again once made.
                let intent =
                    self.system_proxy_intent.lock().unwrap_or_else(PoisonError::into_inner);
                if self.system_proxy_pending.load(Ordering::SeqCst) > 0 || self.port() != running {
                    return false;
                }
                if running.is_some() {
                    let was = self.system_proxy_on.swap(routing.every, Ordering::SeqCst);
                    if was != routing.every {
                        let now = if routing.every { "on" } else { "off" };
                        debug!("The system proxy is {now} at port {port} after a change");
                    }
                }
                drop(intent);
                // Back on the running engine without the app setting it, as Proxyman leaves it
                // in putting back what it found: recorded as the app's, so it is turned off as
                // the engine stops or the app quits.
                if running.is_some()
                    && routing.every
                    && let Err(e) =
                        macos::adopt(port, self.system_proxy_backend(), &self.snapshot_path())
                {
                    warn!("Failed to take over the system proxy pointing here: {e}");
                }
                if !routing.any
                    && let Err(e) =
                        macos::forget(port, self.system_proxy_backend(), &self.snapshot_path())
                {
                    warn!("Failed to forget the replaced proxy settings: {e}");
                }
            }
            Err(e) => warn!("Failed to read the system proxy: {e}"),
        }
        self.emit_state();
        true
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
        let flow = flows::get(&self.db()?, flow_id)?;
        let limit = self.capture_body_limit()?;
        let body =
            bodies::read_body(&self.db()?, &self.blobs()?, &flow, FlowBody::Request, limit).await?;
        let saved = ClientDb::open(&self.client_data_dir)?.save(&flow, &body, req)?;

        let flow = Flow { saved_request_id: Some(saved.request.id.clone()), ..flow };
        self.db()?
            .with_tx(|tx| {
                // Cleared while saving: recording it would bring the flow back without bodies.
                if flows::find_in(tx.conn().resolve(), flow_id).is_none() {
                    return Ok(());
                }
                let (flow, created) = tx.upsert(&flow, &UpdateSource::Background)?;
                // Sent before the commit, so it cannot reach the app after a clear that follows.
                self.events.emit("model_write", &self.live_search.payload(flow, created));
                Ok::<_, yaak_database::Error>(())
            })
            .map_err(|e| format!("Failed to record the saved request on the flow: {e}"))?;
        Ok(saved)
    }

    /// Records that an agent read the flow through the control API, for `@is:read`, and tells
    /// the app. Only the first read writes anything.
    pub fn note_agent_read(&self, flow_id: &str) {
        let noted = self.db().map_err(String::from).and_then(|db| {
            db.with_tx(|tx| {
                let conn = tx.conn().resolve();
                let changed = conn.execute(
                    "UPDATE flows SET agent_read = TRUE WHERE id = ? AND NOT agent_read",
                    [flow_id],
                )?;
                // Sent before the commit, as every flow's event is.
                if changed > 0
                    && let Some(flow) = flows::find_in(conn, flow_id)
                {
                    self.events.emit("model_write", &self.live_search.payload(flow, false));
                }
                Ok::<_, yaak_database::Error>(())
            })
            .map_err(|e| e.to_string())
        });
        if let Err(e) = noted {
            warn!("Failed to note that an agent read flow {flow_id}: {e}");
        }
    }

    /// Clears every flow at once and tells the app so its list empties, then deletes them and
    /// their bodies in the background. Returns how many there were.
    pub fn clear_flows(&self) -> Result<usize, String> {
        let cleared = flows::clear(&self.db()?)?;
        // After the commit, so the app reloads what is left. Flows written before the clear sent
        // their events before it began.
        self.events.emit("flows_cleared", &FlowsClearedPayload {});
        self.delete_cleared();
        Ok(cleared)
    }

    /// Deletes cleared flows on a background thread, a batch per transaction, unless one is
    /// already doing so. Yields the writer between batches, so new flows are written meanwhile.
    fn delete_cleared(&self) {
        // Only ever after a clear or unlocking, so open.
        let Ok(Stores { db, blobs, .. }) = self.stores() else {
            return;
        };
        if !claim(&self.deleting_cleared) {
            return;
        }
        let (running, cleaner) = (self.deleting_cleared.clone(), self.cleaner_id.clone());
        let (resets, reset) = (self.resets.clone(), self.resets.load(Ordering::SeqCst));
        let spawned = std::thread::Builder::new().name("proxy-clear".into()).spawn(move || {
            lower_thread_priority();
            clean(&db, &blobs, &running, &cleaner, &resets, reset);
            // Its last hold on the databases, which may close them, is let go of in a batch too.
            let _gate = exit_gate::hold();
            drop((db, blobs));
        });
        if let Err(e) = spawned {
            warn!("Failed to start deleting cleared flows: {e}");
            *self.deleting_cleared.lock().unwrap_or_else(PoisonError::into_inner) = false;
        }

        /// Deletes cleared flows a batch at a time until none are left, another process takes
        /// over, or a reset replaces the databases.
        fn clean(
            db: &ProxyQueryManager,
            blobs: &BlobManager,
            running: &Mutex<bool>,
            cleaner: &str,
            resets: &AtomicU64,
            reset: u64,
        ) {
            let mut retry = DELETE_PAUSE;
            loop {
                let gate = exit_gate::hold();
                // Its databases are gone, and the reset has let another start.
                if resets.load(Ordering::SeqCst) != reset {
                    return;
                }
                let cleaned = flows::delete_cleared(db, blobs, flows::DELETE_BATCH, cleaner);
                drop(gate);
                match cleaned {
                    Ok(flows::Cleaned::More) => {
                        retry = DELETE_PAUSE;
                        std::thread::sleep(DELETE_PAUSE);
                    }
                    // Another process, the app or the CLI, is deleting them; checked again now
                    // and then, in case it stops before it is done.
                    Ok(flows::Cleaned::Elsewhere) => std::thread::sleep(CLEANER_WAIT),
                    Ok(flows::Cleaned::Done) => {
                        *running.lock().unwrap_or_else(PoisonError::into_inner) = false;
                        // A clear since the last batch saw this running and left its flows to
                        // it, so they are deleted here unless another thread has taken over.
                        let more = {
                            let _gate = exit_gate::hold();
                            flows::clear_mark_in(db) != 0
                        };
                        if !more || !claim(running) {
                            return;
                        }
                    }
                    // A busy database, most likely: tried again, waiting longer each time, so a
                    // clear is never left half done until the next launch.
                    Err(e) => {
                        warn!("{e}");
                        std::thread::sleep(retry);
                        retry = (retry * 4).min(DELETE_RETRY_MAX);
                    }
                }
            }
        }
    }
}

/// Sets `flag`, returning false when it was already set.
fn claim(flag: &Mutex<bool>) -> bool {
    let mut set = flag.lock().unwrap_or_else(PoisonError::into_inner);
    !std::mem::replace(&mut *set, true)
}

/// Whether the sweeper runs, and whether it has been asked to look again since it last read the
/// cap.
#[derive(Debug, Default)]
struct Sweeper {
    running: bool,
    poked: bool,
}

/// Deletes the captured databases, trying again for a few seconds while something still has
/// them open, as Windows refuses to delete an open file.
fn remove_captured_when_closed(data_dir: &Path) -> Result<(), String> {
    let mut tries = 0;
    loop {
        match db::remove_captured(data_dir) {
            Ok(()) => return Ok(()),
            Err(_) if tries < REMOVE_TRIES => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Beside the databases, locked shared by each process that has them open.
const TRAFFIC_LOCK: &str = "traffic.lock";

/// Turns the exclusive `traffic.lock` a launch took to clear back into a shared one as it is
/// dropped, so other processes can open the databases again.
struct ShareOnDrop<'a>(&'a Mutex<Option<std::fs::File>>);

impl Drop for ShareOnDrop<'_> {
    fn drop(&mut self) {
        let held = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        // Let go first: Windows would otherwise add the shared lock beside the exclusive one.
        // Unix's flock lets go between the two as well, so this is no wider a gap.
        if let Some(file) = held.as_ref()
            && let Err(e) = file.unlock().and_then(|()| file.lock_shared())
        {
            warn!("Failed to share {TRAFFIC_LOCK}: {e}");
        }
    }
}

/// A system proxy change decided and not yet made, counted while it is held.
struct PendingChange(Arc<AtomicU64>);

impl Drop for PendingChange {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// How long the system proxy is left to settle after a change is reported before it is read,
/// and how long a read waits for a change of the app's own to finish.
const SYSTEM_PROXY_SETTLE: Duration = Duration::from_millis(500);

/// Tries at deleting the captured databases, 100 ms apart, before a reset gives up.
const REMOVE_TRIES: u32 = 50;

/// How often the sweeper measures the captured traffic against the keep-traffic cap.
const SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// Writes `contents` to `path` through a file beside it and a rename, readable by the user
/// alone where the platform has such modes.
fn write_private(path: &Path, contents: &[u8]) -> Result<(), String> {
    let fail = |e: std::io::Error| format!("Failed to write {}: {e}", path.display());
    let tmp = path.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&tmp).map_err(fail)?;
    file.write_all(contents).and_then(|_| file.sync_all()).map_err(fail)?;
    std::fs::rename(&tmp, path).map_err(fail)
}

/// How long deleting cleared flows rests between batches, leaving the database to new flows.
const DELETE_PAUSE: Duration = Duration::from_millis(5);

/// The longest deleting cleared flows waits before trying a failed batch again.
const DELETE_RETRY_MAX: Duration = Duration::from_secs(5);

/// How often a process checks on cleared flows another process is deleting.
const CLEANER_WAIT: Duration = Duration::from_secs(15);

/// Runs the calling thread below the app's own work, where the platform has priorities: macOS's
/// utility class, not background, whose disk throttling can stall a delete for as long as the
/// Mac is busy.
fn lower_thread_priority() {
    #[cfg(target_os = "macos")]
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0);
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

/// The decrypt list changed, here or through the control API.
#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DecryptListChangedPayload {
    pub list: DecryptList,
}

/// `host`, `host:port`, `[::1]` or `[::1]:8443` as the engine keys its pass-through set:
/// `host:port`, an IPv6 host in brackets. None when it is none of these.
fn passthrough_address(address: &str) -> Option<String> {
    let address = address.trim();
    let (host, port) = if let Some(rest) = address.strip_prefix('[') {
        let (host, after) = rest.split_once(']')?;
        let port = match after {
            "" => 443,
            p => p.strip_prefix(':')?.parse().ok()?,
        };
        (format!("[{host}]"), port)
    } else {
        match address.split_once(':') {
            Some((host, port)) if !port.contains(':') => (host.to_string(), port.parse().ok()?),
            Some(_) => (format!("[{address}]"), 443),
            None => (address.to_string(), 443),
        }
    };
    (!host.is_empty() && host != "[]").then(|| format!("{host}:{port}"))
}

/// The decrypt list as saved, and what it means for connections already open.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DecryptListSaved {
    #[serde(flatten)]
    pub list: DecryptList,
    /// Open connections the list now decrypts that stay encrypted until their clients
    /// reconnect: `reconnect_tunnels` closes them so they do. Closed by nothing else. Zero from
    /// an owner too old to count them.
    #[serde(default)]
    #[ts(type = "number")]
    pub still_encrypted: usize,
}

/// The addresses passed through after clients rejected the CA changed: one was added or
/// forgotten.
#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct PassthroughChangedPayload {
    /// Each `host:port`, an IPv6 host in brackets, sorted.
    pub addresses: Vec<String>,
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
    /// Sorted, the next page's `cursor`: the last flow's sort values, as read. None without a
    /// sort or a flow.
    pub cursor: Option<Vec<flows::SortValue>>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct QuerySchemaRequest {}

/// The search's fields, for the search box's highlighting and completion.
#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct QuerySchemaResponse {
    #[ts(type = "import(\"@yaakapp-internal/query\").Schema")]
    pub schema: serde_json::Value,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ValidateQueryRequest {
    pub query: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct QueryValuesRequest {
    /// A field's path: `host`, `header` for header names, `header.accept` for a header's values.
    pub path: String,
}

/// The search the app shows, which flows written from now on are matched against, their events
/// naming `key`. No query stops it.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct WatchQueryRequest {
    pub key: String,
    #[ts(optional)]
    pub query: Option<String>,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub hide_system: bool,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub hide_encrypted: bool,
}

/// Which of some flows a search covers, for flows whose events were matched against another.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct MatchFlowsRequest {
    pub filter: flows::FlowFilter,
    pub ids: Vec<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListSavedQueriesRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CreateSavedQueryRequest {
    pub name: String,
    pub query: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct RenameSavedQueryRequest {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DeleteSavedQueryRequest {
    pub id: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CountSavedQueriesRequest {
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub hide_system: bool,
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    pub hide_encrypted: bool,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SavedQueriesChangedPayload {}

/// Flows by id, for showing ones the list has not loaded. Those cleared or deleted are left out.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetFlowsRequest {
    pub ids: Vec<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListFilterHistoryRequest {}

/// A filter applied from the search box, or from the history itself, put at its top.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct RecordFilterRequest {
    pub filter: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct DeleteFilterHistoryRequest {
    pub filter: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ClearFilterHistoryRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FilterHistoryChangedPayload {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetLastFilterRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetWindowPlacesRequest {}

/// The window's places, opaque to the engine, kept in memory for a reload of the window.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetWindowPlacesRequest {
    pub places: String,
}

/// The filter the window applied, kept in the encrypted database for the next launch.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetLastFilterRequest {
    pub filter: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ClearFlowsRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowsClearedPayload {}

/// Flows deleted to keep captured traffic under the keep-traffic cap, the oldest first.
#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FlowsRemovedPayload {
    pub ids: Vec<String>,
}

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
    /// Bytes of each body stored per flow.
    #[ts(type = "number")]
    pub capture_body_limit: usize,
    /// Captured traffic is cleared at launch or kept between launches.
    pub traffic: TrafficRetention,
    /// The most captured traffic kept, in bytes, or null to keep everything. Applies only
    /// while traffic is kept.
    #[ts(type = "number | null")]
    pub keep_traffic_bytes: Option<u64>,
    /// Why the engine last failed to start, until it starts.
    pub start_error: Option<String>,
    /// How far encrypting traffic stored before encryption has got, from 0 to 1, while it
    /// runs. The engine starts once it is done.
    pub encrypting: Option<f64>,
    /// Captured traffic cannot be read: its key is unavailable, or it is being encrypted.
    pub locked: Option<ProxyLock>,
    /// Another process that owns the engine, such as the CLI daemon. While one does, this app
    /// cannot start its own, and new flows reach it only through the database.
    pub other_owner: Option<OtherOwner>,
}

/// The databases are locked: their key is unavailable, or they are being encrypted. What reads
/// or writes captured traffic is refused with this rather than reading or writing nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Locked(pub String);

/// What [`Locked`] says first.
pub const LOCKED: &str = "Traffic is locked";

impl std::fmt::Display for Locked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{LOCKED}: {}", self.0)
    }
}

impl From<Locked> for String {
    fn from(locked: Locked) -> Self {
        locked.to_string()
    }
}

impl From<Locked> for RpcError {
    fn from(locked: Locked) -> Self {
        rpc_error(locked)
    }
}

/// Why captured traffic cannot be read, for the window's locked state.
#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ProxyLock {
    /// What every refused read says.
    pub message: String,
    /// The keychain would not give up the key, or has not been asked yet, so allowing Yaak
    /// Proxy in Keychain Access is the way out.
    pub keychain: bool,
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
pub struct SetPortRequest {
    pub port: u16,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetCaptureBodyLimitRequest {
    #[ts(type = "number")]
    pub bytes: u64,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetTrafficRequest {
    pub traffic: TrafficRetention,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetKeepTrafficRequest {
    /// Null keeps everything.
    #[ts(type = "number | null")]
    pub bytes: Option<u64>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetStorageSizeRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetStorageSizeResponse {
    /// The databases' used pages, as the keep-traffic cap counts them; locked, their files'
    /// sizes on disk.
    #[ts(type = "number")]
    pub bytes: u64,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ResetCapturedDataRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct OpenTerminalRequest {
    /// Environment variables the shell starts with, by name: `HTTPS_PROXY`.
    pub vars: Vec<(String, String)>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetDecryptListRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SetDecryptListRequest {
    /// Every entry, in order, as typed: a bare hostname is a `host:` entry. A built-in
    /// exclusion left out is removed.
    pub entries: Vec<String>,
}

/// Entries to add after the user's own and to remove, applied to the list as it is when the
/// change lands. Each is normalized first.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct EditDecryptListRequest {
    pub add: Vec<String>,
    pub remove: Vec<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListSeenRequest {}

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
pub struct ListPassthroughRequest {}

/// The addresses passed through after clients rejected the CA.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct PassthroughResponse {
    /// Each `host:port`, an IPv6 host in brackets, sorted.
    pub addresses: Vec<String>,
}

/// An address to intercept again: `host`, `host:port` or `[::1]:8443`, as a flow's URL has
/// it, the port 443 when left out.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ForgetPassthroughRequest {
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ForgetPassthroughResponse {
    /// It was passed through.
    pub forgotten: bool,
    /// The addresses still passed through.
    pub addresses: Vec<String>,
}

/// Tunnels to close: those in `ids`, or, without them, every one `list_reconnectable_tunnels`
/// returns for the same `entry` and `flowId`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ReconnectTunnelsRequest {
    /// `OpenTunnel` ids. Ones from an earlier run of the engine close nothing.
    #[ts(optional)]
    pub ids: Option<Vec<String>>,
    #[serde(flatten)]
    pub scope: tunnels::TunnelScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ReconnectTunnelsResponse {
    /// Tunnels closed: those still open of the ones asked for.
    #[ts(type = "number")]
    pub closed: usize,
}

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
        messages::list(&ctx.db()?, &req.flow_id, req.after_seq, req.limit).map_err(rpc_error)?;
    let total = messages::count(&ctx.db()?, &req.flow_id).map_err(rpc_error)?;
    Ok(ListMessagesResponse { messages, total })
}

fn get_message_payload(
    ctx: &ProxyCtx,
    req: GetMessagePayloadRequest,
) -> Result<GetMessagePayloadResponse, RpcError> {
    let message = messages::get(&ctx.db()?, &req.flow_id, req.seq).map_err(rpc_error)?;
    let data = messages::payload(&ctx.db()?, &ctx.blobs()?, &message).map_err(rpc_error)?;
    Ok(GetMessagePayloadResponse { data: BASE64.encode(data), truncated: message.truncated })
}

async fn decode_grpc_message(
    ctx: ProxyCtx,
    req: DecodeGrpcMessageRequest,
) -> Result<DecodedGrpcMessage, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    grpc::decode(&ctx.db()?, &ctx.blobs()?, &ctx.grpc, &flow, req.seq, req.schemaless)
        .await
        .map_err(rpc_error)
}

fn list_grpc_schemas(
    ctx: &ProxyCtx,
    _req: ListGrpcSchemasRequest,
) -> Result<Vec<GrpcSchema>, RpcError> {
    grpc::list(&ctx.db()?).map_err(rpc_error)
}

async fn add_grpc_schema(ctx: ProxyCtx, req: AddGrpcSchemaRequest) -> Result<GrpcSchema, RpcError> {
    let db = ctx.db()?;
    grpc::add(&db, &ctx.grpc, &req.host_pattern, &req.proto_paths).await.map_err(rpc_error)
}

fn remove_grpc_schema(ctx: &ProxyCtx, req: RemoveGrpcSchemaRequest) -> Result<bool, RpcError> {
    grpc::remove(&ctx.db()?, &ctx.grpc, &req.id).map_err(rpc_error)
}

async fn reflect_grpc_host(
    ctx: ProxyCtx,
    req: ReflectGrpcHostRequest,
) -> Result<GrpcSchema, RpcError> {
    let (host, plaintext) = grpc::reflection_host(&req.host);
    let db = ctx.db()?;
    grpc::reflect(&db, &ctx.grpc, &host, plaintext).await.map_err(rpc_error)
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
            capture_body_limit: settings.capture_body_limit,
            traffic: settings.traffic(),
            keep_traffic_bytes: settings.keep_traffic_bytes,
            start_error: ctx.start_error(),
            encrypting: ctx.encrypting(),
            locked: ctx.locked(),
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

/// Off the async threads: restarting the engine joins its thread.
async fn set_port(ctx: ProxyCtx, req: SetPortRequest) -> Result<u16, RpcError> {
    blocking(move || ctx.set_port(req.port)).await
}

fn set_capture_body_limit(
    ctx: &ProxyCtx,
    req: SetCaptureBodyLimitRequest,
) -> Result<usize, RpcError> {
    let bytes = usize::try_from(req.bytes).map_err(rpc_error)?;
    ctx.set_capture_body_limit(bytes).map_err(rpc_error)
}

fn set_traffic(ctx: &ProxyCtx, req: SetTrafficRequest) -> Result<TrafficRetention, RpcError> {
    ctx.set_traffic(req.traffic).map_err(rpc_error)
}

/// The cap as saved, in bytes, or null to keep everything.
fn set_keep_traffic(ctx: &ProxyCtx, req: SetKeepTrafficRequest) -> Result<Option<usize>, RpcError> {
    let bytes = ctx.set_keep_traffic(req.bytes).map_err(rpc_error)?;
    Ok(bytes.map(|b| usize::try_from(b).unwrap_or(usize::MAX)))
}

async fn get_storage_size(
    ctx: ProxyCtx,
    _req: GetStorageSizeRequest,
) -> Result<GetStorageSizeResponse, RpcError> {
    let bytes = blocking(move || ctx.storage_size()).await?;
    Ok(GetStorageSizeResponse { bytes })
}

async fn reset_captured_data(
    ctx: ProxyCtx,
    _req: ResetCapturedDataRequest,
) -> Result<bool, RpcError> {
    blocking(move || ctx.reset_captured_data()).await?;
    Ok(true)
}

async fn open_terminal(_ctx: ProxyCtx, req: OpenTerminalRequest) -> Result<bool, RpcError> {
    blocking(move || terminal::open(&req.vars)).await?;
    Ok(true)
}

fn get_decrypt_list(ctx: &ProxyCtx, _req: GetDecryptListRequest) -> Result<DecryptList, RpcError> {
    ctx.decrypt_list().map_err(rpc_error)
}

/// Saved and applied here, or, while another process such as the CLI daemon owns the engine,
/// there, as its engine is the one that reads it.
async fn set_decrypt_list(
    ctx: ProxyCtx,
    req: SetDecryptListRequest,
) -> Result<DecryptListSaved, RpcError> {
    if ctx.port().is_none()
        && let Some(owner) = ctx.other_owner()
    {
        return ControlClient::new(owner).set_decrypt_list(&req.entries).await.map_err(rpc_error);
    }
    blocking(move || ctx.set_decrypt_list(&req.entries)).await
}

/// [`set_decrypt_list`], adding and removing entries rather than replacing them all.
async fn edit_decrypt_list(
    ctx: ProxyCtx,
    req: EditDecryptListRequest,
) -> Result<DecryptListSaved, RpcError> {
    if ctx.port().is_none()
        && let Some(owner) = ctx.other_owner()
    {
        return ControlClient::new(owner).edit_decrypt_list(&req).await.map_err(rpc_error);
    }
    blocking(move || ctx.edit_decrypt_list(&req.add, &req.remove)).await
}

async fn list_seen(ctx: ProxyCtx, _req: ListSeenRequest) -> Result<flows::SeenTargets, RpcError> {
    let db = ctx.db()?;
    blocking(move || flows::seen(&db)).await
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
    if flow.is_handshake_only() {
        return Err(rpc_error(NOT_A_REQUEST));
    }
    let limit = settings(&ctx)?.capture_body_limit;
    let body = bodies::read_body(&ctx.db()?, &ctx.blobs()?, &flow, FlowBody::Request, limit)
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
        Some(ids) => ids.iter().map(|id| flows::get(&ctx.db()?, id)).collect::<Result<Vec<_>, _>>(),
        None => {
            let filter = flows::FlowFilter { limit: None, ..req.filter.unwrap_or_default() };
            flows::list(&ctx.db()?, &filter)
        }
    }
    .map_err(rpc_error)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let har = har::export(&ctx.db()?, &ctx.blobs()?, &flows, limit).await.map_err(rpc_error)?;
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
    let body = bodies::read_body_or_raw(&ctx.db()?, &ctx.blobs()?, &flow, req.which, limit)
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
    let body = bodies::read_body_or_raw(&ctx.db()?, &ctx.blobs()?, &flow, req.which, limit)
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
    let body = bodies::read_body(&ctx.db()?, &ctx.blobs()?, flow, which, limit)
        .await
        .map_err(rpc_error)?;
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

/// Asks macOS to trust the CA, whenever the app needs it, not only during setup. A cancelled
/// password prompt is a result, `cancelled`, not an error.
async fn ca_trust(ctx: ProxyCtx, _req: CaTrustRequest) -> Result<ca::CaTrustResult, RpcError> {
    ctx.trust_ca().await.map_err(rpc_error)
}

/// The addresses passed through after clients rejected the CA, in the engine that runs, here
/// or in the process that owns it.
async fn list_passthrough(
    ctx: ProxyCtx,
    _req: ListPassthroughRequest,
) -> Result<PassthroughResponse, RpcError> {
    if let Some(owner) = ctx.engine_elsewhere() {
        return ControlClient::new(owner).passthrough().await.map_err(rpc_error);
    }
    Ok(PassthroughResponse { addresses: ctx.passthrough() })
}

/// Intercepts one passed-through address again from its next connection on.
async fn forget_passthrough(
    ctx: ProxyCtx,
    req: ForgetPassthroughRequest,
) -> Result<ForgetPassthroughResponse, RpcError> {
    if let Some(owner) = ctx.engine_elsewhere() {
        return ControlClient::new(owner).forget_passthrough(&req).await.map_err(rpc_error);
    }
    ctx.forget_passthrough_request(&req).map_err(rpc_error)
}

/// The open tunnels the decrypt list would decrypt if their clients reconnected.
async fn list_reconnectable_tunnels(
    ctx: ProxyCtx,
    req: tunnels::TunnelScope,
) -> Result<Vec<tunnels::OpenTunnel>, RpcError> {
    if let Some(owner) = ctx.engine_elsewhere() {
        return ControlClient::new(owner).reconnectable_tunnels(&req).await.map_err(rpc_error);
    }
    blocking(move || ctx.reconnectable_tunnels(&req)).await
}

/// Closes tunnels so their clients reconnect, decrypted as the list now says.
async fn reconnect_tunnels(
    ctx: ProxyCtx,
    req: ReconnectTunnelsRequest,
) -> Result<ReconnectTunnelsResponse, RpcError> {
    if let Some(owner) = ctx.engine_elsewhere() {
        return ControlClient::new(owner).reconnect_tunnels(&req).await.map_err(rpc_error);
    }
    blocking(move || {
        let closed = ctx.reconnect_tunnels(req.ids.as_deref(), &req.scope)?;
        Ok::<_, String>(ReconnectTunnelsResponse { closed })
    })
    .await
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

/// A flow by id, with its number; not one that is cleared, though its row may wait to be
/// deleted.
fn find_flow(ctx: &ProxyCtx, flow_id: &str) -> Result<Flow, RpcError> {
    flows::get(&ctx.db()?, flow_id).map_err(rpc_error)
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
    let flows::Page { flows, total, matching, cursor } =
        flows::sorted_page(&ctx.db()?, &req).map_err(rpc_error)?;
    Ok(ListFlowsResponse { flows, total, matching, cursor })
}

async fn clear_flows(ctx: ProxyCtx, _req: ClearFlowsRequest) -> Result<usize, RpcError> {
    blocking(move || ctx.clear_flows()).await
}

fn query_schema(
    _ctx: &ProxyCtx,
    _req: QuerySchemaRequest,
) -> Result<QuerySchemaResponse, RpcError> {
    let schema = serde_json::to_value(query::schema()).map_err(rpc_error)?;
    Ok(QuerySchemaResponse { schema })
}

fn validate_query(
    _ctx: &ProxyCtx,
    req: ValidateQueryRequest,
) -> Result<Vec<query::QueryDiagnostic>, RpcError> {
    Ok(query::diagnostics(&req.query))
}

async fn query_values(ctx: ProxyCtx, req: QueryValuesRequest) -> Result<Vec<String>, RpcError> {
    blocking(move || query::seen_values(&ctx.db()?, &req.path)).await
}

fn watch_query(ctx: &ProxyCtx, req: WatchQueryRequest) -> Result<bool, RpcError> {
    let hidden = query::Hidden { system: req.hide_system, encrypted: req.hide_encrypted };
    let watched = req.query.filter(|q| !q.trim().is_empty() || hidden != Default::default());
    ctx.live_search.watch(watched.map(|q| (req.key, q, hidden)));
    Ok(true)
}

async fn match_flows(ctx: ProxyCtx, req: MatchFlowsRequest) -> Result<Vec<String>, RpcError> {
    blocking(move || flows::matching_ids(&ctx.db()?, &req.filter, &req.ids)).await
}

fn list_saved_queries(
    ctx: &ProxyCtx,
    _req: ListSavedQueriesRequest,
) -> Result<Vec<saved_queries::SavedQuery>, RpcError> {
    saved_queries::list(&ctx.db()?).map_err(rpc_error)
}

fn create_saved_query(
    ctx: &ProxyCtx,
    req: CreateSavedQueryRequest,
) -> Result<saved_queries::SavedQuery, RpcError> {
    let saved = saved_queries::create(&ctx.db()?, &req.name, &req.query).map_err(rpc_error)?;
    ctx.events.emit("saved_queries_changed", &SavedQueriesChangedPayload {});
    Ok(saved)
}

fn rename_saved_query(
    ctx: &ProxyCtx,
    req: RenameSavedQueryRequest,
) -> Result<saved_queries::SavedQuery, RpcError> {
    let saved = saved_queries::rename(&ctx.db()?, &req.id, &req.name).map_err(rpc_error)?;
    ctx.events.emit("saved_queries_changed", &SavedQueriesChangedPayload {});
    Ok(saved)
}

fn delete_saved_query(ctx: &ProxyCtx, req: DeleteSavedQueryRequest) -> Result<bool, RpcError> {
    let deleted = saved_queries::delete(&ctx.db()?, &req.id).map_err(rpc_error)?;
    ctx.events.emit("saved_queries_changed", &SavedQueriesChangedPayload {});
    Ok(deleted)
}

async fn get_flows(ctx: ProxyCtx, req: GetFlowsRequest) -> Result<Vec<Flow>, RpcError> {
    blocking(move || {
        let db = ctx.db()?;
        Ok(req.ids.iter().filter_map(|id| flows::find(&db, id)).collect())
    })
    .await
}

fn list_filter_history(
    ctx: &ProxyCtx,
    _req: ListFilterHistoryRequest,
) -> Result<Vec<filter_history::FilterHistoryEntry>, RpcError> {
    filter_history::list(&ctx.db()?).map_err(rpc_error)
}

fn get_window_places(
    ctx: &ProxyCtx,
    _req: GetWindowPlacesRequest,
) -> Result<Option<String>, RpcError> {
    Ok(ctx.window_places.lock().unwrap_or_else(PoisonError::into_inner).clone())
}

fn set_window_places(ctx: &ProxyCtx, req: SetWindowPlacesRequest) -> Result<bool, RpcError> {
    *ctx.window_places.lock().unwrap_or_else(PoisonError::into_inner) = Some(req.places);
    Ok(true)
}

fn get_last_filter(ctx: &ProxyCtx, _req: GetLastFilterRequest) -> Result<String, RpcError> {
    filter_history::last(&ctx.db()?).map_err(rpc_error)
}

fn set_last_filter(ctx: &ProxyCtx, req: SetLastFilterRequest) -> Result<bool, RpcError> {
    filter_history::set_last(&ctx.db()?, &req.filter).map_err(rpc_error)?;
    Ok(true)
}

fn record_filter(ctx: &ProxyCtx, req: RecordFilterRequest) -> Result<bool, RpcError> {
    let recorded = filter_history::record(&ctx.db()?, &req.filter).map_err(rpc_error)?;
    if recorded {
        ctx.events.emit("filter_history_changed", &FilterHistoryChangedPayload {});
    }
    Ok(recorded)
}

fn delete_filter_history(
    ctx: &ProxyCtx,
    req: DeleteFilterHistoryRequest,
) -> Result<bool, RpcError> {
    let deleted = filter_history::delete(&ctx.db()?, &req.filter).map_err(rpc_error)?;
    ctx.events.emit("filter_history_changed", &FilterHistoryChangedPayload {});
    Ok(deleted)
}

fn clear_filter_history(
    ctx: &ProxyCtx,
    _req: ClearFilterHistoryRequest,
) -> Result<usize, RpcError> {
    let cleared = filter_history::clear(&ctx.db()?).map_err(rpc_error)?;
    ctx.events.emit("filter_history_changed", &FilterHistoryChangedPayload {});
    Ok(cleared)
}

async fn count_saved_queries(
    ctx: ProxyCtx,
    req: CountSavedQueriesRequest,
) -> Result<Vec<saved_queries::SavedQueryCount>, RpcError> {
    let hidden = query::Hidden { system: req.hide_system, encrypted: req.hide_encrypted };
    blocking(move || saved_queries::counts(&ctx.db()?, hidden)).await
}

// -- Event loop --

/// Why the engine cannot be taken over from another app.
pub const ANOTHER_APP_OWNS: &str =
    "Another Yaak Proxy window owns the engine. Quit it to use this one.";

/// How long taking over waits for the owner to let go of the engine.
const TAKE_OVER_WAIT: Duration = Duration::from_secs(10);

/// The CA's private key, encrypted with the data key.
struct CaKeyCipher(DataKey);

impl KeyCipher for CaKeyCipher {
    fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        self.0.encrypt(data).map_err(|e| e.to_string())
    }

    fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        self.0.decrypt(data).map_err(|e| e.to_string())
    }
}

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

/// Why a tunnel still open when the engine stopped ended.
const STOPPED_MID_TUNNEL: &str = "Yaak Proxy stopped before the connection closed";

/// Why a failed handshake's flow can't be saved as a request.
pub(crate) const NOT_A_REQUEST: &str =
    "Not a request: the client's TLS handshake failed before it sent one";

/// The error of a flow recording a client's refusal of the proxy's certificate.
const REJECTED_CERTIFICATE: &str = "Rejected the proxy's certificate";

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
    /// The request body's first bytes, while it may be a GraphQL request whose operation is
    /// read once it is whole. None once it can't be: not JSON, encoded, or too long.
    graphql_scan: Option<Vec<u8>>,
}

/// Most request body bytes read for a GraphQL operation; a longer body is not looked at.
const GRAPHQL_SCAN_LIMIT: usize = 64 * 1024;

impl InFlight {
    /// Keeps a request body chunk for reading a GraphQL operation from, when the body may be
    /// one: JSON, not encoded, and short. `len` is the chunk's size on the wire, `data` what of
    /// it was captured.
    fn scan_graphql(&mut self, first: bool, len: usize, data: &[u8]) {
        if first {
            let headers = &self.flow.request_headers;
            let json = find_header(headers, "content-type")
                .and_then(|t| t.split(';').next())
                .is_some_and(|t| t.trim().eq_ignore_ascii_case("application/json"));
            let encoded = find_header(headers, "content-encoding")
                .is_some_and(|e| !e.trim().eq_ignore_ascii_case("identity"));
            let stream = self.flow.stream_kind.is_some();
            self.graphql_scan = (json && !encoded && !stream).then(Vec::new);
        }
        let Some(buf) = &mut self.graphql_scan else {
            return;
        };
        if data.len() < len || buf.len() + len > GRAPHQL_SCAN_LIMIT {
            self.graphql_scan = None;
            return;
        }
        buf.extend_from_slice(data);
    }

    /// Reads the GraphQL operation from the request body kept by [`Self::scan_graphql`].
    fn finish_graphql_scan(&mut self) {
        let Some(body) = self.graphql_scan.take() else {
            return;
        };
        let content_type = find_header(&self.flow.request_headers, "content-type");
        if let Some(op) =
            yaak_http::graphql::detect(&self.flow.method, &self.flow.url, content_type, Some(&body))
        {
            self.flow.graphql_operation = Some(op.label());
        }
    }

    /// Stops writing the bodies its stream's messages carry, which are read back from them.
    /// A request's bytes are kept while it uploads, as a call can end before its upload does,
    /// with a message still partway in: they are dropped once the upload ends, or kept as its
    /// record, cut, when the flow ends first.
    fn drop_message_bodies(&mut self) {
        if bodies::from_messages(&self.flow, FlowBody::Response) {
            self.response_body = None;
        }
    }

    /// Its bytes on the wire are its record, as for any body that isn't a stream's messages, an
    /// encoded one included. Their cut at the capture limit is then the body's.
    fn keeps_bytes(&self, which: FlowBody) -> bool {
        !bodies::from_messages(&self.flow, which)
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
    /// The search the app shows, which each flow written is matched against.
    live_search: Arc<query::LiveSearch>,
    attribution: Attribution,
    recording: Arc<Mutex<RecordingLog>>,
    /// Flows that have ended, waiting to be written together.
    finished: std::cell::RefCell<FinishedFlows>,
    /// What a batch's wait is timed by.
    clock: BatchClock,
    /// The open tunnels, kept for this engine's run whether or not flows are recorded.
    tunnels: Arc<tunnels::OpenTunnels>,
    tunnel_run: u64,
    /// The engine, for its pass-through set as it changes. Weak, so the loop never keeps alive
    /// the engine whose events it waits for.
    handle: Weak<Mutex<Option<ProxyHandle>>>,
    /// The flow recorded for each refused handshake, by the engine's id for it, for the tunnels
    /// passed through after it to name.
    rejections: std::cell::RefCell<HashMap<u64, String>>,
}

/// What the event loop times a batch's wait by: the time, or in tests a time that stands still,
/// so a batch is written only once no events wait or it is full.
#[derive(Debug, Clone, Copy, Default)]
enum BatchClock {
    #[default]
    Real,
    #[cfg(test)]
    Stopped(std::time::Instant),
}

impl BatchClock {
    fn now(self) -> std::time::Instant {
        match self {
            Self::Real => std::time::Instant::now(),
            #[cfg(test)]
            Self::Stopped(at) => at,
        }
    }
}

/// Flows that have ended and are yet to be written, with when the first of them ended. Each
/// commit encrypts every page it writes, so flows ending together share one: a batch is
/// written once no more events are waiting, or it reaches [`FLOW_BATCH`], or its first flow
/// has waited [`FLOW_BATCH_WAIT`]. What an engine that crashes loses with it is the batch
/// open then, as it loses the events still queued and the flows still in flight.
#[derive(Default)]
struct FinishedFlows {
    flows: Vec<FinishedFlow>,
    since: Option<std::time::Instant>,
}

struct FinishedFlow {
    flow: Flow,
    persisted: bool,
    /// The last chunk of each of its bodies, written with the batch.
    chunks: Vec<yaak_models::blob_manager::BodyChunk>,
}

/// Flows written in one transaction at most.
const FLOW_BATCH: usize = 50;

/// The longest a flow that has ended waits for others to be written with, while events keep
/// coming. Alone, it is written at once.
const FLOW_BATCH_WAIT: Duration = Duration::from_millis(20);

fn run_event_loop(rx: std::sync::mpsc::Receiver<ProxyEvent>, sink: FlowSink) {
    use std::sync::mpsc::{RecvTimeoutError, TryRecvError};
    let mut in_flight: HashMap<u64, InFlight> = HashMap::new();
    let mut pending: Vec<PendingMessage> = Vec::new();
    let mut last_due_check = std::time::Instant::now();

    loop {
        // Messages are written once no more are waiting, or a batch is full; flows changed by
        // them once their interval is up.
        // Flows that have ended likewise, so under load many share a transaction, and one
        // that comes alone is written at once.
        let event = if !pending.is_empty() || sink.has_finished() {
            match rx.try_recv() {
                Ok(event) => event,
                Err(TryRecvError::Empty) => {
                    let _gate = exit_gate::hold();
                    sink.write_messages(&mut in_flight, &mut pending);
                    sink.write_finished();
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
                    let _gate = exit_gate::hold();
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
        // Only while writing, not while waiting for an event above.
        let _gate = exit_gate::hold();
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
        // Traffic that never lets up never empties the queue, so a batch is written once it
        // is full or its first flow has waited long enough.
        if sink.finished_due() {
            sink.write_finished();
        }
        // Traffic that never lets up never empties the queue, so flows due to be written are
        // looked for here too, every so often, their messages written first.
        if last_due_check.elapsed() >= DUE_CHECK_INTERVAL {
            last_due_check = std::time::Instant::now();
            sink.write_messages(&mut in_flight, &mut pending);
            sink.write_due_flows(&mut in_flight);
        }
    }

    let _gate = exit_gate::hold();
    sink.write_messages(&mut in_flight, &mut pending);
    // The engine stopped: a stream still open ends with it. Other flows in flight are dropped,
    // as they always have been. Every flow that ended is written.
    for (_, mut f) in in_flight.drain() {
        if f.persisted {
            let why = if f.flow.tunnelled { STOPPED_MID_TUNNEL } else { STOPPED_MID_STREAM };
            f.flow.error = Some(why.to_string());
            sink.finish_flow(f);
        }
    }
    sink.write_finished();
    sink.tunnels.end_run(sink.tunnel_run);
    // Its hold on the databases goes before the gate opens again.
    drop(sink);
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
                // GraphQL over GET is all in its URL; a body's operation is read once it is whole.
                let graphql_operation = method
                    .eq_ignore_ascii_case("GET")
                    .then(|| yaak_http::graphql::detect(&method, &url, None, None))
                    .flatten()
                    .map(|op| op.label());
                let flow = Flow {
                    id: flow_id,
                    started_at: DateTime::<Utc>::from(started_at).naive_utc(),
                    method,
                    url,
                    client_http_version: http_version,
                    client_addr: Some(client_addr.to_string()),
                    graphql_operation,
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
                        graphql_scan: None,
                    },
                );
            }
            ProxyEvent::TunnelStart {
                id,
                started_at,
                authority,
                host,
                port,
                connection,
                client_addr,
                reason,
            } => {
                attribution.begin(connection, client_addr);
                let recorded = recording.lock().map(|r| r.was_on_at(started_at)).unwrap_or(true);
                let flow_id = recorded.then(Flow::generate_id);
                let (tunnel_reason, excluded_by, excluded_built_in, rejected_by) = match reason {
                    yaak_proxy::TunnelReason::NotListed => {
                        (TunnelReason::NotListed, None, false, None)
                    }
                    yaak_proxy::TunnelReason::Excluded { entry, built_in } => {
                        (TunnelReason::Excluded, Some(entry), built_in, None)
                    }
                    yaak_proxy::TunnelReason::Rejected { rejected_by } => {
                        let flow = self.rejections.borrow().get(&rejected_by).cloned();
                        (TunnelReason::Rejected, None, false, flow)
                    }
                };
                // Kept paused too, so it can be closed for a reconnect.
                let mut open = tunnels::OpenTunnel {
                    id: String::new(),
                    engine_id: id,
                    host,
                    port,
                    app_name: None,
                    app_bundle_id: None,
                    flow_id: flow_id.clone(),
                    reason: tunnel_reason,
                };
                if let Some(app) = attribution.get(connection, Duration::ZERO) {
                    tunnels::set_app(&mut open, app);
                }
                self.tunnels.open(self.tunnel_run, open, connection);
                let Some(flow_id) = flow_id else {
                    return;
                };
                let flow = Flow {
                    id: flow_id,
                    started_at: DateTime::<Utc>::from(started_at).naive_utc(),
                    method: "CONNECT".to_string(),
                    url: format!("https://{authority}"),
                    client_http_version: "HTTP/1.1".to_string(),
                    client_addr: Some(client_addr.to_string()),
                    tunnelled: true,
                    tunnel_reason: Some(tunnel_reason),
                    tunnel_excluded_by: excluded_by,
                    tunnel_excluded_built_in: excluded_built_in,
                    tunnel_rejected_by: rejected_by,
                    ..Default::default()
                };
                let mut f = InFlight {
                    flow,
                    connection,
                    request_body: None,
                    response_body: None,
                    persisted: false,
                    cleared: false,
                    next_seq: 0,
                    dirty: false,
                    last_write: None,
                    graphql_scan: None,
                };
                // Shown while it is open, as tunnels often stay open for minutes.
                self.write_stream_flow(&mut f);
                in_flight.insert(id, f);
            }
            ProxyEvent::TunnelEnd {
                id,
                sent,
                received,
                elapsed_ms,
                error,
                reconnect_requested,
            } => {
                self.tunnels.close(self.tunnel_run, id);
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.request_size = sent as i64;
                    f.flow.response_size = received as i64;
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = error;
                    f.flow.reconnect_requested = reconnect_requested;
                    self.finish_flow(f);
                }
            }
            ProxyEvent::HandshakeFailed {
                id,
                started_at,
                authority,
                connection,
                client_addr,
                rejection,
                error,
                elapsed_ms,
            } => {
                // Whether or not it is recorded, the pass-through set has changed.
                let addresses = self
                    .handle
                    .upgrade()
                    .and_then(|handle| {
                        let handle = handle.lock().ok()?;
                        handle.as_ref().map(ProxyHandle::passthrough)
                    })
                    .unwrap_or_default();
                self.events.emit("passthrough_changed", &PassthroughChangedPayload { addresses });
                if !recording.lock().map(|r| r.was_on_at(started_at)).unwrap_or(true) {
                    return;
                }
                attribution.begin(connection, client_addr);
                let error = match &rejection {
                    Some(_) => REJECTED_CERTIFICATE.to_string(),
                    None => format!("TLS handshake failed: {error}"),
                };
                let flow = Flow {
                    id: Flow::generate_id(),
                    started_at: DateTime::<Utc>::from(started_at).naive_utc(),
                    url: format!("https://{authority}"),
                    client_http_version: "HTTP/1.1".to_string(),
                    client_addr: Some(client_addr.to_string()),
                    elapsed_ms: Some(clamp_ms(elapsed_ms)),
                    tls_rejected: rejection,
                    error: Some(error),
                    ..Default::default()
                };
                self.rejections.borrow_mut().insert(id, flow.id.clone());
                self.finish_flow(InFlight {
                    flow,
                    connection,
                    request_body: None,
                    response_body: None,
                    persisted: false,
                    cleared: false,
                    next_seq: 0,
                    dirty: false,
                    last_write: None,
                    graphql_scan: None,
                });
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
                    f.scan_graphql(f.flow.request_size == 0, len, &data);
                    f.flow.request_size += len as i64;
                    if f.keeps_bytes(FlowBody::Request) {
                        f.flow.request_truncated |= data.len() < len;
                    }
                    write_body_chunk(&mut f.request_body, &data);
                    f.changed();
                }
            }
            ProxyEvent::RequestBodyComplete { id, size, truncated, elapsed_ms } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_size = size as i64;
                    f.flow.elapsed_request_ms = Some(clamp_ms(elapsed_ms));
                    f.finish_graphql_scan();
                    if f.keeps_bytes(FlowBody::Request) {
                        f.flow.request_truncated = truncated;
                        finish_body(f.request_body.take());
                    } else if f.request_body.take().is_some() {
                        // The upload ended whole, its messages its record: its bytes go.
                        let body_id = Flow::body_id(&f.flow.id, FlowBody::Request);
                        if let Err(e) = blobs.with_tx(|b| b.delete_chunks(&body_id)) {
                            warn!("Failed to delete a stream's request bytes: {e}");
                        }
                    }
                    f.changed();
                }
            }
            ProxyEvent::UpstreamConnection {
                id,
                elapsed_connect_ms,
                elapsed_tls_ms,
                tls_version,
                tls_cipher,
            } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.elapsed_connect_ms = elapsed_connect_ms.map(clamp_ms);
                    f.flow.elapsed_tls_ms = elapsed_tls_ms.map(clamp_ms);
                    f.flow.upstream_tls_version = tls_version;
                    f.flow.upstream_tls_cipher = tls_cipher;
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
                    if f.keeps_bytes(FlowBody::Response) {
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
                    if f.keeps_bytes(FlowBody::Response) {
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
            flow.client_cwd = app.cwd;
        }
        let persisted = f.persisted;
        let written = self.db.with_tx(|ctx| self.write_flow(ctx, flow, persisted));
        match written {
            Ok(true) => f.persisted = true,
            Ok(false) => self.stop_cleared(f),
            Err(e) => warn!("Failed to write proxy flow: {e}"),
        }
    }

    /// Puts a flow that has ended, with the rest of its bodies, in the batch to be written.
    fn finish_flow(&self, mut f: InFlight) {
        // Ended while its upload still went on: what came of it is kept, cut.
        let upload_cut = bodies::from_messages(&f.flow, FlowBody::Request)
            && f.request_body.is_some()
            && f.flow.request_size > 0;
        f.flow.request_truncated |= upload_cut;
        if f.cleared {
            // Nothing more of it is kept, so its bodies are not finished.
            drop((f.request_body, f.response_body));
            self.forget_cleared(&f.flow.id);
            return;
        }
        let chunks = [f.request_body, f.response_body]
            .into_iter()
            .flatten()
            .filter_map(BodyChunkWriter::finish_deferred)
            .collect();

        let mut flow = f.flow;
        flow.content_type = find_header(&flow.response_headers, "content-type").map(String::from);
        if let Some(app) = self.attribution.get(f.connection, ATTRIBUTION_WAIT) {
            flow.client_pid = Some(app.pid);
            flow.client_name = Some(app.name);
            flow.client_bundle_id = app.bundle_id;
            flow.client_path = Some(app.path);
            flow.client_cwd = app.cwd;
        }
        let mut finished = self.finished.borrow_mut();
        finished.since.get_or_insert_with(|| self.clock.now());
        finished.flows.push(FinishedFlow { flow, persisted: f.persisted, chunks });
    }

    fn has_finished(&self) -> bool {
        !self.finished.borrow().flows.is_empty()
    }

    /// The batch is full, or its first flow has waited long enough.
    fn finished_due(&self) -> bool {
        let finished = self.finished.borrow();
        finished.flows.len() >= FLOW_BATCH
            || finished
                .since
                .is_some_and(|t| self.clock.now().saturating_duration_since(t) >= FLOW_BATCH_WAIT)
    }

    /// Writes the flows that have ended: their bodies' last chunks in one transaction, then
    /// the flows in another, telling the app of each. Bodies first, so a flow the app hears of
    /// has its bodies. A flow that fails to write is rolled back alone, and a batch of bodies
    /// that fails is written again a body at a time, so one bad row loses no others.
    fn write_finished(&self) {
        let flows = {
            let mut finished = self.finished.borrow_mut();
            finished.since = None;
            std::mem::take(&mut finished.flows)
        };
        if flows.is_empty() {
            return;
        }

        let chunks: Vec<_> = flows.iter().flat_map(|f| f.chunks.iter()).collect();
        if !chunks.is_empty() {
            let stored = self.blobs.with_tx(|b| chunks.iter().try_for_each(|c| b.insert_chunk(c)));
            if let Err(e) = stored {
                warn!("Failed to store proxy body chunks together, so each alone: {e}");
                for chunk in &chunks {
                    if let Err(e) = self.blobs.with_tx(|b| b.insert_chunk(chunk)) {
                        warn!("Failed to store proxy body chunk: {e}");
                    }
                }
            }
        }

        let mut cleared = Vec::new();
        let written = self.db.with_tx(|ctx| {
            let conn = ctx.conn().resolve();
            for FinishedFlow { flow, persisted, .. } in flows {
                let id = flow.id.clone();
                conn.execute_batch("SAVEPOINT finished_flow")?;
                match self.write_flow(ctx, flow, persisted) {
                    Ok(true) => conn.execute_batch("RELEASE finished_flow")?,
                    Ok(false) => {
                        conn.execute_batch("RELEASE finished_flow")?;
                        cleared.push(id);
                    }
                    Err(e) => {
                        warn!("Failed to write proxy flow: {e}");
                        conn.execute_batch("ROLLBACK TO finished_flow; RELEASE finished_flow")?;
                    }
                }
            }
            Ok::<_, yaak_database::Error>(())
        });
        if let Err(e) = written {
            warn!("Failed to write proxy flows: {e}");
        }
        for id in cleared {
            self.forget_cleared(&id);
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
            // Not one cleared since, whose row may wait to be deleted.
            let Some(stored) = flows::find_in(ctx.conn().resolve(), &flow.id) else {
                return Ok(false);
            };
            flow.saved_request_id = stored.saved_request_id;
        }
        let (saved, created) = ctx.upsert(&flow, &UpdateSource::Background)?;
        // Sent while this holds the writer, before the commit, so a clear's event, sent after
        // its own commit, always comes after it.
        self.events.emit("model_write", &self.live_search.payload(saved, created));
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

/// The flow is stored and not cleared: a cleared one's row may wait to be deleted.
fn flow_exists(conn: &rusqlite::Connection, flow_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM flows WHERE id = ?1 AND rowid > ?2",
        rusqlite::params![flow_id, flows::clear_mark(conn)],
        |_| Ok(()),
    )
    .is_ok()
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
        get_decrypt_list(GetDecryptListRequest) -> DecryptList,
        get_message_payload(GetMessagePayloadRequest) -> GetMessagePayloadResponse,
        list_actions(ListActionsRequest) -> ListActionsResponse,
        list_flows(flows::FlowFilter) -> ListFlowsResponse,
        query_schema(QuerySchemaRequest) -> QuerySchemaResponse,
        validate_query(ValidateQueryRequest) -> Vec<query::QueryDiagnostic>,
        watch_query(WatchQueryRequest) -> bool,
        list_saved_queries(ListSavedQueriesRequest) -> Vec<saved_queries::SavedQuery>,
        create_saved_query(CreateSavedQueryRequest) -> saved_queries::SavedQuery,
        rename_saved_query(RenameSavedQueryRequest) -> saved_queries::SavedQuery,
        delete_saved_query(DeleteSavedQueryRequest) -> bool,
        list_filter_history(ListFilterHistoryRequest) -> Vec<filter_history::FilterHistoryEntry>,
        record_filter(RecordFilterRequest) -> bool,
        delete_filter_history(DeleteFilterHistoryRequest) -> bool,
        clear_filter_history(ClearFilterHistoryRequest) -> usize,
        get_last_filter(GetLastFilterRequest) -> String,
        set_last_filter(SetLastFilterRequest) -> bool,
        get_window_places(GetWindowPlacesRequest) -> Option<String>,
        set_window_places(SetWindowPlacesRequest) -> bool,
        list_grpc_schemas(ListGrpcSchemasRequest) -> Vec<GrpcSchema>,
        list_messages(ListMessagesRequest) -> ListMessagesResponse,
        remove_grpc_schema(RemoveGrpcSchemaRequest) -> bool,
        set_recording(SetRecordingRequest) -> bool,
        set_system_proxy_at_launch(SetSystemProxyAtLaunchRequest) -> bool,
        set_http_version(SetHttpVersionRequest) -> HttpVersion,
        set_capture_body_limit(SetCaptureBodyLimitRequest) -> usize,
        set_traffic(SetTrafficRequest) -> TrafficRetention,
        set_keep_traffic(SetKeepTrafficRequest) -> Option<usize>,
    }
    async_commands {
        add_grpc_schema(AddGrpcSchemaRequest) -> GrpcSchema,
        app_icon(AppIconRequest) -> Option<String>,
        ca_status(CaStatusRequest) -> CaStatus,
        ca_trust(CaTrustRequest) -> ca::CaTrustResult,
        forget_passthrough(ForgetPassthroughRequest) -> ForgetPassthroughResponse,
        list_passthrough(ListPassthroughRequest) -> PassthroughResponse,
        list_reconnectable_tunnels(tunnels::TunnelScope) -> Vec<tunnels::OpenTunnel>,
        reconnect_tunnels(ReconnectTunnelsRequest) -> ReconnectTunnelsResponse,
        clear_flows(ClearFlowsRequest) -> usize,
        decode_grpc_message(DecodeGrpcMessageRequest) -> DecodedGrpcMessage,
        export_har(ExportHarRequest) -> usize,
        filter_body(FilterBodyRequest) -> FilterBodyResponse,
        get_flow_body(GetFlowBodyRequest) -> GetFlowBodyResponse,
        get_proxy_state(GetProxyStateRequest) -> GetProxyStateResponse,
        helper_register(HelperRegisterRequest) -> SystemProxyStatus,
        helper_unregister(HelperUnregisterRequest) -> SystemProxyStatus,
        edit_decrypt_list(EditDecryptListRequest) -> DecryptListSaved,
        list_seen(ListSeenRequest) -> flows::SeenTargets,
        set_decrypt_list(SetDecryptListRequest) -> DecryptListSaved,
        list_workspaces(ListWorkspacesRequest) -> ListWorkspacesResponse,
        preview_save(PreviewSaveRequest) -> SavePreview,
        reflect_grpc_host(ReflectGrpcHostRequest) -> GrpcSchema,
        save_flow(SaveFlowToYaakRequest) -> SavedFlow,
        save_flow_body(SaveFlowBodyRequest) -> SaveFlowBodyResponse,
        system_proxy_set(SystemProxySetRequest) -> SystemProxyStatus,
        system_proxy_status(SystemProxyStatusRequest) -> SystemProxyStatus,
        take_over(TakeOverRequest) -> bool,
        set_port(SetPortRequest) -> u16,
        get_storage_size(GetStorageSizeRequest) -> GetStorageSizeResponse,
        reset_captured_data(ResetCapturedDataRequest) -> bool,
        open_terminal(OpenTerminalRequest) -> bool,
        query_values(QueryValuesRequest) -> Vec<String>,
        match_flows(MatchFlowsRequest) -> Vec<String>,
        get_flows(GetFlowsRequest) -> Vec<Flow>,
        count_saved_queries(CountSavedQueriesRequest) -> Vec<saved_queries::SavedQueryCount>,
    }
    events {
        decrypt_list_changed(DecryptListChangedPayload),
        filter_history_changed(FilterHistoryChangedPayload),
        flows_cleared(FlowsClearedPayload),
        flows_removed(FlowsRemovedPayload),
        message_write(MessagePayload),
        model_write(ModelPayload),
        passthrough_changed(PassthroughChangedPayload),
        proxy_state_changed(ProxyStatePayload),
        saved_queries_changed(SavedQueriesChangedPayload),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// While set, [`ProxyCtx::reconnect_tunnels`] says when it has looked up what to close and
    /// waits, up to a time, to be let go, so a test can restart the engine in between.
    static BETWEEN_LOOKUP_AND_CLOSE: Mutex<
        Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
    > = Mutex::new(None);

    pub(super) fn pause_between_lookup_and_close() {
        let pause = BETWEEN_LOOKUP_AND_CLOSE.lock().unwrap().take();
        if let Some((reached, go)) = pause {
            let _ = reached.send(());
            let _ = go.recv_timeout(Duration::from_secs(10));
        }
    }

    /// A CONNECT tunnel through the engine on `port` to `target`, its bytes crossing both ways.
    async fn open_tunnel(port: u16, target: &str) -> tokio::net::TcpStream {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let connect = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n");
        tcp.write_all(connect.as_bytes()).await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(tcp.read_u8().await.unwrap());
        }
        assert!(head.starts_with(b"HTTP/1.1 200"), "{}", String::from_utf8_lossy(&head));
        assert!(still_open(&mut tcp).await, "the tunnel did not relay");
        tcp
    }

    /// Whether `tcp` still relays: a ping comes back, rather than the connection ending.
    async fn still_open(tcp: &mut tokio::net::TcpStream) -> bool {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut echoed = [0u8; 4];
        tcp.write_all(b"ping").await.is_ok() && tcp.read_exact(&mut echoed).await.is_ok()
    }

    async fn spawn_echo() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut tcp, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let (mut read, mut write) = tcp.split();
                    let _ = tokio::io::copy(&mut read, &mut write).await;
                });
            }
        });
        port
    }

    async fn wait_for_open_tunnels(ctx: &ProxyCtx, n: usize) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while ctx.tunnels.list().len() != n {
            assert!(std::time::Instant::now() < deadline, "{:?}", ctx.tunnels.list());
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// An engine restart between finding what to close and closing it can't close a tunnel of
    /// the new run, though the new run numbers its tunnels from 1 again: Greptile's "Reconnect
    /// closes the wrong tunnel" on #835.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_restart_between_lookup_and_close_closes_nothing_of_the_new_run() {
        let dir = tempfile::tempdir().unwrap();
        let settings =
            ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
        settings.save(&dir.path().join("settings.json")).unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        ctx.start().unwrap();
        let echo = spawn_echo().await;
        // The address the echo listens on, not `localhost`, which Windows tries as `::1` first
        // and takes seconds to give up on.
        let target = format!("127.0.0.1:{echo}");
        let host = "host:127.0.0.1".to_string();

        // Run 1: one tunnel, listed as reconnectable once the list names its host.
        let mut old = open_tunnel(ctx.port().unwrap(), &target).await;
        ctx.edit_decrypt_list(std::slice::from_ref(&host), &[]).unwrap();
        wait_for_open_tunnels(&ctx, 1).await;
        let listed = ctx.reconnectable_tunnels(&tunnels::TunnelScope::default()).unwrap();
        let ids: Vec<String> = listed.iter().map(|t| t.id.clone()).collect();
        assert_eq!((ids.len(), listed[0].engine_id), (1, 1));

        // Reconnect pauses once it has looked up what to close.
        let (reached_tx, reached_rx) = std::sync::mpsc::channel();
        let (go_tx, go_rx) = std::sync::mpsc::channel();
        *BETWEEN_LOOKUP_AND_CLOSE.lock().unwrap() = Some((reached_tx, go_rx));
        let reconnecting = {
            let ctx = ctx.clone();
            tokio::task::spawn_blocking(move || {
                ctx.reconnect_tunnels(Some(&ids), &tunnels::TunnelScope::default())
            })
        };
        tokio::task::spawn_blocking(move || reached_rx.recv().unwrap()).await.unwrap();

        // Then the engine restarts, and the new run's first tunnel is number 1 too. While the
        // reconnect holds the engine's lock, a restart would wait for it, so it is let go
        // first; were the lock not held, the restart and the new tunnel land in between.
        let holds_engine = ctx.handle.try_lock().is_err();
        if holds_engine {
            go_tx.send(()).unwrap();
        }
        let restarting = ctx.clone();
        tokio::task::spawn_blocking(move || {
            restarting.stop().unwrap();
            restarting.edit_decrypt_list(&[], std::slice::from_ref(&host)).unwrap();
            restarting.start().unwrap();
        })
        .await
        .unwrap();
        let mut new = open_tunnel(ctx.port().unwrap(), &target).await;
        wait_for_open_tunnels(&ctx, 1).await;
        assert_eq!(ctx.tunnels.list()[0].engine_id, 1, "the new run's first tunnel");
        if !holds_engine {
            go_tx.send(()).unwrap();
        }

        let closed = reconnecting.await.unwrap().unwrap();
        assert!(still_open(&mut new).await, "the new run's tunnel was closed");
        assert!(!still_open(&mut old).await, "the old run's tunnel outlived its engine");
        assert!(holds_engine, "looked up without the engine's lock held");
        assert_eq!(closed, 1, "the old run's tunnel, closed in its own run");
    }

    /// An owner from before the count answers a forwarded save without it.
    #[test]
    fn a_saved_list_from_an_older_owner_reads_without_its_count() {
        let saved: DecryptListSaved = serde_json::from_str(r#"{"entries": []}"#).unwrap();
        assert_eq!((saved.list.entries.len(), saved.still_encrypted), (0, 0));
    }

    #[test]
    fn passthrough_addresses_as_the_engine_keys_them() {
        assert_eq!(passthrough_address("a.com").as_deref(), Some("a.com:443"));
        assert_eq!(passthrough_address(" a.com:8443 ").as_deref(), Some("a.com:8443"));
        assert_eq!(passthrough_address("[::1]").as_deref(), Some("[::1]:443"));
        assert_eq!(passthrough_address("[::1]:8443").as_deref(), Some("[::1]:8443"));
        assert_eq!(passthrough_address("::1").as_deref(), Some("[::1]:443"));
        assert_eq!(passthrough_address(""), None);
        assert_eq!(passthrough_address("a.com:http"), None);
        assert_eq!(passthrough_address("[]"), None);
    }

    #[test]
    fn settings_the_password_prompt_parked_keep_it_over_the_helper() {
        use yaak_proxy_helper::networksetup::{ProxySetting, ServiceProxy, Snapshot};
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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
        event_loop_timed(ctx, BatchClock::Real)
    }

    /// [`event_loop`], its batches timed by `clock`.
    fn event_loop_timed(
        ctx: &ProxyCtx,
        clock: BatchClock,
    ) -> (std::sync::mpsc::Sender<ProxyEvent>, std::thread::JoinHandle<()>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let sink = sink(ctx);
        let sink = FlowSink { clock, ..sink };
        (tx, std::thread::spawn(move || run_event_loop(rx, sink)))
    }

    fn sink(ctx: &ProxyCtx) -> FlowSink {
        FlowSink {
            db: ctx.db().unwrap(),
            blobs: ctx.blobs().unwrap(),
            events: ctx.events.clone(),
            live_search: ctx.live_search.clone(),
            attribution: Attribution::new(0),
            recording: ctx.recording.clone(),
            finished: Default::default(),
            clock: BatchClock::Real,
            tunnels: ctx.tunnels.clone(),
            tunnel_run: ctx.tunnels.begin_run(None),
            handle: Arc::downgrade(&ctx.handle),
            rejections: Default::default(),
        }
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
            let flows = ctx.db().unwrap().with_conn(|c| c.find_all::<Flow>().unwrap());
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
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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
            elapsed_ms: 1,
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
            message.size = 11;
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

        let flow = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap().remove(0);
        assert_eq!((flow.message_count, flow.grpc_status), (3, Some(0)));
        assert_eq!((flow.request_size, flow.response_size), (10, 16), "sizes on the wire");
        assert_eq!((flow.request_truncated, flow.response_truncated), (false, true));
        let (db, blobs) = (ctx.db().unwrap(), ctx.blobs().unwrap());
        let stored = blobs.connect();
        assert!(!stored.body_exists(&Flow::body_id(&flow.id, FlowBody::Request)).unwrap());
        assert!(!stored.body_exists(&Flow::body_id(&flow.id, FlowBody::Response)).unwrap());

        let read = |which| bodies::read_body(&db, &blobs, &flow, which, 1 << 20);
        let request_body = read(FlowBody::Request).await.unwrap();
        assert_eq!((request_body.data.as_slice(), request_body.truncated), (&request[..], false));
        // HTTP/2 trailers are no part of the body.
        let response_body = read(FlowBody::Response).await.unwrap();
        // Framed with the length it was sent with, so it reads back as it was on the wire, cut.
        assert_eq!(response_body.data, b"\x00\x00\x00\x00\x0b\x0a\x09Hel");
        assert!(response_body.truncated);
        let har =
            har::export(&ctx.db().unwrap(), &ctx.blobs().unwrap(), &[flow], 1 << 20).await.unwrap();
        assert_eq!(har.log.entries[0].response.content.size, 10);
    }

    /// A gzipped event stream keeps its bytes as well as its events: they read back through the
    /// body's decoder, so one that decodes reads as its events did, and one that doesn't keeps
    /// its bytes and says why.
    #[tokio::test(flavor = "multi_thread")]
    async fn encoded_event_streams_keep_their_bytes() {
        use std::io::Write;
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let raw = "data: hi\n\n".to_string();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(raw.as_bytes()).unwrap();
        let gzip = bytes::Bytes::from(gzip.finish().unwrap());
        let bodies = [
            (1, "https://a.example.com/events", gzip),
            (
                2,
                "https://b.example.com/events",
                bytes::Bytes::from_static(b"\x1f\x8b not really gzip"),
            ),
        ];
        for (id, url, data) in bodies.clone() {
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
            tx.send(ProxyEvent::ResponseBodyChunk { id, len: data.len(), data }).unwrap();
        }
        // The first one's bytes decoded into an event; the second's never did.
        let event = K::SseEvent { event: None, id: None, retry: None, raw: raw.clone() };
        let mut message = ws_message(1, D::Server, event, b"hi");
        if let ProxyEvent::Message { message, .. } = &mut message {
            message.size = raw.len() as u64;
        }
        tx.send(message).unwrap();
        for (id, _, data) in bodies.clone() {
            tx.send(ProxyEvent::ResponseBodyComplete {
                id,
                size: data.len() as u64,
                truncated: false,
                elapsed_ms: 5,
                error: None,
                cancelled: false,
            })
            .unwrap();
        }
        drop(tx);
        event_loop.join().unwrap();

        let flows = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap();
        let flow = |host: &str| flows.iter().find(|f| f.url.contains(host)).unwrap().clone();
        let (decoded, undecoded) = (flow("a.example"), flow("b.example"));
        assert_eq!(decoded.message_count, 1);
        let (db, blobs) = (ctx.db().unwrap(), ctx.blobs().unwrap());
        let read = |flow| bodies::read_body_or_raw(&db, &blobs, flow, FlowBody::Response, 1024);
        let body = read(&decoded).await.unwrap();
        assert_eq!((body.data.as_slice(), body.decode_error), (raw.as_bytes(), None));
        let body = read(&undecoded).await.unwrap();
        assert_eq!(body.data, b"\x1f\x8b not really gzip");
        assert!(body.decode_error.is_some());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn encoded_grpc_bodies_that_never_decode_keep_their_bytes_and_cut() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let send = |event| tx.send(event).unwrap();
        let header = |name: &str, value: &str| (name.to_string(), value.to_string());
        send(ProxyEvent::RequestStart {
            id: 1,
            started_at: SystemTime::now(),
            method: "POST".into(),
            url: "https://api.example.com/pkg.Greeter/SayHello".into(),
            http_version: "HTTP/2.0".into(),
            connection: 1,
            client_addr: "127.0.0.1:1".parse().unwrap(),
        });
        for (name, value) in [
            header("content-type", "application/grpc"),
            header("content-encoding", "gzip"),
        ] {
            send(ProxyEvent::RequestHeader { id: 1, name, value });
        }
        send(ProxyEvent::StreamStart { id: 1, kind: yaak_proxy::StreamKind::Grpc });
        // Cut at the capture limit: 4 of 30 bytes kept.
        send(ProxyEvent::RequestBodyChunk {
            id: 1,
            len: 30,
            data: bytes::Bytes::from_static(b"junk"),
        });
        send(ProxyEvent::RequestBodyComplete { id: 1, size: 30, truncated: true, elapsed_ms: 1 });
        send(ProxyEvent::ResponseStart {
            id: 1,
            status: 200,
            http_version: "HTTP/2.0".into(),
            remote_addr: None,
            elapsed_ms: 1,
        });
        for (name, value) in [
            header("content-type", "application/grpc"),
            header("content-encoding", "gzip"),
        ] {
            send(ProxyEvent::ResponseHeader { id: 1, name, value });
        }
        send(ProxyEvent::ResponseBodyChunk {
            id: 1,
            len: 40,
            data: bytes::Bytes::from_static(b"\x1f\x8bnope"),
        });
        // The status came in the HTTP/2 trailers, not from the body's bytes.
        let trailers = K::GrpcTrailers { status: Some(0), message: None };
        send(ws_message(1, D::Server, trailers, b"grpc-status: 0\r\n"));
        send(ProxyEvent::ResponseBodyComplete {
            id: 1,
            size: 40,
            truncated: true,
            elapsed_ms: 5,
            error: None,
            cancelled: false,
        });
        drop(tx);
        event_loop.join().unwrap();

        let flow = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap().remove(0);
        assert_eq!((flow.request_truncated, flow.response_truncated), (true, true));
        for (which, kept) in [
            (FlowBody::Request, &b"junk"[..]),
            (FlowBody::Response, b"\x1f\x8bnope"),
        ] {
            // The bytes are kept, and read as a cut body is: what decoded of them, cut short.
            assert_eq!(
                bodies::read_raw_body(&ctx.blobs().unwrap(), &flow.id, which).unwrap(),
                kept
            );
            let body =
                bodies::read_body(&ctx.db().unwrap(), &ctx.blobs().unwrap(), &flow, which, 1024)
                    .await
                    .unwrap();
            assert!(body.truncated, "{which:?}");
        }
    }

    /// A call that ends while its upload still goes on keeps what came of the upload, cut; one
    /// whose upload ended whole keeps only its messages.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_grpc_upload_outlived_by_its_call_keeps_its_bytes() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let send = |event| tx.send(event).unwrap();
        send(ProxyEvent::RequestStart {
            id: 1,
            started_at: SystemTime::now(),
            method: "POST".into(),
            url: "https://api.example.com/pkg.Uploader/Upload".into(),
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
        // One whole message, and the start of the next.
        let uploaded = b"\x00\x00\x00\x00\x02\x08\x01\x00\x00\x00\x00\x0a\x0a\x08par";
        send(ProxyEvent::RequestBodyChunk {
            id: 1,
            len: uploaded.len(),
            data: bytes::Bytes::from_static(uploaded),
        });
        send(ws_message(1, D::Client, K::GrpcMessage, b"\x08\x01"));
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
            value: "application/grpc".into(),
        });
        // The server answers and ends the call before the upload is done.
        send(ProxyEvent::ResponseBodyComplete {
            id: 1,
            size: 0,
            truncated: false,
            elapsed_ms: 5,
            error: None,
            cancelled: false,
        });
        drop(tx);
        event_loop.join().unwrap();

        let flow = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap().remove(0);
        assert!(flow.request_truncated);
        let body = bodies::read_body(
            &ctx.db().unwrap(),
            &ctx.blobs().unwrap(),
            &flow,
            FlowBody::Request,
            1 << 20,
        )
        .await
        .unwrap();
        assert_eq!((body.data.as_slice(), body.truncated), (&uploaded[..], true));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn websocket_messages_are_stored_and_exported() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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

        let flow = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap().remove(0);
        assert_eq!((flow.elapsed_ms, flow.error.as_deref()), (Some(50), None));
        let stored = messages::list(&ctx.db().unwrap(), &flow.id, None, None).unwrap();
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
        assert_eq!(
            messages::payload(&ctx.db().unwrap(), &ctx.blobs().unwrap(), &stored[1]).unwrap(),
            big
        );
        assert!(ctx.blobs().unwrap().connect().body_exists(&stored[1].blob_id()).unwrap());
        assert!(!ctx.blobs().unwrap().connect().body_exists(&stored[0].blob_id()).unwrap());
        assert_eq!(
            messages::payload(&ctx.db().unwrap(), &ctx.blobs().unwrap(), &stored[0]).unwrap(),
            b"hi"
        );

        let har = har::export(
            &ctx.db().unwrap(),
            &ctx.blobs().unwrap(),
            std::slice::from_ref(&flow),
            1 << 20,
        )
        .await
        .unwrap();
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
        let body = bodies::read_body(
            &ctx.db().unwrap(),
            &ctx.blobs().unwrap(),
            &flow,
            FlowBody::Response,
            1 << 20,
        )
        .await
        .unwrap();
        assert_eq!((body.data.len(), body.note.as_deref()), (0, Some(bodies::WEBSOCKET_BODY_NOTE)));

        let names: Vec<_> = event_rx.try_iter().map(|e| e.event).collect();
        assert_eq!(names.iter().filter(|n| **n == "message_write").count(), 3, "{names:?}");

        // Gone from listings at once, and with its messages and their payloads once the
        // background delete has run.
        ctx.clear_flows().unwrap();
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 0);
        wait_for_cleared(&ctx);
        assert!(!ctx.blobs().unwrap().connect().body_exists(&stored[1].blob_id()).unwrap());
        let left: i64 = ctx.db().unwrap().with_conn(|c| {
            c.conn()
                .resolve()
                .query_row("SELECT count(*) FROM flow_messages", [], |r| r.get(0))
                .unwrap()
        });
        assert_eq!(left, 0);
    }

    /// Waits for the background delete a clear starts to finish.
    fn wait_for_cleared(ctx: &ProxyCtx) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while ctx.db().unwrap().with_conn(|c| flows::clear_mark(c.conn().resolve())) > 0 {
            assert!(std::time::Instant::now() < deadline, "cleared flows were not deleted");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn a_stream_cleared_while_open_stays_cleared() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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
        let blobs = ctx.blobs().unwrap().connect().list_body_ids().unwrap();
        assert!(blobs.iter().all(|b| !b.starts_with(&flow.id)), "while open: {blobs:?}");

        tx.send(ProxyEvent::StreamEnd { id: 1, elapsed_ms: 9, error: None }).unwrap();
        drop(tx);
        event_loop.join().unwrap();
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 0, "not brought back by its end");
        // The messages written before the clear go with the background delete.
        wait_for_cleared(&ctx);
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 0, "not brought back by its end");
        assert_eq!(messages::count(&ctx.db().unwrap(), &flow.id).unwrap(), 0);
        let blobs = ctx.blobs().unwrap().connect().list_body_ids().unwrap();
        assert!(blobs.iter().all(|b| !b.starts_with(&flow.id)), "{blobs:?}");
    }

    #[test]
    fn an_open_stream_is_written_while_events_never_let_up() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
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

    /// A stop that comes while a start waits for the databases, as it does through a
    /// conversion, wins: the start does not go on to capture.
    #[test]
    fn a_stop_while_starting_waits_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let settings =
            ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
        settings.save(&dir.path().join("settings.json")).unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();

        // Held as a conversion holds it, so the start waits.
        let unlocked = ctx.unlocked.lock().unwrap();
        let starting = std::thread::spawn({
            let ctx = ctx.clone();
            move || ctx.start()
        });
        std::thread::sleep(Duration::from_millis(100));
        ctx.stop().unwrap();
        drop(unlocked);
        starting.join().unwrap().unwrap();
        assert_eq!(ctx.port(), None);

        // A start after the stop starts.
        ctx.start().unwrap();
        assert!(ctx.port().is_some());
        ctx.stop().unwrap();
    }

    #[test]
    fn streams_still_open_end_when_the_engine_stops() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _event_rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        open_websocket(&tx, 1, "https://example.com/socket");
        wait_for_flow(&ctx, |f| f.stream_kind.is_some());
        drop(tx);
        event_loop.join().unwrap();
        let flow = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap().remove(0);
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
        ctx.db().unwrap().with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        let mut writer =
            BodyChunkWriter::new(ctx.blobs().unwrap(), Flow::body_id(id, FlowBody::Response));
        writer.write(body).unwrap();
        writer.finish().unwrap();
    }

    /// The filter reads the text the viewer shows: in the body's charset, not UTF-8 alone.
    #[tokio::test]
    async fn filter_reads_the_body_in_its_charset() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();

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

    /// A place the app goes back to reads its flow by id, which is gone once cleared.
    #[tokio::test]
    async fn get_flows_leaves_out_missing_and_cleared_flows() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        flow_with_response(&ctx, "fl_a", "text/plain", b"one");
        flow_with_response(&ctx, "fl_b", "text/plain", b"two");
        let ids = |flows: Vec<Flow>| flows.into_iter().map(|f| f.id).collect::<Vec<_>>();

        let req = GetFlowsRequest { ids: vec!["fl_b".into(), "fl_gone".into(), "fl_a".into()] };
        assert_eq!(ids(get_flows(ctx.clone(), req).await.unwrap()), ["fl_b", "fl_a"]);

        flows::clear(&ctx.db().unwrap()).unwrap();
        let req = GetFlowsRequest { ids: vec!["fl_a".into()] };
        assert!(get_flows(ctx.clone(), req).await.unwrap().is_empty());
    }

    /// The window's places are held for a reload of it, in memory, and none at launch.
    #[test]
    fn window_places_are_held_in_memory_for_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        assert_eq!(get_window_places(&ctx, GetWindowPlacesRequest {}).unwrap(), None);
        let places = r#"{"places":[{"filter":"stripe","selection":[],"tabs":{}}],"index":0}"#;
        set_window_places(&ctx, SetWindowPlacesRequest { places: places.into() }).unwrap();
        let held = get_window_places(&ctx.clone(), GetWindowPlacesRequest {}).unwrap();
        assert_eq!(held.as_deref(), Some(places));
        drop(ctx);

        let (events, _rx) = RpcEventEmitter::new();
        let next = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        assert_eq!(get_window_places(&next, GetWindowPlacesRequest {}).unwrap(), None);
    }

    /// Filters applied are listed newest first, each once, and the app hears of each change.
    #[test]
    fn filter_history_commands_record_list_and_forget() {
        let dir = tempfile::tempdir().unwrap();
        let (events, rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let heard = || rx.try_iter().filter(|e| e.event == "filter_history_changed").count();
        let listed = || {
            list_filter_history(&ctx, ListFilterHistoryRequest {})
                .unwrap()
                .into_iter()
                .map(|e| e.filter)
                .collect::<Vec<_>>()
        };
        heard();

        for filter in ["stripe", "@status:>=400", "stripe", " "] {
            record_filter(&ctx, RecordFilterRequest { filter: filter.into() }).unwrap();
        }
        assert_eq!(listed(), ["stripe", "@status:>=400"]);
        // A blank filter is not kept, and changes nothing to hear of.
        assert_eq!(heard(), 3);

        let req = DeleteFilterHistoryRequest { filter: "stripe".into() };
        assert!(delete_filter_history(&ctx, req).unwrap());
        assert_eq!(listed(), ["@status:>=400"]);
        assert_eq!(clear_filter_history(&ctx, ClearFilterHistoryRequest {}).unwrap(), 1);
        assert!(listed().is_empty());
        assert_eq!(heard(), 2);
    }

    #[tokio::test]
    async fn the_app_still_hears_why_a_body_failed_to_decode() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let flow = Flow {
            id: "fl_bad".into(),
            status: Some(200),
            response_headers: vec![ProxyHeader {
                name: "Content-Encoding".into(),
                value: "gzip".into(),
            }],
            ..Default::default()
        };
        ctx.db().unwrap().with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background)).unwrap();
        let mut writer =
            BodyChunkWriter::new(ctx.blobs().unwrap(), Flow::body_id("fl_bad", FlowBody::Response));
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

    /// Sends one whole flow for `url`, with a response body, as the engine does.
    fn send_flow(tx: &std::sync::mpsc::Sender<ProxyEvent>, id: u64, url: &str) {
        tx.send(ProxyEvent::RequestStart {
            id,
            started_at: SystemTime::now(),
            method: "GET".into(),
            url: url.into(),
            http_version: "HTTP/1.1".into(),
            connection: 1,
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
        let data = bytes::Bytes::from(format!("body of {url}"));
        tx.send(ProxyEvent::ResponseBodyChunk { id, len: data.len(), data }).unwrap();
        tx.send(ProxyEvent::ResponseBodyComplete {
            id,
            size: 0,
            truncated: false,
            elapsed_ms: 2,
            error: None,
            cancelled: false,
        })
        .unwrap();
    }

    /// A GraphQL request's operation is stored with the flow: from a JSON body sent in chunks,
    /// and from a GET's URL. A JSON body that is not GraphQL, and one over the scan limit, store
    /// none.
    #[test]
    fn graphql_operations_are_stored_at_capture() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let send = |event| tx.send(event).unwrap();
        let post = |id: u64, url: &str, chunks: &[&[u8]]| {
            send(ProxyEvent::RequestStart {
                id,
                started_at: SystemTime::now(),
                method: "POST".into(),
                url: url.into(),
                http_version: "HTTP/1.1".into(),
                connection: 1,
                client_addr: "127.0.0.1:1".parse().unwrap(),
            });
            send(ProxyEvent::RequestHeader {
                id,
                name: "Content-Type".into(),
                value: "application/json; charset=utf-8".into(),
            });
            let mut size = 0;
            for chunk in chunks {
                size += chunk.len();
                send(ProxyEvent::RequestBodyChunk {
                    id,
                    len: chunk.len(),
                    data: bytes::Bytes::copy_from_slice(chunk),
                });
            }
            send(ProxyEvent::RequestBodyComplete {
                id,
                size: size as u64,
                truncated: false,
                elapsed_ms: 1,
            });
            send(ProxyEvent::ResponseStart {
                id,
                status: 200,
                http_version: "HTTP/1.1".into(),
                remote_addr: None,
                elapsed_ms: 2,
            });
            send(ProxyEvent::ResponseBodyComplete {
                id,
                size: 0,
                truncated: false,
                elapsed_ms: 3,
                error: None,
                cancelled: false,
            });
        };
        post(
            1,
            "https://api.example.com/graphql",
            &[
                br#"{"query":"query GetUser($id: ID!) "#,
                br#"{ user(id: $id) { id } }"}"#,
            ],
        );
        post(2, "https://api.example.com/users", &[br#"{"query":"red shoes"}"#]);
        let long = format!(
            r#"{{"query":"query Big {{ a }}","variables":{{"pad":"{}"}}}}"#,
            "x".repeat(GRAPHQL_SCAN_LIMIT)
        );
        post(3, "https://api.example.com/big/graphql", &[long.as_bytes()]);
        send_flow(&tx, 4, "https://api.example.com/graphql?query=query%20Feed%20%7B%20a%20%7D");
        drop(tx);
        event_loop.join().unwrap();

        let flows = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap();
        assert_eq!(flows.len(), 4);
        let operation = |url: &str| {
            let flow = flows.iter().find(|f| f.url == url).unwrap();
            flow.graphql_operation.clone()
        };
        assert_eq!(operation("https://api.example.com/graphql").as_deref(), Some("GetUser"));
        assert_eq!(operation("https://api.example.com/users"), None);
        assert_eq!(operation("https://api.example.com/big/graphql"), None);
        assert_eq!(
            operation("https://api.example.com/graphql?query=query%20Feed%20%7B%20a%20%7D")
                .as_deref(),
            Some("Feed")
        );
    }

    /// Flows that end together are written together, and every one the engine sent is written
    /// when it stops, mid-batch or not, each with its body.
    #[test]
    fn a_stop_mid_batch_writes_every_flow() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        // More than a batch, sent faster than they are written, then the engine stops.
        for id in 1..=(FLOW_BATCH as u64 * 2 + 7) {
            send_flow(&tx, id, &format!("https://example.com/{id}"));
        }
        drop(tx);
        event_loop.join().unwrap();

        let stored = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap();
        assert_eq!(stored.len(), FLOW_BATCH * 2 + 7);
        for flow in &stored {
            let body =
                bodies::read_raw_body(&ctx.blobs().unwrap(), &flow.id, FlowBody::Response).unwrap();
            assert_eq!(body, format!("body of {}", flow.url).into_bytes());
        }
    }

    /// A flow that ends alone is written at once, not after the batch's wait: with the batch's
    /// clock stopped, the wait never ends, so only the queue running dry writes it.
    #[test]
    fn a_lone_flow_shows_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let stopped = BatchClock::Stopped(std::time::Instant::now());
        let (tx, event_loop) = event_loop_timed(&ctx, stopped);
        send_flow(&tx, 1, "https://example.com/alone");
        // The engine still runs, so it is not the stop that writes it.
        wait_for_flow(&ctx, |f| f.url == "https://example.com/alone");
        drop(tx);
        event_loop.join().unwrap();
    }

    /// The batch's wait is what writes a batch while events keep coming.
    #[test]
    fn a_batch_is_due_once_its_first_flow_has_waited() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let started = std::time::Instant::now();
        let mut sink = FlowSink { clock: BatchClock::Stopped(started), ..sink(&ctx) };
        let f = InFlight {
            flow: Flow { id: Flow::generate_id(), ..Default::default() },
            connection: 1,
            request_body: None,
            response_body: None,
            persisted: false,
            cleared: false,
            next_seq: 0,
            dirty: false,
            last_write: None,
            graphql_scan: None,
        };
        sink.finish_flow(f);
        assert!(!sink.finished_due(), "the clock stands still");
        sink.clock = BatchClock::Stopped(started + FLOW_BATCH_WAIT);
        assert!(sink.finished_due());
        sink.write_finished();
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 1);
    }

    /// A flow keeps the client's address, its connection's timings and TLS, and when its
    /// request was sent whole, for its timeline and details.
    #[test]
    fn a_flow_keeps_its_connection_and_timings() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let send = |event| tx.send(event).unwrap();
        send(ProxyEvent::RequestStart {
            id: 1,
            started_at: SystemTime::now(),
            method: "POST".into(),
            url: "https://api.example.com/upload".into(),
            http_version: "HTTP/2".into(),
            connection: 1,
            client_addr: "127.0.0.1:54321".parse().unwrap(),
        });
        send(ProxyEvent::UpstreamConnection {
            id: 1,
            elapsed_connect_ms: Some(3),
            elapsed_tls_ms: Some(9),
            tls_version: Some("TLSv1.3".into()),
            tls_cipher: Some("TLS13_AES_128_GCM_SHA256".into()),
        });
        let data = bytes::Bytes::from_static(b"payload");
        send(ProxyEvent::RequestBodyChunk { id: 1, len: data.len(), data });
        send(ProxyEvent::RequestBodyComplete { id: 1, size: 7, truncated: false, elapsed_ms: 12 });
        send(ProxyEvent::ResponseStart {
            id: 1,
            status: 201,
            http_version: "HTTP/2".into(),
            remote_addr: Some("93.184.216.34:443".parse().unwrap()),
            elapsed_ms: 20,
        });
        send(ProxyEvent::ResponseBodyComplete {
            id: 1,
            size: 0,
            truncated: false,
            elapsed_ms: 25,
            error: None,
            cancelled: false,
        });
        drop(tx);
        event_loop.join().unwrap();
        let flow = flows::list(&ctx.db().unwrap(), &Default::default()).unwrap().remove(0);
        assert_eq!(flow.client_addr.as_deref(), Some("127.0.0.1:54321"));
        assert_eq!((flow.elapsed_connect_ms, flow.elapsed_tls_ms), (Some(3), Some(9)));
        assert_eq!((flow.elapsed_request_ms, flow.elapsed_headers_ms), (Some(12), Some(20)));
        assert_eq!(flow.upstream_tls_version.as_deref(), Some("TLSv1.3"));
        assert_eq!(flow.upstream_tls_cipher.as_deref(), Some("TLS13_AES_128_GCM_SHA256"));
    }

    /// Waits up to 5 seconds for `check`.
    fn wait_until(what: &str, check: impl Fn() -> bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !check() {
            assert!(std::time::Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn sweeper_running(ctx: &ProxyCtx) -> bool {
        ctx.sweeper.0.lock().unwrap().running
    }

    /// Without a cap nothing sweeps. With one, the oldest flows go until the traffic is under
    /// it, and the app hears which; taken away, the sweeper stops.
    #[test]
    fn keeping_traffic_under_a_cap_sweeps_the_oldest() {
        let dir = tempfile::tempdir().unwrap();
        let (events, rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let empty = ctx.storage_size().unwrap();
        let ids: Vec<String> = (0..20).map(|i| format!("fl_{i:02}")).collect();
        for id in &ids {
            flow_with_response(&ctx, id, "application/octet-stream", &[3; 64 * 1024]);
        }
        let full = ctx.storage_size().unwrap();

        ctx.sweep_soon();
        assert!(!sweeper_running(&ctx), "no thread without a cap");
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 20);

        let cap = (empty + full) / 2;
        // Swept here rather than waited on from the sweeper's thread, which a busy machine may
        // not run in time: what goes is the same either way.
        ctx.sweep_under(cap, &Arc::downgrade(&ctx.stores));
        let removed: Vec<String> = rx
            .try_iter()
            .filter(|e| e.event == "flows_removed")
            .flat_map(|e| serde_json::from_value::<Vec<String>>(e.payload["ids"].clone()).unwrap())
            .collect();
        let kept = flows::count(&ctx.db().unwrap()).unwrap();
        let after = ctx.storage_size().unwrap();
        let sizes = format!("empty {empty}, full {full}, cap {cap}, after {after}");
        assert!(after <= cap, "under the cap: {sizes}");
        assert!(!removed.is_empty() && removed.len() < 20, "some, not all: {removed:?}, {sizes}");
        assert_eq!(removed.len(), 20 - kept, "the app hears of each");
        assert_eq!(removed, ids[..removed.len()], "the oldest, in order");

        // Clearing at launch, a cap is saved but not applied.
        assert_eq!(ctx.set_keep_traffic(Some(cap)).unwrap(), Some(cap));
        assert_eq!(ctx.settings().unwrap().keep_traffic_bytes, Some(cap));
        assert!(!sweeper_running(&ctx), "no sweeping while traffic is cleared at launch");
        // Kept, the cap starts the sweeper, which finds nothing more to do; taken away, it
        // stops, as it does when traffic goes back to being cleared at launch.
        ctx.set_traffic(TrafficRetention::Keep).unwrap();
        assert!(sweeper_running(&ctx));
        ctx.set_traffic(TrafficRetention::ClearOnLaunch).unwrap();
        wait_until("the sweeper stops", || !sweeper_running(&ctx));
        ctx.set_traffic(TrafficRetention::Keep).unwrap();
        assert!(sweeper_running(&ctx));
        assert_eq!(ctx.set_keep_traffic(None).unwrap(), None);
        wait_until("the sweeper stops", || !sweeper_running(&ctx));
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), kept, "nothing more went");
        assert!(ctx.set_keep_traffic(Some(0)).is_err());
    }

    /// Writes a body for `body_id` straight to the blob store, as the event loop does.
    fn write_blob(ctx: &ProxyCtx, body_id: &str, bytes: &[u8]) {
        let mut writer = BodyChunkWriter::new(ctx.blobs().unwrap(), body_id.to_string());
        writer.write(bytes).unwrap();
        writer.finish().unwrap();
    }

    /// The bodies stored under a flow's id: its request and response, and its messages' payloads
    /// numbered below `messages`.
    fn blobs_of(ctx: &ProxyCtx, id: &str, messages: usize) -> usize {
        let blobs = ctx.blobs().unwrap();
        let conn = blobs.connect();
        let bodies = [
            Flow::body_id(id, FlowBody::Request),
            Flow::body_id(id, FlowBody::Response),
        ];
        let payloads = (0..messages).map(|n| format!("{id}.msg.{n}"));
        bodies.into_iter().chain(payloads).filter(|b| conn.body_exists(b).unwrap()).count()
    }

    /// A thread turning the system proxy on or off holds none of the databases, so it never
    /// closes them itself, as it would at a process's exit, crashing in SQLCipher's teardown.
    #[test]
    fn threads_that_outlive_the_engine_hold_no_databases() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        assert!(ctx.stores().is_ok());
        let detached = ctx.detached();
        assert!(detached.stores().is_err(), "none of its own");
        assert_eq!(Arc::strong_count(&ctx.stores), 1, "the owner's alone");
        // Everything else is shared, as the system proxy's state is.
        ctx.system_proxy_on.store(true, Ordering::SeqCst);
        assert!(detached.system_proxy_on.load(Ordering::SeqCst));
    }

    /// A message written for a flow while the sweep deletes it, before its row goes or between
    /// its row and its bodies, is deleted with it rather than left counting against the cap.
    #[test]
    fn a_message_written_while_its_flow_is_swept_goes_too() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        for id in ["fl_a", "fl_b"] {
            flow_with_response(&ctx, id, "text/plain", &[1; 4096]);
        }
        let stores = ctx.stores().unwrap();

        let rows = flows::sweepable(&stores, 1).unwrap();
        assert_eq!(rows.iter().map(|(_, id)| id.as_str()).collect::<Vec<_>>(), ["fl_a"]);
        // Written after it was chosen, before its row is deleted...
        write_blob(&ctx, "fl_a.msg.7", b"late");
        let deleted = flows::delete_swept_rows(&stores, rows).unwrap();
        // ...and after its row is gone, before its bodies are.
        write_blob(&ctx, "fl_a.msg.8", b"later");
        flows::delete_swept_bodies(&stores, &deleted).unwrap();

        assert_eq!(deleted, ["fl_a"]);
        assert_eq!(blobs_of(&ctx, "fl_a", 10), 0, "no orphans");
        assert_eq!(blobs_of(&ctx, "fl_b", 10), 1, "the other flow kept");
    }

    /// A sweep that deletes the rows and then fails before the bodies, as on a full disk, leaves
    /// them pending, and the next sweep deletes them, even with nothing more to sweep.
    #[test]
    fn bodies_a_failed_sweep_left_go_on_the_next() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        for id in ["fl_a", "fl_b"] {
            flow_with_response(&ctx, id, "text/plain", &[1; 4096]);
        }
        let stores = ctx.stores().unwrap();

        let rows = flows::sweepable(&stores, 1).unwrap();
        // The rows go, and the bodies don't.
        assert_eq!(flows::delete_swept_rows(&stores, rows).unwrap(), ["fl_a"]);
        assert_eq!(flows::pending_sweeps(&stores).unwrap(), ["fl_a"]);
        assert_eq!(blobs_of(&ctx, "fl_a", 0), 1, "left behind");

        // Under the cap, so only what was left goes.
        assert!(flows::sweep_oldest(&stores, u64::MAX).unwrap().is_empty());
        assert_eq!(blobs_of(&ctx, "fl_a", 0), 0);
        assert!(flows::pending_sweeps(&stores).unwrap().is_empty());
        assert_eq!(blobs_of(&ctx, "fl_b", 0), 1, "the other flow kept");
    }

    /// A stream still open is never swept, even while its writer adds messages as the sweep
    /// runs and it is the oldest flow there is.
    #[test]
    fn an_open_stream_is_not_swept_while_it_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let open = Flow {
            id: "fl_open".into(),
            stream_kind: Some(StreamKind::Websocket),
            status: Some(101),
            ..Default::default()
        };
        ctx.db().unwrap().with_tx(|tx| tx.upsert(&open, &UpdateSource::Background)).unwrap();
        write_blob(&ctx, "fl_open.msg.0", &[2; 16 * 1024]);
        let ended: Vec<String> = (0..10).map(|i| format!("fl_{i:02}")).collect();
        for id in &ended {
            flow_with_response(&ctx, id, "application/octet-stream", &[3; 32 * 1024]);
        }

        let done = Arc::new(AtomicBool::new(false));
        let writer = {
            let (ctx, done) = (ctx.clone(), done.clone());
            std::thread::spawn(move || {
                let mut seq = 1;
                while !done.load(Ordering::SeqCst) {
                    write_blob(&ctx, &format!("fl_open.msg.{seq}"), &[4; 1024]);
                    seq += 1;
                }
                seq
            })
        };
        // A cap below anything reachable, so the sweep takes every flow it may.
        let stores = ctx.stores().unwrap();
        while !flows::sweep_oldest(&stores, 1).unwrap().is_empty() {}
        done.store(true, Ordering::SeqCst);
        let written = writer.join().unwrap();

        let db = ctx.db().unwrap();
        assert!(flows::find(&db, "fl_open").is_some(), "the open stream stays");
        assert_eq!(flows::count(&db).unwrap(), 1, "every ended flow swept");
        assert_eq!(blobs_of(&ctx, "fl_open", written), written, "its messages all kept");
        for id in &ended {
            assert_eq!(blobs_of(&ctx, id, 0), 0, "{id} left nothing behind");
        }
    }

    /// Resetting deletes the traffic and its data key and opens empty databases under a new
    /// one; the CA, readable with the old key, is kept, so it stays trusted.
    #[test]
    fn resetting_captured_data_starts_empty_and_keeps_the_ca() {
        let dir = tempfile::tempdir().unwrap();
        let (events, rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        flow_with_response(&ctx, "fl_old", "text/plain", b"secret");
        let pem = ctx.load_ca().unwrap().pem().to_string();
        let key = std::fs::read(db::data_key_path(dir.path())).unwrap();
        rx.try_iter().count();

        ctx.reset_captured_data().unwrap();
        assert!(ctx.locked().is_none());
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 0);
        assert!(!ctx.blobs().unwrap().connect().body_exists("fl_old.response").unwrap());
        assert_ne!(std::fs::read(db::data_key_path(dir.path())).unwrap(), key, "a new key");
        assert_eq!(ctx.load_ca().unwrap().pem(), pem, "the same CA");
        let heard: Vec<&str> = rx.try_iter().map(|e| e.event).collect();
        assert!(heard.contains(&"flows_cleared") && heard.contains(&"proxy_state_changed"));
        // Capturing goes on into the new databases.
        flow_with_response(&ctx, "fl_new", "text/plain", b"hello");
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 1);
    }

    /// With the key lost from the keychain, nothing can be read, and resetting is the way out:
    /// the traffic and the CA, which only the lost key could read, make way for new ones.
    #[test]
    fn resetting_while_locked_is_the_way_out_of_a_lost_key() {
        let dir = tempfile::tempdir().unwrap();
        let pem = {
            let (events, _rx) = RpcEventEmitter::new();
            let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
            flow_with_response(&ctx, "fl_old", "text/plain", b"secret");
            ctx.load_ca().unwrap().pem().to_string()
        };
        // Another keychain, without the master key that wrapped the data key.
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        assert!(ctx.locked().is_some());
        assert!(ctx.db().is_err());
        assert!(ctx.storage_size().unwrap() > 0, "the files, measured on disk");

        ctx.reset_captured_data().unwrap();
        assert!(ctx.locked().is_none());
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 0);
        assert_ne!(ctx.load_ca().unwrap().pem(), pem, "a new CA");
        flow_with_response(&ctx, "fl_new", "text/plain", b"hello");
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 1);
    }

    /// A port that is free and unused now.
    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    /// The running engine moves to a new port at once; one it cannot bind leaves it, and the
    /// setting, where they were.
    #[test]
    fn setting_the_port_restarts_the_engine_on_it() {
        let dir = tempfile::tempdir().unwrap();
        let first = free_port();
        let settings =
            ProxySettings { port: first, system_proxy_at_launch: false, ..Default::default() };
        settings.save(&dir.path().join("settings.json")).unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        assert!(ctx.set_port(0).is_err());
        ctx.start().unwrap();
        assert_eq!(ctx.port(), Some(first));

        let second = free_port();
        assert_eq!(ctx.set_port(second).unwrap(), second);
        assert_eq!((ctx.port(), ctx.settings().unwrap().port), (Some(second), second));
        assert!(is_listening(second));

        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let taken_port = taken.local_addr().unwrap().port();
        assert!(ctx.set_port(taken_port).is_err());
        assert_eq!((ctx.port(), ctx.settings().unwrap().port), (Some(second), second));
        assert_eq!(ctx.start_error(), None);
        ctx.stop().unwrap();

        // Stopped, it is only saved, for the next start.
        let third = free_port();
        assert_eq!(ctx.set_port(third).unwrap(), third);
        assert_eq!(ctx.port(), None);
        ctx.start().unwrap();
        assert_eq!(ctx.port(), Some(third));
        ctx.stop().unwrap();
    }

    /// Opens the proxy in `dir` as a launch does, with `keys`, after writing two flows with
    /// bodies and a saved search into it from a launch before.
    fn relaunch_with_traffic(
        dir: &Path,
        keys: &MasterKeySource,
        settings: Option<ProxySettings>,
    ) -> ProxyCtx {
        {
            let (events, _rx) = RpcEventEmitter::new();
            let ctx = ProxyCtx::new(dir, events, keys.clone()).unwrap();
            flow_with_response(&ctx, "fl_a", "text/plain", b"one");
            flow_with_response(&ctx, "fl_b", "text/plain", b"two");
            saved_queries::create(&ctx.db().unwrap(), "Errors", "@status:>=400").unwrap();
            filter_history::record(&ctx.db().unwrap(), "@host:api.stripe.com").unwrap();
            filter_history::set_last(&ctx.db().unwrap(), "@status:>=400").unwrap();
            assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 2);
        }
        if let Some(settings) = settings {
            settings.save(&dir.join("settings.json")).unwrap();
        }
        let (events, _rx) = RpcEventEmitter::new();
        ProxyCtx::new(dir, events, keys.clone()).unwrap()
    }

    /// By default a launch starts with no traffic, bodies included, and keeps saved searches
    /// and the filter history.
    #[test]
    fn a_launch_clears_captured_traffic_by_default() {
        let dir = tempfile::tempdir().unwrap();
        let keys = MasterKeySource::memory();
        let ctx = relaunch_with_traffic(dir.path(), &keys, None);
        let db = ctx.db().unwrap();
        assert_eq!(flows::count(&db).unwrap(), 0);
        assert_eq!(blobs_of(&ctx, "fl_a", 0), 0);
        let saved = saved_queries::list(&db).unwrap();
        assert_eq!(saved.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Errors"]);
        let history = filter_history::list(&db).unwrap();
        assert_eq!(
            history.iter().map(|h| h.filter.as_str()).collect::<Vec<_>>(),
            ["@host:api.stripe.com"]
        );
        assert_eq!(filter_history::last(&db).unwrap(), "@status:>=400");
        // New traffic is written as before.
        flow_with_response(&ctx, "fl_c", "text/plain", b"three");
        assert_eq!(flows::count(&db).unwrap(), 1);
    }

    /// Kept between launches, or with a cap set before the choice existed, traffic stays.
    #[test]
    fn a_launch_keeps_traffic_when_set_to() {
        let keys = MasterKeySource::memory();
        let keep = ProxySettings { traffic: Some(TrafficRetention::Keep), ..Default::default() };
        // From before the choice: a cap and no `traffic` key.
        let capped: ProxySettings =
            serde_json::from_str(r#"{"keepTrafficBytes": 1073741824}"#).unwrap();
        assert_eq!(capped.traffic, None);
        for settings in [keep, capped] {
            let dir = tempfile::tempdir().unwrap();
            let ctx = relaunch_with_traffic(dir.path(), &keys, Some(settings));
            assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 2);
            assert_eq!(blobs_of(&ctx, "fl_a", 0), 1);
        }
    }

    /// A launch that overlaps another, before either has claimed the engine, leaves the
    /// databases the other has open alone, so what it writes is not lost.
    #[test]
    fn an_overlapping_launch_keeps_the_other_launch_s_traffic() {
        let dir = tempfile::tempdir().unwrap();
        let keys = MasterKeySource::memory();
        let (events, _rx) = RpcEventEmitter::new();
        let first = ProxyCtx::new(dir.path(), events, keys.clone()).unwrap();
        flow_with_response(&first, "fl_a", "text/plain", b"one");

        let (events, _rx) = RpcEventEmitter::new();
        let second = ProxyCtx::new(dir.path(), events, keys.clone()).unwrap();
        assert_eq!(flows::count(&second.db().unwrap()).unwrap(), 1);
        // The first still writes bodies into the database both read.
        flow_with_response(&first, "fl_b", "text/plain", b"two");
        assert_eq!(blobs_of(&second, "fl_a", 0), 1);
        assert_eq!(blobs_of(&second, "fl_b", 0), 1);

        // Once both have let go, the next launch clears.
        drop((first, second));
        let (events, _rx) = RpcEventEmitter::new();
        let third = ProxyCtx::new(dir.path(), events, keys).unwrap();
        assert_eq!(flows::count(&third.db().unwrap()).unwrap(), 0);
    }

    /// A change the app decides while the watch reads the system proxy wins over what the
    /// watch read, which is read again once the change is made.
    #[test]
    fn the_watch_never_overwrites_a_change_under_way() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (pending, previous) = ctx.intend_system_proxy(true);
        assert!(!previous);
        assert!(!ctx.follow_system_proxy(), "left to try again");
        assert!(ctx.system_proxy_on.load(Ordering::SeqCst), "the change stands");
        drop(pending);
        assert_eq!(ctx.system_proxy_pending.load(Ordering::SeqCst), 0);
    }

    /// Only a launch clears: unlocking again, after a reset, keeps what was captured since.
    #[test]
    fn only_the_first_unlock_clears() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        assert!(!ctx.take_clear_at_launch(), "taken by the launch");
        flow_with_response(&ctx, "fl_a", "text/plain", b"one");
        ctx.reset_captured_data().unwrap();
        flow_with_response(&ctx, "fl_b", "text/plain", b"two");
        assert!(ctx.unlock().is_ok());
        assert_eq!(flows::count(&ctx.db().unwrap()).unwrap(), 1);
    }

    /// The capture limit is saved and shows in the proxy's state, as the keep-traffic cap does.
    #[tokio::test(flavor = "multi_thread")]
    async fn the_state_has_the_capture_limit_and_the_traffic_cap() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let req = SetCaptureBodyLimitRequest { bytes: 4096 };
        assert_eq!(set_capture_body_limit(&ctx, req).unwrap(), 4096);
        let req = SetKeepTrafficRequest { bytes: Some(1 << 30) };
        assert_eq!(set_keep_traffic(&ctx, req).unwrap(), Some(1 << 30));
        let state = get_proxy_state(ctx.clone(), GetProxyStateRequest {}).await.unwrap();
        assert_eq!((state.capture_body_limit, state.keep_traffic_bytes), (4096, Some(1 << 30)));
        assert_eq!(
            state.traffic,
            TrafficRetention::ClearOnLaunch,
            "a cap set now keeps the choice"
        );
        set_traffic(&ctx, SetTrafficRequest { traffic: TrafficRetention::Keep }).unwrap();
        let state = get_proxy_state(ctx.clone(), GetProxyStateRequest {}).await.unwrap();
        assert_eq!(state.traffic, TrafficRetention::Keep);
        let size = get_storage_size(ctx.clone(), GetStorageSizeRequest {}).await.unwrap();
        assert!(size.bytes > 0);
        ctx.set_keep_traffic(None).unwrap();
    }

    /// A flow that fails to write is rolled back alone: the others in its batch are kept.
    #[test]
    fn one_bad_flow_loses_no_others_in_its_batch() {
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        ctx.db()
            .unwrap()
            .with_tx(|tx| {
                tx.conn().resolve().execute_batch(
                    "CREATE TEMP TRIGGER refuse BEFORE INSERT ON flows
                    WHEN NEW.url = 'https://example.com/bad'
                    BEGIN SELECT RAISE(ABORT, 'refused'); END;",
                )?;
                Ok::<_, yaak_database::Error>(())
            })
            .unwrap();
        let sink = sink(&ctx);
        // One batch of three, the middle one refused.
        for url in ["before", "bad", "after"] {
            let flow = Flow {
                id: Flow::generate_id(),
                url: format!("https://example.com/{url}"),
                ..Default::default()
            };
            let chunks = vec![yaak_models::blob_manager::BodyChunk::new(
                Flow::body_id(&flow.id, FlowBody::Response),
                0,
                url.as_bytes().to_vec(),
            )];
            sink.finished.borrow_mut().flows.push(FinishedFlow { flow, persisted: false, chunks });
        }
        sink.write_finished();
        assert!(!sink.has_finished());

        let mut urls: Vec<String> = flows::list(&ctx.db().unwrap(), &Default::default())
            .unwrap()
            .into_iter()
            .map(|f| f.url)
            .collect();
        urls.sort();
        assert_eq!(urls, ["https://example.com/after", "https://example.com/before"]);
    }

    /// Capture throughput and flow-open latency at 3,000 flows, for weighing what encryption
    /// costs. Run in release: `cargo test --release -p yaak-proxy-lib --lib times_capture --
    /// --ignored --nocapture`.
    #[test]
    #[ignore]
    fn times_capture_and_flow_open() {
        const FLOWS: u64 = 3_000;
        let dir = tempfile::tempdir().unwrap();
        let (events, _rx) = RpcEventEmitter::new();
        let ctx = ProxyCtx::new(dir.path(), events, MasterKeySource::memory()).unwrap();
        let (tx, event_loop) = event_loop(&ctx);
        let body = bytes::Bytes::from(vec![b'x'; 2048]);
        let started = std::time::Instant::now();
        for id in 1..=FLOWS {
            tx.send(ProxyEvent::RequestStart {
                id,
                started_at: SystemTime::now(),
                method: "GET".into(),
                url: format!("https://api.example.com/v1/items/{id}?api_key=sk_test_123"),
                http_version: "HTTP/1.1".into(),
                // One kept-alive connection, so its app is looked up once and the time is
                // the database's.
                connection: 1,
                client_addr: "127.0.0.1:1".parse().unwrap(),
            })
            .unwrap();
            for h in 0..8 {
                let (name, value) = (format!("x-header-{h}"), "a header value".into());
                tx.send(ProxyEvent::RequestHeader { id, name, value }).unwrap();
            }
            tx.send(ProxyEvent::ResponseStart {
                id,
                status: 200,
                http_version: "HTTP/1.1".into(),
                remote_addr: None,
                elapsed_ms: 1,
            })
            .unwrap();
            let (name, value) = ("content-type".into(), "application/json".into());
            tx.send(ProxyEvent::ResponseHeader { id, name, value }).unwrap();
            let data = body.clone();
            tx.send(ProxyEvent::ResponseBodyChunk { id, len: data.len(), data }).unwrap();
            tx.send(ProxyEvent::ResponseBodyComplete {
                id,
                size: body.len() as u64,
                truncated: false,
                elapsed_ms: 2,
                error: None,
                cancelled: false,
            })
            .unwrap();
        }
        drop(tx);
        event_loop.join().unwrap();
        let capture = started.elapsed();
        let db = ctx.db().unwrap();
        let blobs = ctx.blobs().unwrap();
        assert_eq!(flows::count(&db).unwrap(), FLOWS as usize);

        let ids: Vec<String> =
            flows::list(&db, &Default::default()).unwrap().into_iter().map(|f| f.id).collect();
        let started = std::time::Instant::now();
        for id in &ids {
            let flow = flows::get(&db, id).unwrap();
            let body = bodies::read_raw_body(&blobs, &flow.id, FlowBody::Response).unwrap();
            assert_eq!(body.len(), 2048);
        }
        let open = started.elapsed() / ids.len() as u32;
        let cipher: Vec<String> = db.with_conn(|c| {
            [
                "cipher_provider",
                "cipher_provider_version",
                "cipher_memory_security",
            ]
            .iter()
            .map(|p| {
                let value = c.conn().resolve().query_row(&format!("PRAGMA {p}"), [], |r| {
                    r.get::<_, rusqlite::types::Value>(0)
                });
                format!("{p} {value:?}")
            })
            .collect()
        });
        eprintln!("{cipher:?}");
        eprintln!(
            "{FLOWS} flows captured in {capture:?}: {:.0} flows/s; opening one, its row and \
            body: {open:?}",
            FLOWS as f64 / capture.as_secs_f64()
        );
    }
}
