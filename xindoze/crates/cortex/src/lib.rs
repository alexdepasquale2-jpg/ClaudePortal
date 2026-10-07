//! Cortex: local inference for Xindoze (SPEC §3.6, §5).
//!
//! - [`Registry`]: the `models.toml` model registry and its license gate.
//! - Backends implementing [`xz_types::ModelBackend`]: [`OllamaBackend`],
//!   [`ScriptedBackend`] (deterministic, for tests), and `LlamaCppBackend`
//!   behind the `llamacpp` feature.
//! - [`Cortex`]: role routing plus a per-backend priority scheduler,
//!   implementing [`xz_types::Inference`].
//! - [`generate_json`]: schema-checked structured output with repair and escalation.
//! - [`json_schema_to_gbnf`] and [`validate`]: the JSON Schema subset tools.
//! - [`Profile`]: Genesis calibration (tier, role picks, tokens per second).
//!
//! Tests elsewhere drive the OS with a scripted model:
//!
//! ```
//! use std::sync::Arc;
//! use xz_cortex::{Cortex, ScriptedBackend, generate_json};
//! use xz_types::{ChatMessage, GenRequest, Role, plan::plan_schema};
//!
//! let script = Arc::new(ScriptedBackend::queue([
//!     r#"{"thought": "greet", "steps": [], "say": "Hi!", "done": true}"#,
//! ]));
//! let cortex = Cortex::single(script.clone(), "test-model");
//! let req = GenRequest::new(Role::Cortex, vec![ChatMessage::user("hello")])
//!     .with_schema(plan_schema(&[]));
//! let rt = tokio::runtime::Runtime::new().unwrap();
//! let (plan, _) = rt.block_on(generate_json(&cortex, req)).unwrap();
//! assert_eq!(plan["say"], "Hi!");
//! assert_eq!(script.calls().len(), 1);
//! ```

pub mod calibrate;
pub mod cortex;
pub mod grammar;
#[cfg(feature = "llamacpp")]
pub mod llamacpp;
pub mod ollama;
pub mod registry;
mod scheduler;
pub mod schema;
pub mod scripted;
pub mod structured;

pub use calibrate::{Hardware, Profile, choose_roles, measure_tokens_per_sec};
pub use cortex::{Assignment, Cortex, CortexBuilder, CortexStats};
pub use grammar::json_schema_to_gbnf;
#[cfg(feature = "llamacpp")]
pub use llamacpp::LlamaCppBackend;
pub use ollama::OllamaBackend;
pub use registry::{Gguf, ModelEntry, Registry, Tier, is_osi_license};
pub use schema::validate;
pub use scripted::{ScriptedBackend, ScriptedCall};
pub use structured::{extract_json, generate_json, strip_think};
