use crate::XzError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Model roles (SPEC §3.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Tiny, always loaded: routing, classification, slot filling.
    Reflex,
    /// Main reasoning and planning model.
    Cortex,
    /// Largest model reachable anywhere in the Hive.
    Oracle,
    Embed,
    Vision,
}

impl Role {
    /// The next tier up for escalation, if any (Reflex → Cortex → Oracle).
    pub fn escalate(self) -> Option<Role> {
        match self {
            Role::Reflex => Some(Role::Cortex),
            Role::Cortex => Some(Role::Oracle),
            _ => None,
        }
    }
}

/// Inference scheduling priority, lowest first (SPEC §3.6).
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Dream,
    Background,
    #[default]
    Foreground,
    Interactive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MsgRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MsgRole,
    pub content: String,
    /// Base64-encoded images for vision models.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

impl ChatMessage {
    pub fn new(role: MsgRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            images: vec![],
        }
    }
    pub fn system(c: impl Into<String>) -> Self {
        Self::new(MsgRole::System, c)
    }
    pub fn user(c: impl Into<String>) -> Self {
        Self::new(MsgRole::User, c)
    }
    pub fn assistant(c: impl Into<String>) -> Self {
        Self::new(MsgRole::Assistant, c)
    }
    pub fn tool(c: impl Into<String>) -> Self {
        Self::new(MsgRole::Tool, c)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenRequest {
    pub role: Role,
    pub messages: Vec<ChatMessage>,
    /// When set, output must be JSON matching this schema (Ollama `format`, llama.cpp grammar).
    #[serde(default)]
    pub json_schema: Option<Value>,
    pub max_tokens: u32,
    pub temperature: f32,
    #[serde(default)]
    pub priority: Priority,
}

impl GenRequest {
    pub fn new(role: Role, messages: Vec<ChatMessage>) -> Self {
        Self {
            role,
            messages,
            json_schema: None,
            max_tokens: 1024,
            temperature: 0.2,
            priority: Priority::default(),
        }
    }

    pub fn with_schema(mut self, schema: Value) -> Self {
        self.json_schema = Some(schema);
        self
    }

    pub fn with_priority(mut self, p: Priority) -> Self {
        self.priority = p;
        self
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GenResponse {
    pub text: String,
    /// `backend:model` that produced the text.
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub millis: u64,
}

/// One inference engine (Ollama, embedded llama.cpp, a Hive peer, a test script).
#[async_trait]
pub trait ModelBackend: Send + Sync {
    /// Stable id, e.g. `ollama`, `llamacpp`, `hive:<peer>`, `scripted`.
    fn id(&self) -> &str;
    /// Whether the backend is reachable right now.
    async fn available(&self) -> bool;
    async fn generate(&self, model: &str, req: &GenRequest) -> Result<GenResponse, XzError>;
    async fn embed(&self, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError>;
}

/// Role-routed, scheduled inference: what the rest of the OS calls.
/// Implemented by `xz_cortex::Cortex`.
#[async_trait]
pub trait Inference: Send + Sync {
    async fn generate(&self, req: GenRequest) -> Result<GenResponse, XzError>;
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError>;
    /// Whether a model is assigned to this role.
    fn has_role(&self, role: Role) -> bool;
}
