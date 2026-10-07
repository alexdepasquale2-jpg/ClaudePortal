use super::NetOrgan;
use crate::content::tiny_pdf;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use ureq::config::Config;
use ureq::http::Uri;
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::NextTimeout;
use xz_types::{CallCtx, Effect, Organ, Risk, ToolOutput, XzError};

/// A minimal HTTP/1.1 server on 127.0.0.1, one thread per connection.
fn serve() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream, addr));
        }
    });
    addr
}

fn handle(stream: TcpStream, addr: SocketAddr) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    reader.read_line(&mut request_line).unwrap();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let (mut length, mut ctype) = (0usize, String::new());
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if line.trim().is_empty() {
            break;
        }
        let (k, v) = line.split_once(':').unwrap();
        match k.to_ascii_lowercase().as_str() {
            "content-length" => length = v.trim().parse().unwrap(),
            "content-type" => ctype = v.trim().to_string(),
            _ => {}
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();

    let html = "<html><head><title>Test Page</title><script>evil()</script></head>\
                <body><nav>Menu</nav><p>Hello <i>reader</i>.</p><footer>(c)</footer></body></html>";
    let (status, extra, ctype_out, payload): (&str, String, &str, Vec<u8>) = match path.as_str() {
        "/page" => (
            "200 OK",
            String::new(),
            "text/html; charset=utf-8",
            html.into(),
        ),
        "/r1" => (
            "302 Found",
            "Location: /r2\r\n".into(),
            "text/plain",
            vec![],
        ),
        "/r2" => (
            "301 Moved Permanently",
            format!("Location: http://{addr}/page\r\n"),
            "text/plain",
            vec![],
        ),
        "/loop" => (
            "302 Found",
            "Location: /loop\r\n".into(),
            "text/plain",
            vec![],
        ),
        "/elsewhere" => (
            "302 Found",
            format!("Location: http://localhost:{}/page\r\n", addr.port()),
            "text/plain",
            b"moved".to_vec(),
        ),
        "/to-file" => (
            "302 Found",
            "Location: file:///etc/passwd\r\n".into(),
            "text/plain",
            vec![],
        ),
        "/big" => ("200 OK", String::new(), "text/plain", vec![b'a'; 10_000]),
        "/bin" => (
            "200 OK",
            String::new(),
            "application/octet-stream",
            vec![0, 1, 2, 0xff],
        ),
        "/pdf" => (
            "200 OK",
            String::new(),
            "application/pdf",
            tiny_pdf("Remote PDF text"),
        ),
        "/echo" => {
            let echoed = json!({"method": method, "type": ctype,
                                "body": String::from_utf8_lossy(&body)});
            (
                "200 OK",
                String::new(),
                "application/json",
                echoed.to_string().into(),
            )
        }
        "/see-other" => (
            "303 See Other",
            "Location: /page\r\n".into(),
            "text/plain",
            vec![],
        ),
        _ => (
            "404 Not Found",
            String::new(),
            "text/plain",
            b"nope".to_vec(),
        ),
    };
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype_out}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n",
        payload.len()
    );
    let mut stream = stream;
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&payload);
}

async fn call(net: &NetOrgan, tool: &str, args: Value) -> Result<ToolOutput, XzError> {
    net.call(&CallCtx::test(), tool, args).await
}

async fn fetch(addr: SocketAddr, path: &str) -> Result<ToolOutput, XzError> {
    call(
        &NetOrgan::new(),
        "net.fetch",
        json!({"url": format!("http://{addr}{path}")}),
    )
    .await
}

#[test]
fn specs_match_the_catalog() {
    let t = NetOrgan::new().tools();
    assert_eq!(t[0].name, "net.fetch");
    assert_eq!(t[0].risk, Risk::Observe);
    assert_eq!(t[1].name, "net.post");
    assert_eq!(t[1].risk, Risk::Commit);
    for s in &t {
        assert_eq!(s.resource_args, ["url"]);
        assert!(s.tainted_output && s.first_party);
    }
}

#[tokio::test]
async fn fetch_extracts_html() {
    let addr = serve();
    let out = fetch(addr, "/page").await.unwrap();
    assert_eq!(out.content["status"], 200);
    assert_eq!(out.content["title"], "Test Page");
    assert_eq!(out.content["text"], "Hello reader.");
    assert_eq!(out.content["content_type"], "text/html; charset=utf-8");
    assert!(out.taint.sources.contains("web:127.0.0.1"));
    assert!(out.effects.is_empty());

    let out = fetch(addr, "/missing").await.unwrap();
    assert_eq!(out.content["status"], 404);
    assert_eq!(out.content["text"], "nope");
}

#[tokio::test]
async fn fetch_follows_redirects_within_limits() {
    let addr = serve();
    let out = fetch(addr, "/r1").await.unwrap();
    assert_eq!(out.content["url"], format!("http://{addr}/page"));
    assert_eq!(out.content["title"], "Test Page");

    let e = fetch(addr, "/loop").await.unwrap_err();
    assert!(e.to_string().contains("redirects"), "{e}");

    let e = fetch(addr, "/to-file").await.unwrap_err();
    assert!(matches!(e, XzError::Denied(_)), "{e}");

    // Another host is handed back for the Warden to check, not followed.
    let out = fetch(addr, "/elsewhere").await.unwrap();
    assert_eq!(out.content["status"], 302);
    let port = addr.port();
    assert_eq!(
        out.content["location"],
        format!("http://localhost:{port}/page")
    );
    assert!(out.content["note"].as_str().unwrap().contains("location"));
    assert_eq!(out.taint.sources.len(), 1);
    assert!(out.taint.sources.contains("web:127.0.0.1"));
}

#[tokio::test]
async fn fetch_truncates_and_classifies() {
    let addr = serve();
    let net = NetOrgan::new();
    let out = call(
        &net,
        "net.fetch",
        json!({"url": format!("http://{addr}/big"), "max_bytes": 100}),
    )
    .await
    .unwrap();
    assert_eq!(out.content["text"].as_str().unwrap().len(), 100);
    assert_eq!(out.content["truncated"], true);

    let out = fetch(addr, "/bin").await.unwrap();
    assert_eq!(out.content["binary"], true);
    assert_eq!(out.content["size"], 4);

    let out = fetch(addr, "/pdf").await.unwrap();
    assert!(
        out.content["text"]
            .as_str()
            .unwrap()
            .contains("Remote PDF text")
    );
}

#[tokio::test]
async fn bad_urls_are_invalid_args() {
    let net = NetOrgan::new();
    for url in [
        "example.com",
        "localhost:8080",
        "file:///etc/passwd",
        "ftp://x/y",
    ] {
        let e = call(&net, "net.fetch", json!({"url": url}))
            .await
            .unwrap_err();
        assert!(matches!(e, XzError::InvalidArgs(_)), "{url}: {e}");
    }
    let e = call(
        &net,
        "net.fetch",
        json!({"url": "http://x/", "max_bytes": 0}),
    )
    .await
    .unwrap_err();
    assert!(matches!(e, XzError::InvalidArgs(_)));
    assert!(matches!(
        call(&net, "net.get", json!({})).await,
        Err(XzError::UnknownTool(_))
    ));
}

/// Answers every lookup with this machine, as a rebinding attacker would.
#[derive(Debug)]
struct Rebinder;

impl Resolver for Rebinder {
    fn resolve(
        &self,
        uri: &Uri,
        _config: &Config,
        _timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let mut out = self.empty();
        out.push(SocketAddr::from((
            [127, 0, 0, 1],
            uri.port_u16().unwrap_or(80),
        )));
        Ok(out)
    }
}

#[tokio::test]
async fn dns_rebinding_is_refused() {
    let addr = serve();
    let net = NetOrgan::with_resolver(Rebinder);
    let port = addr.port();
    let e = call(
        &net,
        "net.fetch",
        json!({"url": format!("http://rebind.example:{port}/page")}),
    )
    .await
    .unwrap_err();
    assert!(matches!(e, XzError::Denied(_)), "{e}");
    assert!(e.to_string().contains("rebinding"), "{e}");
    // A URL that names localhost itself may reach it.
    let out = call(
        &net,
        "net.fetch",
        json!({"url": format!("http://localhost:{port}/page")}),
    )
    .await
    .unwrap();
    assert_eq!(out.content["title"], "Test Page");
    assert!(out.taint.sources.contains("web:localhost"));
}

#[tokio::test]
async fn post_sends_and_does_not_follow_redirects() {
    let addr = serve();
    let net = NetOrgan::new();
    let out = call(
        &net,
        "net.post",
        json!({"url": format!("http://{addr}/echo"), "body": {"a": 1}}),
    )
    .await
    .unwrap();
    let echoed: Value = serde_json::from_str(out.content["text"].as_str().unwrap()).unwrap();
    assert_eq!(echoed["method"], "POST");
    assert_eq!(echoed["type"], "application/json");
    assert_eq!(echoed["body"], r#"{"a":1}"#);
    assert!(!out.taint.is_clean());
    assert!(matches!(&out.effects[..], [Effect::Irreversible { .. }]));

    let out = call(
        &net,
        "net.post",
        json!({"url": format!("http://{addr}/echo"), "body": "hi", "content_type": "text/csv"}),
    )
    .await
    .unwrap();
    let echoed: Value = serde_json::from_str(out.content["text"].as_str().unwrap()).unwrap();
    assert_eq!(echoed["type"], "text/csv");
    assert_eq!(echoed["body"], "hi");

    let out = call(
        &net,
        "net.post",
        json!({"url": format!("http://{addr}/see-other"), "body": ""}),
    )
    .await
    .unwrap();
    assert_eq!(out.content["status"], 303);
    assert_eq!(out.content["location"], "/page");
}
