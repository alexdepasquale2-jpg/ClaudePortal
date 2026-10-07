use crate::{Risk, Taint};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What the user is asked to approve.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AskInfo {
    pub organism: String,
    pub tool: String,
    pub args: Value,
    pub risk: Risk,
    pub reason: String,
    /// Where tainted inputs came from, shown to the user.
    pub taint: Taint,
}

/// Asks the user to approve an action. CLI reads stdin, the Canvas shows a card.
#[async_trait]
pub trait Confirmer: Send + Sync {
    async fn confirm(&self, ask: &AskInfo) -> bool;
}

pub struct AlwaysYes;
pub struct AlwaysNo;

#[async_trait]
impl Confirmer for AlwaysYes {
    async fn confirm(&self, _ask: &AskInfo) -> bool {
        true
    }
}

#[async_trait]
impl Confirmer for AlwaysNo {
    async fn confirm(&self, _ask: &AskInfo) -> bool {
        false
    }
}
