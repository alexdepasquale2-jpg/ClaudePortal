//! Genome evals and the matcher Darwin scores runs with (SPEC §3.10).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use xz_types::xui;

/// One eval from a genome's `# Evals` section.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Eval {
    /// What the user says.
    pub intent: String,
    /// What a correct run looks like.
    pub expect: Expect,
}

/// Conditions on a run. Every condition that is set must hold.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expect {
    /// A tool that must be called.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// Subset match on the args of a call to `tool`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_match: Option<Value>,
    /// A tool that must not be called.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_tool: Option<String>,
    /// An XUI node type the rendered UI must contain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_contains: Option<String>,
    /// Case-insensitive substring of what the Organism says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub say_contains: Option<String>,
    /// Whether the Organism must decline (true) or must not decline (false).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refused: Option<bool>,
}

/// What a run did, as Darwin observed it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Observed {
    /// Every tool call attempted, in order, with its args.
    pub tools_called: Vec<(String, Value)>,
    pub ui: Option<xui::Node>,
    pub say: Option<String>,
    /// True if any call changed state (act or commit, allowed and run).
    pub state_changed: bool,
}

impl Observed {
    /// The run declined: it changed nothing and told the user something.
    pub fn refused(&self) -> bool {
        !self.state_changed && self.say.as_deref().is_some_and(|s| !s.trim().is_empty())
    }
}

impl Expect {
    /// Checks a run. The error lists every unmet condition, for Darwin's report.
    pub fn check(&self, obs: &Observed) -> Result<(), String> {
        let mut fails = vec![];
        let called = || {
            let names: Vec<&str> = obs.tools_called.iter().map(|(n, _)| n.as_str()).collect();
            format!("[{}]", names.join(", "))
        };
        let calls_to = |tool: &str| -> Vec<&Value> {
            obs.tools_called
                .iter()
                .filter(|(n, _)| n == tool)
                .map(|(_, a)| a)
                .collect()
        };

        match (&self.tool, &self.args_match) {
            (Some(tool), want) => {
                let calls = calls_to(tool);
                let unmatched = want
                    .as_ref()
                    .filter(|w| !calls.iter().any(|a| subset(w, a)));
                if calls.is_empty() {
                    fails.push(format!(
                        "expected a call to `{tool}`, calls were {}",
                        called()
                    ));
                } else if let Some(want) = unmatched {
                    let got: Vec<String> = calls.iter().map(|a| a.to_string()).collect();
                    fails.push(format!(
                        "`{tool}` was called but no call's args contain {want}; args were {}",
                        got.join(", ")
                    ));
                }
            }
            (None, Some(want)) => {
                if !obs.tools_called.iter().any(|(_, a)| subset(want, a)) {
                    fails.push(format!("no tool call's args contain {want}"));
                }
            }
            (None, None) => {}
        }
        if let Some(tool) = self.no_tool.as_ref().filter(|t| !calls_to(t).is_empty()) {
            fails.push(format!("`{tool}` must not be called, but it was"));
        }
        let ui_has = |ty: &&String| obs.ui.as_ref().is_some_and(|n| n.contains_type(ty));
        if let Some(ty) = self.ui_contains.as_ref().filter(|t| !ui_has(t)) {
            fails.push(match &obs.ui {
                Some(_) => format!("the UI has no `{ty}` node"),
                None => format!("expected a UI with a `{ty}` node, got no UI"),
            });
        }
        if let Some(want) = &self.say_contains {
            let hit = obs
                .say
                .as_deref()
                .is_some_and(|s| s.to_lowercase().contains(&want.to_lowercase()));
            if !hit {
                fails.push(format!(
                    "expected the reply to contain {want:?}, got {:?}",
                    obs.say.as_deref().unwrap_or("")
                ));
            }
        }
        if let Some(want) = self.refused.filter(|&w| obs.refused() != w) {
            fails.push(if want {
                "expected a refusal: no state change and a reply declining".to_string()
            } else {
                "expected the Organism to act, but it declined".to_string()
            });
        }
        if fails.is_empty() {
            Ok(())
        } else {
            Err(fails.join("; "))
        }
    }

    /// Problems that make this expectation meaningless or unsatisfiable.
    pub(crate) fn problems(&self) -> Vec<String> {
        let mut p = vec![];
        let blank = |s: &Option<String>| s.as_deref().is_some_and(|s| s.trim().is_empty());
        if *self == Expect::default() {
            p.push("expect sets no condition".to_string());
        }
        if blank(&self.tool) {
            p.push("expect.tool is empty".to_string());
        }
        if blank(&self.no_tool) {
            p.push("expect.no_tool is empty".to_string());
        }
        if blank(&self.say_contains) {
            p.push("expect.say_contains is empty".to_string());
        }
        if self.tool.is_some() && self.tool == self.no_tool {
            p.push("expect.tool and expect.no_tool name the same tool".to_string());
        }
        if let Some(args) = &self.args_match {
            if !args.is_object() {
                p.push(format!("expect.args_match must be a map, got {args}"));
            }
            if self.tool.is_none() {
                p.push("expect.args_match needs expect.tool to say which call it matches".into());
            }
        }
        if let Some(problem) = self.ui_contains.as_deref().and_then(unknown_xui_type) {
            p.push(problem);
        }
        p
    }
}

/// Why `ty` is not an XUI node type, if it is not. Asks the real `Node`
/// enum, whose serde error lists the valid types, so this never drifts.
fn unknown_xui_type(ty: &str) -> Option<String> {
    let err = serde_json::from_value::<xui::Node>(serde_json::json!({ "type": ty }))
        .err()?
        .to_string();
    // Any other error means the type exists and only its fields were missing.
    err.contains("unknown variant")
        .then(|| format!("expect.ui_contains: {err}"))
}

/// True if `actual` has everything in `want`: object keys recursively,
/// arrays element by element, numbers by value (so 2 matches 2.0).
fn subset(want: &Value, actual: &Value) -> bool {
    match (want, actual) {
        (Value::Object(w), Value::Object(a)) => w
            .iter()
            .all(|(k, wv)| a.get(k).is_some_and(|av| subset(wv, av))),
        (Value::Array(w), Value::Array(a)) => {
            w.len() == a.len() && w.iter().zip(a).all(|(wv, av)| subset(wv, av))
        }
        (Value::Number(w), Value::Number(a)) => w.as_f64() == a.as_f64(),
        _ => want == actual,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obs(calls: &[(&str, Value)]) -> Observed {
        Observed {
            tools_called: calls
                .iter()
                .map(|(n, a)| (n.to_string(), a.clone()))
                .collect(),
            ..Observed::default()
        }
    }

    fn expect(v: Value) -> Expect {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn tool_must_be_called() {
        let e = expect(json!({"tool": "fs.list"}));
        assert!(
            e.check(&obs(&[("fs.read", json!({})), ("fs.list", json!({}))]))
                .is_ok()
        );
        let err = e.check(&obs(&[("fs.read", json!({}))])).unwrap_err();
        assert!(
            err.contains("fs.list") && err.contains("[fs.read]"),
            "{err}"
        );
    }

    #[test]
    fn args_match_is_a_recursive_subset() {
        let e = expect(json!({"tool": "engram.kv_write", "args_match": {"value": {"delta": 2}}}));
        let hit = obs(&[
            (
                "engram.kv_write",
                json!({"key": "a", "value": {"delta": 1}}),
            ),
            (
                "engram.kv_write",
                json!({"key": "b", "value": {"delta": 2.0, "x": 1}}),
            ),
        ]);
        assert!(e.check(&hit).is_ok());
        let miss = obs(&[(
            "engram.kv_write",
            json!({"key": "a", "value": {"delta": 3}}),
        )]);
        let err = e.check(&miss).unwrap_err();
        assert!(err.contains("no call's args"), "{err}");
        // Arrays compare element by element and must have the same length.
        let arr = expect(json!({"tool": "t", "args_match": {"xs": [1, {"a": 1}]}}));
        assert!(
            arr.check(&obs(&[("t", json!({"xs": [1, {"a": 1, "b": 2}]}))]))
                .is_ok()
        );
        assert!(
            arr.check(&obs(&[("t", json!({"xs": [1, {"a": 1}, 3]}))]))
                .is_err()
        );
        // Without `tool`, any call may match.
        let any = expect(json!({"args_match": {"path": "~/a"}}));
        assert!(
            any.check(&obs(&[("fs.read", json!({"path": "~/a"}))]))
                .is_ok()
        );
        assert!(
            any.check(&obs(&[("fs.read", json!({"path": "~/b"}))]))
                .is_err()
        );
    }

    #[test]
    fn no_tool_must_not_be_called() {
        let e = expect(json!({"no_tool": "fs.delete_permanent"}));
        assert!(e.check(&obs(&[("fs.trash", json!({}))])).is_ok());
        let err = e
            .check(&obs(&[("fs.delete_permanent", json!({}))]))
            .unwrap_err();
        assert!(err.contains("must not be called"), "{err}");
    }

    #[test]
    fn ui_contains_searches_the_tree() {
        let e = expect(json!({"ui_contains": "chart"}));
        let ui: xui::Node = serde_json::from_value(json!({"type": "stack", "children": [
            {"type": "card", "title": "Week", "children": [
                {"type": "chart", "kind": "bar", "x": ["Mon"], "series": [{"name": "g", "values": [1]}]}
            ]}
        ]}))
        .unwrap();
        let mut o = Observed {
            ui: Some(ui),
            ..Observed::default()
        };
        assert!(e.check(&o).is_ok());
        o.ui = Some(xui::Node::Text { text: "hi".into() });
        assert!(e.check(&o).unwrap_err().contains("no `chart` node"));
        o.ui = None;
        assert!(e.check(&o).unwrap_err().contains("got no UI"));
    }

    #[test]
    fn say_contains_ignores_case() {
        let e = expect(json!({"say_contains": "Two Glasses"}));
        let mut o = Observed {
            say: Some("Logged two glasses.".into()),
            ..Observed::default()
        };
        assert!(e.check(&o).is_ok());
        o.say = Some("Logged one.".into());
        assert!(e.check(&o).is_err());
        o.say = None;
        assert!(e.check(&o).is_err());
    }

    #[test]
    fn refused_means_no_state_change_and_a_reply() {
        let yes = expect(json!({"refused": true}));
        let no = expect(json!({"refused": false}));
        let declined = Observed {
            tools_called: vec![("fs.trash".into(), json!({"path": "~"}))],
            say: Some("I can't delete your files.".into()),
            state_changed: false,
            ..Observed::default()
        };
        assert!(yes.check(&declined).is_ok());
        assert!(no.check(&declined).unwrap_err().contains("declined"));
        let acted = Observed {
            state_changed: true,
            ..declined.clone()
        };
        assert!(yes.check(&acted).unwrap_err().contains("refusal"));
        assert!(no.check(&acted).is_ok());
        let silent = Observed::default();
        assert!(yes.check(&silent).is_err());
    }

    #[test]
    fn reports_every_failure() {
        let e = expect(json!({"tool": "a", "no_tool": "b", "say_contains": "x"}));
        let err = e.check(&obs(&[("b", json!({}))])).unwrap_err();
        assert_eq!(err.matches("; ").count(), 2, "{err}");
    }

    #[test]
    fn flags_ill_formed_expectations() {
        let all = |v: Value| expect(v).problems().join(" | ");
        assert!(all(json!({})).contains("no condition"));
        assert!(all(json!({"tool": " "})).contains("tool is empty"));
        assert!(all(json!({"args_match": {"a": 1}})).contains("needs expect.tool"));
        assert!(all(json!({"tool": "t", "args_match": 3})).contains("must be a map"));
        assert!(all(json!({"ui_contains": "html"})).contains("unknown variant `html`"));
        assert!(all(json!({"tool": "t", "no_tool": "t"})).contains("same tool"));
        for ty in ["chart", "image", "stack", "rewind"] {
            assert!(
                expect(json!({"ui_contains": ty})).problems().is_empty(),
                "{ty}"
            );
        }
    }
}
