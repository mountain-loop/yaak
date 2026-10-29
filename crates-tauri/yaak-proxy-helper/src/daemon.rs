//! The daemon: serves the socket, keeps the saved settings in its state file, and restores
//! them when the process that turned the system proxy on exits, crashes included.

use crate::auth::{CodeSignature, Peer, Verifier};
use crate::networksetup::{
    Networksetup, Snapshot, SystemNetworksetup, apply, disable_commands, enable_commands,
    read_services,
};
use crate::process::{Owner, Processes, SystemProcesses};
use crate::protocol::{MAX_LINE, Request, Response, Status, parse_request};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// How often the owner is checked on.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);

/// Long enough for `networksetup` on every service, short enough that a silent caller lets go.
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// What the daemon has done, saved to its state file before each change, so a daemon that
/// crashes or restarts still knows what to put back.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub active: Option<Active>,
    /// Saved settings a restore found no service for, a service removed or unplugged, kept
    /// for when it is back and merged into the next capture.
    #[serde(default)]
    pub parked: Option<Snapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Active {
    pub owner: Owner,
    pub snapshot: Snapshot,
}

pub struct Daemon<N, P> {
    ns: N,
    processes: P,
    state_path: PathBuf,
    state: Mutex<State>,
}

impl<N: Networksetup, P: Processes> Daemon<N, P> {
    /// Starts from the state file at `state_path`, or from nothing.
    pub fn open(ns: N, processes: P, state_path: PathBuf) -> Self {
        let state = match std::fs::read(&state_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                log(&format!("Ignoring an unreadable state file: {e}"));
                State::default()
            }),
            Err(_) => State::default(),
        };
        Self { ns, processes, state_path, state: Mutex::new(state) }
    }

    pub fn state(&self) -> State {
        self.lock().clone()
    }

    pub fn handle(&self, request: &Request) -> Response {
        let result = match *request {
            Request::Get => Ok(status(&self.lock())),
            Request::Set { enabled: true, port, owner_pid } => self.enable(port, owner_pid),
            Request::Set { enabled: false, port, .. } => self.restore(Some(port)),
            Request::Restore => self.restore(None),
            Request::Unregister => self.unregister(),
        };
        match result {
            Ok(status) => Response::ok(status),
            Err(e) => Response::error(e),
        }
    }

    /// Points every enabled service at `port`, saving what it replaces first, unless an
    /// earlier enable already did and nothing was restored since.
    fn enable(&self, port: u16, owner_pid: i32) -> Result<Status, String> {
        let owner = self
            .processes
            .owner(owner_pid)
            .ok_or_else(|| format!("The owner, pid {owner_pid}, is not running"))?;
        let mut state = self.lock();
        let services = read_services(&self.ns, false)?;
        let mut snapshot = match state.active.take() {
            Some(active) => active.snapshot,
            None => state.parked.take().unwrap_or_default(),
        };
        snapshot.extend(&services, port);
        state.active = Some(Active { owner, snapshot });
        // Saved before anything changes, so whatever happens next can be undone.
        self.save(&state)?;
        if let Err(e) = apply(&self.ns, &enable_commands(&services, port)) {
            // Half applied is worse than not at all.
            if let Err(undo) = self.restore_locked(&mut state, None) {
                log(&format!("Failed to undo a partial change: {undo}"));
            }
            return Err(e);
        }
        Ok(status(&state))
    }

    /// Turns the system proxy off at `port`, or wherever it points without one: at the saved
    /// port this puts back everything saved; at another, a stale one, it only turns off what
    /// points there, and the saved settings stay with the routing still live.
    fn restore(&self, port: Option<u16>) -> Result<Status, String> {
        let mut state = self.lock();
        self.restore_locked(&mut state, port)?;
        Ok(status(&state))
    }

    fn restore_locked(&self, state: &mut State, port: Option<u16>) -> Result<(), String> {
        let port = port.unwrap_or(0);
        let snapshot = state.active.as_ref().map(|a| &a.snapshot);
        if snapshot.is_none() && port == 0 {
            return Ok(());
        }
        let services = read_services(&self.ns, true)?;
        let (commands, used_up) = disable_commands(&services, snapshot, port);
        // Saved first, so a restore cut short is finished by the next one.
        if let Some(active) = state.active.as_mut() {
            active.snapshot.mark_restoring(&commands);
            self.save(state)?;
        }
        // Kept on failure, so the next try still knows what to put back.
        apply(&self.ns, &commands)?;
        if used_up {
            if let Some(active) = state.active.take()
                && let Some(leftover) = active.snapshot.leftover(&services)
            {
                let names: Vec<&str> = leftover.services.iter().map(|s| s.name.as_str()).collect();
                log(&format!("Keeping saved settings no service matched: {}", names.join(", ")));
                state.parked = Some(leftover);
            }
        } else if let Some(active) = state.active.as_mut() {
            active.snapshot.restoring.clear();
        }
        self.save(state)
    }

    /// Restores, then deletes the state file, as the app is about to remove the daemon. Saved
    /// settings no service matched stay in it, for a daemon registered again.
    fn unregister(&self) -> Result<Status, String> {
        let mut state = self.lock();
        self.restore_locked(&mut state, None)?;
        if state.parked.is_some() {
            return Ok(status(&state));
        }
        match std::fs::remove_file(&self.state_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Failed to delete the state file: {e}")),
        }
        Ok(status(&state))
    }

    /// One look at the owner: restores once it has exited. True when it restored.
    pub fn watch(&self) -> bool {
        let mut state = self.lock();
        let Some(active) = &state.active else {
            return false;
        };
        if self.processes.is_alive(&active.owner) {
            return false;
        }
        log(&format!("The owner, pid {}, exited; restoring the system proxy", active.owner.pid));
        match self.restore_locked(&mut state, None) {
            Ok(()) => true,
            Err(e) => {
                log(&format!("Failed to restore the system proxy: {e}"));
                false
            }
        }
    }

    fn save(&self, state: &State) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
        let tmp = self.state_path.with_extension("tmp");
        std::fs::write(&tmp, json)
            .and_then(|()| std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)))
            .and_then(|()| std::fs::rename(&tmp, &self.state_path))
            .map_err(|e| format!("Failed to save the helper's state: {e}"))
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // A panic mid-change leaves the state as saved, which is still the truth to restore.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn status(state: &State) -> Status {
    Status {
        active: state.active.is_some(),
        port: state.active.as_ref().map(|a| a.snapshot.port),
        owner_pid: state.active.as_ref().map(|a| a.owner.pid),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Answers one connection's requests, one line each, once the peer passes `verifier`. An
/// unregister leaves the daemon running: it stops when macOS confirms the unregistration, and
/// if that never comes, it is still there to answer.
pub fn serve_connection<N: Networksetup, P: Processes>(
    stream: UnixStream,
    daemon: &Daemon<N, P>,
    verifier: &dyn Verifier,
) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let mut writer = &stream;
    let mut reply = |response: &Response| {
        let mut line = serde_json::to_string(response).unwrap_or_default();
        line.push('\n');
        writer.write_all(line.as_bytes()).is_ok()
    };

    let peer = Peer::of(&stream).and_then(|peer| verifier.verify(&peer).map(|()| peer));
    let peer = match peer {
        Ok(peer) => peer,
        Err(e) => {
            log(&e);
            reply(&Response::error(e));
            return;
        }
    };

    let mut reader = BufReader::new(&stream);
    loop {
        let mut line = String::new();
        match (&mut reader).take(MAX_LINE as u64).read_line(&mut line) {
            Ok(0) => return,
            Ok(_) if !line.ends_with('\n') => {
                reply(&Response::error("Request too long or unterminated"));
                return;
            }
            Ok(_) => {}
            Err(_) => return,
        }
        let response = match parse_request(&line) {
            Ok(request) => {
                log(&format!("pid {}: {request:?}", peer.pid));
                daemon.handle(&request)
            }
            Err(e) => Response::error(e),
        };
        if !reply(&response) {
            return;
        }
    }
}

/// The daemon's entry point, run by launchd as root. Returns the exit code.
pub fn run() -> i32 {
    // SAFETY: geteuid has no preconditions.
    if unsafe { libc::geteuid() } != 0 {
        eprintln!("yaak-proxy-helper is started by launchd, as root");
        return 1;
    }
    // Blocked before any thread starts, so every thread inherits it and only `sigwait` sees
    // them.
    let signals = blocked_signals();

    let state_dir = Path::new(crate::STATE_DIR);
    if let Err(e) = std::fs::create_dir_all(state_dir)
        .and_then(|()| std::fs::set_permissions(state_dir, std::fs::Permissions::from_mode(0o700)))
    {
        log(&format!("Failed to create {}: {e}", state_dir.display()));
        return 1;
    }
    let daemon =
        Arc::new(Daemon::open(SystemNetworksetup, SystemProcesses, state_dir.join("state.json")));
    // The owner may have exited while the daemon was down.
    daemon.watch();

    let _ = std::fs::remove_file(crate::SOCKET_PATH);
    let listener = match UnixListener::bind(crate::SOCKET_PATH) {
        Ok(listener) => listener,
        Err(e) => {
            log(&format!("Failed to listen on {}: {e}", crate::SOCKET_PATH));
            return 1;
        }
    };
    // Anyone may connect; only the signed app is answered.
    let _ = std::fs::set_permissions(crate::SOCKET_PATH, std::fs::Permissions::from_mode(0o666));
    log(&format!("Listening on {}", crate::SOCKET_PATH));

    let watched = daemon.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(WATCH_INTERVAL);
            watched.watch();
        }
    });

    let stopping = daemon.clone();
    std::thread::spawn(move || {
        let mut signal = 0;
        // SAFETY: `signals` is an initialised set, and `signal` a valid out pointer.
        unsafe { libc::sigwait(&signals, &mut signal) };
        // Stopped by launchd: unregistered in System Settings, or the Mac shutting down.
        log(&format!("Signal {signal}; restoring the system proxy and exiting"));
        if let Response { ok: false, error: Some(e), .. } = stopping.handle(&Request::Restore) {
            log(&format!("Failed to restore the system proxy: {e}"));
        }
        exit();
    });

    let verifier: Arc<dyn Verifier> = Arc::new(CodeSignature::default());
    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            continue;
        };
        let daemon = daemon.clone();
        let verifier = verifier.clone();
        std::thread::spawn(move || serve_connection(stream, &daemon, verifier.as_ref()));
    }
    0
}

/// Exits cleanly, which launchd does not restart.
fn exit() -> ! {
    let _ = std::fs::remove_file(crate::SOCKET_PATH);
    std::process::exit(0);
}

fn blocked_signals() -> libc::sigset_t {
    // SAFETY: the set is initialised by sigemptyset before use, and only signal numbers are
    // added to it.
    unsafe {
        let mut set = std::mem::zeroed::<libc::sigset_t>();
        libc::sigemptyset(&mut set);
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::sigaddset(&mut set, signal);
        }
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        set
    }
}

fn log(message: &str) {
    eprintln!(
        "{} {message}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default()
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::networksetup::fake::FakeNetworksetup;
    use crate::networksetup::{HOST, ProxySetting};
    use std::collections::HashMap;

    /// Processes that are alive while listed.
    #[derive(Default)]
    struct FakeProcesses(Mutex<HashMap<i32, u64>>);

    impl FakeProcesses {
        fn start(&self, pid: i32, started: u64) {
            self.0.lock().unwrap().insert(pid, started);
        }
        fn kill(&self, pid: i32) {
            self.0.lock().unwrap().remove(&pid);
        }
    }

    impl Processes for FakeProcesses {
        fn start_time(&self, pid: i32) -> Option<u64> {
            self.0.lock().unwrap().get(&pid).copied()
        }
    }

    struct Allow;
    impl Verifier for Allow {
        fn verify(&self, _peer: &Peer) -> Result<(), String> {
            Ok(())
        }
    }

    struct Refuse;
    impl Verifier for Refuse {
        fn verify(&self, peer: &Peer) -> Result<(), String> {
            Err(format!("Refused pid {}: not Yaak Proxy", peer.pid))
        }
    }

    fn setting(enabled: bool, server: &str, port: u16) -> ProxySetting {
        ProxySetting { enabled, server: server.into(), port }
    }

    fn daemon(dir: &Path) -> Daemon<FakeNetworksetup, FakeProcesses> {
        let ns = FakeNetworksetup::new(vec![
            ("Wi-Fi", setting(true, "corp-proxy", 3128), setting(false, "corp-proxy", 3129)),
            ("Ethernet", ProxySetting::default(), ProxySetting::default()),
        ]);
        let processes = FakeProcesses::default();
        processes.start(42, 1000);
        Daemon::open(ns, processes, dir.join("state.json"))
    }

    fn set(enabled: bool, port: u16) -> Request {
        Request::Set { enabled, port, owner_pid: 42 }
    }

    fn all_point_at(daemon: &Daemon<FakeNetworksetup, FakeProcesses>, port: u16) -> bool {
        daemon.ns.proxies().iter().all(|s| s.http.points_at(port) && s.https.points_at(port))
    }

    #[test]
    fn set_then_off_restores_exactly() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();

        let status = daemon.handle(&set(true, 9090)).into_result().unwrap();
        assert!(status.active && status.port == Some(9090) && status.owner_pid == Some(42));
        assert!(all_point_at(&daemon, 9090));

        let status = daemon.handle(&set(false, 9090)).into_result().unwrap();
        assert!(!status.active);
        assert_eq!(daemon.ns.proxies()[0], before[0]);
        assert!(!daemon.ns.proxies()[1].points_at(9090));
    }

    #[test]
    fn the_snapshot_survives_a_daemon_restart() {
        let dir = tempfile::tempdir().unwrap();
        let first = daemon(dir.path());
        let before = first.ns.proxies();
        first.handle(&set(true, 9090)).into_result().unwrap();
        let saved = first.state();
        assert!(saved.active.is_some());

        // A new daemon over the same machine reads what the first saved.
        let second = Daemon::open(
            FakeNetworksetup::default(),
            FakeProcesses::default(),
            dir.path().join("state.json"),
        );
        assert_eq!(second.state(), saved);
        *second.ns.services.lock().unwrap() = first.ns.services.lock().unwrap().clone();
        second.handle(&Request::Restore).into_result().unwrap();
        assert_eq!(second.ns.proxies()[0], before[0]);
        assert_eq!(second.state(), State::default());
    }

    #[test]
    fn enabling_twice_keeps_the_first_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        // The engine moved ports; what was saved is still the user's.
        daemon.handle(&set(true, 9191)).into_result().unwrap();
        assert!(all_point_at(&daemon, 9191));
        daemon.handle(&Request::Restore).into_result().unwrap();
        assert_eq!(daemon.ns.proxies()[0], before[0]);
    }

    #[test]
    fn a_failed_port_move_still_restores_the_old_port() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        // Moving to 9191 fails on Ethernet, after Wi-Fi moved.
        *daemon.ns.failing.lock().unwrap() = Some("Ethernet".into());
        assert!(!daemon.handle(&set(true, 9191)).ok);
        // The undo failed on Ethernet too, so what to put back is kept for the next try.
        assert!(daemon.state().active.is_some());
        *daemon.ns.failing.lock().unwrap() = None;
        daemon.handle(&Request::Restore).into_result().unwrap();
        // Restored everywhere, the old port included.
        assert_eq!(daemon.ns.proxies()[0], before[0]);
        assert!(!daemon.ns.proxies()[1].points_at(9090));
        assert_eq!(daemon.state(), State::default());
    }

    #[test]
    fn turning_off_a_stale_port_keeps_the_live_one() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        daemon.ns.set_enabled("Ethernet", false);
        daemon.handle(&set(true, 9191)).into_result().unwrap();

        // The app's launch cleanup of its old port.
        let status = daemon.handle(&set(false, 9090)).into_result().unwrap();
        assert!(status.active && status.port == Some(9191));
        assert!(daemon.ns.proxies()[0].http.points_at(9191));
        assert!(!daemon.ns.proxies()[1].points_at(9090));

        daemon.handle(&set(false, 9191)).into_result().unwrap();
        assert_eq!(daemon.ns.proxies()[0], before[0]);
    }

    #[test]
    fn a_service_renamed_while_routing_is_restored() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        daemon.ns.rename("Wi-Fi", "Office Wi-Fi");
        daemon.handle(&set(false, 9090)).into_result().unwrap();
        let after = &daemon.ns.proxies()[0];
        assert_eq!((&after.http, &after.https), (&before[0].http, &before[0].https));
        assert_eq!(daemon.state(), State::default());
    }

    #[test]
    fn settings_no_service_matched_are_parked_and_merged_back() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let wifi = daemon.ns.proxies()[0].clone();
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        // Wi-Fi is unplugged while ours is on.
        daemon.ns.remove("Wi-Fi");
        daemon.handle(&set(false, 9090)).into_result().unwrap();
        let parked = daemon.state().parked.unwrap();
        assert_eq!(parked.services.len(), 1);
        assert_eq!(parked.services[0].http, wifi.http);

        // Kept through unregister, and back in the next capture.
        daemon.handle(&Request::Unregister).into_result().unwrap();
        assert!(dir.path().join("state.json").exists());
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        let state = daemon.state();
        assert!(state.parked.is_none());
        assert!(state.active.unwrap().snapshot.services.iter().any(|s| s.http == wifi.http));
    }

    #[test]
    fn the_watchdog_restores_once_the_owner_exits() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();
        daemon.handle(&set(true, 9090)).into_result().unwrap();

        assert!(!daemon.watch(), "the owner is alive");
        assert!(all_point_at(&daemon, 9090));

        daemon.processes.kill(42);
        assert!(daemon.watch());
        assert_eq!(daemon.ns.proxies()[0], before[0]);
        assert!(!daemon.watch(), "nothing left to restore");
    }

    #[test]
    fn the_watchdog_treats_a_reused_pid_as_gone() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        // The owner exited and another process got its pid.
        daemon.processes.start(42, 2000);
        assert!(daemon.watch());
        assert!(!daemon.ns.proxies()[1].points_at(9090));
    }

    #[test]
    fn refuses_an_owner_that_is_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let err = daemon.handle(&Request::Set { enabled: true, port: 9090, owner_pid: 7 });
        assert!(!err.ok);
        assert!(daemon.ns.changes.lock().unwrap().is_empty());
    }

    #[test]
    fn a_failed_enable_undoes_what_it_did() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let before = daemon.ns.proxies();
        // Ethernet goes away mid-change, after Wi-Fi was pointed at us.
        *daemon.ns.failing.lock().unwrap() = Some("Ethernet".into());
        assert!(!daemon.handle(&set(true, 9090)).ok);
        assert_eq!(daemon.ns.proxies(), before);
        assert_eq!(daemon.state(), State::default());
    }

    #[test]
    fn unregister_restores_and_deletes_the_state_file() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        daemon.handle(&set(true, 9090)).into_result().unwrap();
        assert!(dir.path().join("state.json").exists());
        daemon.handle(&Request::Unregister).into_result().unwrap();
        assert!(!dir.path().join("state.json").exists());
        assert!(!daemon.ns.proxies()[0].points_at(9090));
    }

    #[test]
    fn get_reports_without_changing_anything() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let status = daemon.handle(&Request::Get).into_result().unwrap();
        assert!(!status.active);
        assert!(daemon.ns.changes.lock().unwrap().is_empty());
    }

    fn exchange(verifier: &dyn Verifier, lines: &[&str]) -> (Vec<Response>, Vec<ProxySetting>) {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon(dir.path());
        let (server, mut client) = UnixStream::pair().unwrap();
        for line in lines {
            client.write_all(format!("{line}\n").as_bytes()).unwrap();
        }
        client.shutdown(std::net::Shutdown::Write).unwrap();
        serve_connection(server, &daemon, verifier);
        let mut out = String::new();
        client.read_to_string(&mut out).unwrap();
        let responses = out.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let http = daemon.ns.proxies().into_iter().map(|s| s.http).collect();
        (responses, http)
    }

    #[test]
    fn serves_a_verified_peer_line_by_line() {
        let pid = std::process::id() as i32;
        let (responses, http) = exchange(
            &AllowWithOwner(pid),
            &[
                r#"{"cmd":"get"}"#,
                r#"{"cmd":"set","enabled":true,"port":80,"owner_pid":42}"#,
                r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":42}"#,
            ],
        );
        assert_eq!(responses.len(), 3);
        assert!(responses[0].ok && !responses[1].ok && responses[2].ok);
        assert!(http.iter().all(|s| s.server == HOST && s.port == 9090));
    }

    #[test]
    fn refuses_an_unverified_peer_before_reading_anything() {
        let (responses, http) =
            exchange(&Refuse, &[r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":42}"#]);
        assert_eq!(responses.len(), 1);
        assert!(responses[0].error.as_deref().unwrap().starts_with("Refused pid"));
        assert!(http.iter().all(|s| s.server != HOST));
    }

    #[test]
    fn refuses_a_peer_with_the_real_check() {
        // The test binary is not the signed app.
        let (responses, http) = exchange(&CodeSignature::default(), &[r#"{"cmd":"restore"}"#]);
        assert!(!responses[0].ok);
        assert!(http.iter().all(|s| s.server != HOST));
    }

    #[test]
    fn keeps_answering_after_unregister() {
        // Should macOS fail to unregister it, the app can still reach it.
        let (responses, _) = exchange(
            &Allow,
            &[
                r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":42}"#,
                r#"{"cmd":"unregister"}"#,
                r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":42}"#,
            ],
        );
        assert_eq!(responses.len(), 3);
        assert!(responses.iter().all(|r| r.ok));
    }

    #[test]
    fn stops_reading_an_overlong_line() {
        let long = format!(r#"{{"cmd":"get","x":"{}"}}"#, "a".repeat(MAX_LINE));
        let (responses, _) = exchange(&Allow, &[&long, r#"{"cmd":"get"}"#]);
        assert_eq!(responses.len(), 1);
        assert!(!responses[0].ok);
    }

    /// Allows only the expected peer, this test process.
    struct AllowWithOwner(i32);
    impl Verifier for AllowWithOwner {
        fn verify(&self, peer: &Peer) -> Result<(), String> {
            if peer.pid == self.0 { Ok(()) } else { Err("wrong peer".into()) }
        }
    }
}
