//! A deterministic backend for tests: answers come from a closure or a queue
//! of canned responses, and every request is recorded for assertions.

use async_trait::async_trait;
use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;
use xz_types::{GenRequest, GenResponse, ModelBackend, XzError};

type ScriptFn = dyn Fn(&str, &GenRequest) -> String + Send + Sync;

enum Script {
    Func(Box<ScriptFn>),
    Queue(Mutex<VecDeque<String>>),
}

/// One recorded `generate` call.
#[derive(Clone, Debug, PartialEq)]
pub struct ScriptedCall {
    pub model: String,
    pub request: GenRequest,
}

/// Test backend. `embed` returns deterministic hashed bag-of-words vectors of
/// [`ScriptedBackend::EMBED_DIMS`] dimensions, so texts sharing words are close.
pub struct ScriptedBackend {
    id: String,
    script: Script,
    calls: Mutex<Vec<ScriptedCall>>,
}

impl ScriptedBackend {
    /// Default backend id.
    pub const ID: &'static str = "scripted";
    /// Length of every embedding vector.
    pub const EMBED_DIMS: usize = 64;

    /// Answers every request with `f(model, request)`.
    pub fn new(f: impl Fn(&str, &GenRequest) -> String + Send + Sync + 'static) -> Self {
        Self::with_script(Script::Func(Box::new(f)))
    }

    /// Answers requests with `responses` in order, then fails with `XzError::Model`.
    pub fn queue<I, S>(responses: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let q = responses.into_iter().map(Into::into).collect();
        Self::with_script(Script::Queue(Mutex::new(q)))
    }

    /// Answers every request with the same text.
    pub fn always(text: impl Into<String>) -> Self {
        let text = text.into();
        Self::new(move |_, _| text.clone())
    }

    fn with_script(script: Script) -> Self {
        Self {
            id: Self::ID.into(),
            script,
            calls: Mutex::new(vec![]),
        }
    }

    /// Renames the backend, e.g. to register two scripted backends in one Cortex.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    /// Every `generate` call so far, oldest first.
    pub fn calls(&self) -> Vec<ScriptedCall> {
        lock(&self.calls).clone()
    }

    /// Canned responses not yet served (always 0 for closure scripts).
    pub fn remaining(&self) -> usize {
        match &self.script {
            Script::Func(_) => 0,
            Script::Queue(q) => lock(q).len(),
        }
    }
}

#[async_trait]
impl ModelBackend for ScriptedBackend {
    fn id(&self) -> &str {
        &self.id
    }

    async fn available(&self) -> bool {
        true
    }

    async fn generate(&self, model: &str, req: &GenRequest) -> Result<GenResponse, XzError> {
        let start = Instant::now();
        lock(&self.calls).push(ScriptedCall {
            model: model.into(),
            request: req.clone(),
        });
        let text = match &self.script {
            Script::Func(f) => f(model, req),
            Script::Queue(q) => lock(q)
                .pop_front()
                .ok_or_else(|| XzError::Model("scripted backend has no more responses".into()))?,
        };
        let tokens_in = req.messages.iter().map(|m| word_count(&m.content)).sum();
        Ok(GenResponse {
            tokens_out: word_count(&text),
            text,
            model: format!("{}:{model}", self.id),
            tokens_in,
            millis: start.elapsed().as_millis() as u64,
        })
    }

    async fn embed(&self, _model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError> {
        Ok(texts.iter().map(|t| hashed_embedding(t)).collect())
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic in another test thread must not cascade into this one.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn word_count(s: &str) -> u32 {
    s.split_whitespace().count() as u32
}

/// L2-normalized hashed bag of lowercase words (FNV-1a, stable across builds).
fn hashed_embedding(text: &str) -> Vec<f32> {
    let mut v = vec![0f32; ScriptedBackend::EMBED_DIMS];
    for word in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        let h = word
            .to_lowercase()
            .bytes()
            .fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
                (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
            });
        v[(h % ScriptedBackend::EMBED_DIMS as u64) as usize] += 1.0;
    }
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

    fn req(text: &str) -> GenRequest {
        GenRequest::new(Role::Cortex, vec![ChatMessage::user(text)])
    }

    #[tokio::test]
    async fn closure_sees_model_and_request() {
        let b = ScriptedBackend::new(|model, r| {
            format!("{model}/{:?}/{}", r.role, r.messages[0].content)
        });
        let out = b.generate("m1", &req("hi there")).await.unwrap();
        assert_eq!(out.text, "m1/Cortex/hi there");
        assert_eq!(out.model, "scripted:m1");
        assert_eq!(out.tokens_in, 2);
        assert_eq!(b.calls().len(), 1);
        assert_eq!(b.calls()[0].model, "m1");
    }

    #[tokio::test]
    async fn queue_serves_in_order_then_errors() {
        let b = ScriptedBackend::queue(["one", "two"]).with_id("q");
        assert_eq!(b.id(), "q");
        assert_eq!(b.remaining(), 2);
        assert_eq!(b.generate("m", &req("a")).await.unwrap().text, "one");
        assert_eq!(b.generate("m", &req("b")).await.unwrap().text, "two");
        assert!(matches!(
            b.generate("m", &req("c")).await,
            Err(XzError::Model(_))
        ));
        assert_eq!(b.remaining(), 0);
        assert_eq!(b.calls().len(), 3);
    }

    #[tokio::test]
    async fn embeddings_are_deterministic_and_meaningful() {
        let b = ScriptedBackend::always("x");
        let texts = [
            "Buy milk today".to_string(),
            "buy MILK".into(),
            "quantum chromodynamics".into(),
            String::new(),
        ];
        let v = b.embed("e", &texts).await.unwrap();
        assert_eq!(v.len(), 4);
        assert!(v.iter().all(|e| e.len() == ScriptedBackend::EMBED_DIMS));
        let dot = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
        assert!(dot(&v[0], &v[1]) > dot(&v[0], &v[2]));
        assert!((dot(&v[0], &v[0]) - 1.0).abs() < 1e-5);
        assert!(v[3].iter().all(|x| *x == 0.0));
        assert_eq!(v, b.embed("e", &texts).await.unwrap());
    }
}
