//! The privileged helper from the app's side: its registration with launchd through
//! `SMAppService`, and requests over its socket. Only the bundled, signed app can register it
//! or be answered by it; `tauri dev` and the CLI see it as unavailable.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum HelperState {
    /// Not running from a bundle with the helper inside: a dev build, the CLI, or not macOS.
    Unavailable,
    NotRegistered,
    /// Registered, and waiting for the user to allow it in System Settings.
    RequiresApproval,
    Enabled,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::HelperState;
    use objc2::rc::Retained;
    use objc2_foundation::NSString;
    use objc2_service_management::{SMAppService, SMAppServiceStatus};
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixStream;
    use std::time::{Duration, Instant};
    use yaak_proxy_helper::protocol::{Request, Response, Status};

    /// How long a just-approved daemon gets to open its socket.
    const CONNECT_WAIT: Duration = Duration::from_secs(3);

    /// Long enough for `networksetup` on every service.
    const IO_TIMEOUT: Duration = Duration::from_secs(30);

    /// This app is a bundle with the helper's plist inside, so `SMAppService` can find it.
    fn bundled() -> bool {
        std::env::current_exe()
            .ok()
            .and_then(|exe| Some(exe.parent()?.parent()?.to_path_buf()))
            .map(|contents| {
                contents.join("Library/LaunchDaemons").join(yaak_proxy_helper::PLIST_NAME).is_file()
            })
            .unwrap_or(false)
    }

    fn service() -> Option<Retained<SMAppService>> {
        if !bundled() {
            return None;
        }
        let plist = NSString::from_str(yaak_proxy_helper::PLIST_NAME);
        // SAFETY: a class method taking a valid NSString.
        Some(unsafe { SMAppService::daemonServiceWithPlistName(&plist) })
    }

    fn state_of(service: &SMAppService) -> HelperState {
        // SAFETY: reads the service's registration status.
        match unsafe { service.status() } {
            SMAppServiceStatus::Enabled => HelperState::Enabled,
            SMAppServiceStatus::RequiresApproval => HelperState::RequiresApproval,
            SMAppServiceStatus::NotRegistered => HelperState::NotRegistered,
            _ => HelperState::Unavailable,
        }
    }

    pub fn state() -> HelperState {
        service().map(|s| state_of(&s)).unwrap_or(HelperState::Unavailable)
    }

    /// Registers the daemon and, while it awaits approval, opens the System Settings pane
    /// that allows it.
    pub fn register() -> Result<HelperState, String> {
        let service = service().ok_or_else(unavailable)?;
        // SAFETY: registers the plist bundled with this app.
        let registered = unsafe { service.registerAndReturnError() };
        let state = state_of(&service);
        match state {
            // Registering asks for approval by failing with "Operation not permitted".
            HelperState::RequiresApproval => {
                // SAFETY: opens System Settings; no arguments.
                unsafe { SMAppService::openSystemSettingsLoginItems() };
                Ok(state)
            }
            HelperState::Enabled => Ok(state),
            _ => Err(registered
                .err()
                .map(|e| format!("Failed to install the helper: {}", e.localizedDescription()))
                .unwrap_or_else(|| "Failed to install the helper".to_string())),
        }
    }

    /// Removes the daemon, once it has put the system proxy back.
    pub fn unregister() -> Result<HelperState, String> {
        let service = service().ok_or_else(unavailable)?;
        if state_of(&service) == HelperState::Enabled
            && let Err(e) = request(&Request::Unregister)
        {
            // launchd stops it on unregistering, and it restores as it stops.
            log::warn!("The helper did not restore before unregistering: {e}");
        }
        // SAFETY: unregisters the plist bundled with this app.
        unsafe { service.unregisterAndReturnError() }
            .map_err(|e| format!("Failed to remove the helper: {}", e.localizedDescription()))?;
        Ok(state_of(&service))
    }

    fn unavailable() -> String {
        "The helper is only available in the installed app, not a dev build".to_string()
    }

    /// Sends one request and reads its response.
    pub fn request(request: &Request) -> Result<Status, String> {
        let start = Instant::now();
        let stream = loop {
            match UnixStream::connect(yaak_proxy_helper::SOCKET_PATH) {
                Ok(stream) => break stream,
                Err(_) if start.elapsed() < CONNECT_WAIT => {
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(format!("The helper is not running: {e}")),
            }
        };
        let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
        let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
        let mut line = serde_json::to_string(request).map_err(|e| e.to_string())?;
        line.push('\n');
        (&stream).write_all(line.as_bytes()).map_err(|e| format!("The helper hung up: {e}"))?;
        let mut reply = String::new();
        BufReader::new(&stream)
            .read_line(&mut reply)
            .map_err(|e| format!("The helper did not answer: {e}"))?;
        let response: Response = serde_json::from_str(&reply)
            .map_err(|e| format!("The helper's answer was not understood: {e}"))?;
        response.into_result()
    }

    /// Points the system proxy at `port`, or puts back what was there, owned by this process.
    pub fn set(enabled: bool, port: u16) -> Result<(), String> {
        let owner_pid = std::process::id() as i32;
        request(&Request::Set { enabled, port, owner_pid }).map(|_| ())
    }
}

#[cfg(target_os = "macos")]
pub use imp::{register, set, state, unregister};

#[cfg(not(target_os = "macos"))]
pub fn state() -> HelperState {
    HelperState::Unavailable
}

#[cfg(not(target_os = "macos"))]
pub fn register() -> Result<HelperState, String> {
    Err("The helper is only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn unregister() -> Result<HelperState, String> {
    Ok(HelperState::Unavailable)
}
