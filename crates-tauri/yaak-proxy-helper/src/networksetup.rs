//! The macOS system proxy as `networksetup` sees it: the web and secure web proxies of each
//! network service. Reading needs no rights; changing needs an administrator, which the
//! daemon is and the app's password-dialog fallback borrows.
//!
//! Before pointing the services at `127.0.0.1:<port>`, their settings are saved in a
//! [`Snapshot`]; turning off puts back exactly what was there, not just "off".

use serde::{Deserialize, Serialize};

pub const NETWORKSETUP: &str = "/usr/sbin/networksetup";

/// Where the system proxy is always pointed. Never anywhere else, so a compromised caller can
/// at worst send this Mac's traffic to localhost.
pub const HOST: &str = "127.0.0.1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "gen_rpc.ts"))]
#[serde(rename_all = "camelCase")]
pub struct ServiceProxy {
    /// The network service, as System Settings names it: "Wi-Fi", "USB 10/100/1000 LAN".
    pub name: String,
    pub http: ProxySetting,
    pub https: ProxySetting,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "gen_rpc.ts"))]
#[serde(rename_all = "camelCase")]
pub struct ProxySetting {
    pub enabled: bool,
    pub server: String,
    pub port: u16,
}

impl ProxySetting {
    pub fn points_at(&self, port: u16) -> bool {
        self.enabled && self.server == HOST && self.port == port
    }

    /// This setting as the user's own: one pointing at one of `ports` is ours, left behind, so
    /// it is saved as off.
    fn owned(&self, ports: &[u16]) -> Self {
        let ours = ports.iter().any(|p| self.points_at(*p));
        Self { enabled: self.enabled && !ours, ..self.clone() }
    }
}

impl ServiceProxy {
    /// Either proxy of the service sends traffic to `127.0.0.1:<port>`.
    pub fn points_at(&self, port: u16) -> bool {
        self.http.points_at(port) || self.https.points_at(port)
    }
}

/// The settings of the services the system proxy changed, as they were before, and the port
/// it points them at.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub port: u16,
    /// Ports it pointed at before moving to `port`, where a service it could not move, or a
    /// disabled one, may still point.
    #[serde(default)]
    pub previous_ports: Vec<u16>,
    pub services: Vec<ServiceProxy>,
}

impl Snapshot {
    pub fn capture(services: &[ServiceProxy], port: u16) -> Self {
        let mut snapshot = Self::default();
        snapshot.extend(services, port);
        snapshot
    }

    /// Records `services` not saved yet, a network connected since the first capture, and
    /// moves the snapshot to `port`. Those already saved keep the user's settings, not ours.
    pub fn extend(&mut self, services: &[ServiceProxy], port: u16) {
        if self.port != 0 && self.port != port && !self.previous_ports.contains(&self.port) {
            self.previous_ports.push(self.port);
        }
        self.previous_ports.retain(|p| *p != port);
        self.port = port;
        let ports = self.ports();
        for service in services {
            if self.services.iter().any(|s| s.name == service.name) {
                continue;
            }
            self.services.push(ServiceProxy {
                name: service.name.clone(),
                http: service.http.owned(&ports),
                https: service.https.owned(&ports),
            });
        }
    }

    /// Every port this snapshot has pointed services at, the current one first.
    pub fn ports(&self) -> Vec<u16> {
        std::iter::once(self.port).chain(self.previous_ports.iter().copied()).collect()
    }

    fn get(&self, name: &str) -> Option<&ServiceProxy> {
        self.services.iter().find(|s| s.name == name)
    }
}

/// The calls that turn the system proxy off at `port`, and whether `snapshot` is used up by
/// them. At the snapshot's current port, or at port 0 meaning wherever it is, they put back
/// everything it saved. At any other port they only turn off what points there, leaving the
/// snapshot to the routing still live on its own port.
pub fn disable_commands(
    services: &[ServiceProxy],
    snapshot: Option<&Snapshot>,
    port: u16,
) -> (Vec<Vec<String>>, bool) {
    match snapshot {
        Some(snapshot) if port == 0 || port == snapshot.port => {
            let mut ports = snapshot.ports();
            if port != 0 && !ports.contains(&port) {
                ports.push(port);
            }
            (restore_commands(services, Some(snapshot), &ports), true)
        }
        Some(_) => (restore_commands(services, None, &[port]), false),
        None if port == 0 => (Vec::new(), true),
        None => (restore_commands(services, None, &[port]), true),
    }
}

/// The services from `networksetup -listallnetworkservices`, the disabled ones too with
/// `include_disabled`. The first line is a legend; a leading `*` marks a disabled service.
pub fn parse_services(output: &str, include_disabled: bool) -> Vec<String> {
    output
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|l| !l.is_empty() && (include_disabled || !l.starts_with('*')))
        .map(|l| l.trim_start_matches('*').to_string())
        .collect()
}

/// The output of `networksetup -getwebproxy` or `-getsecurewebproxy`.
pub fn parse_proxy(output: &str) -> ProxySetting {
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

const WEB: [(&str, &str); 2] =
    [("-setwebproxy", "-setwebproxystate"), ("-setsecurewebproxy", "-setsecurewebproxystate")];

/// The `networksetup` calls that point every one of `services` at `127.0.0.1:<port>`.
pub fn enable_commands(services: &[ServiceProxy], port: u16) -> Vec<Vec<String>> {
    let mut commands = Vec::new();
    for service in services {
        for (set, state) in WEB {
            let name = service.name.clone();
            commands.push(vec![set.into(), name.clone(), HOST.into(), port.to_string()]);
            commands.push(vec![state.into(), name, "on".into()]);
        }
    }
    commands
}

/// The `networksetup` calls that put back what `snapshot` saved for each proxy of `services`
/// still pointing at one of `ports`, and turn off those it has nothing saved for. A proxy the
/// user has pointed elsewhere since is theirs, and left alone.
pub fn restore_commands(
    services: &[ServiceProxy],
    snapshot: Option<&Snapshot>,
    ports: &[u16],
) -> Vec<Vec<String>> {
    let mut commands = Vec::new();
    for service in services {
        let saved = snapshot.and_then(|s| s.get(&service.name));
        let proxies = [
            (&service.http, saved.map(|s| &s.http)),
            (&service.https, saved.map(|s| &s.https)),
        ];
        for ((current, saved), (set, state)) in proxies.into_iter().zip(WEB) {
            if !ports.iter().any(|p| current.points_at(*p)) {
                continue;
            }
            let name = service.name.clone();
            match saved {
                // Setting the server turns the proxy on, so its state follows.
                Some(saved) if !saved.server.is_empty() && saved.port != 0 => {
                    let port = saved.port.to_string();
                    commands.push(vec![set.into(), name.clone(), saved.server.clone(), port]);
                    commands.push(vec![state.into(), name, on_off(saved.enabled)]);
                }
                _ => commands.push(vec![state.into(), name, "off".into()]),
            }
        }
    }
    commands
}

fn on_off(on: bool) -> String {
    if on { "on" } else { "off" }.to_string()
}

/// Runs `networksetup`, real or stubbed.
pub trait Networksetup {
    /// Runs it with `args`, returning what it printed.
    fn run(&self, args: &[String]) -> Result<String, String>;
}

/// `/usr/sbin/networksetup` itself.
pub struct SystemNetworksetup;

impl Networksetup for SystemNetworksetup {
    fn run(&self, args: &[String]) -> Result<String, String> {
        let output = std::process::Command::new(NETWORKSETUP)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to run {NETWORKSETUP}: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!("{NETWORKSETUP} exited with {}", output.status)
            } else {
                stderr
            });
        }
        // It reports some failures, such as an unknown service, on stdout with status 0.
        if stdout.starts_with("** Error") {
            return Err(stdout.trim().to_string());
        }
        Ok(stdout)
    }
}

/// Every service and its proxies, the disabled ones too with `include_disabled`.
pub fn read_services(
    ns: &impl Networksetup,
    include_disabled: bool,
) -> Result<Vec<ServiceProxy>, String> {
    let list = ns.run(&["-listallnetworkservices".to_string()])?;
    parse_services(&list, include_disabled)
        .into_iter()
        .map(|name| {
            let http = parse_proxy(&ns.run(&["-getwebproxy".into(), name.clone()])?);
            let https = parse_proxy(&ns.run(&["-getsecurewebproxy".into(), name.clone()])?);
            Ok(ServiceProxy { name, http, https })
        })
        .collect()
}

/// Runs `commands` in order, stopping at the first that fails.
pub fn apply(ns: &impl Networksetup, commands: &[Vec<String>]) -> Result<(), String> {
    for args in commands {
        ns.run(args)?;
    }
    Ok(())
}

/// A `networksetup` that keeps its services in memory, for tests here and in the app.
#[cfg(any(test, feature = "test-support"))]
pub mod fake {
    use super::*;
    use std::sync::Mutex;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct FakeService {
        pub proxy: ServiceProxy,
        pub enabled: bool,
    }

    #[derive(Default)]
    pub struct FakeNetworksetup {
        pub services: Mutex<Vec<FakeService>>,
        /// Every change made, in order.
        pub changes: Mutex<Vec<Vec<String>>>,
        /// A service whose changes fail, as one removed mid-change would.
        pub failing: Mutex<Option<String>>,
    }

    impl FakeNetworksetup {
        pub fn new(services: Vec<(&str, ProxySetting, ProxySetting)>) -> Self {
            let services = services
                .into_iter()
                .map(|(name, http, https)| FakeService {
                    proxy: ServiceProxy { name: name.into(), http, https },
                    enabled: true,
                })
                .collect();
            Self { services: Mutex::new(services), ..Default::default() }
        }

        /// The services' proxies, disabled ones included.
        pub fn proxies(&self) -> Vec<ServiceProxy> {
            self.services.lock().unwrap().iter().map(|s| s.proxy.clone()).collect()
        }

        pub fn set_enabled(&self, name: &str, enabled: bool) {
            let mut services = self.services.lock().unwrap();
            services.iter_mut().find(|s| s.proxy.name == name).unwrap().enabled = enabled;
        }

        pub fn set_proxy(&self, name: &str, http: ProxySetting, https: ProxySetting) {
            let mut services = self.services.lock().unwrap();
            let service = services.iter_mut().find(|s| s.proxy.name == name).unwrap();
            service.proxy.http = http;
            service.proxy.https = https;
        }
    }

    impl Networksetup for FakeNetworksetup {
        fn run(&self, args: &[String]) -> Result<String, String> {
            let mut services = self.services.lock().unwrap();
            if args.first().map(String::as_str) == Some("-listallnetworkservices") {
                let mut out = "An asterisk (*) denotes that a network service is disabled.\n".to_string();
                for s in services.iter() {
                    out.push_str(&format!("{}{}\n", if s.enabled { "" } else { "*" }, s.proxy.name));
                }
                return Ok(out);
            }
            let [command, name, rest @ ..] = args else {
                return Err(format!("bad arguments {args:?}"));
            };
            let service = services
                .iter_mut()
                .find(|s| &s.proxy.name == name)
                .ok_or_else(|| format!("** Error: {name} is not a recognized network service."))?;
            let setting = if command.contains("secure") {
                &mut service.proxy.https
            } else {
                &mut service.proxy.http
            };
            match (command.as_str(), rest) {
                ("-getwebproxy" | "-getsecurewebproxy", []) => {
                    return Ok(format!(
                        "Enabled: {}\nServer: {}\nPort: {}\nAuthenticated Proxy Enabled: 0\n",
                        if setting.enabled { "Yes" } else { "No" },
                        setting.server,
                        setting.port
                    ));
                }
                (_, [_, ..]) if self.failing.lock().unwrap().as_ref() == Some(name) => {
                    return Err(format!("** Error: {name} is not a recognized network service."));
                }
                ("-setwebproxy" | "-setsecurewebproxy", [server, port]) => {
                    setting.server = server.clone();
                    setting.port = port.parse().map_err(|_| format!("bad port {port}"))?;
                    setting.enabled = true;
                }
                ("-setwebproxystate" | "-setsecurewebproxystate", [state]) => {
                    setting.enabled = state == "on";
                }
                _ => return Err(format!("bad arguments {args:?}")),
            }
            self.changes.lock().unwrap().push(args.to_vec());
            Ok(String::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeNetworksetup;
    use super::*;

    fn setting(enabled: bool, server: &str, port: u16) -> ProxySetting {
        ProxySetting { enabled, server: server.into(), port }
    }

    fn ours(port: u16) -> ProxySetting {
        setting(true, HOST, port)
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
        assert_eq!(parse_proxy(on), ours(9090));
        let off = "Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0\n";
        assert_eq!(parse_proxy(off), setting(false, "", 0));
    }

    #[test]
    fn enabling_points_every_service_at_localhost() {
        let services = vec![ServiceProxy {
            name: "Wi-Fi".into(),
            http: ProxySetting::default(),
            https: ProxySetting::default(),
        }];
        assert_eq!(
            enable_commands(&services, 9090),
            vec![
                vec!["-setwebproxy", "Wi-Fi", "127.0.0.1", "9090"],
                vec!["-setwebproxystate", "Wi-Fi", "on"],
                vec!["-setsecurewebproxy", "Wi-Fi", "127.0.0.1", "9090"],
                vec!["-setsecurewebproxystate", "Wi-Fi", "on"],
            ]
        );
    }

    #[test]
    fn snapshot_round_trip_puts_back_exactly_what_was_there() {
        let corp = setting(true, "corp-proxy", 3128);
        let parked = setting(false, "old-proxy", 8888);
        let ns = FakeNetworksetup::new(vec![
            ("Wi-Fi", corp.clone(), parked.clone()),
            ("Ethernet", ProxySetting::default(), ProxySetting::default()),
        ]);
        let before = ns.proxies();

        let services = read_services(&ns, false).unwrap();
        let snapshot = Snapshot::capture(&services, 9090);
        apply(&ns, &enable_commands(&services, 9090)).unwrap();
        assert!(ns.proxies().iter().all(|s| s.http.points_at(9090) && s.https.points_at(9090)));

        let restore = restore_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), &[9090]);
        apply(&ns, &restore).unwrap();
        let after = ns.proxies();
        assert_eq!(after[0], before[0]);
        // A service that never had a server is turned off, keeping ours as the unused server.
        assert!(!after[1].http.enabled && !after[1].https.enabled);
    }

    #[test]
    fn restoring_leaves_a_proxy_the_user_changed_since() {
        let ns = FakeNetworksetup::new(vec![(
            "Wi-Fi",
            setting(true, "corp-proxy", 3128),
            setting(true, "corp-proxy", 3128),
        )]);
        let services = read_services(&ns, false).unwrap();
        let snapshot = Snapshot::capture(&services, 9090);
        apply(&ns, &enable_commands(&services, 9090)).unwrap();
        // The user points HTTPS somewhere else while ours is on.
        ns.set_proxy("Wi-Fi", ours(9090), setting(true, "charles", 8888));

        let restore = restore_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), &[9090]);
        assert_eq!(
            restore,
            vec![
                vec!["-setwebproxy", "Wi-Fi", "corp-proxy", "3128"],
                vec!["-setwebproxystate", "Wi-Fi", "on"],
            ]
        );
    }

    #[test]
    fn restoring_without_a_snapshot_turns_off_only_our_proxies() {
        let services = vec![
            ServiceProxy { name: "Wi-Fi".into(), http: ours(9090), https: ours(9090) },
            // Someone else's proxy, and ours on another port.
            ServiceProxy {
                name: "Ethernet".into(),
                http: setting(true, "corp-proxy", 9090),
                https: ours(8080),
            },
        ];
        assert!(services[0].points_at(9090) && !services[1].points_at(9090));
        assert_eq!(
            restore_commands(&services, None, &[9090]),
            vec![
                vec!["-setwebproxystate", "Wi-Fi", "off"],
                vec!["-setsecurewebproxystate", "Wi-Fi", "off"],
            ]
        );
    }

    #[test]
    fn a_capture_over_our_own_leftover_saves_it_as_off() {
        // A crash left Wi-Fi pointing at us with nothing saved.
        let services =
            vec![ServiceProxy { name: "Wi-Fi".into(), http: ours(9090), https: ours(9090) }];
        let snapshot = Snapshot::capture(&services, 9090);
        assert!(!snapshot.services[0].http.enabled && !snapshot.services[0].https.enabled);
        let restore = restore_commands(&services, Some(&snapshot), &[9090]);
        assert_eq!(
            restore,
            vec![
                vec!["-setwebproxy", "Wi-Fi", "127.0.0.1", "9090"],
                vec!["-setwebproxystate", "Wi-Fi", "off"],
                vec!["-setsecurewebproxy", "Wi-Fi", "127.0.0.1", "9090"],
                vec!["-setsecurewebproxystate", "Wi-Fi", "off"],
            ]
        );
    }

    #[test]
    fn extending_keeps_the_first_capture_and_adds_new_services() {
        let corp = setting(true, "corp-proxy", 3128);
        let mut snapshot = Snapshot::capture(
            &[ServiceProxy { name: "Wi-Fi".into(), http: corp.clone(), https: corp.clone() }],
            9090,
        );
        // Turned on again on another port: Wi-Fi now shows ours, and Ethernet is new.
        snapshot.extend(
            &[
                ServiceProxy { name: "Wi-Fi".into(), http: ours(9090), https: ours(9090) },
                ServiceProxy { name: "Ethernet".into(), http: corp.clone(), https: corp.clone() },
            ],
            9191,
        );
        assert_eq!(snapshot.port, 9191);
        assert_eq!(snapshot.services.len(), 2);
        assert_eq!(snapshot.services[0].http, corp);
        assert_eq!(snapshot.services[1].https, corp);
    }

    #[test]
    fn the_fake_refuses_an_unknown_service() {
        let ns = FakeNetworksetup::new(vec![]);
        assert!(ns.run(&["-getwebproxy".into(), "Nope".into()]).is_err());
    }
}
