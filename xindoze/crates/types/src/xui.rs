//! XUI: the generative UI schema (SPEC Appendix B).
//! Models emit this JSON; the Canvas renders it. Never HTML, never scripts.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_DEPTH: usize = 8;
pub const MAX_NODES: usize = 500;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Row,
    #[default]
    Col,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputKind {
    Text,
    Number,
    Date,
    Toggle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChartKind {
    Bar,
    Line,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Series {
    pub name: String,
    pub values: Vec<f64>,
}

/// What a button does. Bound at render time; tool calls still pass the Warden.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Action {
    Intent {
        intent: String,
    },
    Tool {
        tool: String,
        #[serde(default)]
        args: Value,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Node {
    Stack {
        #[serde(default)]
        direction: Direction,
        #[serde(default)]
        gap: Option<u32>,
        #[serde(default)]
        children: Vec<Node>,
    },
    Heading {
        text: String,
        #[serde(default = "one")]
        level: u8,
    },
    /// Markdown subset: bold, italic, code, links.
    Text {
        text: String,
    },
    List {
        items: Vec<String>,
        #[serde(default)]
        ordered: bool,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Card {
        title: String,
        #[serde(default)]
        children: Vec<Node>,
    },
    Button {
        label: String,
        action: Action,
    },
    Input {
        label: String,
        kind: InputKind,
        bind: String,
    },
    /// `src` is a local blob ref, never a remote URL.
    Image {
        src: String,
        alt: String,
    },
    Chart {
        kind: ChartKind,
        x: Vec<String>,
        series: Vec<Series>,
        #[serde(default)]
        y: Option<String>,
    },
    Progress {
        value: f64,
        max: f64,
        label: String,
    },
    /// The undo button for a task's actions.
    Rewind {
        task_id: String,
    },
}

fn one() -> u8 {
    1
}

impl Node {
    fn children(&self) -> &[Node] {
        match self {
            Node::Stack { children, .. } | Node::Card { children, .. } => children,
            _ => &[],
        }
    }

    /// Checks accessibility and size rules. Returns every problem found.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = vec![];
        let mut count = 0;
        walk(self, 1, &mut count, &mut problems);
        if count > MAX_NODES {
            problems.push(format!("too many nodes: {count} > {MAX_NODES}"));
        }
        problems
    }

    /// True if this tree contains a node of the given `type` name.
    pub fn contains_type(&self, ty: &str) -> bool {
        let me = serde_json::to_value(self).ok();
        me.as_ref()
            .and_then(|v| v.get("type"))
            .and_then(Value::as_str)
            == Some(ty)
            || self.children().iter().any(|c| c.contains_type(ty))
    }
}

fn walk(n: &Node, depth: usize, count: &mut usize, out: &mut Vec<String>) {
    *count += 1;
    if depth > MAX_DEPTH {
        out.push(format!("nesting deeper than {MAX_DEPTH}"));
        return;
    }
    let blank = |s: &str| s.trim().is_empty();
    match n {
        Node::Button { label, .. } if blank(label) => out.push("button without label".into()),
        Node::Input { label, .. } if blank(label) => out.push("input without label".into()),
        Node::Image { src, alt } => {
            if blank(alt) {
                out.push("image without alt text".into());
            }
            if src.contains("://") {
                out.push("image src must be a local blob ref".into());
            }
        }
        Node::Progress { label, .. } if blank(label) => out.push("progress without label".into()),
        Node::Heading { level, .. } if !(1..=6).contains(level) => {
            out.push("heading level must be 1-6".into())
        }
        Node::Table { columns, rows } if rows.iter().any(|r| r.len() != columns.len()) => {
            out.push("table row width differs from columns".into())
        }
        Node::Chart { x, series, .. } if series.iter().any(|s| s.values.len() != x.len()) => {
            out.push("chart series length differs from x".into())
        }
        _ => {}
    }
    for c in n.children() {
        walk(c, depth + 1, count, out);
    }
}

/// `$defs` for embedding the XUI schema in other schemas (`#/$defs/node`).
pub fn schema_defs() -> Value {
    let s = |p: Value, req: &[&str]| json!({"type": "object", "properties": p, "required": req});
    let ty = |t: &str| json!({"const": t});
    let strs = json!({"type": "array", "items": {"type": "string"}});
    let kids = json!({"type": "array", "items": {"$ref": "#/$defs/node"}});
    let action = json!({"anyOf": [
        {"type": "object", "properties": {"intent": {"type": "string"}}, "required": ["intent"]},
        {"type": "object", "properties": {"tool": {"type": "string"}, "args": {"type": "object"}}, "required": ["tool"]}
    ]});
    json!({
        "node": {"anyOf": [
            s(json!({"type": ty("stack"), "direction": {"enum": ["row", "col"]}, "children": kids}), &["type", "children"]),
            s(json!({"type": ty("heading"), "text": {"type": "string"}, "level": {"type": "integer"}}), &["type", "text"]),
            s(json!({"type": ty("text"), "text": {"type": "string"}}), &["type", "text"]),
            s(json!({"type": ty("list"), "items": strs, "ordered": {"type": "boolean"}}), &["type", "items"]),
            s(json!({"type": ty("table"), "columns": strs, "rows": {"type": "array", "items": strs}}), &["type", "columns", "rows"]),
            s(json!({"type": ty("card"), "title": {"type": "string"}, "children": kids}), &["type", "title", "children"]),
            s(json!({"type": ty("button"), "label": {"type": "string"}, "action": action}), &["type", "label", "action"]),
            s(json!({"type": ty("input"), "label": {"type": "string"}, "kind": {"enum": ["text", "number", "date", "toggle"]}, "bind": {"type": "string"}}), &["type", "label", "kind", "bind"]),
            s(json!({"type": ty("chart"), "kind": {"enum": ["bar", "line"]}, "x": strs, "series": {"type": "array", "items": s(json!({"name": {"type": "string"}, "values": {"type": "array", "items": {"type": "number"}}}), &["name", "values"])}, "y": {"type": "string"}}), &["type", "kind", "x", "series"]),
            s(json!({"type": ty("image"), "src": {"type": "string"}, "alt": {"type": "string"}}), &["type", "src", "alt"]),
            s(json!({"type": ty("progress"), "value": {"type": "number"}, "max": {"type": "number"}, "label": {"type": "string"}}), &["type", "value", "max", "label"]),
            s(json!({"type": ty("rewind"), "task_id": {"type": "string"}}), &["type", "task_id"])
        ]}
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_validates() {
        let n: Node = serde_json::from_value(json!({
            "type": "stack", "children": [
                {"type": "heading", "text": "Water"},
                {"type": "chart", "kind": "bar", "x": ["Mon", "Tue"], "series": [{"name": "glasses", "values": [3, 5]}]},
                {"type": "button", "label": "+1", "action": {"tool": "hydrate.log", "args": {"glasses": 1}}},
                {"type": "button", "label": "Week", "action": {"intent": "show my week"}}
            ]
        }))
        .unwrap();
        assert!(n.validate().is_empty(), "{:?}", n.validate());
        assert!(n.contains_type("chart"));
        assert!(!n.contains_type("table"));
    }

    #[test]
    fn rejects_inaccessible_and_remote() {
        let n: Node = serde_json::from_value(json!({
            "type": "stack", "children": [
                {"type": "button", "label": " ", "action": {"intent": "x"}},
                {"type": "image", "src": "https://evil.example/x.png", "alt": ""}
            ]
        }))
        .unwrap();
        let p = n.validate();
        assert!(p.iter().any(|s| s.contains("button")));
        assert!(p.iter().any(|s| s.contains("alt")));
        assert!(p.iter().any(|s| s.contains("local blob")));
    }

    #[test]
    fn rejects_unknown_type() {
        assert!(
            serde_json::from_value::<Node>(json!({"type": "html", "html": "<script>"})).is_err()
        );
    }
}
