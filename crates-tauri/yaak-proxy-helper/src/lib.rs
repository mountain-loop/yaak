//! Yaak Proxy's privileged helper: a root launchd daemon, registered by the app through
//! `SMAppService`, that points this Mac's web proxies at the engine and puts the user's own
//! settings back afterwards, so toggling the system proxy never asks for a password.
//!
//! The app talks to it over a Unix socket, one JSON line per request ([`protocol`]). Only a
//! caller signed as the proxy app by [`TEAM_ID`] is served.

pub mod networksetup;
pub mod protocol;

#[cfg(target_os = "macos")]
pub mod auth;
#[cfg(target_os = "macos")]
pub mod daemon;
#[cfg(target_os = "macos")]
pub mod process;

/// The launchd label, which is also the plist's name without `.plist`.
pub const LABEL: &str = "app.yaak.proxy.helper";

/// The plist inside the app, at `Contents/Library/LaunchDaemons/`.
pub const PLIST_NAME: &str = "app.yaak.proxy.helper.plist";

/// Created by the daemon, root-owned and world-writable: who may talk is decided per caller.
pub const SOCKET_PATH: &str = "/var/run/app.yaak.proxy.helper.sock";

/// The daemon's own state, root only: the settings to restore, and whose they are.
pub const STATE_DIR: &str = "/var/db/app.yaak.proxy.helper";

/// The Apple Developer Team that signs Yaak Proxy, set at build time with
/// `YAAK_PROXY_TEAM_ID`.
pub const TEAM_ID: &str = match option_env!("YAAK_PROXY_TEAM_ID") {
    Some(team) => team,
    None => "7PU3P6ELJ8",
};

/// The bundle identifiers of the apps served: the release app, and the dev app as well in a
/// debug build of the helper.
pub const APP_IDENTIFIERS: &[&str] = if cfg!(debug_assertions) {
    &["app.yaak.proxy", "app.yaak.proxy.dev"]
} else {
    &["app.yaak.proxy"]
};

/// The code requirement a caller must satisfy.
pub fn code_requirement() -> String {
    let identifiers = APP_IDENTIFIERS
        .iter()
        .map(|id| format!("identifier \"{id}\""))
        .collect::<Vec<_>>()
        .join(" or ");
    format!(
        "anchor apple generic and ({identifiers}) and certificate leaf[subject.OU] = \"{TEAM_ID}\""
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_the_app_signed_by_the_team() {
        let requirement = code_requirement();
        assert!(requirement.starts_with("anchor apple generic and (identifier \"app.yaak.proxy\""));
        assert!(requirement.ends_with(&format!("certificate leaf[subject.OU] = \"{TEAM_ID}\"")));
        assert_eq!(TEAM_ID.len(), 10);
    }
}
