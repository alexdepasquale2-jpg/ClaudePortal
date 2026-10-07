//! URL and address rules for the net Organ, in step with the Warden.
//!
//! The Warden approves a URL by its host. Two things could still send a
//! request somewhere it never approved: a redirect, and a domain whose DNS
//! answer points into the local network (DNS rebinding). Redirects are
//! followed only within the approved host; the rebinding guard checks the
//! address actually connected to.

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use ureq::config::Config;
use ureq::http::Uri;
use ureq::unversioned::resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::NextTimeout;
use url::Url;
use xz_types::{Result, XzError};

/// Parses a URL argument strictly: no base URL, no guessed scheme, and
/// only http(s), exactly as the Warden reads it.
pub(crate) fn parse(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|e| {
        XzError::InvalidArgs(format!(
            "`{raw}` is not a full URL ({e}); write it with its scheme, e.g. https://example.com/page"
        ))
    })?;
    if !is_web(&url) {
        return Err(XzError::InvalidArgs(format!(
            "only http and https URLs are allowed, not `{}:`",
            url.scheme()
        )));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(XzError::InvalidArgs(format!("`{raw}` has no host")));
    }
    Ok(url)
}

fn is_web(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Decides one redirect hop from the URL the Warden approved (`first`):
/// follow it (same host and port), or hand it back to the planner, whose
/// next call the Warden checks like any new URL. Following a hop to
/// another host would skip the egress allowlist, and an open redirector
/// on an approved site would then reach anywhere.
pub(crate) fn follows(first: &Url, next: &Url) -> Result<bool> {
    if !is_web(next) {
        return Err(XzError::Denied(format!(
            "refused a redirect to a `{}:` URL; only http and https are allowed",
            next.scheme()
        )));
    }
    Ok(next.host() == first.host() && next.port() == first.port())
}

fn is_localhost_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || h.ends_with(".localhost")
}

/// False for loopback, unspecified, private, link-local and shared
/// (CGNAT) addresses: the same ranges the Warden treats as local or LAN.
pub(crate) fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return false;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let seg = v6.segments();
            if let [0, 0, 0, 0, 0, 0, hi, lo] = seg {
                return is_public_v4(Ipv4Addr::from((u32::from(hi) << 16) | u32::from(lo)));
            }
            // fc00::/7 unique local, fe80::/10 link local, fec0::/10 site local.
            !(seg[0] & 0xfe00 == 0xfc00 || seg[0] & 0xffc0 == 0xfe80 || seg[0] & 0xffc0 == 0xfec0)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    !matches!(
        ip.octets(),
        [127 | 0 | 10, ..]
            | [192, 168, ..]
            | [169, 254, ..]
            | [172, 16..=31, ..]
            | [100, 64..=127, ..]
    )
}

/// Vets a DNS answer for `host` (as written in the request URI). IP
/// literals and localhost names pass: the Warden has already judged them
/// by name. Any other name must resolve to public addresses only.
pub(crate) fn vet(host: &str, addrs: &[SocketAddr]) -> std::result::Result<(), String> {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.parse::<IpAddr>().is_ok() || is_localhost_name(bare) {
        return Ok(());
    }
    match addrs.iter().find(|a| !is_public(a.ip())) {
        Some(a) => Err(format!(
            "`{host}` resolves to the local or private address {}; refusing to connect \
             (DNS rebinding guard)",
            a.ip()
        )),
        None => Ok(()),
    }
}

/// The refusal a [`GuardedResolver`] returns through ureq.
#[derive(Debug)]
pub(crate) struct Blocked(pub String);

impl fmt::Display for Blocked {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Blocked {}

/// Resolves with `R`, then applies [`vet`] to the answer, so the address
/// checked is the address connected to.
#[derive(Debug, Default)]
pub(crate) struct GuardedResolver<R = DefaultResolver>(pub R);

impl<R: Resolver> Resolver for GuardedResolver<R> {
    fn resolve(
        &self,
        uri: &Uri,
        config: &Config,
        timeout: NextTimeout,
    ) -> std::result::Result<ResolvedSocketAddrs, ureq::Error> {
        let addrs = self.0.resolve(uri, config, timeout)?;
        vet(uri.host().unwrap_or_default(), &addrs)
            .map_err(|why| ureq::Error::Other(Box::new(Blocked(why))))?;
        Ok(addrs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn parses_strictly() {
        assert!(parse("https://example.com/a").is_ok());
        for bad in [
            "example.com",
            "www.example.com/page",
            "localhost:8080",
            "file:///etc/passwd",
            "ftp://h/x",
            "javascript:alert(1)",
            "data:text/html,x",
            "",
        ] {
            assert!(matches!(parse(bad), Err(XzError::InvalidArgs(_))), "{bad}");
        }
    }

    #[test]
    fn redirect_rules() {
        let first = u("http://example.com/a");
        // Same host and port: followed, including the upgrade to https.
        for same in [
            "http://example.com/b?x=1",
            "https://example.com/",
            "http://EXAMPLE.com:80/",
        ] {
            assert!(follows(&first, &u(same)).unwrap(), "{same}");
        }
        // Anywhere else goes back to the planner and through the Warden.
        for other in [
            "http://www.example.com/",
            "http://example.com:8080/",
            "http://127.0.0.1/",
            "http://localhost/",
            "http://169.254.169.254/latest/meta-data",
            "https://evil.example/?secret=1",
        ] {
            assert!(!follows(&first, &u(other)).unwrap(), "{other}");
        }
        for scheme in [
            "file:///etc/passwd",
            "ftp://example.com/",
            "data:text/plain,x",
        ] {
            let e = follows(&first, &u(scheme)).unwrap_err();
            assert!(matches!(e, XzError::Denied(_)), "{scheme}");
        }
    }

    #[test]
    fn classifies_addresses() {
        for ip in [
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "2001:db8::1",
            "::ffff:8.8.8.8",
        ] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "127.0.0.1",
            "0.0.0.0",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fec0::1",
            "::127.0.0.1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn vets_dns_answers() {
        let local: SocketAddr = "127.0.0.1:80".parse().unwrap();
        let public: SocketAddr = "93.184.216.34:80".parse().unwrap();
        assert!(vet("example.com", &[public]).is_ok());
        assert!(vet("evil.example", &[public, local]).is_err());
        assert!(vet("localhost", &[local]).is_ok());
        assert!(vet("LOCALHOST.", &[local]).is_ok());
        assert!(vet("127.0.0.1", &[local]).is_ok());
        assert!(vet("[::1]", &["[::1]:80".parse().unwrap()]).is_ok());
        assert!(vet("localhost.evil.com", &[local]).is_err());
    }
}
