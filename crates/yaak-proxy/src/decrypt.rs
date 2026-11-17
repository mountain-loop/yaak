//! Which HTTPS connections the engine decrypts. The policy is one list of entries:
//!
//! - `host:api.example.com`, `host:*.example.com` (the host itself and every host below it),
//!   `host:example.com:8443` (that port only), with `*` matching any run of characters;
//! - `app:Google Chrome` (by the app's name) or `app:com.google.Chrome` (by its bundle id);
//! - `*` alone, everything;
//! - any of these after `!`, which excludes what it matches.
//!
//! A connection is decrypted when a positive entry matches it and no negative one does, wherever
//! each sits in the list. Nothing matching tunnels it, so an empty list decrypts nothing. A
//! built-in exclusion (Apple's services, apps that pin their certificates) applies only to
//! positive entries broader than itself, such as `*` or `host:*.com`: an app entry, or a host
//! entry at least as specific as the exclusion, still decrypts what it names.

use std::fmt;

/// Why a built-in exclusion ships: Apple's own services, which macOS daemons reach with pinned
/// certificates, or the sync hosts of a common app that pins its certificates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BuiltInKind {
    Apple,
    Pinned,
}

impl BuiltInKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Apple => "apple",
            Self::Pinned => "pinned",
        }
    }
}

/// Hosts excluded by default, each with why: Apple's own services, and the sync hosts of common
/// apps that pin their certificates. Each is removable.
pub const BUILT_IN_EXCLUSIONS: &[(&str, BuiltInKind)] = &[
    ("!host:*.apple.com", BuiltInKind::Apple),
    ("!host:*.icloud.com", BuiltInKind::Apple),
    ("!host:*.mzstatic.com", BuiltInKind::Apple),
    ("!host:*.apple-cloudkit.com", BuiltInKind::Apple),
    ("!host:*.icloud-content.com", BuiltInKind::Apple),
    ("!host:*.cdn-apple.com", BuiltInKind::Apple),
    // Push and FaceTime, kept apart so they stay excluded without the rest of apple.com.
    ("!host:*.push.apple.com", BuiltInKind::Apple),
    ("!host:*.ess.apple.com", BuiltInKind::Apple),
    ("!host:*.1password.com", BuiltInKind::Pinned),
    ("!host:*.1password.ca", BuiltInKind::Pinned),
    ("!host:*.1password.eu", BuiltInKind::Pinned),
    ("!host:*.signal.org", BuiltInKind::Pinned),
    ("!host:*.whispersystems.org", BuiltInKind::Pinned),
    ("!host:*.dropboxapi.com", BuiltInKind::Pinned),
    ("!host:client*.dropbox.com", BuiltInKind::Pinned),
    ("!host:bolt.dropbox.com", BuiltInKind::Pinned),
    ("!host:*.zoom.us", BuiltInKind::Pinned),
];

/// The kind of the built-in exclusion `entry` is, as stored (`!host:*.apple.com`), or None when
/// it is not one.
pub fn built_in_kind(entry: &str) -> Option<BuiltInKind> {
    BUILT_IN_EXCLUSIONS.iter().find(|(e, _)| *e == entry).map(|(_, kind)| *kind)
}

/// What an entry matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecryptTarget {
    /// `*`: every connection.
    Everything,
    /// A host pattern, lowercased, and the port it is limited to, if any.
    Host { pattern: String, port: Option<u16> },
    /// An app's name or bundle id, as a pattern, matched in any case.
    App { pattern: String },
}

/// One entry of the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptEntry {
    /// Written with `!`: excludes what it matches.
    pub negated: bool,
    pub target: DecryptTarget,
    /// Shipped with the engine rather than added by the user.
    pub built_in: bool,
}

impl DecryptEntry {
    /// Parses an entry as the user may type it: with its prefix, or as a bare hostname, which is
    /// a `host:` entry. A URL is taken as its host. Prefixes are any case.
    pub fn parse(input: &str) -> Result<Self, String> {
        let trimmed = input.trim();
        let (negated, rest) = match trimmed.strip_prefix('!') {
            Some(rest) => (true, rest.trim_start()),
            None => (false, trimmed),
        };
        if rest.is_empty() {
            return Err(format!("Empty decrypt entry {input:?}"));
        }
        let target = if rest == "*" {
            DecryptTarget::Everything
        } else if let Some(app) = strip_prefix_ci(rest, "app:") {
            let app = unquote(app.trim());
            if app.is_empty() {
                return Err(format!("No app in decrypt entry {input:?}"));
            }
            DecryptTarget::App { pattern: app.to_string() }
        } else {
            let host = unquote(strip_prefix_ci(rest, "host:").unwrap_or(rest).trim());
            parse_host(host).ok_or_else(|| format!("Invalid host in decrypt entry {input:?}"))?
        };
        let mut entry = Self { negated, target, built_in: false };
        entry.built_in = built_in_kind(&entry.to_string()).is_some();
        Ok(entry)
    }

    /// The literal characters of the pattern: how specific it is. A site's `*.` counts for
    /// nothing, as `*.apple.com` matches `apple.com` itself, so `host:apple.com` ranks with it.
    fn specificity(&self) -> usize {
        match &self.target {
            DecryptTarget::Everything => 0,
            DecryptTarget::Host { pattern, port } => {
                let pattern = pattern.strip_prefix("*.").unwrap_or(pattern);
                pattern.chars().filter(|c| *c != '*').count() + usize::from(port.is_some())
            }
            DecryptTarget::App { .. } => usize::MAX,
        }
    }

    fn matches(&self, conn: &DecryptQuery) -> bool {
        match &self.target {
            DecryptTarget::Everything => true,
            DecryptTarget::Host { pattern, port } => {
                port.is_none_or(|p| p == conn.port) && host_matches(pattern, &conn.host)
            }
            DecryptTarget::App { pattern } => conn.app.as_ref().is_some_and(|app| {
                let pattern = pattern.to_lowercase();
                glob(&pattern, &app.name.to_lowercase())
                    || app.bundle_id.as_ref().is_some_and(|id| glob(&pattern, &id.to_lowercase()))
            }),
        }
    }
}

/// The entry as stored and shown: `!host:*.apple.com`, `app:Google Chrome`, `*`.
impl fmt::Display for DecryptEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.negated {
            f.write_str("!")?;
        }
        match &self.target {
            DecryptTarget::Everything => f.write_str("*"),
            DecryptTarget::Host { pattern, port: None } => write!(f, "host:{pattern}"),
            DecryptTarget::Host { pattern, port: Some(port) } if pattern.contains(':') => {
                write!(f, "host:[{pattern}]:{port}")
            }
            DecryptTarget::Host { pattern, port: Some(port) } => write!(f, "host:{pattern}:{port}"),
            DecryptTarget::App { pattern } => write!(f, "app:{pattern}"),
        }
    }
}

/// A value as the search writes one with spaces in it: `"Google Chrome"`.
fn unquote(s: &str) -> &str {
    match s.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
        Some(inner) => inner.trim(),
        None => s,
    }
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
}

/// A host pattern with an optional port: `api.example.com`, `*.example.com:8443`,
/// `[::1]:8443`, or a URL, whose host and port it takes.
fn parse_host(input: &str) -> Option<DecryptTarget> {
    let mut host = input;
    if let Some((_, rest)) = host.split_once("://") {
        host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        host = host.rsplit_once('@').map_or(host, |(_, h)| h);
    }
    let (pattern, port) = if let Some(rest) = host.strip_prefix('[') {
        let (addr, after) = rest.split_once(']')?;
        let port = match after {
            "" => None,
            p => Some(p.strip_prefix(':')?.parse::<u16>().ok()?),
        };
        (addr, port)
    } else {
        match host.rsplit_once(':') {
            // One colon: a port. More: a bare IPv6 address.
            Some((name, port)) if !name.contains(':') => (name, Some(port.parse::<u16>().ok()?)),
            _ => (host, None),
        }
    };
    let pattern = pattern.trim_end_matches('.').to_lowercase();
    let valid = !pattern.is_empty()
        && pattern.chars().all(|c| c.is_ascii_alphanumeric() || "-._*:".contains(c));
    valid.then_some(DecryptTarget::Host { pattern, port })
}

/// `*.example.com` matches `example.com` too, as cookie domains do and as the search's `@host`
/// does.
fn host_matches(pattern: &str, host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.');
    let host = host.to_lowercase();
    glob(pattern, &host) || pattern.strip_prefix("*.").is_some_and(|apex| glob(apex, &host))
}

/// `*` matches any run of characters, none included; everything else matches itself.
fn glob(pattern: &str, text: &str) -> bool {
    let (p, t) = (pattern.as_bytes(), text.as_bytes());
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() && p[pi] == b'*' {
            star = Some((pi, ti));
            pi += 1;
        } else if pi < p.len() && p[pi] == t[ti] {
            pi += 1;
            ti += 1;
        } else if let Some((sp, st)) = star {
            pi = sp + 1;
            ti = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == b'*')
}

/// The app that opened a connection, as the policy's `app:` entries match it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DecryptApp {
    pub name: String,
    pub bundle_id: Option<String>,
}

/// A CONNECT to judge: where it goes and, when known, the app that sent it.
#[derive(Debug, Clone, Default)]
pub struct DecryptQuery {
    pub host: String,
    pub port: u16,
    pub app: Option<DecryptApp>,
}

/// The list of entries, in order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DecryptPolicy {
    pub entries: Vec<DecryptEntry>,
}

impl DecryptPolicy {
    /// Decrypts everything, without exclusions: the engine's default, for callers that keep no
    /// list.
    pub fn everything() -> Self {
        Self { entries: vec![DecryptEntry::parse("*").unwrap()] }
    }

    /// The policy from entries as stored. Fails on the first one that does not parse.
    pub fn parse<S: AsRef<str>>(entries: &[S]) -> Result<Self, String> {
        let entries = entries.iter().map(|e| DecryptEntry::parse(e.as_ref()));
        Ok(Self { entries: entries.collect::<Result<_, _>>()? })
    }

    /// Some entry names an app, so judging a connection needs the app that sent it.
    pub fn needs_app(&self) -> bool {
        self.entries.iter().any(|e| matches!(e.target, DecryptTarget::App { .. }))
    }

    /// Some positive entry could match, so a connection may be decrypted at all.
    pub fn decrypts_anything(&self) -> bool {
        self.entries.iter().any(|e| !e.negated)
    }

    /// Whether to decrypt `conn`: a positive entry matches and no negative one excludes it. A
    /// built-in exclusion yields to a positive entry at least as specific as itself.
    pub fn decrypts(&self, conn: &DecryptQuery) -> bool {
        self.judge(conn) == Verdict::Decrypt
    }

    /// [`Self::decrypts`], saying why not: no positive entry matches, or an exclusion keeps it
    /// out, the first in the list that does.
    pub fn judge(&self, conn: &DecryptQuery) -> Verdict {
        let Some(best) = self
            .entries
            .iter()
            .filter(|e| !e.negated && e.matches(conn))
            .map(DecryptEntry::specificity)
            .max()
        else {
            return Verdict::NotListed;
        };
        match self
            .entries
            .iter()
            .find(|e| e.negated && e.matches(conn) && (!e.built_in || e.specificity() > best))
        {
            Some(exclusion) => Verdict::Excluded(exclusion.clone()),
            None => Verdict::Decrypt,
        }
    }
}

/// What the policy makes of a connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Decrypt,
    /// No positive entry matches it.
    NotListed,
    /// A positive entry matches it, and this exclusion keeps it out.
    Excluded(DecryptEntry),
}

impl DecryptEntry {
    /// Whether the entry names `conn`, read without its `!`: the connections it decrypts, or,
    /// for an exclusion, the ones it keeps out.
    pub fn covers(&self, conn: &DecryptQuery) -> bool {
        self.matches(conn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(entries: &[&str]) -> DecryptPolicy {
        DecryptPolicy::parse(entries).unwrap()
    }

    fn to(host: &str, port: u16) -> DecryptQuery {
        DecryptQuery { host: host.into(), port, app: None }
    }

    fn from_app(host: &str, name: &str, bundle_id: Option<&str>) -> DecryptQuery {
        let app = DecryptApp { name: name.into(), bundle_id: bundle_id.map(String::from) };
        DecryptQuery { host: host.into(), port: 443, app: Some(app) }
    }

    fn with_built_ins(entries: &[&str]) -> DecryptPolicy {
        let mut all: Vec<&str> = entries.to_vec();
        all.extend(BUILT_IN_EXCLUSIONS.iter().map(|(e, _)| *e));
        policy(&all)
    }

    #[test]
    fn an_empty_list_tunnels_everything() {
        let empty = policy(&[]);
        assert!(!empty.decrypts(&to("api.example.com", 443)));
        assert!(!empty.decrypts_anything());
        // The built-in exclusions alone decrypt nothing either.
        let built_in = with_built_ins(&[]);
        assert!(!built_in.decrypts(&to("api.example.com", 443)));
        assert!(!built_in.decrypts_anything());
    }

    #[test]
    fn host_patterns() {
        let p = policy(&["host:api.example.com"]);
        assert!(p.decrypts(&to("api.example.com", 443)));
        assert!(p.decrypts(&to("API.Example.com", 8443)), "any case, any port");
        assert!(!p.decrypts(&to("www.example.com", 443)));
        assert!(!p.decrypts(&to("example.com", 443)));

        let p = policy(&["host:*.example.com"]);
        assert!(p.decrypts(&to("api.example.com", 443)));
        assert!(p.decrypts(&to("a.b.example.com", 443)));
        assert!(p.decrypts(&to("example.com", 443)), "the site itself too");
        assert!(!p.decrypts(&to("notexample.com", 443)));
        assert!(!p.decrypts(&to("example.com.evil.net", 443)));

        let p = policy(&["host:api-*.example.com"]);
        assert!(p.decrypts(&to("api-eu.example.com", 443)));
        assert!(!p.decrypts(&to("web.example.com", 443)));
    }

    #[test]
    fn host_patterns_with_a_port() {
        let p = policy(&["host:example.com:8443"]);
        assert!(p.decrypts(&to("example.com", 8443)));
        assert!(!p.decrypts(&to("example.com", 443)));

        let p = policy(&["host:[::1]:8443", "host:fe80::1"]);
        assert!(p.decrypts(&to("[::1]", 8443)));
        assert!(!p.decrypts(&to("::1", 443)));
        assert!(p.decrypts(&to("fe80::1", 443)));
        assert_eq!(p.entries[0].to_string(), "host:[::1]:8443");
        assert_eq!(p.entries[1].to_string(), "host:fe80::1");
    }

    #[test]
    fn apps_by_name_and_bundle_id() {
        let by_name = policy(&["app:Google Chrome"]);
        assert!(by_name.decrypts(&from_app("a.com", "Google Chrome", Some("com.google.Chrome"))));
        assert!(by_name.decrypts(&from_app("a.com", "google chrome", None)));
        assert!(!by_name.decrypts(&from_app("a.com", "Safari", Some("com.apple.Safari"))));
        assert!(!by_name.decrypts(&to("a.com", 443)), "an unknown app matches no app entry");
        assert!(by_name.needs_app());

        let by_id = policy(&["app:com.google.Chrome"]);
        assert!(by_id.decrypts(&from_app("a.com", "Google Chrome", Some("com.google.Chrome"))));
        assert!(!by_id.decrypts(&from_app("a.com", "Chromium", Some("org.chromium.Chromium"))));

        let pattern = policy(&["app:com.google.*"]);
        assert!(pattern.decrypts(&from_app("a.com", "Google Chrome", Some("com.google.Chrome"))));
        assert!(!policy(&["host:a.com"]).needs_app());
    }

    #[test]
    fn everything_keeps_the_built_in_exclusions() {
        let p = with_built_ins(&["*"]);
        assert!(p.decrypts(&to("api.example.com", 443)));
        assert!(!p.decrypts(&to("gateway.icloud.com", 443)));
        assert!(!p.decrypts(&to("apple.com", 443)));
        assert!(!p.decrypts(&to("courier.push.apple.com", 5223)));
        assert!(!p.decrypts(&to("my.1password.com", 443)));
        assert!(!p.decrypts(&to("client-cf.dropbox.com", 443)));
        assert!(p.decrypts(&to("www.dropbox.com", 443)));
        // A broad wildcard yields to them too.
        assert!(!with_built_ins(&["host:*.com"]).decrypts(&to("p01.icloud.com", 443)));
    }

    #[test]
    fn a_specific_entry_beats_a_built_in_exclusion() {
        let p = with_built_ins(&["*", "host:developer.apple.com"]);
        assert!(p.decrypts(&to("developer.apple.com", 443)));
        assert!(!p.decrypts(&to("www.apple.com", 443)));
        assert!(with_built_ins(&["host:*.apple.com"]).decrypts(&to("www.apple.com", 443)));
        // The site itself, which the exclusion's `*.apple.com` matches too.
        assert!(with_built_ins(&["host:apple.com"]).decrypts(&to("apple.com", 443)));
        // A narrower exclusion still wins over a broader entry.
        assert!(
            !with_built_ins(&["host:*.apple.com"]).decrypts(&to("courier.push.apple.com", 443))
        );
        let safari = from_app("www.icloud.com", "Safari", Some("com.apple.Safari"));
        assert!(with_built_ins(&["app:Safari"]).decrypts(&safari));
    }

    #[test]
    fn the_verdict_says_why_not() {
        let p = with_built_ins(&["*", "!host:secret.example.com"]);
        assert_eq!(p.judge(&to("api.example.com", 443)), Verdict::Decrypt);
        let Verdict::Excluded(by) = p.judge(&to("secret.example.com", 443)) else {
            panic!("not excluded");
        };
        assert_eq!((by.to_string().as_str(), by.built_in), ("!host:secret.example.com", false));
        let Verdict::Excluded(by) = p.judge(&to("gateway.icloud.com", 443)) else {
            panic!("not excluded");
        };
        assert_eq!((by.to_string().as_str(), by.built_in), ("!host:*.icloud.com", true));
        assert_eq!(with_built_ins(&["host:a.com"]).judge(&to("b.com", 443)), Verdict::NotListed);
        assert_eq!(policy(&[]).judge(&to("b.com", 443)), Verdict::NotListed);
    }

    #[test]
    fn built_in_kinds() {
        assert_eq!(built_in_kind("!host:*.apple.com"), Some(BuiltInKind::Apple));
        assert_eq!(built_in_kind("!host:*.1password.com"), Some(BuiltInKind::Pinned));
        assert_eq!(built_in_kind("!host:*.example.com"), None);
        assert_eq!(built_in_kind("host:*.apple.com"), None);
        // Every one parses back to itself and reads as built in.
        for (entry, _) in BUILT_IN_EXCLUSIONS {
            let parsed = DecryptEntry::parse(entry).unwrap();
            assert!(parsed.built_in && parsed.negated, "{entry}");
            assert_eq!(parsed.to_string(), *entry);
        }
    }

    #[test]
    fn an_entry_covers_what_it_names_either_way() {
        let exclusion = DecryptEntry::parse("!host:*.chase.com").unwrap();
        assert!(exclusion.covers(&to("www.chase.com", 443)));
        assert!(!exclusion.covers(&to("www.example.com", 443)));
        let app = DecryptEntry::parse("app:Dia").unwrap();
        assert!(app.covers(&from_app("a.com", "Dia", None)));
        assert!(!app.covers(&to("a.com", 443)));
    }

    #[test]
    fn a_removed_exclusion_no_longer_applies() {
        let kept: Vec<&str> = BUILT_IN_EXCLUSIONS
            .iter()
            .map(|(e, _)| *e)
            .filter(|e| *e != "!host:*.zoom.us")
            .collect();
        let mut entries = vec!["*"];
        entries.extend(kept);
        let p = policy(&entries);
        assert!(p.decrypts(&to("us02web.zoom.us", 443)));
        assert!(!p.decrypts(&to("gateway.icloud.com", 443)));
    }

    #[test]
    fn negative_entries_win_wherever_they_sit() {
        for entries in [
            ["!host:secret.example.com", "host:*.example.com"],
            ["host:*.example.com", "!host:secret.example.com"],
        ] {
            let p = policy(&entries);
            assert!(p.decrypts(&to("api.example.com", 443)));
            assert!(!p.decrypts(&to("secret.example.com", 443)));
        }
        // The user's own exclusion beats even an exact entry.
        let p = policy(&["host:a.example.com", "!host:*.example.com"]);
        assert!(!p.decrypts(&to("a.example.com", 443)));
        let p = policy(&["*", "!app:Slack"]);
        assert!(!p.decrypts(&from_app("slack.com", "Slack", Some("com.tinyspeck.slackmacgap"))));
        assert!(p.decrypts(&from_app("slack.com", "Safari", None)));
    }

    #[test]
    fn entries_are_normalized() {
        let parse = |s: &str| DecryptEntry::parse(s).unwrap().to_string();
        assert_eq!(parse("api.example.com"), "host:api.example.com");
        assert_eq!(parse("  API.Example.com. "), "host:api.example.com");
        assert_eq!(parse("HOST:*.Example.com"), "host:*.example.com");
        assert_eq!(parse("! host:x.com"), "!host:x.com");
        assert_eq!(parse("!x.com"), "!host:x.com");
        assert_eq!(parse("https://api.example.com:8443/v1?q"), "host:api.example.com:8443");
        assert_eq!(parse("App: Google Chrome"), "app:Google Chrome");
        assert_eq!(parse(" * "), "*");
        assert_eq!(parse(r#"app:"Google Chrome""#), "app:Google Chrome");
        assert!(DecryptEntry::parse("").is_err());
        assert!(DecryptEntry::parse("!").is_err());
        assert!(DecryptEntry::parse("app:").is_err());
        assert!(DecryptEntry::parse("host:a b").is_err());
        assert!(DecryptEntry::parse("host:a.com:http").is_err());
        assert!(DecryptEntry::parse("!host:*.apple.com").unwrap().built_in);
        assert!(!DecryptEntry::parse("host:*.apple.com").unwrap().built_in);
    }

    #[test]
    fn globs() {
        assert!(glob("*", ""));
        assert!(glob("a*c", "abbbc"));
        assert!(glob("*b*", "abc"));
        assert!(!glob("a*c", "abd"));
        assert!(glob("client*.dropbox.com", "client-lb.dropbox.com"));
    }
}
