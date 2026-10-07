//! The `notify` Organ: desktop notifications (SPEC Appendix D).
//!
//! `notify.schedule` belongs to the core (it needs the scheduler). Without
//! a notification service (no D-Bus session on Linux CI, mobile builds)
//! `notify.show` returns `Unsupported`.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use xz_types::Risk::Act;
use xz_types::{CallCtx, Organ, Result, ToolOutput, ToolSpec, XzError};

use crate::util::{blocking, parse_args, tool};

/// Serves `notify.show`.
#[derive(Clone, Debug, Default)]
pub struct NotifyOrgan;

impl NotifyOrgan {
    /// A notification Organ for the desktop session.
    pub fn new() -> Self {
        Self
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn show(title: &str, body: &str) -> Result<()> {
    notify_rust::Notification::new()
        .appname("Xindoze")
        .summary(title)
        .body(body)
        .show()
        .map(|_| ())
        .map_err(|e| XzError::Unsupported(format!("notifications are unavailable: {e}")))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn show(_title: &str, _body: &str) -> Result<()> {
    Err(XzError::Unsupported(
        "notifications are shown by the shell on this platform".into(),
    ))
}

#[async_trait]
impl Organ for NotifyOrgan {
    fn family(&self) -> &str {
        "notify"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![tool(
            "notify.show",
            "Show a desktop notification now.",
            Act,
            json!({
                "type": "object",
                "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
                "required": ["title", "body"],
                "additionalProperties": false
            }),
            &[],
            false,
        )]
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        if tool != "notify.show" {
            return Err(XzError::UnknownTool(tool.into()));
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct A {
            title: String,
            body: String,
        }
        let a: A = parse_args(tool, args)?;
        if a.title.trim().is_empty() {
            return Err(XzError::InvalidArgs(
                "notify.show: `title` must not be empty".into(),
            ));
        }
        blocking(move || show(&a.title, &a.body)).await?;
        Ok(ToolOutput::clean(json!({"shown": true})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn shows_or_reports_unsupported() {
        let n = NotifyOrgan::new();
        let ctx = CallCtx::test();
        match n
            .call(
                &ctx,
                "notify.show",
                json!({"title": "Xindoze test", "body": "ok"}),
            )
            .await
        {
            Ok(out) => assert_eq!(out.content["shown"], true),
            Err(e) => assert!(matches!(e, XzError::Unsupported(_)), "{e}"),
        }
        assert!(matches!(
            n.call(&ctx, "notify.show", json!({"title": " ", "body": ""}))
                .await,
            Err(XzError::InvalidArgs(_))
        ));
        assert!(matches!(
            n.call(&ctx, "notify.schedule", json!({})).await,
            Err(XzError::UnknownTool(_))
        ));
    }
}
