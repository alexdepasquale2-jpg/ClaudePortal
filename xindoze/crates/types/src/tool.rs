use crate::{Taint, XzError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Risk class of a tool (SPEC §3.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    /// Reads only.
    Observe,
    /// Changes state; reversible through the Journal.
    Act,
    /// Irreversible or leaves the device.
    Commit,
}

/// A tool as advertised by an Organ. Mirrors an MCP tool definition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolSpec {
    /// `family.verb`, e.g. `fs.read`.
    pub name: String,
    pub description: String,
    /// JSON Schema for the call's `args`.
    pub input_schema: Value,
    pub risk: Risk,
    /// Names of args whose values are resources (paths or URLs) the Warden checks.
    #[serde(default)]
    pub resource_args: Vec<String>,
    /// Output carries content from outside the user's control (web, messages, screens).
    #[serde(default)]
    pub tainted_output: bool,
    /// True only for core Organs. The Warden never trusts third-party annotations.
    #[serde(default)]
    pub first_party: bool,
}

impl ToolSpec {
    /// The risk the Warden uses: third-party tools always count as `commit`.
    pub fn effective_risk(&self) -> Risk {
        if self.first_party {
            self.risk
        } else {
            Risk::Commit
        }
    }

    /// The resource values named by `resource_args` in `args` (strings only).
    pub fn resources<'a>(&self, args: &'a Value) -> Vec<&'a str> {
        self.resource_args
            .iter()
            .filter_map(|k| args.get(k).and_then(Value::as_str))
            .collect()
    }
}

/// A capability a Genome requests and the Charter grants: a tool glob plus
/// resource globs. Empty `resources` means "any resource" for that tool.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    /// Glob over tool names, e.g. `fs.*` or `fs.read`.
    pub tool: String,
    #[serde(default)]
    pub resources: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub tool: String,
    #[serde(default)]
    pub args: Value,
}

/// A state change a tool made, recorded in the Journal so Rewind can undo it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Effect {
    /// Undo: delete the file.
    FileCreated { path: PathBuf },
    /// Undo: restore the pre-image blob `pre`.
    FileModified { path: PathBuf, pre: String },
    /// Undo: move `to` back to `from`.
    FileMoved { from: PathBuf, to: PathBuf },
    /// Undo: move `trashed_to` back to `path`.
    FileTrashed { path: PathBuf, trashed_to: PathBuf },
    /// Undo: remove the directory if empty.
    DirCreated { path: PathBuf },
    /// Undo: restore `pre` (None means the key did not exist).
    KvSet {
        ns: String,
        key: String,
        pre: Option<Value>,
    },
    /// Cannot be undone (commit-level actions).
    Irreversible { note: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolOutput {
    pub content: Value,
    #[serde(default)]
    pub taint: Taint,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

impl ToolOutput {
    pub fn clean(content: Value) -> Self {
        Self {
            content,
            taint: Taint::none(),
            effects: vec![],
        }
    }

    pub fn tainted(content: Value, source: impl Into<String>) -> Self {
        Self {
            content,
            taint: Taint::from_source(source),
            effects: vec![],
        }
    }

    pub fn with_effect(mut self, e: Effect) -> Self {
        self.effects.push(e);
        self
    }
}

/// Stores a file's current contents before an Organ changes it.
/// Implemented by Engram's blob store.
pub trait Snapshotter: Send + Sync {
    /// Returns the blob hash of the file's current contents, or None if it does not exist.
    fn snapshot(&self, path: &Path) -> Result<Option<String>, XzError>;
}

/// A Snapshotter that keeps nothing (tests, read-only contexts).
pub struct NoSnapshot;

impl Snapshotter for NoSnapshot {
    fn snapshot(&self, _path: &Path) -> Result<Option<String>, XzError> {
        Ok(None)
    }
}

/// Per-call context handed to an Organ by the Synapse.
#[derive(Clone)]
pub struct CallCtx {
    pub organism: String,
    pub task_id: String,
    pub snapshot: Arc<dyn Snapshotter>,
}

impl CallCtx {
    pub fn test() -> Self {
        Self {
            organism: "test".into(),
            task_id: "t0".into(),
            snapshot: Arc::new(NoSnapshot),
        }
    }
}

/// An MCP capability server (SPEC §3.2). Core Organs run in-process.
#[async_trait]
pub trait Organ: Send + Sync {
    /// Capability family, e.g. `fs`.
    fn family(&self) -> &str;
    fn tools(&self) -> Vec<ToolSpec>;
    async fn call(&self, ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput, XzError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(first_party: bool) -> ToolSpec {
        ToolSpec {
            name: "fs.move".into(),
            description: String::new(),
            input_schema: json!({}),
            risk: Risk::Act,
            resource_args: vec!["from".into(), "to".into()],
            tainted_output: false,
            first_party,
        }
    }

    #[test]
    fn third_party_is_commit() {
        assert_eq!(spec(true).effective_risk(), Risk::Act);
        assert_eq!(spec(false).effective_risk(), Risk::Commit);
    }

    #[test]
    fn resources_reads_named_args() {
        let a = json!({"from": "/a", "to": "/b", "x": 1});
        assert_eq!(spec(true).resources(&a), vec!["/a", "/b"]);
    }

    #[test]
    fn effect_roundtrips() {
        let e = Effect::FileMoved {
            from: "/a".into(),
            to: "/b".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"kind\":\"file_moved\""));
        assert_eq!(serde_json::from_str::<Effect>(&s).unwrap(), e);
    }
}
