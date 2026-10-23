use std::{net::IpAddr, sync::OnceLock};

use axum::{
    body::Body,
    extract::Request,
    http::{StatusCode, header},
    response::Response,
};
use relay_client::RELAY_HEADER;
use url::Url;

#[derive(Clone, Debug, Eq, PartialEq)]
struct OriginKey {
    https: bool,
    host: String,
    port: u16,
}

impl OriginKey {
    fn from_origin(origin: &str) -> Option<Self> {
        let url = Url::parse(origin).ok()?;
        let https = match url.scheme() {
            "http" => false,
            "https" => true,
            _ => return None,
        };
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return None;
        }
        let host = normalize_host(url.host_str()?);
        let port = url.port_or_known_default()?;
        Some(Self { https, host, port })
    }

    fn from_host_header(host: &str, https: bool) -> Option<Self> {
        let authority: axum::http::uri::Authority = host.parse().ok()?;
        if authority.as_str().contains('@') {
            return None;
        }
        let suffix = &authority.as_str()[authority.host().len()..];
        if !suffix.is_empty()
            && suffix
                .strip_prefix(':')
                .and_then(|port| port.parse::<u16>().ok())
                .is_none()
        {
            return None;
        }
        let host = normalize_host(authority.host());
        let port = authority.port_u16().unwrap_or_else(|| default_port(https));
        Some(Self { https, host, port })
    }
}

#[allow(clippy::result_large_err)]
pub fn validate_origin<B>(req: &mut Request<B>) -> Result<(), Response> {
    validate_origin_with_policy(req, allowed_origins(), &configured_host())
}

#[allow(clippy::result_large_err)]
fn validate_origin_with_policy<B>(
    req: &mut Request<B>,
    allowed: &[OriginKey],
    bind_host: &str,
) -> Result<(), Response> {
    let Some(host) = get_host_header(req) else {
        return Err(forbidden());
    };
    if req.headers().get_all(header::HOST).iter().count() != 1
        || !trusted_host(host, allowed, bind_host)
    {
        return Err(forbidden());
    }
    // Relay-proxied requests are authenticated through the relay's own session
    // system, so origin validation is not applicable.
    if is_relay_request(req) {
        return Ok(());
    }

    let Some(origin) = get_origin_header(req) else {
        return Ok(());
    };

    if origin.eq_ignore_ascii_case("null") {
        return Err(forbidden());
    }

    let host = Some(host);

    // quick short-circuit same-origin check
    if host.is_some_and(|host| origin_matches_host(origin, host)) {
        return Ok(());
    }

    let Some(origin_key) = OriginKey::from_origin(origin) else {
        return Err(forbidden());
    };

    if allowed.iter().any(|allowed| allowed == &origin_key) {
        return Ok(());
    }

    if let Some(host_key) =
        host.and_then(|host| OriginKey::from_host_header(host, origin_key.https))
        && host_key == origin_key
    {
        return Ok(());
    }

    Err(forbidden())
}

fn trusted_host(host: &str, allowed: &[OriginKey], bind_host: &str) -> bool {
    let Some(http) = OriginKey::from_host_header(host, false) else {
        return false;
    };
    if http.host == "localhost" || http.host == normalize_host(bind_host) {
        return true;
    }
    let https = OriginKey::from_host_header(host, true);
    allowed
        .iter()
        .any(|origin| origin == &http || Some(origin) == https.as_ref())
}

fn configured_host() -> String {
    std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn get_origin_header<B>(req: &Request<B>) -> Option<&str> {
    get_header(req, header::ORIGIN)
}

fn get_host_header<B>(req: &Request<B>) -> Option<&str> {
    get_header(req, header::HOST)
}

fn get_header<B>(req: &Request<B>, name: header::HeaderName) -> Option<&str> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
}

fn is_relay_request<B>(req: &Request<B>) -> bool {
    req.headers()
        .get(RELAY_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim() == "1")
}

fn forbidden() -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .is_some_and(|rest| rest.eq_ignore_ascii_case(host))
}

fn normalize_host(host: &str) -> String {
    let trimmed = host.trim().trim_start_matches('[').trim_end_matches(']');
    let lower = trimmed.to_ascii_lowercase();
    if lower == "localhost" {
        return "localhost".to_string();
    }
    if let Ok(ip) = lower.parse::<IpAddr>() {
        if ip.is_loopback() {
            return "localhost".to_string();
        }
        return ip.to_string();
    }
    lower
}

fn default_port(https: bool) -> u16 {
    if https { 443 } else { 80 }
}

fn allowed_origins() -> &'static Vec<OriginKey> {
    static ALLOWED: OnceLock<Vec<OriginKey>> = OnceLock::new();
    ALLOWED.get_or_init(|| {
        let value = match std::env::var("VK_ALLOWED_ORIGINS") {
            Ok(value) => value,
            Err(_) => return Vec::new(),
        };

        value
            .split(',')
            .filter_map(|origin| OriginKey::from_origin(origin.trim()))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use axum::http::{Request, header};

    use super::*;

    fn make_request(origin: Option<&str>, host: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().uri("/test").method("GET");
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        if let Some(host) = host {
            builder = builder.header(header::HOST, host);
        }
        builder.body(Body::empty()).unwrap()
    }

    fn is_forbidden(result: Result<(), Response>) -> bool {
        matches!(result, Err(resp) if resp.status() == StatusCode::FORBIDDEN)
    }

    #[test]
    fn no_origin_header_allows_trusted_local_request() {
        let mut req = make_request(None, Some("localhost:3000"));
        assert!(validate_origin(&mut req).is_ok());
    }

    #[test]
    fn null_origin_is_forbidden() {
        for null in ["null", "NULL", "Null"] {
            let mut req = make_request(Some(null), Some("example.com"));
            assert!(is_forbidden(validate_origin(&mut req)));
        }
    }

    #[test]
    fn same_origin_allows_request() {
        // HTTP, HTTPS, with port, case-insensitive
        let cases = [
            ("http://example.com", "example.com"),
            ("https://example.com", "example.com"),
            ("http://example.com:8080", "example.com:8080"),
            ("http://EXAMPLE.COM", "example.com"),
        ];
        for (origin, host) in cases {
            let mut req = make_request(Some(origin), Some(host));
            let allowed = vec![OriginKey::from_origin(origin).unwrap()];
            assert!(
                validate_origin_with_policy(&mut req, &allowed, "127.0.0.1").is_ok(),
                "{origin} vs {host}"
            );
        }
    }

    #[test]
    fn cross_origin_forbidden() {
        let cases = [
            ("http://unknown.com", "example.com"),         // different host
            ("http://example.com:8080", "example.com:80"), // different port
            ("ftp://example.com", "example.com"),          // non-http scheme
            ("not-a-valid-url", "example.com"),            // invalid URL
            ("http://example.com", ""),                    // missing host (invalid)
        ];
        for (origin, host) in cases {
            let host_opt = if host.is_empty() { None } else { Some(host) };
            let mut req = make_request(Some(origin), host_opt);
            assert!(is_forbidden(validate_origin(&mut req)), "{origin}");
        }
    }

    #[test]
    fn loopback_addresses_normalized_and_equivalent() {
        // All loopback forms normalize to "localhost"
        assert_eq!(
            OriginKey::from_origin("http://localhost:3000")
                .unwrap()
                .host,
            "localhost"
        );
        assert_eq!(
            OriginKey::from_origin("http://127.0.0.1:3000")
                .unwrap()
                .host,
            "localhost"
        );
        assert_eq!(
            OriginKey::from_origin("http://[::1]:3000").unwrap().host,
            "localhost"
        );

        // Cross-loopback requests should be allowed
        let mut req = make_request(Some("http://127.0.0.1:3000"), Some("[::1]:3000"));
        assert!(validate_origin(&mut req).is_ok());
    }

    #[test]
    fn default_ports_handled_correctly() {
        assert_eq!(
            OriginKey::from_origin("http://example.com").unwrap().port,
            80
        );
        assert_eq!(
            OriginKey::from_origin("https://example.com").unwrap().port,
            443
        );

        // Explicit default port matches implicit
        let mut req = make_request(Some("http://localhost:80"), Some("localhost"));
        assert!(validate_origin(&mut req).is_ok());
    }
    #[test]
    fn arbitrary_same_origin_hostname_is_not_authority() {
        for origin in [None, Some("http://attacker.example:3000")] {
            let mut req = make_request(origin, Some("attacker.example:3000"));
            assert!(is_forbidden(validate_origin_with_policy(
                &mut req,
                &[],
                "127.0.0.1"
            )));
            req.headers_mut().insert(RELAY_HEADER, "1".parse().unwrap());
            assert!(is_forbidden(validate_origin_with_policy(
                &mut req,
                &[],
                "127.0.0.1"
            )));
        }
    }

    #[test]
    fn configured_proxy_origins_and_bound_interfaces_remain_supported() {
        let allowed = vec![OriginKey::from_origin("https://preview.example:8443").unwrap()];
        for (origin, host, bind) in [
            (
                Some("https://preview.example:8443"),
                "preview.example:8443",
                "127.0.0.1",
            ),
            (None, "preview.example:8443", "127.0.0.1"),
            (
                Some("https://preview.example:8443"),
                "localhost:3000",
                "127.0.0.1",
            ),
            (None, "192.168.1.10:3000", "192.168.1.10"),
            (None, "0.0.0.0:3000", "0.0.0.0"),
        ] {
            let mut req = make_request(origin, Some(host));
            assert!(validate_origin_with_policy(&mut req, &allowed, bind).is_ok());
        }
        for host in [
            "preview.example:8444",
            "attacker.example:8443",
            "192.168.1.10:3000",
        ] {
            let mut req = make_request(None, Some(host));
            assert!(is_forbidden(validate_origin_with_policy(
                &mut req, &allowed, "0.0.0.0"
            )));
        }
    }

    #[test]
    fn absent_or_malformed_host_is_rejected() {
        for host in [
            None,
            Some("localhost:65536"),
            Some("localhost:bad"),
            Some("evil@localhost"),
        ] {
            let mut req = make_request(None, host);
            assert!(is_forbidden(validate_origin_with_policy(
                &mut req,
                &[],
                "127.0.0.1"
            )));
        }
    }

    #[test]
    fn local_relay_requests_keep_the_signed_authentication_path() {
        let mut req = make_request(Some("https://relay.example"), Some("127.0.0.1:3000"));
        req.headers_mut().insert(RELAY_HEADER, "1".parse().unwrap());
        assert!(validate_origin_with_policy(&mut req, &[], "127.0.0.1").is_ok());
    }
}
