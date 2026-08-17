//! Where a send may go.
//!
//! A hosted sender is, by construction, a machine that makes HTTP requests on
//! behalf of strangers. Left alone that is an open relay into whatever network
//! it sits on: cloud metadata endpoints, internal admin panels, the database
//! next door. So every destination is checked twice — once on the URL before a
//! hop is attempted (literal IPs, host allow/deny lists) and once on the
//! addresses a hostname actually resolves to, right before the connection is
//! made. The second check is the one that matters for a hostname pointing at
//! an internal address, and it runs on every redirect hop because the engine
//! resolves every hop.

use async_trait::async_trait;
use log::warn;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use tokio::sync::mpsc;
use url::Url;
use yaak_http::dns::AddressFilter;
use yaak_http::sender::{HttpResponse, HttpResponseEvent, HttpSender};
use yaak_http::types::SendableHttpRequest;

/// The destination policy, built once from config and shared by every send.
#[derive(Clone)]
pub struct DestinationPolicy {
    allow_private_networks: bool,
    allow_hosts: Vec<HostPattern>,
    deny_hosts: Vec<HostPattern>,
}

#[derive(Clone, Debug)]
enum HostPattern {
    Exact(String),
    /// `*.example.com`: any subdomain, and the bare domain too.
    Suffix(String),
}

impl HostPattern {
    fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim().trim_end_matches('.').to_ascii_lowercase();
        if raw.is_empty() {
            return None;
        }
        Some(match raw.strip_prefix("*.") {
            Some(suffix) => Self::Suffix(suffix.to_string()),
            None => Self::Exact(raw),
        })
    }

    fn matches(&self, host: &str) -> bool {
        match self {
            Self::Exact(h) => host == h,
            Self::Suffix(s) => host == s || host.strip_suffix(s).is_some_and(|p| p.ends_with('.')),
        }
    }
}

impl DestinationPolicy {
    pub fn new(
        allow_private_networks: bool,
        allow_hosts: &[String],
        deny_hosts: &[String],
    ) -> Self {
        Self {
            allow_private_networks,
            allow_hosts: allow_hosts.iter().filter_map(|h| HostPattern::parse(h)).collect(),
            deny_hosts: deny_hosts.iter().filter_map(|h| HostPattern::parse(h)).collect(),
        }
    }

    /// Check a URL before a hop is attempted: scheme, host lists, and literal IPs. A hostname
    /// that passes here still has its resolved addresses checked by [`Self::address_filter`].
    pub fn check_url(&self, raw: &str) -> Result<(), String> {
        let url = Url::parse(raw).map_err(|e| format!("Invalid URL {raw:?}: {e}"))?;
        match url.scheme() {
            "http" | "https" => {}
            other => return Err(format!("Refusing to send over {other:?}; only http and https")),
        }
        let host = url.host_str().ok_or_else(|| format!("URL {raw:?} has no host"))?;
        let host =
            host.trim_matches(|c| c == '[' || c == ']').trim_end_matches('.').to_ascii_lowercase();

        if self.deny_hosts.iter().any(|p| p.matches(&host)) {
            return Err(format!("Host {host:?} is on this proxy's deny list"));
        }
        if !self.allow_hosts.is_empty() && !self.allow_hosts.iter().any(|p| p.matches(&host)) {
            return Err(format!("Host {host:?} is not on this proxy's allow list"));
        }

        // A literal IP never reaches the resolver, so it is checked here. Hostnames are checked
        // where their addresses become known.
        if let Ok(ip) = host.parse::<IpAddr>() {
            self.check_ip(ip)?;
        }
        Ok(())
    }

    /// The veto the engine's resolver applies to every address a hostname resolves to.
    pub fn address_filter(&self) -> AddressFilter {
        let policy = self.clone();
        Arc::new(move |ip| policy.check_ip(ip))
    }

    pub fn check_ip(&self, ip: IpAddr) -> Result<(), String> {
        if self.allow_private_networks {
            return Ok(());
        }
        match non_public_reason(ip) {
            Some(reason) => Err(format!(
                "Refusing to connect to {ip}: {reason}. This proxy only sends to public addresses"
            )),
            None => Ok(()),
        }
    }
}

/// Why an address is not a public internet address, or `None` if it is one.
///
/// Every range here is one a hosted relay must never be talked into reaching: the machine
/// itself, the network it sits on, and the link-local range where cloud metadata services
/// (169.254.169.254) live. IPv4 addresses tunnelled inside IPv6 forms are unwrapped and judged
/// as IPv4, since that is what the socket would connect to.
pub fn non_public_reason(ip: IpAddr) -> Option<&'static str> {
    match ip {
        IpAddr::V4(v4) => non_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return non_public_v4(v4);
            }
            if let Some(v4) = nat64_embedded_v4(&v6) {
                return non_public_v4(v4);
            }
            if v6.is_loopback() {
                Some("loopback")
            } else if v6.is_unspecified() {
                Some("unspecified")
            } else if v6.is_unique_local() {
                Some("unique local (fc00::/7)")
            } else if v6.is_unicast_link_local() {
                Some("link-local (fe80::/10)")
            } else if v6.is_multicast() {
                Some("multicast")
            } else if (v6.segments()[0] & 0xffc0) == 0xfec0 {
                Some("site-local (fec0::/10)")
            } else if v6.segments()[0] == 0x2001 && v6.segments()[1] == 0x0db8 {
                Some("documentation (2001:db8::/32)")
            } else {
                None
            }
        }
    }
}

fn non_public_v4(v4: Ipv4Addr) -> Option<&'static str> {
    let o = v4.octets();
    if v4.is_loopback() {
        Some("loopback (127.0.0.0/8)")
    } else if v4.is_private() {
        Some("private (10/8, 172.16/12, 192.168/16)")
    } else if v4.is_link_local() {
        Some("link-local (169.254.0.0/16, where cloud metadata lives)")
    } else if v4.is_unspecified() || o[0] == 0 {
        Some("this network (0.0.0.0/8)")
    } else if o[0] == 100 && (o[1] & 0xc0) == 64 {
        Some("carrier-grade NAT (100.64.0.0/10)")
    } else if v4.is_broadcast() {
        Some("broadcast")
    } else if v4.is_multicast() {
        Some("multicast (224.0.0.0/4)")
    } else if o[0] >= 240 {
        Some("reserved (240.0.0.0/4)")
    } else if v4.is_documentation() {
        Some("documentation")
    } else if o[0] == 192 && o[1] == 0 && o[2] == 0 {
        Some("IETF protocol assignments (192.0.0.0/24)")
    } else if o[0] == 198 && (o[1] & 0xfe) == 18 {
        Some("benchmarking (198.18.0.0/15)")
    } else {
        None
    }
}

/// The IPv4 address inside a NAT64 (64:ff9b::/96) address, if this is one.
fn nat64_embedded_v4(v6: &Ipv6Addr) -> Option<Ipv4Addr> {
    let s = v6.segments();
    if s[0] == 0x64 && s[1] == 0xff9b && s[2..6].iter().all(|x| *x == 0) {
        let o = v6.octets();
        Some(Ipv4Addr::new(o[12], o[13], o[14], o[15]))
    } else {
        None
    }
}

/// An [`HttpSender`] that checks each hop's URL against the policy before delegating.
///
/// The engine's redirect loop calls the sender once per hop with the hop's URL, so wrapping
/// the sender is what makes `Location:` headers subject to the same rules as the first URL —
/// including a redirect to a literal internal IP, which the resolver would never see.
pub struct GuardedSender<S> {
    inner: S,
    policy: DestinationPolicy,
}

impl<S: HttpSender> GuardedSender<S> {
    pub fn new(inner: S, policy: DestinationPolicy) -> Self {
        Self { inner, policy }
    }
}

#[async_trait]
impl<S: HttpSender> HttpSender for GuardedSender<S> {
    async fn send(
        &self,
        request: SendableHttpRequest,
        event_tx: mpsc::Sender<HttpResponseEvent>,
    ) -> yaak_http::error::Result<HttpResponse> {
        if let Err(reason) = self.policy.check_url(&request.url) {
            warn!("Refused {} {}: {reason}", request.method, request.url);
            return Err(yaak_http::error::Error::RequestError(reason));
        }
        self.inner.send(request, event_tx).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn refuses_the_ranges_a_relay_must_never_reach() {
        for addr in [
            "127.0.0.1",
            "127.9.9.9",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "169.254.0.1",
            "0.0.0.0",
            "100.64.0.1",
            "255.255.255.255",
            "224.0.0.1",
            "240.0.0.1",
            "::1",
            "::",
            "fc00::1",
            "fd12::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::7f00:1",
            "ff02::1",
        ] {
            assert!(non_public_reason(ip(addr)).is_some(), "{addr} should be refused");
        }
    }

    #[test]
    fn allows_public_addresses() {
        for addr in [
            "1.1.1.1",
            "8.8.8.8",
            "93.184.216.34",
            "172.32.0.1",
            "2606:4700:4700::1111",
        ] {
            assert!(non_public_reason(ip(addr)).is_none(), "{addr} should be allowed");
        }
    }

    #[test]
    fn private_networks_can_be_opted_in() {
        let policy = DestinationPolicy::new(true, &[], &[]);
        assert!(policy.check_url("http://127.0.0.1/").is_ok());
        assert!(policy.check_url("http://169.254.169.254/").is_ok());
        let policy = DestinationPolicy::new(false, &[], &[]);
        assert!(policy.check_url("http://127.0.0.1/").is_err());
        assert!(policy.check_url("http://[::1]/").is_err());
        assert!(policy.check_url("http://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn host_lists() {
        let policy = DestinationPolicy::new(
            false,
            &["*.example.com".into(), "api.test".into()],
            &["bad.example.com".into()],
        );
        assert!(policy.check_url("https://example.com/").is_ok());
        assert!(policy.check_url("https://a.b.example.com/").is_ok());
        assert!(policy.check_url("https://api.test/").is_ok());
        assert!(policy.check_url("https://API.TEST./").is_ok());
        assert!(policy.check_url("https://bad.example.com/").is_err(), "deny wins over allow");
        assert!(policy.check_url("https://notexample.com/").is_err());
        assert!(policy.check_url("https://httpbin.org/").is_err(), "not on the allow list");
    }

    #[test]
    fn only_http_schemes() {
        let policy = DestinationPolicy::new(true, &[], &[]);
        assert!(policy.check_url("ftp://example.com/").is_err());
        assert!(policy.check_url("file:///etc/passwd").is_err());
        assert!(policy.check_url("https://example.com/").is_ok());
    }
}
