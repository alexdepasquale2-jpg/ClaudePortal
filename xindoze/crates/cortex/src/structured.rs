//! Structured output (SPEC §3.6): extract JSON from model text, validate it
//! against the request's schema, repair once, then escalate a tier.

use crate::schema::validate;
use serde_json::Value;
use xz_types::{ChatMessage, GenRequest, GenResponse, Inference, XzError};

/// Problems listed in a repair turn; more only bloat the prompt.
const MAX_LISTED_ERRORS: usize = 12;

/// Generates JSON for `req`.
///
/// For each role, starting at `req.role`: one attempt, then one repair turn
/// that shows the model its output and the problems. If both fail, retry from
/// the original messages on the next role up (`Role::escalate`) while the
/// Inference has that role assigned. Gives up with `XzError::Model`.
/// Backend errors are returned as they are, without escalation.
pub async fn generate_json(
    inf: &dyn Inference,
    req: GenRequest,
) -> Result<(Value, GenResponse), XzError> {
    let mut role = req.role;
    loop {
        let mut attempt = req.clone();
        attempt.role = role;
        let first = inf.generate(attempt.clone()).await?;
        let problems = match check(&first.text, req.json_schema.as_ref()) {
            Ok(v) => return Ok((v, first)),
            Err(p) => p,
        };

        attempt.messages.push(ChatMessage::assistant(first.text));
        attempt
            .messages
            .push(ChatMessage::user(repair_prompt(&problems)));
        let second = inf.generate(attempt).await?;
        let problems = match check(&second.text, req.json_schema.as_ref()) {
            Ok(v) => return Ok((v, second)),
            Err(p) => p,
        };

        match role.escalate() {
            Some(next) if inf.has_role(next) => {
                tracing::debug!(?role, ?next, "invalid structured output; escalating");
                role = next;
            }
            _ => {
                let shown: Vec<&str> = problems
                    .iter()
                    .take(MAX_LISTED_ERRORS)
                    .map(String::as_str)
                    .collect();
                return Err(XzError::Model(format!(
                    "no valid JSON from role {role:?} after one repair: {}",
                    shown.join("; ")
                )));
            }
        }
    }
}

/// Parses and validates model output. Errors describe what to fix.
fn check(text: &str, schema: Option<&Value>) -> Result<Value, Vec<String>> {
    let value =
        extract_json(text).ok_or_else(|| vec!["the reply contains no JSON value".to_string()])?;
    match schema {
        Some(s) => validate(&value, s).map(|()| value),
        None => Ok(value),
    }
}

fn repair_prompt(problems: &[String]) -> String {
    let mut msg =
        String::from("Your reply was not valid JSON for the required schema. Problems:\n");
    for p in problems.iter().take(MAX_LISTED_ERRORS) {
        msg.push_str("- ");
        msg.push_str(p);
        msg.push('\n');
    }
    if problems.len() > MAX_LISTED_ERRORS {
        msg.push_str(&format!(
            "- ...and {} more\n",
            problems.len() - MAX_LISTED_ERRORS
        ));
    }
    msg.push_str("Reply with the corrected JSON only: no prose, no code fences.");
    msg
}

/// Finds the JSON value in model text. Tolerates a leading `<think>` block,
/// Markdown code fences, and prose before or after the value.
pub fn extract_json(text: &str) -> Option<Value> {
    let text = strip_think(text);
    if let Ok(v) = serde_json::from_str(text) {
        return Some(v);
    }
    if let Some(v) = fenced(text).and_then(|f| serde_json::from_str(f).ok()) {
        return Some(v);
    }
    // The first `{` or `[` that starts a complete value wins; trailing text is ignored.
    text.char_indices()
        .filter(|(_, c)| matches!(c, '{' | '['))
        .find_map(|(i, _)| {
            serde_json::Deserializer::from_str(&text[i..])
                .into_iter::<Value>()
                .next()?
                .ok()
        })
}

/// The body of the first Markdown code fence, if any.
fn fenced(text: &str) -> Option<&str> {
    let start = text.find("```")? + 3;
    let rest = &text[start..];
    // Skip an info string such as `json`.
    let body_start = rest.find('\n')? + 1;
    let body = &rest[body_start..];
    let end = body.find("```").unwrap_or(body.len());
    Some(body[..end].trim())
}

/// Removes a leading `<think>…</think>` block (reasoning models such as Qwen3).
/// An unterminated block means the whole reply was thinking.
pub fn strip_think(text: &str) -> &str {
    let t = text.trim_start();
    match t.strip_prefix("<think>") {
        Some(rest) => match rest.find("</think>") {
            Some(end) => rest[end + "</think>".len()..].trim(),
            None => "",
        },
        None => text.trim(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cortex::Cortex;
    use crate::scripted::ScriptedBackend;
    use serde_json::json;
    use std::sync::Arc;
    use xz_types::{MsgRole, Role};

    fn schema() -> Value {
        json!({"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]})
    }

    fn req(role: Role) -> GenRequest {
        GenRequest::new(role, vec![ChatMessage::user("give n")]).with_schema(schema())
    }

    #[test]
    fn extracts_from_messy_text() {
        assert_eq!(extract_json(r#"{"n": 1}"#), Some(json!({"n": 1})));
        assert_eq!(
            extract_json("<think>\nlet me think {\n</think>\n{\"n\": 2}"),
            Some(json!({"n": 2}))
        );
        assert_eq!(
            extract_json("Sure!\n```json\n{\"n\": 3}\n```\nDone."),
            Some(json!({"n": 3}))
        );
        assert_eq!(extract_json("```\n[1, 2]\n```"), Some(json!([1, 2])));
        assert_eq!(
            extract_json("Here you go: {\"n\": 4} hope that helps {x}"),
            Some(json!({"n": 4}))
        );
        assert_eq!(
            extract_json("a {broken then {\"n\": 5}"),
            Some(json!({"n": 5}))
        );
        assert_eq!(
            extract_json("\"just a string\""),
            Some(json!("just a string"))
        );
        assert_eq!(extract_json("no json here"), None);
        assert_eq!(extract_json("<think>never ends {\"n\": 1}"), None);
    }

    #[test]
    fn strips_think() {
        assert_eq!(strip_think("  <think>a</think>\n\nhi "), "hi");
        assert_eq!(strip_think("hi <think>x</think>"), "hi <think>x</think>");
        assert_eq!(strip_think("<think>unterminated"), "");
    }

    #[tokio::test]
    async fn valid_first_time() {
        let sb = Arc::new(ScriptedBackend::queue(["```json\n{\"n\": 7}\n```"]));
        let cx = Cortex::single(sb.clone(), "m");
        let (v, resp) = generate_json(&cx, req(Role::Cortex)).await.unwrap();
        assert_eq!(v, json!({"n": 7}));
        assert_eq!(resp.model, "scripted:m");
        assert_eq!(sb.calls().len(), 1);
    }

    #[tokio::test]
    async fn one_repair_turn_shows_output_and_errors() {
        let sb = Arc::new(ScriptedBackend::queue([r#"{"n": "seven"}"#, r#"{"n": 7}"#]));
        let cx = Cortex::single(sb.clone(), "m");
        let (v, _) = generate_json(&cx, req(Role::Reflex)).await.unwrap();
        assert_eq!(v, json!({"n": 7}));
        let calls = sb.calls();
        assert_eq!(calls.len(), 2);
        let repair = &calls[1].request;
        assert_eq!(repair.role, Role::Reflex);
        assert_eq!(repair.messages.len(), 3);
        assert_eq!(repair.messages[1].role, MsgRole::Assistant);
        assert_eq!(repair.messages[1].content, r#"{"n": "seven"}"#);
        assert_eq!(repair.messages[2].role, MsgRole::User);
        assert!(
            repair.messages[2]
                .content
                .contains("/n: expected integer, got string")
        );
        assert!(repair.messages[2].content.contains("corrected JSON only"));
        assert_eq!(repair.json_schema, Some(schema()));
    }

    #[tokio::test]
    async fn escalates_after_failed_repair() {
        // Reflex is hopeless; Cortex gets it right on a fresh attempt.
        let sb = Arc::new(ScriptedBackend::new(|_, r| match r.role {
            Role::Reflex => "I think n is seven".into(),
            _ => r#"{"n": 7}"#.into(),
        }));
        let cx = Cortex::single(sb.clone(), "m");
        let (v, _) = generate_json(&cx, req(Role::Reflex)).await.unwrap();
        assert_eq!(v, json!({"n": 7}));
        let roles: Vec<Role> = sb.calls().iter().map(|c| c.request.role).collect();
        assert_eq!(roles, [Role::Reflex, Role::Reflex, Role::Cortex]);
        let escalated = &sb.calls()[2].request;
        assert_eq!(
            escalated.messages.len(),
            1,
            "escalation starts from the original messages"
        );
        assert!(
            sb.calls()[1].request.messages[2]
                .content
                .contains("no JSON value")
        );
    }

    #[tokio::test]
    async fn gives_up_at_the_top_tier() {
        let sb = Arc::new(ScriptedBackend::always("{\"m\": 1}"));
        let cx = Cortex::single(sb.clone(), "m");
        let err = generate_json(&cx, req(Role::Reflex)).await.unwrap_err();
        match err {
            XzError::Model(m) => assert!(
                m.contains("Oracle") && m.contains("missing required property"),
                "{m}"
            ),
            other => panic!("{other:?}"),
        }
        let roles: Vec<Role> = sb.calls().iter().map(|c| c.request.role).collect();
        assert_eq!(
            roles,
            [
                Role::Reflex,
                Role::Reflex,
                Role::Cortex,
                Role::Cortex,
                Role::Oracle,
                Role::Oracle
            ]
        );
    }

    #[tokio::test]
    async fn stops_where_no_higher_role_is_assigned() {
        let sb = Arc::new(ScriptedBackend::always("nope"));
        let cx = Cortex::builder()
            .backend(sb.clone())
            .assign(Role::Cortex, "scripted", "m")
            .build()
            .unwrap();
        // Oracle is unassigned, so Cortex does not escalate into itself.
        assert!(matches!(
            generate_json(&cx, req(Role::Cortex)).await,
            Err(XzError::Model(_))
        ));
        assert_eq!(sb.calls().len(), 2);
    }

    #[tokio::test]
    async fn backend_errors_propagate() {
        let sb = Arc::new(ScriptedBackend::queue(["not json"]));
        let cx = Cortex::single(sb.clone(), "m");
        // The repair turn hits an empty queue: that error comes back unchanged.
        let err = generate_json(&cx, req(Role::Cortex)).await.unwrap_err();
        assert!(err.to_string().contains("no more responses"), "{err}");
    }

    #[tokio::test]
    async fn without_schema_any_json_passes() {
        let cx = Cortex::single(Arc::new(ScriptedBackend::always("ok: [1, 2]")), "m");
        let r = GenRequest::new(Role::Cortex, vec![ChatMessage::user("x")]);
        assert_eq!(generate_json(&cx, r).await.unwrap().0, json!([1, 2]));
    }

    #[test]
    fn repair_prompt_caps_the_list() {
        let problems: Vec<String> = (0..20).map(|i| format!("p{i}")).collect();
        let msg = repair_prompt(&problems);
        assert!(msg.contains("- p11\n") && !msg.contains("- p12\n"));
        assert!(msg.contains("and 8 more"));
    }
}
