//! Ollama over its local HTTP API (SPEC §3.6). Plain HTTP only: Ollama
//! listens on localhost, so no TLS stack is linked.

use crate::structured::strip_think;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use xz_types::{ChatMessage, GenRequest, GenResponse, ModelBackend, XzError};

/// Talks to an Ollama server.
pub struct OllamaBackend {
    base: String,
    client: reqwest::Client,
    timeout: Duration,
    num_ctx: u32,
}

impl OllamaBackend {
    pub const ID: &'static str = "ollama";
    pub const DEFAULT_URL: &'static str = "http://127.0.0.1:11434";
    /// Environment variable that overrides the server URL.
    pub const URL_ENV: &'static str = "XZ_OLLAMA_URL";
    /// How long `available` waits before calling the server absent.
    const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
    /// Keep the model loaded between Intent Bar requests.
    pub const KEEP_ALIVE: &'static str = "30m";
    /// Fits qwen3:8b on a 4 GB GPU. Override with `XZ_NUM_CTX`.
    pub const DEFAULT_NUM_CTX: u32 = 4096;
    /// Environment variable that overrides [`Self::DEFAULT_NUM_CTX`].
    pub const NUM_CTX_ENV: &'static str = "XZ_NUM_CTX";

    /// A backend for the server at `base_url`, e.g. `http://127.0.0.1:11434`.
    pub fn new(base_url: impl Into<String>) -> Result<Self, XzError> {
        let base = base_url.into().trim_end_matches('/').to_string();
        if !base.starts_with("http://") {
            return Err(XzError::InvalidArgs(format!(
                "ollama url must be plain http (Ollama is local): {base}"
            )));
        }
        let client = reqwest::Client::builder()
            // Ollama is local; a system proxy would only get in the way.
            .no_proxy()
            .connect_timeout(Self::PROBE_TIMEOUT)
            .build()
            .map_err(|e| XzError::Other(format!("http client: {e}")))?;
        Ok(Self {
            base,
            client,
            // Large models on a CPU can take minutes to answer.
            timeout: Duration::from_secs(600),
            num_ctx: Self::DEFAULT_NUM_CTX,
        })
    }

    /// `XZ_NUM_CTX` when it is a positive integer, otherwise 4096.
    pub fn context_from_env() -> u32 {
        std::env::var(Self::NUM_CTX_ENV)
            .ok()
            .and_then(|raw| raw.trim().parse().ok())
            .filter(|n| *n > 0)
            .unwrap_or(Self::DEFAULT_NUM_CTX)
    }

    /// Uses `$XZ_OLLAMA_URL`, or the default local URL.
    pub fn from_env() -> Result<Self, XzError> {
        let url = std::env::var(Self::URL_ENV)
            .ok()
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| Self::DEFAULT_URL.into());
        Ok(Self::new(url)?.with_context(Self::context_from_env()))
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }

    /// Overall time limit for one `generate` or `embed` call.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Context window sent on every call (`options.num_ctx`).
    ///
    /// Warm-up and real requests must use this same value. A different
    /// `num_ctx` makes Ollama reload the model.
    pub fn with_context(mut self, num_ctx: u32) -> Self {
        self.num_ctx = num_ctx.max(1);
        self
    }

    pub fn num_ctx(&self) -> u32 {
        self.num_ctx
    }

    /// Load `model` and hold it with [`Self::KEEP_ALIVE`]. Uses the same
    /// `num_ctx` as [`Self::generate`].
    pub async fn warm(&self, model: &str) -> Result<(), XzError> {
        let mut req = GenRequest::new(xz_types::Role::Reflex, vec![ChatMessage::user("ok")]);
        req.max_tokens = 1;
        req.temperature = 0.0;
        self.generate(model, &req).await.map(|_| ())
    }

    async fn post(
        &self,
        path: &str,
        body: &impl Serialize,
        model: &str,
    ) -> Result<Vec<u8>, XzError> {
        let url = format!("{}{path}", self.base);
        let body = serde_json::to_vec(body)?;
        let resp = self
            .client
            .post(&url)
            .header("content-type", "application/json")
            .body(body)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| XzError::Model(format!("ollama at {} unreachable: {e}", self.base)))?;
        let status = resp.status();
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| XzError::Model(format!("ollama {path}: {e}")))?;
        if status.is_success() {
            return Ok(bytes.to_vec());
        }
        let msg = serde_json::from_slice::<ErrorBody>(&bytes)
            .map(|e| e.error)
            .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());
        if status == reqwest::StatusCode::NOT_FOUND {
            Err(XzError::NotFound(format!("ollama model {model}: {msg}")))
        } else {
            Err(XzError::Model(format!("ollama {path} {status}: {msg}")))
        }
    }
}

#[derive(Serialize)]
struct ChatBody<'a> {
    model: &'a str,
    // `ChatMessage` already serializes as Ollama's {role, content, images}.
    messages: &'a [ChatMessage],
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'a Value>,
    options: Value,
    keep_alive: &'a str,
    /// Qwen3 thinking. `false` keeps the planner on the answer. Omitted on
    /// the `/no_think` fallback when a server rejects the field.
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<bool>,
}

#[derive(Deserialize)]
struct ChatReply {
    message: ReplyMessage,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
    /// Nanoseconds.
    #[serde(default)]
    total_duration: u64,
}

#[derive(Deserialize)]
struct ReplyMessage {
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct EmbedReply {
    embeddings: Vec<Vec<f32>>,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: String,
}

fn chat_options(req: &GenRequest, num_ctx: u32) -> Value {
    // num_parallel stays unset. OLLAMA_NUM_PARALLEL must stay at 1; raising
    // it blows a 4 GB GPU that is already spilling qwen3:8b.
    json!({
        "temperature": req.temperature,
        "num_predict": req.max_tokens,
        "num_ctx": num_ctx,
    })
}

fn think_field_rejected(err: &XzError) -> bool {
    let text = err.to_string().to_ascii_lowercase();
    text.contains("think")
}

fn no_think_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut messages = messages.to_vec();
    if let Some(last) = messages
        .iter_mut()
        .rev()
        .find(|message| matches!(message.role, xz_types::MsgRole::User))
    {
        if !last.content.contains("/no_think") {
            if !last.content.is_empty() {
                last.content.push('\n');
            }
            last.content.push_str("/no_think");
        }
    }
    messages
}

#[async_trait]
impl ModelBackend for OllamaBackend {
    fn id(&self) -> &str {
        Self::ID
    }

    async fn available(&self) -> bool {
        let url = format!("{}/api/tags", self.base);
        match self
            .client
            .get(&url)
            .timeout(Self::PROBE_TIMEOUT)
            .send()
            .await
        {
            Ok(r) => r.status().is_success(),
            Err(_) => false,
        }
    }

    async fn generate(&self, model: &str, req: &GenRequest) -> Result<GenResponse, XzError> {
        let start = Instant::now();
        let options = chat_options(req, self.num_ctx);
        let body = ChatBody {
            model,
            messages: &req.messages,
            stream: false,
            format: req.json_schema.as_ref(),
            options: options.clone(),
            keep_alive: Self::KEEP_ALIVE,
            think: Some(false),
        };
        let bytes = match self.post("/api/chat", &body, model).await {
            Ok(bytes) => bytes,
            Err(err) if think_field_rejected(&err) => {
                let messages = no_think_messages(&req.messages);
                let fallback = ChatBody {
                    model,
                    messages: &messages,
                    stream: false,
                    format: req.json_schema.as_ref(),
                    options,
                    keep_alive: Self::KEEP_ALIVE,
                    think: None,
                };
                self.post("/api/chat", &fallback, model).await?
            }
            Err(err) => return Err(err),
        };
        let reply: ChatReply = serde_json::from_slice(&bytes)
            .map_err(|e| XzError::Model(format!("ollama /api/chat: bad reply: {e}")))?;
        let millis = match reply.total_duration / 1_000_000 {
            0 => start.elapsed().as_millis() as u64,
            ms => ms,
        };
        Ok(GenResponse {
            text: strip_think(&reply.message.content).to_string(),
            model: format!("{}:{model}", Self::ID),
            tokens_in: reply.prompt_eval_count,
            tokens_out: reply.eval_count,
            millis,
        })
    }

    async fn embed(&self, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        let body = json!({
            "model": model,
            "input": texts,
            "keep_alive": Self::KEEP_ALIVE,
        });
        let bytes = self.post("/api/embed", &body, model).await?;
        let reply: EmbedReply = serde_json::from_slice(&bytes)
            .map_err(|e| XzError::Model(format!("ollama /api/embed: bad reply: {e}")))?;
        if reply.embeddings.len() != texts.len() {
            return Err(XzError::Model(format!(
                "ollama /api/embed returned {} vectors for {} texts",
                reply.embeddings.len(),
                texts.len()
            )));
        }
        Ok(reply.embeddings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use xz_types::{ChatMessage, Role};

    type Handler = dyn Fn(&str, &str, &Value) -> (u16, Value) + Send + Sync;

    /// A tiny HTTP/1.1 server that mimics Ollama's JSON API.
    struct FakeOllama {
        url: String,
        seen: Arc<Mutex<Vec<(String, String, Value)>>>,
    }

    impl FakeOllama {
        async fn start(
            handler: impl Fn(&str, &str, &Value) -> (u16, Value) + Send + Sync + 'static,
        ) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let seen = Arc::new(Mutex::new(vec![]));
            let handler: Arc<Handler> = Arc::new(handler);
            let log = seen.clone();
            tokio::spawn(async move {
                while let Ok((mut sock, _)) = listener.accept().await {
                    let handler = handler.clone();
                    let log = log.clone();
                    tokio::spawn(async move {
                        let (method, path, body) = read_request(&mut sock).await;
                        log.lock()
                            .unwrap()
                            .push((method.clone(), path.clone(), body.clone()));
                        let (status, reply) = handler(&method, &path, &body);
                        let text = reply.to_string();
                        let head = format!(
                            "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                            text.len()
                        );
                        let _ = sock.write_all(head.as_bytes()).await;
                        let _ = sock.write_all(text.as_bytes()).await;
                    });
                }
            });
            Self { url, seen }
        }

        fn requests(&self) -> Vec<(String, String, Value)> {
            self.seen.lock().unwrap().clone()
        }
    }

    async fn read_request(sock: &mut tokio::net::TcpStream) -> (String, String, Value) {
        let mut buf = vec![];
        let mut chunk = [0u8; 4096];
        let header_end = loop {
            let n = sock.read(&mut chunk).await.unwrap();
            assert!(n > 0, "client closed early");
            buf.extend_from_slice(&chunk[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break i + 4;
            }
        };
        let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
        let mut lines = head.lines();
        let mut first = lines.next().unwrap().split(' ');
        let method = first.next().unwrap().to_string();
        let path = first.next().unwrap().to_string();
        let len = lines
            .filter_map(|l| l.split_once(':'))
            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            .map(|(_, v)| v.trim().parse::<usize>().unwrap())
            .unwrap_or(0);
        while buf.len() < header_end + len {
            let n = sock.read(&mut chunk).await.unwrap();
            buf.extend_from_slice(&chunk[..n]);
        }
        let body =
            serde_json::from_slice(&buf[header_end..header_end + len]).unwrap_or(Value::Null);
        (method, path, body)
    }

    fn chat_reply(content: &str) -> Value {
        json!({
            "model": "qwen3:0.6b", "created_at": "2026-01-01T00:00:00Z",
            "message": {"role": "assistant", "content": content},
            "done": true, "done_reason": "stop",
            "total_duration": 1_500_000_000u64, "prompt_eval_count": 12, "eval_count": 7
        })
    }

    #[tokio::test]
    async fn generate_posts_chat_with_schema_options_and_images() {
        let fake =
            FakeOllama::start(|_, _, _| (200, chat_reply("<think>hmm</think>\n{\"ok\":true}")))
                .await;
        let ollama = OllamaBackend::new(format!("{}/", fake.url))
            .unwrap()
            .with_context(8192);
        let mut msg = ChatMessage::user("what is this?");
        msg.images = vec!["aGk=".into()];
        let schema = json!({"type": "object", "properties": {"ok": {"type": "boolean"}}});
        let mut req = GenRequest::new(Role::Reflex, vec![ChatMessage::system("be brief"), msg])
            .with_schema(schema.clone());
        req.max_tokens = 64;
        req.temperature = 0.0;

        let out = ollama.generate("qwen3:0.6b", &req).await.unwrap();
        assert_eq!(out.text, "{\"ok\":true}");
        assert_eq!(out.model, "ollama:qwen3:0.6b");
        assert_eq!((out.tokens_in, out.tokens_out, out.millis), (12, 7, 1500));

        let reqs = fake.requests();
        let (method, path, body) = &reqs[0];
        assert_eq!((method.as_str(), path.as_str()), ("POST", "/api/chat"));
        assert_eq!(body["model"], "qwen3:0.6b");
        assert_eq!(body["stream"], false);
        assert_eq!(body["format"], schema);
        assert_eq!(
            body["options"],
            json!({"temperature": 0.0, "num_predict": 64, "num_ctx": 8192})
        );
        assert!(body["options"].get("num_parallel").is_none());
        assert_eq!(body["keep_alive"], "30m");
        assert_eq!(body["think"], false);
        assert_eq!(
            body["messages"][0],
            json!({"role": "system", "content": "be brief"})
        );
        assert_eq!(body["messages"][1]["images"], json!(["aGk="]));
    }

    #[tokio::test]
    async fn generate_without_schema_sends_no_format() {
        let fake = FakeOllama::start(|_, _, _| (200, chat_reply("hello"))).await;
        let ollama = OllamaBackend::new(&fake.url).unwrap();
        let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("hi")]);
        assert_eq!(ollama.generate("m", &req).await.unwrap().text, "hello");
        let reqs = fake.requests();
        let body = &reqs[0].2;
        assert!(body.get("format").is_none());
        assert_eq!(body["options"]["num_ctx"], json!(4096));
        assert_eq!(body["keep_alive"], "30m");
        assert_eq!(body["think"], false);
        assert!(body["options"].get("num_parallel").is_none());
    }

    #[tokio::test]
    async fn think_false_falls_back_to_no_think() {
        let fake = FakeOllama::start(|_, _, body| {
            if body.get("think").is_some() {
                (400, json!({"error": "unknown field think"}))
            } else {
                (200, chat_reply("{\"ok\":true}"))
            }
        })
        .await;
        let ollama = OllamaBackend::new(&fake.url).unwrap();
        let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("plan")]);
        assert_eq!(
            ollama.generate("qwen3:8b", &req).await.unwrap().text,
            "{\"ok\":true}"
        );
        let reqs = fake.requests();
        assert_eq!(reqs.len(), 2);
        assert_eq!(reqs[0].2["think"], false);
        assert_eq!(
            reqs[0].2["options"]["num_ctx"],
            reqs[1].2["options"]["num_ctx"]
        );
        assert!(reqs[1].2.get("think").is_none());
        assert!(
            reqs[1].2["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("/no_think")
        );
    }

    #[tokio::test]
    async fn warm_uses_the_same_num_ctx() {
        let fake = FakeOllama::start(|_, _, _| (200, chat_reply("ok"))).await;
        let ollama = OllamaBackend::new(&fake.url).unwrap().with_context(4096);
        ollama.warm("qwen3:8b").await.unwrap();
        let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("list files")]);
        ollama.generate("qwen3:8b", &req).await.unwrap();
        let reqs = fake.requests();
        assert_eq!(reqs[0].2["options"]["num_ctx"], json!(4096));
        assert_eq!(
            reqs[1].2["options"]["num_ctx"],
            reqs[0].2["options"]["num_ctx"]
        );
        assert_eq!(reqs[0].2["keep_alive"], reqs[1].2["keep_alive"]);
    }

    #[tokio::test]
    async fn embed_and_available() {
        let fake = FakeOllama::start(|method, path, body| match (method, path) {
            ("GET", "/api/tags") => (200, json!({"models": []})),
            ("POST", "/api/embed") => {
                let n = body["input"].as_array().map_or(0, Vec::len);
                (
                    200,
                    json!({"model": "e", "embeddings": vec![vec![0.5, 0.25]; n]}),
                )
            }
            _ => (404, json!({"error": "nope"})),
        })
        .await;
        let ollama = OllamaBackend::new(&fake.url).unwrap();
        assert!(ollama.available().await);
        let v = ollama
            .embed("all-minilm", &["a".into(), "b".into()])
            .await
            .unwrap();
        assert_eq!(v, vec![vec![0.5, 0.25]; 2]);
        assert!(ollama.embed("all-minilm", &[]).await.unwrap().is_empty());
        let reqs = fake.requests();
        assert_eq!(reqs.last().unwrap().2["input"], json!(["a", "b"]));
        assert_eq!(reqs.last().unwrap().2["keep_alive"], "30m");
    }

    #[tokio::test]
    async fn errors_are_mapped() {
        let fake = FakeOllama::start(|_, path, _| match path {
            "/api/chat" => (
                404,
                json!({"error": "model \"x\" not found, try pulling it first"}),
            ),
            _ => (500, json!({"error": "boom"})),
        })
        .await;
        let ollama = OllamaBackend::new(&fake.url).unwrap();
        let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("hi")]);
        match ollama.generate("x", &req).await {
            Err(XzError::NotFound(m)) => assert!(m.contains("not found"), "{m}"),
            other => panic!("{other:?}"),
        }
        match ollama.embed("e", &["a".into()]).await {
            Err(XzError::Model(m)) => assert!(m.contains("boom"), "{m}"),
            other => panic!("{other:?}"),
        }
        assert!(!ollama.available().await);
    }

    #[tokio::test]
    async fn unreachable_server() {
        // Bind then drop to find a port nobody listens on.
        let port = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let ollama = OllamaBackend::new(format!("http://127.0.0.1:{port}")).unwrap();
        assert!(!ollama.available().await);
        let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("hi")]);
        assert!(matches!(
            ollama.generate("m", &req).await,
            Err(XzError::Model(_))
        ));
    }

    #[test]
    fn urls() {
        assert!(OllamaBackend::new("https://example.org").is_err());
        assert_eq!(
            OllamaBackend::new("http://h:1/").unwrap().base_url(),
            "http://h:1"
        );
    }
}
