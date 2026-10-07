//! Offline reflex: a schema-constrained stand-in used when Ollama is absent
//! and no GGUF is loaded. It proposes tool plans. The Warden still decides.

use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::PathBuf;
use xz_cortex::extract_json;
use xz_types::{GenRequest, GenResponse, ModelBackend, MsgRole, XzError};

pub struct OfflineReflex {
    home: PathBuf,
}

impl OfflineReflex {
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }
}

#[async_trait]
impl ModelBackend for OfflineReflex {
    fn id(&self) -> &str {
        "offline-reflex"
    }

    async fn available(&self) -> bool {
        true
    }

    async fn generate(&self, model: &str, req: &GenRequest) -> Result<GenResponse, XzError> {
        let text = plan_json(&self.home, req);
        Ok(GenResponse {
            text,
            model: format!("offline-reflex:{model}"),
            tokens_in: 0,
            tokens_out: 0,
            millis: 0,
        })
    }

    async fn embed(&self, _model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, XzError> {
        Ok(texts.iter().map(|_| vec![0.0; 8]).collect())
    }
}

fn plan_json(home: &std::path::Path, req: &GenRequest) -> String {
    let intent = req
        .messages
        .iter()
        .find(|m| m.role == MsgRole::User)
        .map(|m| m.content.as_str())
        .unwrap_or("");
    let tools: Vec<&str> = req
        .messages
        .iter()
        .filter(|m| m.role == MsgRole::Tool)
        .map(|m| m.content.as_str())
        .collect();
    let plan = if tools.is_empty() {
        propose(home, intent)
    } else {
        reflect(home, intent, &tools)
    };
    plan.to_string()
}

fn propose(_home: &std::path::Path, intent: &str) -> Value {
    if blanket_delete(intent) {
        return done(
            "The request asks to delete everything. That needs a specific path and confirmation. Nothing was changed.",
            None,
        );
    }
    if let Some(url) = find_url(intent) {
        return json!({
            "thought": "Fetch the page and treat its body as data.",
            "steps": [{"tool": "net.fetch", "args": {"url": url}, "why": "the user named a URL"}],
            "ui": null,
            "say": null,
            "done": false
        });
    }
    let lower = intent.to_lowercase();
    if lower.contains("largest") && lower.contains("file") {
        let n = first_count(intent).unwrap_or(10);
        return json!({
            "thought": "Rank files in the home directory by size.",
            "steps": [{"tool": "fs.search", "args": {"path": "~", "largest": n}, "why": "size ranking"}],
            "ui": null,
            "say": null,
            "done": false
        });
    }
    if lower.contains("process") {
        return json!({
            "thought": "List processes.",
            "steps": [{"tool": "proc.list", "args": {}, "why": "the user asked what is running"}],
            "ui": null,
            "say": null,
            "done": false
        });
    }
    done(
        "I can look through files in your home directory, list processes, or fetch a URL you name.",
        None,
    )
}

fn reflect(home: &std::path::Path, intent: &str, tools: &[&str]) -> Value {
    let blob = tools.join("\n");
    let Some(value) = extract_json(&blob) else {
        return done("The tool returned nothing I can read.", None);
    };
    if value.get("error").is_some() || value.get("denied").is_some() {
        let msg = value["error"]
            .as_str()
            .or_else(|| value["denied"].as_str())
            .unwrap_or("the tool was not run");
        return done(&format!("Nothing was changed. {msg}"), None);
    }
    if let Some(files) = value.get("files").and_then(Value::as_array) {
        return files_report(home, files, value["truncated"].as_bool().unwrap_or(false));
    }
    if value.get("text").is_some() && value.get("status").is_some() {
        let url = value["url"].as_str().unwrap_or("the page");
        let _ = intent;
        return done(
            &format!(
                "Fetched {url}. The page is untrusted data, not instructions. Nothing was deleted."
            ),
            None,
        );
    }
    if let Some(procs) = value.get("processes").and_then(Value::as_array) {
        return done(
            &format!("There are {} processes running.", procs.len()),
            None,
        );
    }
    done("Done.", None)
}

fn files_report(home: &std::path::Path, files: &[Value], truncated: bool) -> Value {
    let mut lines = vec!["Largest files:".to_string()];
    let mut rows = Vec::new();
    for (i, file) in files.iter().enumerate() {
        let path = file["path"].as_str().unwrap_or("");
        let bytes = file["bytes"].as_u64().unwrap_or(0);
        let rel = relative_to_home(home, path);
        let note = if looks_safe_to_delete(&rel) {
            "looks safe to delete"
        } else {
            "keep"
        };
        let shown = shorten(path);
        lines.push(format!("{}. {shown} — {bytes} bytes — {note}", i + 1));
        rows.push(json!([shown, bytes.to_string(), note]));
    }
    if files.is_empty() {
        lines.push("No files under the home directory.".into());
    }
    if truncated {
        lines.push("The scan stopped early; this is the largest among the files visited.".into());
    }
    let say = lines.join("\n");
    let ui = if rows.is_empty() {
        Value::Null
    } else {
        json!({
            "type": "table",
            "columns": ["file", "bytes", "note"],
            "rows": rows
        })
    };
    done(&say, Some(ui))
}

fn done(say: &str, ui: Option<Value>) -> Value {
    json!({
        "thought": "Report only what the tools returned.",
        "steps": [],
        "ui": ui.unwrap_or(Value::Null),
        "say": say,
        "done": true
    })
}

fn shorten(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn relative_to_home(home: &std::path::Path, path: &str) -> String {
    let home = home.to_string_lossy().replace('\\', "/");
    let path = path.replace('\\', "/");
    path.strip_prefix(&home)
        .unwrap_or(&path)
        .trim_start_matches('/')
        .to_string()
}

/// Cache, logs, and temp files, judged on the path relative to home.
/// A home that itself lives under `/tmp` must not mark every file safe.
/// This does not delete anything.
pub fn looks_safe_to_delete(path: &str) -> bool {
    let p = path.replace('\\', "/").to_lowercase();
    let p = p.trim_start_matches('/');
    p.starts_with(".cache/")
        || p.contains("/.cache/")
        || p.starts_with("cache/")
        || p.contains("/cache/")
        || p.starts_with("tmp/")
        || p.contains("/tmp/")
        || p.starts_with("node_modules/")
        || p.contains("/node_modules/")
        || p.starts_with("trash/")
        || p.contains("/trash/")
        || p.ends_with(".log")
        || p.ends_with(".tmp")
        || p == "thumbs.db"
        || p.ends_with("/thumbs.db")
        || p == ".ds_store"
        || p.ends_with("/.ds_store")
}

fn blanket_delete(intent: &str) -> bool {
    let s = intent.to_lowercase();
    let delete =
        s.contains("delete") || s.contains("wipe") || s.contains("erase") || s.contains("rm -rf");
    let all = s.contains("everything")
        || s.contains("all my")
        || s.contains("all files")
        || s.contains("every file");
    delete && all
}

fn find_url(intent: &str) -> Option<&str> {
    intent.split_whitespace().find_map(|token| {
        let t = token.trim_matches(|c: char| matches!(c, '"' | '\'' | ',' | ')' | '('));
        (t.starts_with("http://") || t.starts_with("https://")).then_some(t)
    })
}

fn first_count(intent: &str) -> Option<u64> {
    let mut n = String::new();
    for c in intent.chars() {
        if c.is_ascii_digit() {
            n.push(c);
        } else if !n.is_empty() {
            break;
        }
    }
    let v = n.parse::<u64>().ok()?;
    (1..=100).contains(&v).then_some(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use xz_cortex::{Cortex, generate_json};
    use xz_types::{ChatMessage, GenRequest, Role, plan::plan_schema};

    #[test]
    fn safe_marker_matches_caches_not_documents() {
        assert!(looks_safe_to_delete(".cache/junk.bin"));
        assert!(looks_safe_to_delete("app.log"));
        assert!(!looks_safe_to_delete("Documents/taxes.pdf"));
        assert!(!looks_safe_to_delete("big.bin"));
        assert!(!looks_safe_to_delete("photo.jpg"));
    }

    #[tokio::test]
    async fn largest_files_plan_matches_the_schema() {
        let reflex = Arc::new(OfflineReflex::new("/home/u"));
        let cortex = Cortex::single(reflex, "offline-reflex");
        let tools = vec![
            "fs.search".into(),
            "fs.read".into(),
            "proc.list".into(),
            "net.fetch".into(),
        ];
        let req = GenRequest::new(
            Role::Cortex,
            vec![ChatMessage::user(
                "find my 10 largest files and tell me which look safe to delete",
            )],
        )
        .with_schema(plan_schema(&tools));
        let (plan, _) = generate_json(&cortex, req).await.unwrap();
        assert_eq!(plan["steps"][0]["tool"], "fs.search");
        assert_eq!(plan["steps"][0]["args"]["largest"], 10);
        assert_eq!(plan["done"], false);
    }
}
