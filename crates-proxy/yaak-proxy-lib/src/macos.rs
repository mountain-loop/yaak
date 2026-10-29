//! The macOS system proxy: `networksetup` pointing the web and secure web proxies of every
//! enabled network service at `127.0.0.1:<port>`. Reading needs no rights; changing needs an
//! administrator, which the privileged helper is, and which the password dialog and `sudo`
//! borrow for one script. Each path saves the settings it replaces and puts them back when
//! turned off. Everything here blocks, the password dialog included, so async callers go
//! through `spawn_blocking`.

use crate::helper::HelperState;
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;
use yaak_proxy_helper::networksetup::{
    NETWORKSETUP, Networksetup, Snapshot, enable_commands, read_services, restore_commands,
};

pub use yaak_proxy_helper::networksetup::{ProxySetting, ServiceProxy};

/// How a change gets administrator rights.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum SystemProxyBackend {
    /// The privileged helper, approved once in System Settings. No prompt.
    Helper,
    /// The standard macOS password dialog, through `osascript`.
    AdminPrompt,
    /// `sudo` in the terminal running the CLI daemon.
    Sudo,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SystemProxyStatus {
    /// Every enabled network service sends HTTP and HTTPS to `127.0.0.1:<port>`.
    pub enabled: bool,
    /// The port checked against.
    pub port: u16,
    pub services: Vec<ServiceProxy>,
    pub backend: SystemProxyBackend,
    /// The privileged helper's registration, which decides the backend.
    pub helper: HelperState,
    /// This platform has a system proxy the app can set.
    pub supported: bool,
}

/// Where the password dialog and `sudo` save the settings they replace, in the proxy data
/// directory. The helper keeps its own, as root.
pub const SNAPSHOT_FILE: &str = "system-proxy-snapshot.json";

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn load_snapshot(path: &Path) -> Result<Option<Snapshot>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| format!("Failed to read {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {e}", path.display())),
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn save_snapshot(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(snapshot).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, json)
        .and_then(|()| std::fs::rename(&tmp, path))
        .map_err(|e| format!("Failed to save {}: {e}", path.display()))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn remove_snapshot(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete {}: {e}", path.display())),
    }
}

/// The password-dialog and `sudo` paths: reads through `ns`, and changes through `run`, which
/// gets administrator rights for the whole list at once. Turning on saves the settings it
/// replaces at `snapshot_path` first; turning off puts them back and deletes the file.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn set_scripted(
    ns: &impl Networksetup,
    run: impl FnOnce(&[Vec<String>]) -> Result<(), String>,
    enabled: bool,
    port: u16,
    snapshot_path: &Path,
) -> Result<(), String> {
    if enabled {
        let services = read_services(ns, false)?;
        let saved = load_snapshot(snapshot_path)?;
        let created = saved.is_none();
        let mut snapshot = saved.unwrap_or_default();
        snapshot.extend(&services, port);
        // Saved before anything changes, so a crash after the change still restores.
        save_snapshot(snapshot_path, &snapshot)?;
        if let Err(e) = run(&enable_commands(&services, port)) {
            // Usually cancelled, with nothing changed; a snapshot kept would go stale.
            if created {
                remove_snapshot(snapshot_path)?;
            }
            return Err(e);
        }
        return Ok(());
    }

    // Disabled services too: one disabled since it was pointed at us would point at us again
    // once re-enabled.
    let services = read_services(ns, true)?;
    let snapshot = load_snapshot(snapshot_path)?;
    let mut ports = vec![port];
    ports.extend(snapshot.as_ref().map(|s| s.port).filter(|p| *p != port));
    let commands = restore_commands(&services, snapshot.as_ref(), &ports);
    if !commands.is_empty() {
        run(&commands)?;
    }
    remove_snapshot(snapshot_path)
}

/// The calls as one `sh` script that stops at the first failure.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn script(commands: &[Vec<String>]) -> String {
    commands
        .iter()
        .map(|args| {
            std::iter::once(NETWORKSETUP.to_string())
                .chain(args.iter().map(|a| shell_quote(a)))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join(" && ")
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// `script` inside an AppleScript string literal.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', r"\\").replace('"', "\\\""))
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::process::{Command, Output, Stdio};

    fn check(output: &Output, program: &str) -> Result<(), String> {
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            stderr
        })
    }

    pub fn run_privileged(script: &str, backend: SystemProxyBackend) -> Result<(), String> {
        match backend {
            SystemProxyBackend::Helper => {
                Err("The helper changes the system proxy itself, not by script".to_string())
            }
            SystemProxyBackend::AdminPrompt => {
                let source = format!(
                    "do shell script {} with prompt {} with administrator privileges",
                    applescript_string(script),
                    applescript_string("Yaak Proxy wants to change your system proxy settings."),
                );
                let output = Command::new("/usr/bin/osascript")
                    .args(["-e", &source])
                    .output()
                    .map_err(|e| format!("Failed to run osascript: {e}"))?;
                // -128 is the dialog's Cancel button.
                if String::from_utf8_lossy(&output.stderr).contains("(-128)") {
                    return Err("Cancelled in the password dialog".to_string());
                }
                check(&output, "osascript")
            }
            SystemProxyBackend::Sudo => {
                // sudo asks on the terminal, so the daemon's own stdin stays attached.
                let output = Command::new("/usr/bin/sudo")
                    .args(["/bin/sh", "-c", script])
                    .stdin(Stdio::inherit())
                    .output()
                    .map_err(|e| format!("Failed to run sudo: {e}"))?;
                check(&output, "sudo")
            }
        }
    }
}

/// Which services point where, judged against `port`.
#[cfg(target_os = "macos")]
pub fn status(
    port: u16,
    backend: SystemProxyBackend,
    helper: HelperState,
) -> Result<SystemProxyStatus, String> {
    let ns = yaak_proxy_helper::networksetup::SystemNetworksetup;
    let services = read_services(&ns, false)?;
    let enabled = !services.is_empty()
        && services.iter().all(|s| s.http.points_at(port) && s.https.points_at(port));
    Ok(SystemProxyStatus { enabled, port, services, backend, helper, supported: true })
}

/// Points every enabled service at `127.0.0.1:<port>`, or puts back the settings that were
/// there, turning off any other proxy still pointing at `port`. Turning off with nothing
/// pointing at `port` asks for nothing. `snapshot_path` is where the password dialog and
/// `sudo` keep the settings they replace.
#[cfg(target_os = "macos")]
pub fn set(
    enabled: bool,
    port: u16,
    backend: SystemProxyBackend,
    snapshot_path: &Path,
) -> Result<(), String> {
    if port == 0 {
        return Err("The system proxy needs a port".to_string());
    }
    match backend {
        SystemProxyBackend::Helper => crate::helper::set(enabled, port),
        SystemProxyBackend::AdminPrompt | SystemProxyBackend::Sudo => set_scripted(
            &yaak_proxy_helper::networksetup::SystemNetworksetup,
            |commands| imp::run_privileged(&script(commands), backend),
            enabled,
            port,
            snapshot_path,
        ),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn status(
    port: u16,
    backend: SystemProxyBackend,
    helper: HelperState,
) -> Result<SystemProxyStatus, String> {
    Ok(SystemProxyStatus {
        enabled: false,
        port,
        services: Vec::new(),
        backend,
        helper,
        supported: false,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn set(
    enabled: bool,
    _port: u16,
    _backend: SystemProxyBackend,
    _snapshot_path: &Path,
) -> Result<(), String> {
    if !enabled {
        return Ok(());
    }
    Err("Setting the system proxy is only supported on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use yaak_proxy_helper::networksetup::HOST;
    use yaak_proxy_helper::networksetup::fake::FakeNetworksetup;

    fn setting(enabled: bool, server: &str, port: u16) -> ProxySetting {
        ProxySetting { enabled, server: server.into(), port }
    }

    /// Runs the "privileged" commands against the fake, counting the prompts.
    fn runner<'a>(
        ns: &'a FakeNetworksetup,
        prompts: &'a std::cell::Cell<usize>,
    ) -> impl FnOnce(&[Vec<String>]) -> Result<(), String> + 'a {
        move |commands| {
            prompts.set(prompts.get() + 1);
            yaak_proxy_helper::networksetup::apply(ns, commands)
        }
    }

    fn fake() -> FakeNetworksetup {
        FakeNetworksetup::new(vec![
            ("Wi-Fi", setting(true, "corp-proxy", 3128), setting(false, "corp-proxy", 3129)),
            ("Ethernet", ProxySetting::default(), ProxySetting::default()),
        ])
    }

    #[test]
    fn the_password_path_restores_what_it_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SNAPSHOT_FILE);
        let ns = fake();
        let before = ns.proxies();
        let prompts = std::cell::Cell::new(0);

        set_scripted(&ns, runner(&ns, &prompts), true, 9090, &path).unwrap();
        assert!(ns.proxies().iter().all(|s| s.http.points_at(9090) && s.https.points_at(9090)));
        assert!(load_snapshot(&path).unwrap().is_some());

        set_scripted(&ns, runner(&ns, &prompts), false, 9090, &path).unwrap();
        assert_eq!(ns.proxies()[0], before[0]);
        assert!(!ns.proxies()[1].points_at(9090));
        assert!(!path.exists());
        assert_eq!(prompts.get(), 2);
    }

    #[test]
    fn a_stale_reset_after_a_crash_uses_the_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SNAPSHOT_FILE);
        let ns = fake();
        let before = ns.proxies();
        let prompts = std::cell::Cell::new(0);
        set_scripted(&ns, runner(&ns, &prompts), true, 9090, &path).unwrap();

        // The app crashed; the next launch resets the port its control file named, which the
        // settings since moved away from.
        set_scripted(&ns, runner(&ns, &prompts), false, 8080, &path).unwrap();
        assert_eq!(ns.proxies()[0], before[0]);
        assert!(!path.exists());
    }

    #[test]
    fn turning_off_with_nothing_pointing_at_us_asks_for_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SNAPSHOT_FILE);
        let ns = fake();
        let prompts = std::cell::Cell::new(0);
        set_scripted(&ns, runner(&ns, &prompts), false, 9090, &path).unwrap();
        assert_eq!(prompts.get(), 0);
        assert!(ns.changes.lock().unwrap().is_empty());
    }

    #[test]
    fn a_cancelled_prompt_keeps_no_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SNAPSHOT_FILE);
        let ns = fake();
        let cancel = |_: &[Vec<String>]| Err("Cancelled in the password dialog".to_string());
        assert!(set_scripted(&ns, cancel, true, 9090, &path).is_err());
        assert!(!path.exists());
        assert!(ns.changes.lock().unwrap().is_empty());
    }

    #[test]
    fn turning_on_again_keeps_the_first_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SNAPSHOT_FILE);
        let ns = fake();
        let before = ns.proxies();
        let prompts = std::cell::Cell::new(0);
        set_scripted(&ns, runner(&ns, &prompts), true, 9090, &path).unwrap();
        // A second enable, the engine on a new port, must not save ours as the user's.
        set_scripted(&ns, runner(&ns, &prompts), true, 9191, &path).unwrap();
        let cancel = |_: &[Vec<String>]| Err("Cancelled in the password dialog".to_string());
        assert!(set_scripted(&ns, cancel, true, 9191, &path).is_err());
        assert!(path.exists(), "a cancelled re-enable keeps the original snapshot");
        set_scripted(&ns, runner(&ns, &prompts), false, 9191, &path).unwrap();
        assert_eq!(ns.proxies()[0], before[0]);
    }

    #[test]
    fn a_disabled_service_pointing_at_us_is_turned_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SNAPSHOT_FILE);
        let ns = fake();
        let prompts = std::cell::Cell::new(0);
        set_scripted(&ns, runner(&ns, &prompts), true, 9090, &path).unwrap();
        ns.set_enabled("Ethernet", false);
        set_scripted(&ns, runner(&ns, &prompts), false, 9090, &path).unwrap();
        let ethernet = &ns.proxies()[1];
        assert!(!ethernet.points_at(9090));
        assert_eq!(ethernet.http.server, HOST);
    }

    #[test]
    fn quotes_service_names() {
        let commands = vec![vec![
            "-setwebproxystate".to_string(),
            "Bob's \"LAN\"".to_string(),
            "off".into(),
        ]];
        let script = script(&commands);
        assert_eq!(script, r#"/usr/sbin/networksetup '-setwebproxystate' 'Bob'\''s "LAN"' 'off'"#);
        assert_eq!(
            applescript_string(&script),
            r#""/usr/sbin/networksetup '-setwebproxystate' 'Bob'\\''s \"LAN\"' 'off'""#
        );
    }
}
