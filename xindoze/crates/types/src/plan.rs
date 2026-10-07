use crate::xui;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// One planned tool call.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Step {
    pub tool: String,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub why: String,
}

/// The planner's structured output (SPEC Appendix C, PlanSchema).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    #[serde(default)]
    pub thought: String,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub ui: Option<xui::Node>,
    #[serde(default)]
    pub say: Option<String>,
    #[serde(default)]
    pub done: bool,
}

/// JSON Schema for a Plan. `tools` restricts `steps[].tool` to known names.
pub fn plan_schema(tools: &[String]) -> Value {
    let tool = if tools.is_empty() {
        json!({"type": "string"})
    } else {
        json!({"type": "string", "enum": tools})
    };
    let mut schema = json!({
        "type": "object",
        "properties": {
            "thought": {"type": "string"},
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "tool": tool,
                        "args": {"type": "object"},
                        "why": {"type": "string"}
                    },
                    "required": ["tool", "args"]
                }
            },
            "ui": {"anyOf": [{"$ref": "#/$defs/node"}, {"type": "null"}]},
            "say": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "done": {"type": "boolean"}
        },
        "required": ["thought", "steps", "done"]
    });
    schema["$defs"] = xui::schema_defs();
    schema
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_plan() {
        let p: Plan = serde_json::from_str(
            r#"{"thought":"t","steps":[{"tool":"fs.list","args":{"path":"~"}}],"done":false}"#,
        )
        .unwrap();
        assert_eq!(p.steps[0].tool, "fs.list");
        assert!(p.ui.is_none());
    }

    #[test]
    fn schema_restricts_tools() {
        let s = plan_schema(&["fs.read".into()]);
        assert_eq!(
            s["properties"]["steps"]["items"]["properties"]["tool"]["enum"][0],
            "fs.read"
        );
        assert!(s["$defs"]["node"].is_object());
    }
}
