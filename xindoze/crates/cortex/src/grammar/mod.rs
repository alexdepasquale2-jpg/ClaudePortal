//! JSON Schema to GBNF (llama.cpp grammar), for the subset Xindoze emits:
//! `type` (string or list), `properties`, `required`, `items`, `enum`,
//! `const`, `anyOf`, `oneOf`, and `$ref` to `#/$defs/*` or `#/definitions/*`
//! (recursion allowed).
//!
//! Objects with `properties` are closed: only declared keys, in a fixed order
//! (required keys in `required` order, then optional keys by name, since
//! `serde_json` maps are sorted). Optional keys may be omitted. Every value
//! rule ends with `space`, following llama.cpp's own converter.

#[cfg(test)]
mod check;

use serde_json::{Map, Value};
use std::collections::HashMap;
use xz_types::XzError;

/// Shared rules for JSON primitives and unconstrained values.
const PRIMITIVES: &[(&str, &str)] = &[
    ("space", r#"| " " | "\n" [ \t]{0,20}"#),
    (
        "char",
        r#"[^"\\\x7F\x00-\x1F] | [\\] (["\\/bfnrt] | "u" [0-9a-fA-F]{4})"#,
    ),
    ("string", r#""\"" char* "\"" space"#),
    ("integral-part", r#"[0] | [1-9] [0-9]{0,15}"#),
    ("decimal-part", r#"[0-9]{1,16}"#),
    (
        "number",
        r#"("-"? integral-part) ("." decimal-part)? ([eE] [-+]? integral-part)? space"#,
    ),
    ("integer", r#"("-"? integral-part) space"#),
    ("boolean", r#"("true" | "false") space"#),
    ("null", r#""null" space"#),
    (
        "value",
        r#"object | array | string | number | boolean | null"#,
    ),
    (
        "object",
        r#""{" space ( string ":" space value ( "," space string ":" space value )* )? "}" space"#,
    ),
    (
        "array",
        r#""[" space ( value ( "," space value )* )? "]" space"#,
    ),
];

/// Converts a JSON Schema into a GBNF grammar whose start rule is `root`.
pub fn json_schema_to_gbnf(schema: &Value) -> Result<String, XzError> {
    let mut b = Builder {
        root: schema,
        rules: vec![],
        names: HashMap::new(),
        refs: HashMap::new(),
    };
    let expr = b.visit(schema, "root")?;
    if expr != "root" {
        // The top-level schema made no rule of its own (a primitive or a `$ref`).
        let name = b.reserve("root");
        b.set(&name, expr);
    }
    b.add_primitives();
    // Root first for readability; llama.cpp itself does not care about order.
    b.rules.sort_by_key(|(name, _)| name != "root");
    let mut out = String::new();
    for (name, body) in &b.rules {
        out.push_str(name);
        out.push_str(" ::= ");
        out.push_str(body);
        out.push('\n');
    }
    Ok(out)
}

struct Builder<'a> {
    root: &'a Value,
    /// Rules in definition order (root first).
    rules: Vec<(String, String)>,
    /// Rule name -> index into `rules`.
    names: HashMap<String, usize>,
    /// `$ref` target -> rule name, so recursive refs reuse one rule.
    refs: HashMap<String, String>,
}

impl<'a> Builder<'a> {
    /// Returns a GBNF expression matching `schema`. `hint` names any rules created.
    fn visit(&mut self, schema: &'a Value, hint: &str) -> Result<String, XzError> {
        let s = match schema {
            Value::Bool(true) => return Ok("value".into()),
            Value::Bool(false) => return Err(unsupported("a `false` schema matches nothing")),
            Value::Object(s) => s,
            other => {
                return Err(unsupported(&format!(
                    "schema must be an object, got {other}"
                )));
            }
        };
        if let Some(r) = s.get("$ref") {
            let r = r
                .as_str()
                .ok_or_else(|| unsupported("$ref must be a string"))?;
            return self.visit_ref(r);
        }
        if let Some(c) = s.get("const") {
            return Ok(json_literal(c));
        }
        if let Some(e) = s.get("enum") {
            let options = e
                .as_array()
                .ok_or_else(|| unsupported("enum must be an array"))?;
            if options.is_empty() {
                return Err(unsupported("empty enum matches nothing"));
            }
            let alts: Vec<String> = options.iter().map(json_literal).collect();
            return Ok(format!("({})", alts.join(" | ")));
        }
        for key in ["anyOf", "oneOf"] {
            if let Some(branches) = s.get(key) {
                let branches = branches
                    .as_array()
                    .filter(|b| !b.is_empty())
                    .ok_or_else(|| unsupported(&format!("{key} must be a non-empty array")))?;
                let name = self.reserve(hint);
                let mut alts = vec![];
                for (i, b) in branches.iter().enumerate() {
                    alts.push(self.visit(b, &format!("{name}-{}", i + 1))?);
                }
                self.set(&name, alts.join(" | "));
                return Ok(name);
            }
        }
        match s.get("type") {
            Some(Value::String(t)) => self.visit_type(t, s, hint),
            Some(Value::Array(types)) => {
                let mut alts = vec![];
                for t in types {
                    let t = t
                        .as_str()
                        .ok_or_else(|| unsupported("type list must hold strings"))?;
                    alts.push(self.visit_type(t, s, &format!("{hint}-{t}"))?);
                }
                if alts.is_empty() {
                    return Err(unsupported("empty type list matches nothing"));
                }
                Ok(format!("({})", alts.join(" | ")))
            }
            Some(other) => Err(unsupported(&format!("bad type {other}"))),
            None if s.contains_key("properties") => self.visit_type("object", s, hint),
            None if s.contains_key("items") => self.visit_type("array", s, hint),
            None => Ok("value".into()),
        }
    }

    fn visit_type(
        &mut self,
        t: &str,
        s: &'a Map<String, Value>,
        hint: &str,
    ) -> Result<String, XzError> {
        match t {
            "string" | "number" | "integer" | "boolean" | "null" => Ok(t.into()),
            "object" => match s.get("properties") {
                Some(Value::Object(props)) => self.visit_object(props, s.get("required"), hint),
                _ => Ok("object".into()),
            },
            "array" => match s.get("items") {
                Some(items) => {
                    let name = self.reserve(hint);
                    let item = self.visit(items, &format!("{name}-item"))?;
                    self.set(
                        &name,
                        format!(r#""[" space ( {item} ( "," space {item} )* )? "]" space"#),
                    );
                    Ok(name)
                }
                None => Ok("array".into()),
            },
            other => Err(unsupported(&format!("unknown type {other}"))),
        }
    }

    fn visit_object(
        &mut self,
        props: &'a Map<String, Value>,
        required: Option<&'a Value>,
        hint: &str,
    ) -> Result<String, XzError> {
        let name = self.reserve(hint);
        let required: Vec<&str> = required
            .and_then(Value::as_array)
            .map(|r| r.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();

        let kv = |key: &str, this: &mut Self| -> Result<String, XzError> {
            let value = match props.get(key) {
                Some(sub) => this.visit(sub, &format!("{name}-{}", sanitize(key)))?,
                None => "value".into(),
            };
            Ok(format!(
                r#"{} ":" space {value}"#,
                json_literal(&Value::from(key))
            ))
        };

        let mut req = vec![];
        for key in &required {
            req.push(kv(key, self)?);
        }
        let mut opt = vec![];
        for key in props.keys().filter(|k| !required.contains(&k.as_str())) {
            opt.push(kv(key, self)?);
        }

        let body = if !req.is_empty() {
            let mut parts = vec![req.join(r#" "," space "#)];
            parts.extend(opt.iter().map(|o| format!(r#"( "," space {o} )?"#)));
            parts.join(" ")
        } else if !opt.is_empty() {
            // Any non-empty in-order subset: pick the first present key, then
            // each later key is optional.
            let alts: Vec<String> = (0..opt.len())
                .map(|i| {
                    let mut seq = vec![opt[i].clone()];
                    seq.extend(
                        opt[i + 1..]
                            .iter()
                            .map(|o| format!(r#"( "," space {o} )?"#)),
                    );
                    seq.join(" ")
                })
                .collect();
            format!("( {} )?", alts.join(" | "))
        } else {
            String::new()
        };
        self.set(&name, format!(r#""{{" space {body} "}}" space"#));
        Ok(name)
    }

    fn visit_ref(&mut self, r: &str) -> Result<String, XzError> {
        if let Some(name) = self.refs.get(r) {
            return Ok(name.clone());
        }
        let def = r
            .strip_prefix("#/$defs/")
            .or_else(|| r.strip_prefix("#/definitions/"))
            .ok_or_else(|| unsupported(&format!("only #/$defs/* refs are supported, got {r}")))?;
        let target = r
            .strip_prefix('#')
            .and_then(|p| self.root.pointer(p))
            .ok_or_else(|| unsupported(&format!("unresolvable $ref {r}")))?;
        let name = self.reserve(&format!("def-{def}"));
        // Register before visiting so recursive refs resolve to this rule.
        self.refs.insert(r.to_string(), name.clone());
        let body = self.visit(target, &name)?;
        self.set(&name, body);
        Ok(name)
    }

    /// Claims a unique rule name derived from `hint`.
    fn reserve(&mut self, hint: &str) -> String {
        let base = sanitize(hint);
        let mut name = base.clone();
        let mut n = 2;
        while self.names.contains_key(&name) || is_primitive(&name) {
            name = format!("{base}{n}");
            n += 1;
        }
        self.names.insert(name.clone(), self.rules.len());
        self.rules.push((name.clone(), String::new()));
        name
    }

    fn set(&mut self, name: &str, body: String) {
        if let Some(&i) = self.names.get(name) {
            self.rules[i].1 = body;
        }
    }

    fn add_primitives(&mut self) {
        for (name, body) in PRIMITIVES {
            self.rules.push(((*name).into(), (*body).into()));
        }
    }
}

fn is_primitive(name: &str) -> bool {
    PRIMITIVES.iter().any(|(n, _)| *n == name)
}

fn unsupported(why: &str) -> XzError {
    XzError::InvalidArgs(format!("json schema to grammar: {why}"))
}

/// Rule names allow only `[a-zA-Z0-9-]`.
fn sanitize(hint: &str) -> String {
    let s: String = hint
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-');
    if s.is_empty() { "r".into() } else { s.into() }
}

/// A GBNF literal matching exactly the compact JSON text of `v`.
fn json_literal(v: &Value) -> String {
    format!("{} space", gbnf_string(&v.to_string()))
}

fn gbnf_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\x7f' => out.push_str(&format!("\\x{:02X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::check::Grammar;
    use super::*;
    use serde_json::json;
    use xz_types::plan::plan_schema;

    fn grammar(schema: Value) -> Grammar {
        let text = json_schema_to_gbnf(&schema).unwrap();
        Grammar::parse(&text).unwrap_or_else(|e| panic!("{e}\n{text}"))
    }

    #[test]
    fn primitives() {
        let g = grammar(json!({"type": "string"}));
        assert!(g.accepts(r#""hi \"there\" é""#));
        assert!(!g.accepts(r#""unterminated"#));
        assert!(!g.accepts("\"raw\nnewline\""));
        let g = grammar(json!({"type": "integer"}));
        assert!(g.accepts("-42") && g.accepts("0"));
        assert!(!g.accepts("01") && !g.accepts("1.5"));
        let g = grammar(json!({"type": "number"}));
        assert!(g.accepts("1.5e-3") && g.accepts("-0.25") && g.accepts("7"));
        let g = grammar(json!({"type": ["boolean", "null"]}));
        assert!(g.accepts("true") && g.accepts("null"));
        assert!(!g.accepts("\"true\""));
        let g = grammar(json!({}));
        assert!(g.accepts(r#"{"any": [1, {"x": null}], "y": "z"}"#));
    }

    #[test]
    fn enum_and_const() {
        let g = grammar(json!({"enum": ["a\"b", 3, null]}));
        assert!(g.accepts(r#""a\"b""#) && g.accepts("3") && g.accepts("null"));
        assert!(!g.accepts(r#""a""#));
        let g = grammar(json!({"const": {"k": [1, 2]}}));
        assert!(g.accepts(r#"{"k":[1,2]}"#));
        assert!(!g.accepts(r#"{"k":[1]}"#));
    }

    #[test]
    fn objects_respect_required_and_optional() {
        let g = grammar(json!({
            "type": "object",
            "properties": {"a": {"type": "integer"}, "b": {"type": "string"}, "c": {"type": "boolean"}},
            "required": ["c"]
        }));
        assert!(g.accepts(r#"{"c": true}"#));
        assert!(g.accepts(r#"{"c": true, "a": 1, "b": "x"}"#));
        assert!(g.accepts("{\n  \"c\": false,\n  \"b\": \"x\"\n}"));
        assert!(!g.accepts(r#"{"a": 1}"#), "missing required c");
        assert!(!g.accepts(r#"{"c": true, "d": 1}"#), "undeclared key");
        assert!(!g.accepts(r#"{"c": true,}"#), "trailing comma");

        let g =
            grammar(json!({"properties": {"x": {"type": "integer"}, "y": {"type": "integer"}}}));
        for ok in ["{}", r#"{"x": 1}"#, r#"{"y": 2}"#, r#"{"x": 1, "y": 2}"#] {
            assert!(g.accepts(ok), "{ok}");
        }
        assert!(!g.accepts(r#"{, "y": 2}"#));
        assert!(!g.accepts(r#"{"y": 2, "x": 1}"#), "fixed key order");
    }

    #[test]
    fn arrays_any_of_and_type_lists() {
        let g = grammar(
            json!({"type": "array", "items": {"anyOf": [{"type": "integer"}, {"type": "string"}]}}),
        );
        assert!(g.accepts("[]") && g.accepts(r#"[1, "two", 3]"#));
        assert!(!g.accepts("[true]") && !g.accepts("[1,]"));
        let g = grammar(json!({"oneOf": [{"type": "null"}, {"type": "array"}]}));
        assert!(g.accepts("null") && g.accepts("[1, [2]]"));
    }

    #[test]
    fn recursive_refs() {
        let schema = json!({
            "$ref": "#/$defs/tree",
            "$defs": {"tree": {
                "type": "object",
                "properties": {"v": {"type": "integer"}, "kids": {"type": "array", "items": {"$ref": "#/$defs/tree"}}},
                "required": ["v"]
            }}
        });
        let g = grammar(schema);
        assert!(g.accepts(r#"{"v": 1, "kids": [{"v": 2, "kids": [{"v": 3}]}, {"v": 4}]}"#));
        assert!(!g.accepts(r#"{"v": 1, "kids": [{"kids": []}]}"#));
    }

    #[test]
    fn plan_schema_grammar() {
        let schema = plan_schema(&["fs.list".into(), "notify.show".into()]);
        let text = json_schema_to_gbnf(&schema).unwrap();
        let g = Grammar::parse(&text).unwrap();
        // Required keys come first in `required` order, then optional keys by name.
        let plan = r#"{"thought": "list", "steps": [{"tool": "fs.list", "args": {"path": "~"}, "why": "look"}], "done": false, "say": null, "ui": {"type": "stack", "children": [{"type": "heading", "text": "Files"}, {"type": "button", "label": "Go", "action": {"intent": "go"}}, {"type": "card", "title": "t", "children": [{"type": "text", "text": "x"}]}]}}"#;
        assert!(g.accepts(plan), "{text}");
        assert!(g.accepts(r#"{"thought": "", "steps": [], "done": true, "say": "Done."}"#));
        assert!(!g.accepts(
            r#"{"thought": "", "steps": [{"tool": "fs.nuke", "args": {}}], "done": true}"#
        ));
        assert!(
            !g.accepts(r#"{"thought": "", "steps": [], "done": true, "ui": {"type": "html"}}"#)
        );
        assert!(!g.accepts(
            r#"{"thought": "", "steps": [], "done": true, "ui": {"type": "button", "label": "x"}}"#
        ));
        // Every rule referenced is defined exactly once.
        let mut names: Vec<&str> = text
            .lines()
            .map(|l| l.split(" ::= ").next().unwrap())
            .collect();
        let total = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), total);
    }

    #[test]
    fn rejects_unsupported_schemas() {
        assert!(json_schema_to_gbnf(&json!(false)).is_err());
        assert!(json_schema_to_gbnf(&json!({"$ref": "https://x/y.json"})).is_err());
        assert!(json_schema_to_gbnf(&json!({"$ref": "#/$defs/missing"})).is_err());
        assert!(json_schema_to_gbnf(&json!({"enum": []})).is_err());
        assert!(json_schema_to_gbnf(&json!({"type": "date"})).is_err());
    }

    #[test]
    fn names_and_literals() {
        assert_eq!(sanitize("steps_item.tool"), "steps-item-tool");
        assert_eq!(sanitize("__"), "r");
        assert_eq!(gbnf_string("a\"\\\n\u{1}"), r#""a\"\\\n\x01""#);
    }
}
