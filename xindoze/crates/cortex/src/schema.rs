//! A minimal JSON Schema validator for the subset Xindoze emits:
//! `type` (string or list), `properties`, `required`, `items`, `enum`,
//! `const`, `anyOf`, `oneOf`, and `$ref` to `#/$defs/*` or `#/definitions/*`.
//! Unknown keywords are ignored, as JSON Schema requires.

use serde_json::{Map, Value};

/// Guards against `$ref` cycles that never descend into the value.
const MAX_DEPTH: usize = 256;

/// One validation failure. `shape` marks failures that show the value has a
/// different shape than this schema branch (wrong type, const or enum).
struct Problem {
    at: String,
    msg: String,
    shape: bool,
}

impl Problem {
    fn new(at: &str, msg: String, shape: bool) -> Self {
        Self {
            at: at.to_string(),
            msg,
            shape,
        }
    }
}

/// Validates `value` against `schema`. Errors read `<json pointer>: <problem>`.
pub fn validate(value: &Value, schema: &Value) -> Result<(), Vec<String>> {
    let mut problems = vec![];
    check(value, schema, schema, "", 0, &mut problems);
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems
            .into_iter()
            .map(|p| {
                let at = if p.at.is_empty() { "/" } else { &p.at };
                format!("{at}: {}", p.msg)
            })
            .collect())
    }
}

fn check(
    value: &Value,
    schema: &Value,
    root: &Value,
    at: &str,
    depth: usize,
    out: &mut Vec<Problem>,
) {
    if depth > MAX_DEPTH {
        out.push(Problem::new(at, "schema nests too deeply".into(), false));
        return;
    }
    let s = match schema {
        Value::Bool(true) => return,
        Value::Bool(false) => {
            out.push(Problem::new(at, "no value is allowed here".into(), true));
            return;
        }
        Value::Object(s) => s,
        _ => return,
    };

    if let Some(r) = s.get("$ref").and_then(Value::as_str) {
        match resolve_ref(root, r) {
            Some(target) => check(value, target, root, at, depth + 1, out),
            None => out.push(Problem::new(at, format!("unresolvable $ref {r}"), false)),
        }
    }

    if let Some(c) = s.get("const")
        && value != c
    {
        out.push(Problem::new(at, format!("expected {c}"), true));
    }
    if let Some(Value::Array(options)) = s.get("enum")
        && !options.contains(value)
    {
        let msg = format!("expected one of {}", Value::Array(options.clone()));
        out.push(Problem::new(at, msg, true));
    }

    if let Some(t) = s.get("type")
        && !type_matches(value, t)
    {
        let msg = format!("expected {}, got {}", type_label(t), kind(value));
        out.push(Problem::new(at, msg, true));
        // Further keywords would only repeat the type mismatch.
        return;
    }

    if let Value::Object(obj) = value {
        check_object(obj, s, root, at, depth, out);
    }
    if let (Value::Array(items), Some(item_schema)) = (value, s.get("items")) {
        for (i, item) in items.iter().enumerate() {
            check(
                item,
                item_schema,
                root,
                &format!("{at}/{i}"),
                depth + 1,
                out,
            );
        }
    }

    if let Some(Value::Array(branches)) = s.get("anyOf") {
        check_branches(value, branches, root, at, depth, false, out);
    }
    if let Some(Value::Array(branches)) = s.get("oneOf") {
        check_branches(value, branches, root, at, depth, true, out);
    }
}

fn check_object(
    obj: &Map<String, Value>,
    s: &Map<String, Value>,
    root: &Value,
    at: &str,
    depth: usize,
    out: &mut Vec<Problem>,
) {
    if let Some(Value::Array(required)) = s.get("required") {
        for key in required.iter().filter_map(Value::as_str) {
            if !obj.contains_key(key) {
                let msg = format!("missing required property \"{key}\"");
                out.push(Problem::new(at, msg, false));
            }
        }
    }
    if let Some(Value::Object(props)) = s.get("properties") {
        for (key, sub) in props {
            if let Some(v) = obj.get(key) {
                check(
                    v,
                    sub,
                    root,
                    &format!("{at}/{}", escape(key)),
                    depth + 1,
                    out,
                );
            }
        }
    }
}

/// `anyOf` needs at least one matching branch, `oneOf` exactly one. When none
/// match, the closest branch's problems are the most useful repair hint.
fn check_branches(
    value: &Value,
    branches: &[Value],
    root: &Value,
    at: &str,
    depth: usize,
    exactly_one: bool,
    out: &mut Vec<Problem>,
) {
    let results: Vec<Vec<Problem>> = branches
        .iter()
        .map(|b| {
            let mut p = vec![];
            check(value, b, root, at, depth + 1, &mut p);
            p
        })
        .collect();
    let matched = results.iter().filter(|p| p.is_empty()).count();
    if matched == 0 {
        let closest = results
            .into_iter()
            .min_by_key(|p| (shape_mismatches(p, at), p.len()));
        if let Some(closest) = closest {
            let msg = format!(
                "matches none of {} allowed shapes; the closest one fails:",
                branches.len()
            );
            out.push(Problem::new(at, msg, false));
            out.extend(closest);
        }
    } else if exactly_one && matched > 1 {
        let msg = format!("matches {matched} oneOf shapes, expected exactly one");
        out.push(Problem::new(at, msg, false));
    }
}

/// Shape problems on the value itself or its direct properties: a wrong
/// `type`, or a wrong discriminator such as `{"type": {"const": "button"}}`.
fn shape_mismatches(problems: &[Problem], at: &str) -> usize {
    problems
        .iter()
        .filter(|p| p.shape)
        .filter(|p| {
            p.at == at
                || p.at
                    .strip_prefix(at)
                    .and_then(|rest| rest.strip_prefix('/'))
                    .is_some_and(|rest| !rest.contains('/'))
        })
        .count()
}

fn resolve_ref<'a>(root: &'a Value, r: &str) -> Option<&'a Value> {
    if r == "#" {
        return Some(root);
    }
    let pointer = r.strip_prefix('#')?;
    root.pointer(pointer)
}

fn type_matches(value: &Value, t: &Value) -> bool {
    match t {
        Value::String(name) => is_type(value, name),
        Value::Array(names) => names
            .iter()
            .filter_map(Value::as_str)
            .any(|n| is_type(value, n)),
        _ => true,
    }
}

fn is_type(value: &Value, name: &str) -> bool {
    match name {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        // JSON Schema counts 1.0 as an integer.
        "integer" => value.as_f64().is_some_and(|f| f.fract() == 0.0),
        _ => true,
    }
}

fn type_label(t: &Value) -> String {
    match t {
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" or "),
        other => other.to_string(),
    }
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(n) if n.is_i64() || n.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// JSON Pointer escaping for property names in error paths.
fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use xz_types::plan::plan_schema;

    #[test]
    fn primitive_types() {
        assert!(validate(&json!("x"), &json!({"type": "string"})).is_ok());
        assert!(validate(&json!(3), &json!({"type": "integer"})).is_ok());
        assert!(validate(&json!(3.0), &json!({"type": "integer"})).is_ok());
        assert!(validate(&json!(3.5), &json!({"type": "integer"})).is_err());
        assert!(validate(&json!(3.5), &json!({"type": "number"})).is_ok());
        assert!(validate(&json!(null), &json!({"type": ["string", "null"]})).is_ok());
        assert!(validate(&json!(true), &json!({"type": ["string", "null"]})).is_err());
        assert!(validate(&json!({}), &json!({})).is_ok());
        assert!(validate(&json!(1), &json!(true)).is_ok());
        assert!(validate(&json!(1), &json!(false)).is_err());
        let e = validate(&json!(1), &json!({"type": "string"})).unwrap_err();
        assert_eq!(e, ["/: expected string, got integer"]);
    }

    #[test]
    fn objects_arrays_enum_const() {
        let schema = json!({
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "tags": {"type": "array", "items": {"enum": ["a", "b"]}},
                "kind": {"const": "note"}
            },
            "required": ["name", "kind"]
        });
        assert!(
            validate(
                &json!({"name": "x", "kind": "note", "tags": ["a"], "extra": 1}),
                &schema
            )
            .is_ok()
        );
        let e = validate(&json!({"tags": ["a", "c"], "kind": "todo"}), &schema).unwrap_err();
        assert!(
            e.contains(&"/: missing required property \"name\"".to_string()),
            "{e:?}"
        );
        assert!(
            e.iter().any(|m| m.starts_with("/tags/1: expected one of")),
            "{e:?}"
        );
        assert!(e.contains(&"/kind: expected \"note\"".to_string()), "{e:?}");
    }

    #[test]
    fn any_of_and_one_of() {
        let any = json!({"anyOf": [{"type": "string"}, {"type": "integer"}]});
        assert!(validate(&json!("x"), &any).is_ok());
        assert!(validate(&json!(1), &any).is_ok());
        assert!(validate(&json!(true), &any).is_err());
        let one = json!({"oneOf": [{"type": "number"}, {"type": "integer"}]});
        assert!(validate(&json!(1.5), &one).is_ok());
        let e = validate(&json!(1), &one).unwrap_err();
        assert!(e[0].contains("exactly one"), "{e:?}");
        let e = validate(&json!(true), &any).unwrap_err();
        assert!(e[0].starts_with("/: matches none of 2"), "{e:?}");
    }

    #[test]
    fn refs_are_resolved_recursively() {
        let schema = json!({
            "$ref": "#/$defs/tree",
            "$defs": {"tree": {
                "type": "object",
                "properties": {"kids": {"type": "array", "items": {"$ref": "#/$defs/tree"}}, "v": {"type": "integer"}},
                "required": ["v"]
            }}
        });
        assert!(
            validate(
                &json!({"v": 1, "kids": [{"v": 2, "kids": [{"v": 3}]}]}),
                &schema
            )
            .is_ok()
        );
        let e = validate(&json!({"v": 1, "kids": [{"kids": []}]}), &schema).unwrap_err();
        assert_eq!(e, ["/kids/0: missing required property \"v\""]);
        let bad = json!({"$ref": "#/$defs/missing"});
        assert!(validate(&json!(1), &bad).unwrap_err()[0].contains("unresolvable"));
        let cycle = json!({"$ref": "#/$defs/a", "$defs": {"a": {"$ref": "#/$defs/a"}}});
        assert!(validate(&json!(1), &cycle).is_err());
    }

    #[test]
    fn plan_schema_accepts_good_plans_and_explains_bad_ones() {
        let schema = plan_schema(&["fs.list".into(), "fs.read".into()]);
        let good = json!({
            "thought": "list home",
            "steps": [{"tool": "fs.list", "args": {"path": "~"}, "why": "see files"}],
            "ui": {"type": "stack", "children": [
                {"type": "heading", "text": "Files"},
                {"type": "button", "label": "Open", "action": {"intent": "open it"}},
                {"type": "card", "title": "c", "children": [{"type": "text", "text": "hi"}]}
            ]},
            "say": null,
            "done": false
        });
        assert_eq!(validate(&good, &schema), Ok(()));

        let bad = json!({
            "thought": "x",
            "steps": [{"tool": "fs.nuke", "args": {}}],
            "ui": {"type": "stack", "children": [{"type": "button", "action": {"intent": "go"}}]},
            "done": "yes"
        });
        let e = validate(&bad, &schema).unwrap_err();
        let all = e.join("\n");
        assert!(all.contains("/steps/0/tool: expected one of"), "{all}");
        assert!(all.contains("/done: expected boolean, got string"), "{all}");
        assert!(
            all.contains("/ui/children/0: missing required property \"label\""),
            "{all}"
        );
    }
}
