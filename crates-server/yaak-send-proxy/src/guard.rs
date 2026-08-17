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

/// The destination policy, shared by every send: public addresses only, always. A hosted
/// proxy's "private network" is the cloud's, not the user's, so there is no configuration
/// that makes reaching it right.
#[derive(Clone, Default)]
pub struct DestinationPolicy;

impl DestinationPolicy {
    /// Check a URL before a hop is attempted: scheme and literal IPs. A hostname that passes
    /// here still has its resolved addresses checked by [`Self::address_filter`].
    pub fn check_url(&self, raw: &str) -> Result<(), String> {
        let url = Url::parse(raw).map_err(|e| format!("Invalid URL {raw:?}: {e}"))?;
        match url.scheme() {
            "http" | "https" => {}
            other => return Err(format!("Refusing to send over {other:?}; only http and https")),
        }
        let host = url.host_str().ok_or_else(|| format!("URL {raw:?} has no host"))?;
        let host = host.trim_matches(|c| c == '[' || c == ']');

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
/// (169.254.169.254) live. IPv4 addresses carried inside IPv6 forms — IPv4-mapped, the
/// well-known and local-use NAT64 prefixes, 6to4 — are unwrapped and judged as IPv4, since
/// that is where the packets end up. (A network-specific NAT64 prefix is not knowable here.)
pub fn non_public_reason(ip: IpAddr) -> Option<&'static str> {
    match ip {
        IpAddr::V4(v4) => non_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return non_public_v4(v4);
            }
            if let Some(reason) = embedded_v4(&v6).into_iter().find_map(non_public_v4) {
                return Some(reason);
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

/// The IPv4 addresses an IPv6 address may stand for, when it is one of the standard
/// translation forms: the NAT64 well-known prefix (64:ff9b::/96), the NAT64 local-use range
/// (64:ff9b:1::/48, RFC 8215), or 6to4 (2002::/16, IPv4 in the next 32 bits).
///
/// The local-use range is a pool an operator carves their own prefix from, at any of the
/// lengths RFC 6052 allows, so where the IPv4 sits inside it is not knowable here. Every
/// position it could occupy is returned, and the caller refuses if any of them is
/// non-public — a hosted relay would rather turn away an odd address than reach the wrong one.
fn embedded_v4(v6: &Ipv6Addr) -> Vec<Ipv4Addr> {
    let s = v6.segments();
    let o = v6.octets();
    let v4 = |a: usize, b: usize, c: usize, d: usize| Ipv4Addr::new(o[a], o[b], o[c], o[d]);
    if s[0] == 0x64 && s[1] == 0xff9b && s[2..6].iter().all(|x| *x == 0) {
        return vec![v4(12, 13, 14, 15)];
    }
    if s[0] == 0x64 && s[1] == 0xff9b && s[2] == 1 {
        // RFC 6052 layouts for a /48, /56, /64 and /96 prefix; octet 8 is the reserved `u`
        // byte, skipped by the layouts that straddle it.
        return vec![
            v4(6, 7, 9, 10),
            v4(7, 9, 10, 11),
            v4(9, 10, 11, 12),
            v4(12, 13, 14, 15),
        ];
    }
    if s[0] == 0x2002 {
        return vec![v4(2, 3, 4, 5)];
    }
    Vec::new()
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
    fn literal_private_addresses_in_urls_are_refused() {
        let policy = DestinationPolicy;
        assert!(policy.check_url("http://127.0.0.1/").is_err());
        assert!(policy.check_url("http://[::1]/").is_err());
        assert!(policy.check_url("http://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn only_http_schemes() {
        let policy = DestinationPolicy;
        assert!(policy.check_url("ftp://example.com/").is_err());
        assert!(policy.check_url("file:///etc/passwd").is_err());
        assert!(policy.check_url("https://example.com/").is_ok());
    }
}
