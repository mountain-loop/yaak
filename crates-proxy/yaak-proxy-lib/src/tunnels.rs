//! The HTTPS connections the engine is passing through undecrypted right now, kept whether or
//! not flows are recorded, since a tunnel opened while paused has no flow. Each is added as its
//! `TunnelStart` is handled and removed at its `TunnelEnd`, never on the decrypted path. From
//! them and the decrypt list come the tunnels that would be decrypted if their client
//! reconnected, which the app may close so it does.

use crate::attribution::{Attribution, ClientApp};
use crate::models::TunnelReason;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;
use ts_rs::TS;
use yaak_proxy::{DecryptApp, DecryptEntry, DecryptPolicy, DecryptQuery};

/// An open tunnel, as the app is told of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct OpenTunnel {
    /// Its id for closing it, unique to this run of the engine, so one listed before the
    /// engine restarted closes nothing after.
    pub id: String,
    /// The engine's own number for it, which starts again each run.
    #[serde(skip)]
    #[ts(skip)]
    pub engine_id: u64,
    /// The host it leads to, without an IPv6 address's brackets.
    pub host: String,
    pub port: u16,
    /// The app that opened it, when known.
    pub app_name: Option<String>,
    pub app_bundle_id: Option<String>,
    /// Its flow, when it was recorded.
    pub flow_id: Option<String>,
    pub reason: TunnelReason,
}

impl OpenTunnel {
    /// `host:port`, as the engine keys its pass-through set, an IPv6 host in brackets.
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    fn query(&self) -> DecryptQuery {
        DecryptQuery {
            host: self.host.clone(),
            port: self.port,
            app: self.app_name.as_ref().map(|name| DecryptApp {
                name: name.clone(),
                bundle_id: self.app_bundle_id.clone(),
            }),
        }
    }
}

/// Which open tunnels to consider: all of them, those one decrypt-list entry names, or the one
/// a flow records.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct TunnelScope {
    /// An entry as stored or typed, `host:www.google.com`, `app:Dia`, `*`: only tunnels it
    /// names. An exclusion, `!host:*.chase.com`, names those it would keep out.
    #[ts(optional)]
    pub entry: Option<String>,
    /// Only the tunnel this flow records.
    #[ts(optional)]
    pub flow_id: Option<String>,
}

/// The open tunnels among `tunnels` in `scope` that `policy` would decrypt if their clients
/// reconnected. Those whose address `passthrough` holds, after a client rejected the proxy's
/// certificate, are left out, as their next connection would be passed through again; once the
/// address is forgotten, its tunnels count again.
pub fn reconnectable(
    tunnels: &[OpenTunnel],
    policy: &DecryptPolicy,
    passthrough: &[String],
    scope: &TunnelScope,
) -> Result<Vec<OpenTunnel>, String> {
    let entry = scope.entry.as_deref().map(DecryptEntry::parse).transpose()?;
    Ok(tunnels
        .iter()
        .filter(|t| scope.flow_id.as_ref().is_none_or(|f| t.flow_id.as_ref() == Some(f)))
        .filter(|t| !passthrough.contains(&t.address()))
        .filter(|t| {
            let query = t.query();
            entry.as_ref().is_none_or(|e| e.covers(&query)) && policy.decrypts(&query)
        })
        .cloned()
        .collect())
}

/// The registry of open tunnels, shared by the context and the engine's event loop. Each start
/// of the engine begins a new run, its ids its own, and an event loop of an earlier run changes
/// nothing.
#[derive(Default)]
pub struct OpenTunnels(Mutex<Run>);

#[derive(Default)]
struct Run {
    run: u64,
    /// Random for each run, so ids from another run or process never match this one's.
    token: String,
    /// Finds the app behind a tunnel not known when it opened.
    attribution: Option<Attribution>,
    tunnels: HashMap<u64, Open>,
}

struct Open {
    tunnel: OpenTunnel,
    /// The client connection it came on, for finding its app.
    connection: u64,
}

impl OpenTunnels {
    fn lock(&self) -> std::sync::MutexGuard<'_, Run> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Starts a run for an engine just started, forgetting the last one's tunnels, which ended
    /// with it. Returns the run, for the event loop's changes.
    pub fn begin_run(&self, attribution: Option<Attribution>) -> u64 {
        let mut run = self.lock();
        run.run += 1;
        run.token = yaak_database::generate_prefixed_id("tnl");
        run.attribution = attribution;
        run.tunnels.clear();
        run.run
    }

    /// The engine stopped, and its tunnels with it. Its event loop's late changes, and ids it
    /// gave out, apply to nothing from now on.
    pub fn stop_run(&self) {
        let mut run = self.lock();
        run.run += 1;
        run.token.clear();
        run.attribution = None;
        run.tunnels.clear();
    }

    /// The engine of `run` stopped, and its tunnels with it.
    pub fn end_run(&self, run: u64) {
        let mut current = self.lock();
        if current.run == run {
            current.tunnels.clear();
        }
    }

    /// A tunnel opened in `run`, on client `connection`, its `id` given here from its
    /// `engine_id`.
    pub fn open(&self, run: u64, mut tunnel: OpenTunnel, connection: u64) {
        let mut current = self.lock();
        if current.run == run {
            tunnel.id = format!("{}.{}", current.token, tunnel.engine_id);
            current.tunnels.insert(tunnel.engine_id, Open { tunnel, connection });
        }
    }

    /// The engine's numbers for those of `ids` this run gave out. Others are left out.
    pub fn engine_ids(&self, ids: &[String]) -> Vec<u64> {
        let current = self.lock();
        if current.token.is_empty() {
            return Vec::new();
        }
        ids.iter()
            .filter_map(|id| id.strip_prefix(current.token.as_str())?.strip_prefix('.'))
            .filter_map(|n| n.parse().ok())
            .collect()
    }

    /// A tunnel of `run` closed.
    pub fn close(&self, run: u64, id: u64) {
        let mut current = self.lock();
        if current.run == run {
            current.tunnels.remove(&id);
        }
    }

    /// The tunnels open now, oldest first, each with its app when it can be found without
    /// waiting.
    pub fn list(&self) -> Vec<OpenTunnel> {
        let mut current = self.lock();
        let Run { attribution, tunnels, .. } = &mut *current;
        for open in tunnels.values_mut() {
            if open.tunnel.app_name.is_none()
                && let Some(app) =
                    attribution.as_ref().and_then(|a| a.get(open.connection, Duration::ZERO))
            {
                set_app(&mut open.tunnel, app);
            }
        }
        let mut list: Vec<OpenTunnel> = tunnels.values().map(|o| o.tunnel.clone()).collect();
        list.sort_by_key(|t| t.engine_id);
        list
    }
}

/// Records the app that opened `tunnel`.
pub fn set_app(tunnel: &mut OpenTunnel, app: ClientApp) {
    tunnel.app_name = Some(app.name);
    tunnel.app_bundle_id = app.bundle_id;
}

#[cfg(test)]
mod tests {
    use super::*;
    use yaak_proxy::BUILT_IN_EXCLUSIONS;

    fn tunnel(id: u64, host: &str, app: Option<&str>, reason: TunnelReason) -> OpenTunnel {
        OpenTunnel {
            id: String::new(),
            engine_id: id,
            host: host.into(),
            port: 443,
            app_name: app.map(String::from),
            app_bundle_id: app.map(|a| format!("com.example.{}", a.to_lowercase())),
            flow_id: Some(format!("fl_{id}")),
            reason,
        }
    }

    fn sample() -> Vec<OpenTunnel> {
        use TunnelReason::*;
        vec![
            tunnel(1, "www.google.com", Some("Dia"), NotListed),
            tunnel(2, "api.example.com", Some("Slack"), NotListed),
            tunnel(3, "gateway.icloud.com", Some("Dia"), Excluded),
            tunnel(4, "my.1password.com", Some("1Password"), Rejected),
            tunnel(5, "www.chase.com", None, Excluded),
            tunnel(6, "maps.google.com", None, NotListed),
        ]
    }

    fn policy(entries: &[&str]) -> DecryptPolicy {
        let mut all = entries.to_vec();
        all.extend(BUILT_IN_EXCLUSIONS.iter().map(|(e, _)| *e));
        DecryptPolicy::parse(&all).unwrap()
    }

    fn ids(
        policy: &DecryptPolicy,
        passthrough: &[&str],
        entry: Option<&str>,
        flow_id: Option<&str>,
    ) -> Vec<u64> {
        let passthrough: Vec<String> = passthrough.iter().map(|p| p.to_string()).collect();
        let scope =
            TunnelScope { entry: entry.map(String::from), flow_id: flow_id.map(String::from) };
        reconnectable(&sample(), policy, &passthrough, &scope)
            .unwrap()
            .iter()
            .map(|t| t.engine_id)
            .collect()
    }

    #[test]
    fn host_entries() {
        let p = policy(&["host:www.google.com"]);
        assert_eq!(ids(&p, &[], None, None), [1]);
        let p = policy(&["host:*.google.com"]);
        assert_eq!(ids(&p, &[], None, None), [1, 6]);
        // Narrowed to one entry of several.
        let p = policy(&["host:*.google.com", "host:api.example.com"]);
        assert_eq!(ids(&p, &[], Some("host:api.example.com"), None), [2]);
        assert_eq!(ids(&p, &[], Some("api.example.com"), None), [2], "as typed");
        assert_eq!(ids(&p, &[], Some("host:*.google.com"), None), [1, 6]);
    }

    #[test]
    fn app_entries() {
        // Dia's iCloud tunnel too: an app entry outranks the built-in exclusion.
        let p = policy(&["app:Dia"]);
        assert_eq!(ids(&p, &[], None, None), [1, 3]);
        let p = policy(&["app:com.example.slack"]);
        assert_eq!(ids(&p, &[], Some("app:com.example.slack"), None), [2]);
    }

    #[test]
    fn everything_and_exclusions() {
        // The built-in exclusions keep iCloud and 1Password out.
        let p = policy(&["*"]);
        assert_eq!(ids(&p, &[], None, None), [1, 2, 5, 6]);
        assert_eq!(ids(&p, &[], Some("*"), None), [1, 2, 5, 6]);
        // The person's own exclusion.
        let p = policy(&["*", "!host:*.chase.com"]);
        assert_eq!(ids(&p, &[], None, None), [1, 2, 6]);
        // A removed exclusion, asked about by name: what it kept out.
        let p = policy(&["*"]);
        assert_eq!(ids(&p, &[], Some("!host:*.chase.com"), None), [5]);
        assert!(reconnectable(&sample(), &p, &[], &TunnelScope::search_entry("host:a b")).is_err());
    }

    #[test]
    fn rejected_pass_throughs_are_left_out() {
        let p = policy(&["*", "host:my.1password.com"]);
        let rejected = "my.1password.com:443";
        assert!(!ids(&p, &[rejected], None, None).contains(&4), "passed through still");
        // Forgotten, its next connection would be decrypted.
        assert!(ids(&p, &[], None, None).contains(&4));
        // An address passed through since it opened.
        assert_eq!(ids(&p, &[rejected, "www.google.com:443"], None, None), [2, 5, 6]);
    }

    #[test]
    fn one_flow() {
        let p = policy(&["*"]);
        assert_eq!(ids(&p, &[], None, Some("fl_2")), [2]);
        assert!(ids(&p, &[], None, Some("fl_3")).is_empty(), "excluded still");
        assert!(ids(&p, &[], None, Some("fl_nope")).is_empty());
    }

    #[test]
    fn nothing_listed_reconnects_nothing() {
        assert!(ids(&policy(&[]), &[], None, None).is_empty());
    }

    #[test]
    fn the_registry_keeps_one_run() {
        let tunnels = OpenTunnels::default();
        let first = tunnels.begin_run(None);
        tunnels.open(first, tunnel(1, "a.com", None, TunnelReason::NotListed), 1);
        tunnels.open(first, tunnel(2, "b.com", None, TunnelReason::NotListed), 2);
        tunnels.close(first, 1);
        assert_eq!(tunnels.list().iter().map(|t| t.engine_id).collect::<Vec<_>>(), [2]);
        let id = tunnels.list()[0].id.clone();
        assert!(id.starts_with("tnl_") && id.ends_with(".2"), "{id}");
        assert_eq!(tunnels.engine_ids(&[id.clone(), "tnl_x.2".into(), "2".into()]), [2]);
        // A new run starts empty, and the old one's late events change nothing.
        let second = tunnels.begin_run(None);
        tunnels.open(first, tunnel(3, "c.com", None, TunnelReason::NotListed), 3);
        tunnels.open(second, tunnel(2, "d.com", None, TunnelReason::NotListed), 4);
        tunnels.close(first, 2);
        tunnels.end_run(first);
        assert_eq!(tunnels.list().iter().map(|t| t.host.as_str()).collect::<Vec<_>>(), ["d.com"]);
        // An id the first run gave out names nothing now, though its number is reused.
        assert!(tunnels.engine_ids(&[id]).is_empty());
        tunnels.end_run(second);
        assert!(tunnels.list().is_empty());

        // Stopped, a run's late events and ids apply to nothing.
        let third = tunnels.begin_run(None);
        tunnels.open(third, tunnel(1, "e.com", None, TunnelReason::NotListed), 5);
        let id = tunnels.list()[0].id.clone();
        tunnels.stop_run();
        assert!(tunnels.list().is_empty());
        tunnels.open(third, tunnel(2, "f.com", None, TunnelReason::NotListed), 6);
        assert!(tunnels.list().is_empty());
        assert!(tunnels.engine_ids(&[id, ".1".into()]).is_empty());
    }

    #[test]
    fn addresses_as_the_engine_keys_them() {
        assert_eq!(tunnel(1, "a.com", None, TunnelReason::NotListed).address(), "a.com:443");
        assert_eq!(tunnel(1, "::1", None, TunnelReason::NotListed).address(), "[::1]:443");
    }

    impl TunnelScope {
        fn search_entry(entry: &str) -> Self {
            Self { entry: Some(entry.into()), flow_id: None }
        }
    }
}
