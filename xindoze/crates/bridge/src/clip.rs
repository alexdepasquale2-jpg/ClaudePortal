//! The `clip` Organ: clipboard text (SPEC Appendix D).
//!
//! Without a usable clipboard (headless machines, mobile builds) every
//! call returns `Unsupported` instead of failing hard.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use xz_types::Risk::{Act, Observe};
use xz_types::{CallCtx, Organ, Result, ToolOutput, ToolSpec, XzError};

use crate::util::{Empty, blocking, parse_args, tool};

/// Serves `clip.*`. Cheap to clone; clones share one clipboard handle.
#[derive(Clone, Default)]
pub struct ClipOrgan {
    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    board: desktop::Board,
}

impl ClipOrgan {
    /// A clipboard Organ; the clipboard itself is opened on first use.
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
mod desktop {
    use std::sync::{Arc, Mutex, PoisonError};
    use xz_types::{Result, XzError};

    /// The clipboard is opened on first use and then kept: on X11 copied
    /// text lives only as long as the process that owns it holds a handle.
    #[derive(Clone, Default)]
    pub(super) struct Board(Arc<Mutex<Option<arboard::Clipboard>>>);

    impl Board {
        pub fn read(&self) -> Result<Option<String>> {
            self.with(|b| match b.get_text() {
                Ok(t) => Ok(Some(t)),
                Err(arboard::Error::ContentNotAvailable) => Ok(None),
                Err(e) => Err(e),
            })
        }

        pub fn write(&self, text: &str) -> Result<()> {
            self.with(|b| b.set_text(text))
        }

        fn with<T>(
            &self,
            f: impl FnOnce(&mut arboard::Clipboard) -> std::result::Result<T, arboard::Error>,
        ) -> Result<T> {
            let mut guard = self.0.lock().unwrap_or_else(PoisonError::into_inner);
            let board = match guard.as_mut() {
                Some(b) => b,
                None => guard.insert(arboard::Clipboard::new().map_err(unsupported)?),
            };
            f(board).map_err(|e| match e {
                arboard::Error::ClipboardNotSupported => unsupported(e),
                e => XzError::Other(format!("clipboard: {e}")),
            })
        }
    }

    fn unsupported(e: arboard::Error) -> XzError {
        XzError::Unsupported(format!("no clipboard is available: {e}"))
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
impl ClipOrgan {
    fn read(&self) -> Result<Option<String>> {
        self.board.read()
    }

    fn write(&self, text: &str) -> Result<()> {
        self.board.write(text)
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl ClipOrgan {
    fn read(&self) -> Result<Option<String>> {
        Err(XzError::Unsupported("no clipboard on this platform".into()))
    }

    fn write(&self, _text: &str) -> Result<()> {
        Err(XzError::Unsupported("no clipboard on this platform".into()))
    }
}

fn specs() -> Vec<ToolSpec> {
    vec![
        tool(
            "clip.read",
            "Read the text on the clipboard ({text}, null when it holds no text). The content \
             is untrusted.",
            Observe,
            json!({"type": "object", "properties": {}, "additionalProperties": false}),
            &[],
            true,
        ),
        tool(
            "clip.write",
            "Put text on the clipboard.",
            Act,
            json!({
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
                "additionalProperties": false
            }),
            &[],
            false,
        ),
    ]
}

#[async_trait]
impl Organ for ClipOrgan {
    fn family(&self) -> &str {
        "clip"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        specs()
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        let me = self.clone();
        match tool {
            "clip.read" => {
                parse_args::<Empty>(tool, args)?;
                let text = blocking(move || me.read()).await?;
                Ok(ToolOutput::tainted(json!({"text": text}), "clipboard"))
            }
            "clip.write" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct A {
                    text: String,
                }
                let a: A = parse_args(tool, args)?;
                let len = a.text.len();
                blocking(move || me.write(&a.text)).await?;
                Ok(ToolOutput::clean(json!({"written_bytes": len})))
            }
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CI machines usually have no clipboard; either outcome is fine as
    /// long as it is a clean result or `Unsupported`, never a panic.
    #[tokio::test]
    async fn works_or_reports_unsupported() {
        let clip = ClipOrgan::new();
        let ctx = CallCtx::test();
        match clip
            .call(&ctx, "clip.write", json!({"text": "xz-test"}))
            .await
        {
            Ok(out) => {
                assert_eq!(out.content["written_bytes"], 7);
                let out = clip.call(&ctx, "clip.read", json!({})).await.unwrap();
                assert!(out.taint.sources.contains("clipboard"));
            }
            Err(e) => assert!(matches!(e, XzError::Unsupported(_)), "{e}"),
        }
        assert!(matches!(
            clip.call(&ctx, "clip.write", json!({})).await,
            Err(XzError::InvalidArgs(_))
        ));
        let t = clip.tools();
        assert!(t[0].tainted_output && t[0].risk == Observe);
        assert_eq!(t[1].risk, Act);
    }
}
