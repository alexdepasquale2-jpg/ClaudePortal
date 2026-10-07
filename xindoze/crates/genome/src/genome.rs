//! The Genome type: parse, system prompt, Markdown output, exported tools.

use crate::eval::Eval;
use crate::markdown::{self, Chunk};
use crate::schema;
use crate::text::{self, parse_err};
use serde::de::Visitor;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use std::fmt;
use xz_types::{Grant, Risk, Role, ToolSpec, XzError};

/// A parsed Genome file (SPEC §3.8, Appendix A).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Genome {
    /// Dotted id, e.g. `xindoze.hydrate`.
    pub id: String,
    /// Semver, checked by [`Genome::validate`].
    pub version: String,
    /// One line; the router reads it.
    pub purpose: String,
    /// Minimum model tier: Reflex, Cortex or Oracle.
    pub tier: Role,
    /// Requested capabilities. The Charter decides what is granted.
    pub capabilities: Vec<Grant>,
    pub exports: Vec<Export>,
    pub ui: Ui,
    pub author: Option<String>,
    /// `ed25519:<pubkey-b64>:<sig-b64>`, checked by [`crate::verify`] on the file text.
    pub signature: Option<String>,
    /// The Markdown after the frontmatter, verbatim. The source of
    /// `behaviors`, `evals` and the system prompt.
    pub body: String,
    /// H2 subsections of `# Behaviors`.
    pub behaviors: Vec<Behavior>,
    /// Items of `# Evals`.
    pub evals: Vec<Eval>,
}

/// A tool other Organisms can call; the call runs this Organism.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Export {
    /// `<last id segment>.<verb>`, e.g. `hydrate.log`.
    pub name: String,
    pub description: String,
    /// JSON Schema for the args (the short form is converted on parse).
    pub input_schema: Value,
    pub risk: Risk,
}

/// One `## name` subsection of `# Behaviors`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Behavior {
    /// Heading text, e.g. `remind (optional)`.
    pub name: String,
    pub text: String,
}

/// Whether the Organism draws a Canvas pane.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ui {
    #[default]
    None,
    Canvas,
}

/// Frontmatter as written. Unknown keys are errors so typos never pass silently.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFront {
    #[serde(deserialize_with = "scalar")]
    genome: String,
    #[serde(deserialize_with = "scalar")]
    version: String,
    #[serde(deserialize_with = "scalar")]
    purpose: String,
    #[serde(default, deserialize_with = "opt_scalar")]
    tier: Option<String>,
    #[serde(default)]
    capabilities: Option<Vec<Value>>,
    #[serde(default)]
    exports: Option<Vec<RawExport>>,
    #[serde(default)]
    ui: Option<Ui>,
    #[serde(default, deserialize_with = "opt_scalar")]
    author: Option<String>,
    #[serde(default, deserialize_with = "opt_scalar")]
    signature: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawExport {
    name: String,
    #[serde(deserialize_with = "scalar")]
    description: String,
    input: Value,
    #[serde(default)]
    risk: Option<Risk>,
}

/// Frontmatter as written by [`Genome::to_markdown`], in the conventional key order.
#[derive(Serialize)]
struct OutFront<'a> {
    genome: &'a str,
    version: &'a str,
    purpose: &'a str,
    tier: Role,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    capabilities: Vec<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    exports: Vec<OutExport<'a>>,
    ui: Ui,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<&'a str>,
}

#[derive(Serialize)]
struct OutExport<'a> {
    name: &'a str,
    description: &'a str,
    input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    risk: Option<Risk>,
}

/// Accepts any YAML scalar as text so `version: 1.0` reaches `validate`
/// (which explains semver) instead of failing as "expected a string".
/// A visitor rather than a buffered `Value` so YAML errors keep key and line.
fn scalar<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    d.deserialize_any(TextVisitor)
}

struct TextVisitor;

impl Visitor<'_> for TextVisitor {
    type Value = String;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a single line of text")
    }
    fn visit_str<E>(self, v: &str) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_string<E>(self, v: String) -> Result<String, E> {
        Ok(v)
    }
    fn visit_bool<E>(self, v: bool) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_i64<E>(self, v: i64) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_u64<E>(self, v: u64) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_f64<E>(self, v: f64) -> Result<String, E> {
        // Debug keeps `1.0` as written; Display would print `1`.
        Ok(format!("{v:?}"))
    }
    fn visit_unit<E>(self) -> Result<String, E> {
        Ok(String::new())
    }
}

fn opt_scalar<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    scalar(d).map(|s| Some(s).filter(|s| !s.trim().is_empty()))
}

impl Genome {
    /// Parses a genome file. Structural problems are errors naming the key
    /// and file line; semantic ones are left to [`Genome::validate`].
    pub fn parse(text: &str) -> Result<Genome, XzError> {
        let text = text::normalize(text);
        let framed = text::frame(&text)?;
        let yaml = framed.yaml();
        if yaml.trim().is_empty() {
            return Err(parse_err(
                "the frontmatter is empty: it needs at least `genome`, `version` and `purpose`",
            ));
        }
        // Offset 1: the YAML starts on file line 2, after the opening `---`.
        let raw: RawFront = text::from_yaml(&yaml, 1, "frontmatter")?;
        let body = framed.body();
        let (behaviors, evals) = parse_body(&body, framed.body_offset())?;
        Ok(Genome {
            id: raw.genome,
            version: raw.version,
            purpose: raw.purpose,
            tier: parse_tier(raw.tier.as_deref())?,
            capabilities: raw
                .capabilities
                .unwrap_or_default()
                .into_iter()
                .enumerate()
                .map(|(i, c)| parse_capability(i, c))
                .collect::<Result<_, _>>()?,
            exports: raw
                .exports
                .unwrap_or_default()
                .into_iter()
                .map(|e| {
                    let input_schema = schema::to_schema(e.input)
                        .map_err(|m| parse_err(format!("export `{}`: {m}", e.name)))?;
                    Ok(Export {
                        name: e.name,
                        description: e.description,
                        input_schema,
                        risk: e.risk.unwrap_or(Risk::Act),
                    })
                })
                .collect::<Result<_, XzError>>()?,
            ui: raw.ui.unwrap_or_default(),
            author: raw.author,
            signature: raw.signature,
            body,
            behaviors,
            evals,
        })
    }

    /// The last segment of the id (`hydrate` for `xindoze.hydrate`): the
    /// prefix of its exports and the name of its own state namespace.
    pub fn short_name(&self) -> &str {
        self.id.rsplit('.').next().unwrap_or(&self.id)
    }

    /// The Organism's system prompt: the purpose, then every body section
    /// except `# Evals` (evals are for Darwin, not the model).
    pub fn system_prompt(&self) -> String {
        let lines: Vec<&str> = self.body.lines().collect();
        let kept: Vec<&str> = markdown::split(&lines, 0..lines.len(), 1)
            .iter()
            .filter(|c| !c.is("evals"))
            .flat_map(|c| lines[c.lines.clone()].iter().copied())
            .collect();
        format!(
            "Purpose: {}\n\n{}",
            self.purpose.trim(),
            kept.join("\n").trim()
        )
        .trim_end()
        .to_string()
    }

    /// Writes the genome back as a file. `parse` of the result equals `self`.
    ///
    /// The frontmatter is regenerated (comments are dropped, short-form inputs
    /// are kept short), so a signature from the original text will no longer
    /// verify unless the frontmatter was already in this canonical form.
    pub fn to_markdown(&self) -> Result<String, XzError> {
        let front = OutFront {
            genome: &self.id,
            version: &self.version,
            purpose: &self.purpose,
            tier: self.tier,
            capabilities: self.capabilities.iter().map(capability_yaml).collect(),
            exports: self
                .exports
                .iter()
                .map(|e| OutExport {
                    name: &e.name,
                    description: &e.description,
                    input: schema::to_short(&e.input_schema)
                        .unwrap_or_else(|| e.input_schema.clone()),
                    risk: Some(e.risk).filter(|r| *r != Risk::Act),
                })
                .collect(),
            ui: self.ui,
            author: self.author.as_deref(),
            signature: self.signature.as_deref(),
        };
        let yaml = serde_yaml_ng::to_string(&front)
            .map_err(|e| XzError::Other(format!("writing genome frontmatter: {e}")))?;
        Ok(format!("---\n{yaml}---\n{}", self.body))
    }

    /// The exported tools as the Synapse advertises them. Only Seed Bank
    /// genomes are first party; for any other genome the Warden treats
    /// every export as `commit`.
    pub fn export_tools(&self, seed_bank: bool) -> Vec<ToolSpec> {
        self.exports
            .iter()
            .map(|e| ToolSpec {
                name: e.name.clone(),
                description: e.description.clone(),
                input_schema: e.input_schema.clone(),
                risk: e.risk,
                resource_args: vec![],
                tainted_output: false,
                first_party: seed_bank,
            })
            .collect()
    }
}

fn parse_tier(tier: Option<&str>) -> Result<Role, XzError> {
    match tier.map(str::trim) {
        None | Some("") => Ok(Role::Cortex),
        Some("reflex") => Ok(Role::Reflex),
        Some("cortex") => Ok(Role::Cortex),
        Some("oracle") => Ok(Role::Oracle),
        Some(other) => Err(parse_err(format!(
            "frontmatter: tier must be reflex, cortex or oracle, got `{other}`"
        ))),
    }
}

/// One `capabilities` item: `"tool.glob"` or `{"tool.glob": [resource globs]}`.
fn parse_capability(i: usize, item: Value) -> Result<Grant, XzError> {
    let shape = || {
        parse_err(format!(
            "frontmatter: capabilities[{i}] must be a tool glob like `fs.read` or a one-key map \
             like `fs.read: [\"~/Notes/**\"]`, got {item}"
        ))
    };
    match &item {
        Value::String(tool) => Ok(Grant {
            tool: tool.clone(),
            resources: vec![],
        }),
        Value::Object(m) if m.len() == 1 => {
            let Some((tool, res)) = m.iter().next() else {
                return Err(shape());
            };
            let resources = match res {
                Value::Array(items) => items
                    .iter()
                    .map(|r| match r {
                        Value::String(s) => Ok(s.clone()),
                        // A bare `~` is YAML for null, a likely slip when meaning home.
                        Value::Null => Err(parse_err(format!(
                            "frontmatter: capabilities[{i}] `{tool}`: a resource is empty or a \
                             bare `~`; quote it, e.g. \"~\" or \"~/**\""
                        ))),
                        other => Err(parse_err(format!(
                            "frontmatter: capabilities[{i}] `{tool}`: resources must be glob \
                             strings, got {other}"
                        ))),
                    })
                    .collect::<Result<_, _>>()?,
                _ => {
                    return Err(parse_err(format!(
                        "frontmatter: capabilities[{i}] `{tool}`: resources must be a list, \
                         e.g. `{tool}: [\"~/Notes/**\"]`, got {res}"
                    )));
                }
            };
            Ok(Grant {
                tool: tool.clone(),
                resources,
            })
        }
        _ => Err(shape()),
    }
}

fn capability_yaml(g: &Grant) -> Value {
    if g.resources.is_empty() {
        Value::String(g.tool.clone())
    } else {
        json!({ g.tool.clone(): g.resources })
    }
}

/// Extracts behaviors and evals. `offset` is the number of file lines before the body.
fn parse_body(body: &str, offset: usize) -> Result<(Vec<Behavior>, Vec<Eval>), XzError> {
    let lines: Vec<&str> = body.lines().collect();
    let sections = markdown::split(&lines, 0..lines.len(), 1);
    let behaviors = sections
        .iter()
        .filter(|c| c.is("behaviors"))
        .flat_map(|c| markdown::split(&lines, c.content(), 2))
        .filter_map(|b: Chunk| {
            let name = b.title.clone()?;
            let text = lines[b.content()].join("\n").trim().to_string();
            Some(Behavior { name, text })
        })
        .collect();
    let mut evals = vec![];
    for c in sections.iter().filter(|c| c.is("evals")) {
        let range = markdown::yaml_lines(&lines, c.content());
        let yaml = lines[range.clone()].join("\n");
        if yaml.trim().is_empty() {
            continue;
        }
        let items: Option<Vec<Eval>> = text::from_yaml(&yaml, offset + range.start, "# Evals")?;
        evals.extend(items.unwrap_or_default());
    }
    Ok((behaviors, evals))
}
