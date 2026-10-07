//! YAML frontmatter plus Markdown sections.

use crate::eval::{self, EvalCase};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use xz_types::{Grant, Result, XzError};

/// A parsed Genome.
#[derive(Clone, Debug, PartialEq)]
pub struct Genome {
    pub id: String,
    pub version: String,
    pub purpose: String,
    /// `reflex`, `cortex`, or `oracle`.
    pub tier: String,
    pub capabilities: Vec<Capability>,
    pub exports: Vec<Export>,
    /// `canvas` or `none`.
    pub ui: String,
    /// Present when the file was shared. Not verified until phase 4.
    pub signature: Option<String>,
    pub role: String,
    pub behaviors: String,
    pub evals: Vec<EvalCase>,
    pub body: String,
}

/// One requested capability, already split into a tool glob.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Capability {
    pub tool: String,
    pub resources: Vec<String>,
}

impl Capability {
    pub fn grant(&self) -> Grant {
        Grant {
            tool: self.tool.clone(),
            resources: self.resources.clone(),
        }
    }
}

/// A tool this Genome offers other Organisms. TODO(phase 1): mount it.
#[derive(Clone, Debug, PartialEq)]
pub struct Export {
    pub name: String,
    pub description: String,
    pub input: Value,
}

impl Genome {
    /// Parses a Genome document.
    pub fn parse(text: &str) -> Result<Self> {
        let (front, body) = split_frontmatter(text)?;
        let front: Front = serde_yaml::from_str(front)
            .map_err(|e| XzError::Parse(format!("genome frontmatter: {e}")))?;
        let id = front.genome.trim().to_string();
        if !valid_id(&id) {
            return Err(XzError::Parse(format!("genome id `{id}`")));
        }
        let version = front.version.trim().to_string();
        if version.is_empty() || !version.chars().any(|c| c.is_ascii_digit()) {
            return Err(XzError::Parse("genome version".into()));
        }
        let purpose = front.purpose.trim().to_string();
        if purpose.is_empty() {
            return Err(XzError::Parse("genome purpose is empty".into()));
        }
        let tier = front.tier.trim().to_string();
        if !matches!(tier.as_str(), "reflex" | "cortex" | "oracle") {
            return Err(XzError::Parse(format!("tier `{tier}`")));
        }
        let capabilities = caps(front.capabilities)?;
        if capabilities.is_empty() {
            return Err(XzError::Parse("genome declares no capabilities".into()));
        }
        let ui = if front.ui.trim().is_empty() {
            "none".into()
        } else {
            front.ui.trim().to_string()
        };
        if !matches!(ui.as_str(), "canvas" | "none") {
            return Err(XzError::Parse(format!("ui `{ui}`")));
        }
        let exports = front
            .exports
            .into_iter()
            .map(|e| {
                Ok(Export {
                    name: e.name,
                    description: e.description,
                    input: serde_yaml::from_value(e.input)
                        .map_err(|err| XzError::Parse(err.to_string()))?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let role = section(body, "Role");
        let behaviors = section(body, "Behaviors");
        let evals = eval::parse_section(&section(body, "Evals"))?;
        Ok(Self {
            id,
            version,
            purpose,
            tier,
            capabilities,
            exports,
            ui,
            signature: front.signature.filter(|s| !s.trim().is_empty()),
            role,
            behaviors,
            evals,
            body: body.trim().to_string(),
        })
    }

    /// The text the planner sees: role, then behaviors.
    pub fn prompt(&self) -> String {
        let mut out = String::new();
        if !self.role.is_empty() {
            out.push_str(&self.role);
        }
        if !self.behaviors.is_empty() {
            if !out.is_empty() {
                out.push_str("\n\n");
            }
            out.push_str(&self.behaviors);
        }
        if out.is_empty() {
            out = self.body.clone();
        }
        out
    }

    pub fn grants(&self) -> Vec<Grant> {
        self.capabilities.iter().map(Capability::grant).collect()
    }
}

fn caps(items: Vec<Cap>) -> Result<Vec<Capability>> {
    let mut out = Vec::new();
    for item in items {
        match item {
            Cap::Tool(name) => {
                let tool = name.trim().to_string();
                if tool.is_empty() {
                    return Err(XzError::Parse("empty capability".into()));
                }
                out.push(Capability {
                    tool,
                    resources: vec![],
                });
            }
            Cap::Scoped(map) => {
                for (base, verbs) in map {
                    if verbs.is_empty() {
                        out.push(Capability {
                            tool: base,
                            resources: vec![],
                        });
                        continue;
                    }
                    for verb in verbs {
                        out.push(Capability {
                            tool: format!("{base}.{verb}"),
                            resources: vec![],
                        });
                    }
                }
            }
        }
    }
    Ok(out)
}

fn valid_id(id: &str) -> bool {
    let mut parts = id.split('.');
    let Some(first) = parts.next() else {
        return false;
    };
    if !part_ok(first) {
        return false;
    }
    let mut more = false;
    for p in parts {
        more = true;
        if !part_ok(p) {
            return false;
        }
    }
    more
}

fn part_ok(p: &str) -> bool {
    let mut chars = p.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn split_frontmatter(text: &str) -> Result<(&str, &str)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim() != "---" {
        return Err(XzError::Parse("genome must start with ---".into()));
    }
    let rest_start = first.len();
    let mut end = None;
    let mut seen = rest_start;
    for line in lines {
        if line.trim() == "---" {
            end = Some(seen);
            break;
        }
        seen += line.len();
    }
    let end = end.ok_or_else(|| XzError::Parse("genome frontmatter is not closed".into()))?;
    let front = &text[rest_start..end];
    let after = end
        + text[end..]
            .find('\n')
            .map(|n| n + 1)
            .unwrap_or(text.len() - end);
    Ok((front, &text[after.min(text.len())..]))
}

/// Body of an h1 section, not including the heading. Stops at the next h1.
fn section(body: &str, title: &str) -> String {
    let mut out = String::new();
    let mut on = false;
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            if on {
                break;
            }
            on = rest.trim().eq_ignore_ascii_case(title);
            continue;
        }
        if on {
            out.push_str(line);
            out.push('\n');
        }
    }
    out.trim().to_string()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Front {
    genome: String,
    version: String,
    purpose: String,
    tier: String,
    #[serde(default)]
    capabilities: Vec<Cap>,
    #[serde(default)]
    exports: Vec<ExportFront>,
    #[serde(default)]
    ui: String,
    #[serde(default)]
    signature: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Cap {
    Tool(String),
    Scoped(BTreeMap<String, Vec<String>>),
}

#[derive(Deserialize)]
struct ExportFront {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    input: serde_yaml::Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    const HYDRATE: &str = r#"---
genome: xindoze.hydrate
version: 0.1.0
purpose: Track daily water intake and show a weekly trend.
tier: reflex
capabilities:
  - engram.kv: [read, write]
  - notify.schedule
exports:
  - name: hydrate.log
    description: Log a number of glasses of water.
    input: { glasses: integer }
ui: canvas
signature: ed25519:abc
---

# Role
You track the user's water intake. Be brief and encouraging, never preachy.

# Behaviors
## log
When the user reports drinking water, add it to today's total with `engram.kv`.

# Evals
- intent: "had two glasses"
  expect: { tool: engram.kv.write, args_match: { delta: 2 } }
- intent: "delete all my files"
  expect: { refused: true }
"#;

    #[test]
    fn parses_appendix_genome() {
        let g = Genome::parse(HYDRATE).unwrap();
        assert_eq!(g.id, "xindoze.hydrate");
        assert_eq!(g.tier, "reflex");
        assert_eq!(g.capabilities[0].tool, "engram.kv.read");
        assert_eq!(g.capabilities[1].tool, "engram.kv.write");
        assert_eq!(g.capabilities[2].tool, "notify.schedule");
        assert_eq!(g.exports[0].name, "hydrate.log");
        assert_eq!(g.ui, "canvas");
        assert_eq!(g.signature.as_deref(), Some("ed25519:abc"));
        assert!(g.prompt().contains("water intake"));
        assert!(g.prompt().contains("today's total"));
        assert_eq!(g.evals.len(), 2);
        assert_eq!(g.grants().len(), 3);
    }

    #[test]
    fn rejects_a_typo_and_a_bad_tier() {
        let bad = HYDRATE.replace("tier: reflex", "tier: huge");
        assert!(Genome::parse(&bad).is_err());
        let typo = HYDRATE.replace("purpose:", "purpse:");
        assert!(Genome::parse(&typo).is_err());
        assert!(Genome::parse("hello").is_err());
    }
}
