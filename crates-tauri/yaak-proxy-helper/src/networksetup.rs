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
    /// What stays the same when the service is renamed: its device ("en0"), or its hardware
    /// port when it has none. Absent when `networksetup` lists neither.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub id: Option<String>,
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
    /// A service known by its name only.
    pub fn new(name: &str, http: ProxySetting, https: ProxySetting) -> Self {
        Self { name: name.into(), id: None, http, https }
    }

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
    /// Proxies a restore has started putting the saved server back on, as `(service, "http"
    /// or "https")`. Setting a server turns the proxy on, so one of these found on with its
    /// saved server, saved as off, is a restore that stopped halfway.
    #[serde(default)]
    pub restoring: Vec<(String, String)>,
}

impl Snapshot {
    /// Records the restores `commands` start, saved before running them.
    pub fn mark_restoring(&mut self, commands: &[Vec<String>]) {
        for args in commands {
            let proto = match args.first().map(String::as_str) {
                Some("-setwebproxy") => "http",
                Some("-setsecurewebproxy") => "https",
                _ => continue,
            };
            let Some(name) = args.get(1) else { continue };
            let entry = (name.clone(), proto.to_string());
            if !self.restoring.contains(&entry) {
                self.restoring.push(entry);
            }
        }
    }

    fn is_restoring(&self, name: &str, proto: &str) -> bool {
        self.restoring.iter().any(|(n, p)| n == name && p == proto)
    }

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
            if self.get(service).is_some() {
                continue;
            }
            self.services.push(ServiceProxy {
                name: service.name.clone(),
                id: service.id.clone(),
                http: service.http.owned(&ports),
                https: service.https.owned(&ports),
            });
        }
    }

    /// Every port this snapshot has pointed services at, the current one first.
    pub fn ports(&self) -> Vec<u16> {
        std::iter::once(self.port).chain(self.previous_ports.iter().copied()).collect()
    }

    /// What was saved for `service`: matched by its id, so a rename keeps it, or by its name
    /// when the two ids don't disagree.
    fn get(&self, service: &ServiceProxy) -> Option<&ServiceProxy> {
        if let Some(id) = &service.id
            && let Some(saved) = self.services.iter().find(|s| s.id.as_ref() == Some(id))
        {
            return Some(saved);
        }
        self.services
            .iter()
            .find(|s| s.name == service.name && (s.id.is_none() || service.id.is_none()))
    }

    /// What is left once this snapshot is restored over `services`: the saved entries none of
    /// them matched, a service removed or unplugged, kept so its settings are not lost. They
    /// are parked at port 0, which routes nothing.
    pub fn leftover(&self, services: &[ServiceProxy]) -> Option<Snapshot> {
        let unmatched: Vec<ServiceProxy> = self
            .services
            .iter()
            .filter(|saved| {
                !services.iter().any(|s| self.get(s).is_some_and(|m| std::ptr::eq(m, *saved)))
            })
            .cloned()
            .collect();
        if unmatched.is_empty() {
            return None;
        }
        Some(Snapshot { services: unmatched, ..Snapshot::default() })
    }
}

/// The calls that turn the system proxy off at `port`, and whether `snapshot` is used up by
/// them. At the snapshot's current port, or at port 0 meaning wherever it is, they put back
/// everything it saved. At any other port they put back only what points there, leaving the
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
        Some(snapshot) => (restore_commands(services, Some(snapshot), &[port]), false),
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

/// Each service's id from `networksetup -listnetworkserviceorder`, as `(name, id)`: its device,
/// or `port:<hardware port>` when it has no device, as a VPN may not.
pub fn parse_service_ids(output: &str) -> Vec<(String, String)> {
    let mut ids = Vec::new();
    let mut name = None;
    for line in output.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("(Hardware Port:") {
            let Some(name) = name.take() else { continue };
            let rest = rest.trim_end_matches(')');
            let (port, device) = rest.split_once(", Device:").unwrap_or((rest, ""));
            let (port, device) = (port.trim(), device.trim());
            if !device.is_empty() {
                ids.push((name, device.to_string()));
            } else if !port.is_empty() {
                ids.push((name, format!("port:{port}")));
            }
        } else if line.starts_with('(')
            && let Some((_, rest)) = line.split_once(") ")
        {
            // "(1) Wi-Fi", or "(*) Name" for a disabled service.
            name = Some(rest.to_string());
        }
    }
    ids
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

const WEB: [(&str, &str); 2] = [
    ("-setwebproxy", "-setwebproxystate"),
    ("-setsecurewebproxy", "-setsecurewebproxystate"),
];

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
        let saved = snapshot.and_then(|s| s.get(service));
        let proxies = [
            (&service.http, saved.map(|s| &s.http)),
            (&service.https, saved.map(|s| &s.https)),
        ];
        for (((current, saved), (set, state)), proto) in
            proxies.into_iter().zip(WEB).zip(["http", "https"])
        {
            let name = service.name.clone();
            // An earlier restore set the user's server, which turned it on, and stopped
            // before turning it back off.
            let unfinished = saved.is_some_and(|s| {
                !s.enabled
                    && current.enabled
                    && current.server == s.server
                    && current.port == s.port
                    && snapshot.is_some_and(|snapshot| snapshot.is_restoring(&name, proto))
            });
            if unfinished {
                commands.push(vec![state.into(), name, "off".into()]);
                continue;
            }
            if !ports.iter().any(|p| current.points_at(*p)) {
                continue;
            }
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
    // Without ids, services are still matched by name.
    let ids = ns
        .run(&["-listnetworkserviceorder".to_string()])
        .map(|order| parse_service_ids(&order))
        .unwrap_or_default();
    parse_services(&list, include_disabled)
        .into_iter()
        .map(|name| {
            let http = parse_proxy(&ns.run(&["-getwebproxy".into(), name.clone()])?);
            let https = parse_proxy(&ns.run(&["-getsecurewebproxy".into(), name.clone()])?);
            let id = ids.iter().find(|(n, _)| *n == name).map(|(_, id)| id.clone());
            Ok(ServiceProxy { name, id, http, https })
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
        /// Services on devices `en0`, `en1` and on, in order.
        pub fn new(services: Vec<(&str, ProxySetting, ProxySetting)>) -> Self {
            let services = services
                .into_iter()
                .enumerate()
                .map(|(i, (name, http, https))| FakeService {
                    proxy: ServiceProxy {
                        name: name.into(),
                        id: Some(format!("en{i}")),
                        http,
                        https,
                    },
                    enabled: true,
                })
                .collect();
            Self { services: Mutex::new(services), ..Default::default() }
        }

        /// Renames a service, as System Settings can; its device stays.
        pub fn rename(&self, name: &str, to: &str) {
            let mut services = self.services.lock().unwrap();
            services.iter_mut().find(|s| s.proxy.name == name).unwrap().proxy.name = to.into();
        }

        /// Removes a service, as unplugging an adapter can.
        pub fn remove(&self, name: &str) {
            self.services.lock().unwrap().retain(|s| s.proxy.name != name);
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
                let mut out =
                    "An asterisk (*) denotes that a network service is disabled.\n".to_string();
                for s in services.iter() {
                    out.push_str(&format!(
                        "{}{}\n",
                        if s.enabled { "" } else { "*" },
                        s.proxy.name
                    ));
                }
                return Ok(out);
            }
            if args.first().map(String::as_str) == Some("-listnetworkserviceorder") {
                let mut out =
                    "An asterisk (*) denotes that a network service is disabled.\n".to_string();
                for (i, s) in services.iter().enumerate() {
                    let order = if s.enabled { (i + 1).to_string() } else { "*".into() };
                    let device = s.proxy.id.clone().unwrap_or_default();
                    out.push_str(&format!(
                        "({order}) {}\n(Hardware Port: {}, Device: {device})\n\n",
                        s.proxy.name, s.proxy.name
                    ));
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
    fn parses_service_ids() {
        let output = "An asterisk (*) denotes that a network service is disabled.\n(1) Wi-Fi\n(Hardware Port: Wi-Fi, Device: en0)\n\n(*) Thunderbolt Bridge\n(Hardware Port: Thunderbolt Bridge, Device: bridge0)\n\n(3) Tailscale\n(Hardware Port: io.tailscale.ipn.macsys, Device: )\n\n";
        assert_eq!(
            parse_service_ids(output),
            vec![
                ("Wi-Fi".to_string(), "en0".to_string()),
                ("Thunderbolt Bridge".to_string(), "bridge0".to_string()),
                ("Tailscale".to_string(), "port:io.tailscale.ipn.macsys".to_string()),
            ]
        );
    }

    #[test]
    fn a_service_renamed_while_routing_gets_its_settings_back() {
        let corp = setting(true, "corp-proxy", 3128);
        let ns = FakeNetworksetup::new(vec![("Wi-Fi", corp.clone(), corp.clone())]);
        let snapshot = Snapshot::capture(&read_services(&ns, false).unwrap(), 9090);
        assert_eq!(snapshot.services[0].id.as_deref(), Some("en0"));
        apply(&ns, &enable_commands(&read_services(&ns, false).unwrap(), 9090)).unwrap();

        ns.rename("Wi-Fi", "Office Wi-Fi");
        let services = read_services(&ns, true).unwrap();
        let (commands, used_up) = disable_commands(&services, Some(&snapshot), 9090);
        apply(&ns, &commands).unwrap();
        assert_eq!(ns.proxies()[0].http, corp);
        assert_eq!(ns.proxies()[0].https, corp);
        assert!(used_up && snapshot.leftover(&services).is_none());
    }

    #[test]
    fn a_saved_entry_no_service_matches_is_kept() {
        let corp = setting(true, "corp-proxy", 3128);
        let ns = FakeNetworksetup::new(vec![
            ("Wi-Fi", corp.clone(), corp.clone()),
            ("USB LAN", corp.clone(), corp.clone()),
        ]);
        let snapshot = Snapshot::capture(&read_services(&ns, false).unwrap(), 9090);
        apply(&ns, &enable_commands(&read_services(&ns, false).unwrap(), 9090)).unwrap();
        ns.remove("USB LAN");

        let leftover = snapshot.leftover(&read_services(&ns, true).unwrap()).unwrap();
        assert_eq!(leftover.port, 0);
        assert_eq!(leftover.services.len(), 1);
        assert_eq!(leftover.services[0].name, "USB LAN");
        assert_eq!(leftover.services[0].http, corp);
    }

    #[test]
    fn a_same_named_service_on_another_device_is_not_matched() {
        let corp = setting(true, "corp-proxy", 3128);
        let mut saved = ServiceProxy::new("Ethernet", corp.clone(), corp);
        saved.id = Some("en5".into());
        let snapshot = Snapshot { port: 9090, services: vec![saved], ..Snapshot::default() };
        let mut other = ServiceProxy::new("Ethernet", setting(true, HOST, 9090), ours(9090));
        other.id = Some("en6".into());
        assert_eq!(
            restore_commands(&[other], Some(&snapshot), &[9090]),
            vec![
                vec!["-setwebproxystate", "Ethernet", "off"],
                vec!["-setsecurewebproxystate", "Ethernet", "off"],
            ]
        );
    }

    #[test]
    fn enabling_points_every_service_at_localhost() {
        let services = vec![ServiceProxy::new(
            "Wi-Fi",
            ProxySetting::default(),
            ProxySetting::default(),
        )];
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

        let restore =
            restore_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), &[9090]);
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

        let restore =
            restore_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), &[9090]);
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
            ServiceProxy::new("Wi-Fi", ours(9090), ours(9090)),
            // Someone else's proxy, and ours on another port.
            ServiceProxy::new("Ethernet", setting(true, "corp-proxy", 9090), ours(8080)),
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
        let services = vec![ServiceProxy::new("Wi-Fi", ours(9090), ours(9090))];
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
        let mut snapshot =
            Snapshot::capture(&[ServiceProxy::new("Wi-Fi", corp.clone(), corp.clone())], 9090);
        // Turned on again on another port: Wi-Fi now shows ours, and Ethernet is new.
        snapshot.extend(
            &[
                ServiceProxy::new("Wi-Fi", ours(9090), ours(9090)),
                ServiceProxy::new("Ethernet", corp.clone(), corp.clone()),
            ],
            9191,
        );
        assert_eq!(snapshot.port, 9191);
        assert_eq!(snapshot.services.len(), 2);
        assert_eq!(snapshot.services[0].http, corp);
        assert_eq!(snapshot.services[1].https, corp);
    }

    /// Enables on 9090 over `parked`, then runs only the first call of the restore, as a crash
    /// would leave it: the saved server is back, but on.
    fn cut_short(parked: &ProxySetting) -> (FakeNetworksetup, Snapshot) {
        let ns = FakeNetworksetup::new(vec![("Wi-Fi", parked.clone(), parked.clone())]);
        let mut snapshot = Snapshot::capture(&read_services(&ns, false).unwrap(), 9090);
        apply(&ns, &enable_commands(&read_services(&ns, false).unwrap(), 9090)).unwrap();
        let restore =
            restore_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), &[9090]);
        snapshot.mark_restoring(&restore);
        apply(&ns, &restore[..1]).unwrap();
        assert!(ns.proxies()[0].http.enabled);
        (ns, snapshot)
    }

    #[test]
    fn a_restore_cut_short_is_finished_on_the_next_try() {
        let parked = setting(false, "old-proxy", 8888);
        let (ns, snapshot) = cut_short(&parked);
        let (retry, used_up) =
            disable_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), 9090);
        assert!(used_up);
        apply(&ns, &retry).unwrap();
        assert_eq!(ns.proxies()[0].http, parked);
        assert_eq!(ns.proxies()[0].https, parked);
    }

    #[test]
    fn a_cut_short_restore_of_a_localhost_proxy_is_finished_too() {
        let parked = setting(false, HOST, 8888);
        let (ns, snapshot) = cut_short(&parked);
        let (retry, _) =
            disable_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), 9090);
        apply(&ns, &retry).unwrap();
        assert_eq!(ns.proxies()[0].http, parked);
    }

    #[test]
    fn a_proxy_the_user_turned_on_themselves_is_left_on() {
        let parked = setting(false, "corp-proxy", 3128);
        let ns = FakeNetworksetup::new(vec![
            ("Wi-Fi", ProxySetting::default(), ProxySetting::default()),
            ("Ethernet", parked.clone(), parked.clone()),
        ]);
        let snapshot = Snapshot::capture(&read_services(&ns, false).unwrap(), 9090);
        apply(&ns, &enable_commands(&ns.proxies()[..1], 9090)).unwrap();
        // A VPN turns the parked corporate proxy on while ours runs on Wi-Fi.
        let on = setting(true, "corp-proxy", 3128);
        ns.set_proxy("Ethernet", on.clone(), on.clone());
        let (commands, _) =
            disable_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), 9090);
        apply(&ns, &commands).unwrap();
        assert_eq!(ns.proxies()[1].http, on);
    }

    #[test]
    fn clearing_an_old_port_puts_back_what_was_saved_there() {
        let corp = setting(true, "corp-proxy", 3128);
        let ns = FakeNetworksetup::new(vec![
            ("Wi-Fi", corp.clone(), corp.clone()),
            ("Ethernet", corp.clone(), corp.clone()),
        ]);
        let mut snapshot = Snapshot::capture(&read_services(&ns, false).unwrap(), 9090);
        apply(&ns, &enable_commands(&read_services(&ns, false).unwrap(), 9090)).unwrap();
        // Ethernet is disabled before the move to 9191, so it stays on 9090.
        ns.set_enabled("Ethernet", false);
        let enabled = read_services(&ns, false).unwrap();
        snapshot.extend(&enabled, 9191);
        apply(&ns, &enable_commands(&enabled, 9191)).unwrap();

        let (commands, used_up) =
            disable_commands(&read_services(&ns, true).unwrap(), Some(&snapshot), 9090);
        assert!(!used_up);
        apply(&ns, &commands).unwrap();
        assert_eq!(ns.proxies()[1].http, corp);
        assert!(ns.proxies()[0].http.points_at(9191), "live routing kept");
    }

    #[test]
    fn the_fake_refuses_an_unknown_service() {
        let ns = FakeNetworksetup::new(vec![]);
        assert!(ns.run(&["-getwebproxy".into(), "Nope".into()]).is_err());
    }
}
