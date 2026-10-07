//! Canvas confirmer: a Charter ask becomes an `xz://ask` card and waits.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use xz_types::{AskInfo, Confirmer};

use crate::runtime::EVENT_ASK;

#[derive(Clone, Serialize)]
pub struct AskEvent {
    pub id: String,
    pub ask: AskInfo,
}

pub struct AskHub {
    app: AppHandle,
    pending: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    next: Mutex<u64>,
}

impl AskHub {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending: Mutex::new(HashMap::new()),
            next: Mutex::new(1),
        }
    }

    pub fn reply(&self, id: &str, approve: bool) -> bool {
        let Some(tx) = self.pending.lock().expect("ask map").remove(id) else {
            return false;
        };
        tx.send(approve).is_ok()
    }
}

pub struct CanvasConfirmer {
    pub hub: std::sync::Arc<AskHub>,
}

#[async_trait]
impl Confirmer for CanvasConfirmer {
    async fn confirm(&self, ask: &AskInfo) -> bool {
        let id = {
            let mut n = self.hub.next.lock().expect("ask id");
            let id = format!("ask-{n}");
            *n += 1;
            id
        };
        let (tx, rx) = oneshot::channel();
        self.hub.pending.lock().expect("ask map").insert(id.clone(), tx);
        if self
            .hub
            .app
            .emit(EVENT_ASK, AskEvent { id, ask: ask.clone() })
            .is_err()
        {
            return false;
        }
        rx.await.unwrap_or(false)
    }
}
