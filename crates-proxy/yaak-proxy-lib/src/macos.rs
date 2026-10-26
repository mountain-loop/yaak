//! The macOS system proxy: `networksetup` pointing the web and secure web proxies of every
//! enabled network service at `127.0.0.1:<port>`. Reading needs no rights; changing needs an
//! administrator, so changes run as one script through the backend in use. Everything here
//! blocks, the password dialog included, so async callers go through `spawn_blocking`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a change gets administrator rights.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum SystemProxyBackend {
    /// The privileged helper, approved once in System Settings (not built yet).
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
    /// This platform has a system proxy the app can set.
    pub supported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ServiceProxy {
    /// The network service, as System Settings names it: "Wi-Fi", "USB 10/100/1000 LAN".
    pub name: String,
    pub http: ProxySetting,
    pub https: ProxySetting,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ProxySetting {
    pub enabled: bool,
    pub server: String,
    pub port: u16,
}

const HOST: &str = "127.0.0.1";

impl ProxySetting {
    fn points_at(&self, port: u16) -> bool {
        self.enabled && self.server == HOST && self.port == port
    }
}

impl ServiceProxy {
    /// Either proxy of the service sends traffic to `127.0.0.1:<port>`.
    pub fn points_at(&self, port: u16) -> bool {
        self.http.points_at(port) || self.https.points_at(port)
    }
}

/// The services from `networksetup -listallnetworkservices`, the disabled ones too with
/// `include_disabled`. The first line is a legend; a leading `*` marks a disabled service.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_services(output: &str, include_disabled: bool) -> Vec<String> {
    output
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|l| !l.is_empty() && (include_disabled || !l.starts_with('*')))
        .map(|l| l.trim_start_matches('*').to_string())
        .collect()
}

/// The output of `networksetup -getwebproxy` or `-getsecurewebproxy`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_proxy(output: &str) -> ProxySetting {
    let mut setting = ProxySetting::default();
    for line in output.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "Enabled" => setting.enabled = value.eq_ignore_ascii_case("yes"),
            "Server" => setting.server = value.to_string(),
            "Port" => setting.port = value.parse().unwrap_or_default(),
            _ => {}
        }
    }
    setting
}

/// The `networksetup` calls that point `services` at `port`, or turn off those pointing at it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn commands(services: &[ServiceProxy], enabled: bool, port: u16) -> Vec<Vec<String>> {
    let mut commands = Vec::new();
    for service in services {
        let name = service.name.clone();
        if enabled {
            let port = port.to_string();
            for (set, state) in [
                ("-setwebproxy", "-setwebproxystate"),
                ("-setsecurewebproxy", "-setsecurewebproxystate"),
            ] {
                commands.push(vec![set.into(), name.clone(), HOST.into(), port.clone()]);
                commands.push(vec![state.into(), name.clone(), "on".into()]);
            }
        } else {
            if service.http.points_at(port) {
                commands.push(vec!["-setwebproxystate".into(), name.clone(), "off".into()]);
            }
            if service.https.points_at(port) {
                commands.push(vec!["-setsecurewebproxystate".into(), name, "off".into()]);
            }
        }
    }
    commands
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

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const NETWORKSETUP: &str = "/usr/sbin/networksetup";

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::process::{Command, Output, Stdio};

    fn networksetup(args: &[&str]) -> Result<String, String> {
        let output = Command::new(NETWORKSETUP)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to run {NETWORKSETUP}: {e}"))?;
        check(&output, NETWORKSETUP)?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

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

    pub fn services(include_disabled: bool) -> Result<Vec<ServiceProxy>, String> {
        parse_services(&networksetup(&["-listallnetworkservices"])?, include_disabled)
            .into_iter()
            .map(|name| {
                let http = parse_proxy(&networksetup(&["-getwebproxy", &name])?);
                let https = parse_proxy(&networksetup(&["-getsecurewebproxy", &name])?);
                Ok(ServiceProxy { name, http, https })
            })
            .collect()
    }

    pub fn run_privileged(script: &str, backend: SystemProxyBackend) -> Result<(), String> {
        match backend {
            SystemProxyBackend::Helper => {
                Err("The privileged helper is not available yet".to_string())
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
pub fn status(port: u16, backend: SystemProxyBackend) -> Result<SystemProxyStatus, String> {
    let services = imp::services(false)?;
    let enabled = !services.is_empty()
        && services.iter().all(|s| s.http.points_at(port) && s.https.points_at(port));
    Ok(SystemProxyStatus { enabled, port, services, backend, supported: true })
}

/// Points every enabled service at `127.0.0.1:<port>`, or turns off the services that point
/// there, disabled ones included, leaving other proxies alone. Turning off with nothing
/// pointing at `port` does nothing.
#[cfg(target_os = "macos")]
pub fn set(enabled: bool, port: u16, backend: SystemProxyBackend) -> Result<(), String> {
    if port == 0 {
        return Err("The system proxy needs a port".to_string());
    }
    // A service disabled since it was pointed at us would point at us again once re-enabled.
    let commands = commands(&imp::services(!enabled)?, enabled, port);
    if commands.is_empty() {
        return Ok(());
    }
    imp::run_privileged(&script(&commands), backend)
}

#[cfg(not(target_os = "macos"))]
pub fn status(port: u16, backend: SystemProxyBackend) -> Result<SystemProxyStatus, String> {
    Ok(SystemProxyStatus { enabled: false, port, services: Vec::new(), backend, supported: false })
}

#[cfg(not(target_os = "macos"))]
pub fn set(enabled: bool, _port: u16, _backend: SystemProxyBackend) -> Result<(), String> {
    if !enabled {
        return Ok(());
    }
    Err("Setting the system proxy is only supported on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setting(enabled: bool, server: &str, port: u16) -> ProxySetting {
        ProxySetting { enabled, server: server.into(), port }
    }

    #[test]
    fn parses_services() {
        let output = "An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n*Thunderbolt Bridge\nUSB 10/100/1000 LAN\n\n";
        assert_eq!(parse_services(output, false), vec!["Wi-Fi", "USB 10/100/1000 LAN"]);
        // A disabled service can still hold a proxy setting pointing at us.
        assert_eq!(
            parse_services(output, true),
            vec!["Wi-Fi", "Thunderbolt Bridge", "USB 10/100/1000 LAN"]
        );
    }

    #[test]
    fn parses_proxy() {
        let on = "Enabled: Yes\nServer: 127.0.0.1\nPort: 9090\nAuthenticated Proxy Enabled: 0\n";
        assert_eq!(parse_proxy(on), setting(true, "127.0.0.1", 9090));
        let off = "Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0\n";
        assert_eq!(parse_proxy(off), setting(false, "", 0));
    }

    #[test]
    fn turning_off_touches_only_our_proxies() {
        let services = vec![
            ServiceProxy {
                name: "Wi-Fi".into(),
                http: setting(true, "127.0.0.1", 9090),
                https: setting(true, "127.0.0.1", 9090),
            },
            // Someone else's proxy, and ours on another port.
            ServiceProxy {
                name: "Ethernet".into(),
                http: setting(true, "corp-proxy", 9090),
                https: setting(true, "127.0.0.1", 8080),
            },
        ];
        assert!(services[0].points_at(9090) && !services[1].points_at(9090));
        assert_eq!(
            commands(&services, false, 9090),
            vec![
                vec!["-setwebproxystate", "Wi-Fi", "off"],
                vec!["-setsecurewebproxystate", "Wi-Fi", "off"],
            ]
        );
        assert_eq!(commands(&services, true, 9090).len(), 8);
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
