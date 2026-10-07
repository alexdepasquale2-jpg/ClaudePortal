//! Embedded llama.cpp (SPEC §3.6), behind the `llamacpp` feature. Loads GGUF
//! files, applies the model's chat template, and constrains JSON output with
//! a GBNF grammar built from the request's schema.

use crate::grammar::json_schema_to_gbnf;
use crate::structured::strip_think;
use async_trait::async_trait;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaChatTemplate, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use llama_cpp_2::{LogOptions, send_logs_to_tracing};
use std::fmt::Display;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use xz_types::{GenRequest, GenResponse, ModelBackend, MsgRole, XzError};

/// Loaded models, least recently used first.
type ModelCache = Mutex<Vec<(PathBuf, Arc<LlamaModel>)>>;

/// Runs GGUF models in-process on the CPU.
pub struct LlamaCppBackend {
    models_dir: PathBuf,
    max_loaded: usize,
    threads: i32,
    loaded: Arc<ModelCache>,
}

impl LlamaCppBackend {
    pub const ID: &'static str = "llamacpp";

    /// Model names resolve against `models_dir` (`<data>/models`); a name
    /// without an extension gets `.gguf`, and absolute paths are used as is.
    pub fn new(models_dir: impl Into<PathBuf>) -> Self {
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get() as i32);
        Self {
            models_dir: models_dir.into(),
            // Reflex plus one larger model, per SPEC §3.6.
            max_loaded: 2,
            threads,
            loaded: Arc::new(Mutex::new(vec![])),
        }
    }

    /// How many models stay loaded; older ones unload in LRU order.
    pub fn with_max_loaded(mut self, n: usize) -> Self {
        self.max_loaded = n.max(1);
        self
    }

    pub fn with_threads(mut self, n: usize) -> Self {
        self.threads = n.max(1) as i32;
        self
    }

    fn path_for(&self, model: &str) -> PathBuf {
        let mut p = self.models_dir.join(model);
        if p.extension().is_none() {
            p.set_extension("gguf");
        }
        p
    }

    async fn blocking<T: Send + 'static>(
        &self,
        model: &str,
        work: impl FnOnce(&LlamaBackend, &LlamaModel) -> Result<T, XzError> + Send + 'static,
    ) -> Result<T, XzError> {
        let path = self.path_for(model);
        let loaded = self.loaded.clone();
        let max_loaded = self.max_loaded;
        tokio::task::spawn_blocking(move || {
            let backend = backend()?;
            let model = load(backend, &loaded, &path, max_loaded)?;
            work(backend, &model)
        })
        .await
        .map_err(|e| XzError::Other(format!("llama.cpp worker: {e}")))?
    }
}

/// llama.cpp's process-wide backend; it may be initialized only once.
fn backend() -> Result<&'static LlamaBackend, XzError> {
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            send_logs_to_tracing(LogOptions::default());
            LlamaBackend::init().map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| XzError::Model(format!("llama.cpp init: {e}")))
}

fn load(
    backend: &LlamaBackend,
    loaded: &ModelCache,
    path: &Path,
    max_loaded: usize,
) -> Result<Arc<LlamaModel>, XzError> {
    // Held while loading so two requests never load the same file twice.
    let mut cache = loaded.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(i) = cache.iter().position(|(p, _)| p == path) {
        let hit = cache.remove(i);
        let model = hit.1.clone();
        cache.push(hit);
        return Ok(model);
    }
    if !path.is_file() {
        return Err(XzError::NotFound(format!("model file {}", path.display())));
    }
    let model = LlamaModel::load_from_file(backend, path, &LlamaModelParams::default())
        .map_err(|e| err(&format!("loading {}", path.display()), e))?;
    let model = Arc::new(model);
    cache.push((path.to_path_buf(), model.clone()));
    while cache.len() > max_loaded {
        cache.remove(0);
    }
    Ok(model)
}

fn err(what: &str, e: impl Display) -> XzError {
    XzError::Model(format!("llama.cpp {what}: {e}"))
}

#[async_trait]
impl ModelBackend for LlamaCppBackend {
    fn id(&self) -> &str {
        Self::ID
    }

    async fn available(&self) -> bool {
        backend().is_ok()
    }

    async fn generate(&self, model: &str, req: &GenRequest) -> Result<GenResponse, XzError> {
        if req.messages.iter().any(|m| !m.images.is_empty()) {
            return Err(XzError::Unsupported(
                "images on the embedded llama.cpp backend".into(),
            ));
        }
        let grammar = req
            .json_schema
            .as_ref()
            .map(json_schema_to_gbnf)
            .transpose()?;
        let req = req.clone();
        let threads = self.threads;
        let name = format!("{}:{model}", Self::ID);
        self.blocking(model, move |backend, model| {
            let start = Instant::now();
            let (text, tokens_in, tokens_out) =
                run(backend, model, &req, grammar.as_deref(), threads)?;
            Ok(GenResponse {
                text: strip_think(&text).to_string(),
                model: name,
                tokens_in,
                tokens_out,
                millis: start.elapsed().as_millis() as u64,
            })
        })
        .await
    }

    async fn embed(&self, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        let texts = texts.to_vec();
        let threads = self.threads;
        self.blocking(model, move |backend, model| {
            embed(backend, model, &texts, threads)
        })
        .await
    }
}

fn prompt(model: &LlamaModel, req: &GenRequest) -> Result<String, XzError> {
    let template = match model.chat_template(None) {
        Ok(t) => t,
        // GGUF files without a template get ChatML, which most instruct models accept.
        Err(_) => LlamaChatTemplate::new("chatml").map_err(|e| err("chat template", e))?,
    };
    let messages = req
        .messages
        .iter()
        .map(|m| {
            let role = match m.role {
                MsgRole::System => "system",
                MsgRole::User => "user",
                MsgRole::Assistant => "assistant",
                MsgRole::Tool => "tool",
            };
            LlamaChatMessage::new(role.into(), m.content.clone()).map_err(|e| err("message", e))
        })
        .collect::<Result<Vec<_>, _>>()?;
    model
        .apply_chat_template(&template, &messages, true)
        .map_err(|e| err("chat template", e))
}

fn context<'m>(
    backend: &LlamaBackend,
    model: &'m LlamaModel,
    n_ctx: u32,
    threads: i32,
    embeddings: bool,
) -> Result<LlamaContext<'m>, XzError> {
    let params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_batch(n_ctx)
        // Embedding models attend both ways, so a whole input must fit one micro-batch.
        .with_n_ubatch(if embeddings { n_ctx } else { n_ctx.min(512) })
        .with_n_threads(threads)
        .with_n_threads_batch(threads)
        .with_embeddings(embeddings);
    model
        .new_context(backend, params)
        .map_err(|e| err("context", e))
}

/// Returns (text, prompt tokens, generated tokens).
fn run(
    backend: &LlamaBackend,
    model: &LlamaModel,
    req: &GenRequest,
    grammar: Option<&str>,
    threads: i32,
) -> Result<(String, u32, u32), XzError> {
    let vocab = model.vocab();
    let tokens = vocab.tokenize(prompt(model, req)?.as_bytes(), true, true);
    let n_prompt = tokens.len() as u32;
    let n_ctx = n_prompt + req.max_tokens.max(1) + 1;
    if n_ctx > model.n_ctx_train() {
        return Err(XzError::Budget(format!(
            "prompt of {n_prompt} tokens plus {} to generate exceeds the model's {} token context",
            req.max_tokens,
            model.n_ctx_train()
        )));
    }
    let mut ctx = context(backend, model, n_ctx, threads, false)?;

    let mut samplers = vec![];
    if let Some(g) = grammar {
        samplers.push(LlamaSampler::grammar(model, g, "root").map_err(|e| err("grammar", e))?);
    }
    if req.temperature <= 0.0 {
        samplers.push(LlamaSampler::greedy());
    } else {
        samplers.push(LlamaSampler::top_k(40));
        samplers.push(LlamaSampler::top_p(0.95, 1));
        samplers.push(LlamaSampler::temp(req.temperature));
        samplers.push(LlamaSampler::dist(xz_types::now_ms() as u32));
    }
    let mut sampler = LlamaSampler::chain_simple(samplers);

    let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
    batch
        .add_sequence(&tokens, 0, false)
        .map_err(|e| err("batch", e))?;
    ctx.decode(&mut batch).map_err(|e| err("decode", e))?;

    let mut out = Vec::new();
    let mut produced = 0u32;
    let mut pos = tokens.len() as i32;
    while produced < req.max_tokens {
        let token: LlamaToken = sampler.sample(&ctx, batch.n_tokens() - 1);
        if vocab.is_eog(token) {
            break;
        }
        out.extend(vocab.token_to_piece(token, false, None));
        produced += 1;
        batch.clear();
        batch
            .add(token, pos, &[0], true)
            .map_err(|e| err("batch", e))?;
        pos += 1;
        ctx.decode(&mut batch).map_err(|e| err("decode", e))?;
    }
    Ok((
        String::from_utf8_lossy(&out).into_owned(),
        n_prompt,
        produced,
    ))
}

fn embed(
    backend: &LlamaBackend,
    model: &LlamaModel,
    texts: &[String],
    threads: i32,
) -> Result<Vec<Vec<f32>>, XzError> {
    let vocab = model.vocab();
    let all: Vec<Vec<LlamaToken>> = texts
        .iter()
        .map(|t| vocab.tokenize(t.as_bytes(), true, false))
        .collect();
    let longest = all.iter().map(Vec::len).max().unwrap_or(1).max(1) as u32;
    if longest > model.n_ctx_train() {
        return Err(XzError::Budget(format!(
            "text of {longest} tokens exceeds the embedding model's {} token context",
            model.n_ctx_train()
        )));
    }
    let mut ctx = context(backend, model, longest, threads, true)?;
    let mut out = Vec::with_capacity(all.len());
    for tokens in &all {
        ctx.clear_kv_cache();
        let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
        batch
            .add_sequence(tokens, 0, true)
            .map_err(|e| err("batch", e))?;
        ctx.decode(&mut batch).map_err(|e| err("decode", e))?;
        let v = match ctx.embeddings_seq_ith(0) {
            Ok(pooled) => pooled.to_vec(),
            // No pooling in the GGUF: use the last token's state.
            Err(_) => ctx
                .embeddings_ith(batch.n_tokens() - 1)
                .map_err(|e| err("embeddings", e))?
                .to_vec(),
        };
        out.push(normalize(v));
    }
    Ok(out)
}

fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use xz_types::{ChatMessage, Role};

    #[tokio::test]
    async fn missing_model_file_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let b = LlamaCppBackend::new(dir.path());
        let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("hi")]);
        assert!(matches!(
            b.generate("nope", &req).await,
            Err(XzError::NotFound(_))
        ));
        assert_eq!(b.path_for("nope"), dir.path().join("nope.gguf"));
        assert_eq!(b.path_for("/abs/x.gguf"), PathBuf::from("/abs/x.gguf"));
        assert!(b.available().await);
    }

    #[tokio::test]
    async fn images_are_unsupported() {
        let b = LlamaCppBackend::new("/nonexistent");
        let mut msg = ChatMessage::user("what is this");
        msg.images = vec!["aGk=".into()];
        let req = GenRequest::new(Role::Vision, vec![msg]);
        assert!(matches!(
            b.generate("m", &req).await,
            Err(XzError::Unsupported(_))
        ));
    }

    /// Runs a real GGUF end to end. Set `XZ_TEST_GGUF` to a model file; a tiny
    /// random-weight model from `scripts/tiny_gguf.py` is enough, since only
    /// the plumbing (template, grammar, sampling, embeddings) is checked.
    #[tokio::test]
    #[ignore = "needs a GGUF file in XZ_TEST_GGUF"]
    async fn generates_schema_constrained_json_from_a_real_gguf() {
        let Ok(path) = std::env::var("XZ_TEST_GGUF") else {
            return;
        };
        let b = LlamaCppBackend::new("/");
        let schema = serde_json::json!({
            "type": "object",
            "properties": {"ok": {"type": "boolean"}, "n": {"type": "integer"}},
            "required": ["ok", "n"]
        });
        let mut req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("Answer in JSON.")])
            .with_schema(schema.clone());
        req.max_tokens = 48;
        let out = b.generate(&path, &req).await.unwrap();
        assert!(out.tokens_in > 0);
        // Random weights may run out of tokens before closing the object, but
        // every token must still follow the grammar.
        assert!(out.text.starts_with("{\"ok\""), "{}", out.text);
        if out.tokens_out < req.max_tokens {
            let v: serde_json::Value = serde_json::from_str(&out.text).unwrap();
            assert_eq!(crate::validate(&v, &schema), Ok(()));
        }
        let free = GenRequest::new(Role::Cortex, vec![ChatMessage::user("hi")]);
        assert!(b.generate(&path, &free).await.is_ok());

        let v = b
            .embed(&path, &["hello".into(), "the ok".into()])
            .await
            .unwrap();
        assert_eq!(v.len(), 2);
        assert!(
            v.iter()
                .all(|e| !e.is_empty() && e.iter().all(|x| x.is_finite()))
        );
    }
}
