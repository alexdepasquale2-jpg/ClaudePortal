//! Export `input`: a JSON Schema object or the short form `{field: type}`.

use serde_json::{Map, Value, json};

/// Types allowed in the short form.
const SHORT_TYPES: [&str; 4] = ["string", "integer", "number", "boolean"];

/// Converts an export's `input` to a JSON Schema.
///
/// A map with `type: object` or a `properties` key is already a schema.
/// Any other map is the short form: every field becomes a required property.
/// Null (an empty `input:`) means no arguments.
pub(crate) fn to_schema(input: Value) -> Result<Value, String> {
    let map = match input {
        Value::Null => Map::new(),
        Value::Object(m) if is_schema(&m) => return Ok(Value::Object(m)),
        Value::Object(m) => m,
        other => {
            return Err(format!(
                "input must be a map, either the short form {{field: type}} or a JSON Schema \
                 with `type: object`, got {other}"
            ));
        }
    };
    let mut properties = Map::new();
    let mut required = vec![];
    for (field, ty) in map {
        match ty.as_str().filter(|t| SHORT_TYPES.contains(t)) {
            Some(t) => {
                properties.insert(field.clone(), json!({ "type": t }));
                required.push(Value::String(field));
            }
            None => {
                return Err(format!(
                    "input field `{field}` has type {ty}; the short form allows string, \
                     integer, number or boolean (write a full JSON Schema for anything else)"
                ));
            }
        }
    }
    Ok(json!({ "type": "object", "properties": properties, "required": required }))
}

fn is_schema(m: &Map<String, Value>) -> bool {
    m.get("type").and_then(Value::as_str) == Some("object") || m.contains_key("properties")
}

/// The short form of `schema`, if `to_schema` of it gives back exactly `schema`.
/// Keeps written genomes as terse as their authors wrote them.
pub(crate) fn to_short(schema: &Value) -> Option<Value> {
    let m = schema.as_object()?;
    if m.len() != 3 || m.get("type")?.as_str()? != "object" {
        return None;
    }
    let props = m.get("properties")?.as_object()?;
    let required: Vec<&str> = m
        .get("required")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    // `to_schema` lists required fields in property order; anything else would not round-trip.
    if !props.keys().map(String::as_str).eq(required) {
        return None;
    }
    let mut short = Map::new();
    for (field, p) in props {
        let p = p.as_object()?;
        let ty = p.get("type")?.as_str()?;
        if p.len() != 1 || !SHORT_TYPES.contains(&ty) {
            return None;
        }
        short.insert(field.clone(), Value::String(ty.to_string()));
    }
    Some(Value::Object(short))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_form_becomes_required_object_schema() {
        let s = to_schema(
            json!({"glasses": "integer", "note": "string", "ml": "number", "cold": "boolean"}),
        )
        .unwrap();
        assert_eq!(s["type"], "object");
        assert_eq!(s["properties"]["glasses"], json!({"type": "integer"}));
        assert_eq!(s["properties"]["note"], json!({"type": "string"}));
        assert_eq!(s["properties"]["ml"], json!({"type": "number"}));
        assert_eq!(s["properties"]["cold"], json!({"type": "boolean"}));
        let mut req: Vec<&str> = s["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        req.sort();
        assert_eq!(req, ["cold", "glasses", "ml", "note"]);
    }

    #[test]
    fn full_schema_passes_through() {
        let full =
            json!({"type": "object", "properties": {"q": {"type": "string", "maxLength": 9}}});
        assert_eq!(to_schema(full.clone()).unwrap(), full);
        let no_type = json!({"properties": {}});
        assert_eq!(to_schema(no_type.clone()).unwrap(), no_type);
    }

    #[test]
    fn empty_and_null_mean_no_args() {
        let want = json!({"type": "object", "properties": {}, "required": []});
        assert_eq!(to_schema(json!({})).unwrap(), want);
        assert_eq!(to_schema(Value::Null).unwrap(), want);
    }

    #[test]
    fn rejects_unknown_short_types_and_scalars() {
        let e = to_schema(json!({"glasses": "int"})).unwrap_err();
        assert!(e.contains("`glasses`") && e.contains("integer"), "{e}");
        let e = to_schema(json!({"tags": ["a"]})).unwrap_err();
        assert!(e.contains("`tags`"), "{e}");
        assert!(
            to_schema(json!("glasses"))
                .unwrap_err()
                .contains("must be a map")
        );
    }

    #[test]
    fn short_form_round_trips() {
        let short = json!({"a": "string", "b": "integer"});
        let schema = to_schema(short.clone()).unwrap();
        assert_eq!(to_short(&schema), Some(short));
        let empty = to_schema(json!({})).unwrap();
        assert_eq!(to_short(&empty), Some(json!({})));
    }

    #[test]
    fn rich_schemas_have_no_short_form() {
        for s in [
            json!({"type": "object", "properties": {"a": {"type": "string"}}}),
            json!({"type": "object", "properties": {"a": {"type": "string", "enum": ["x"]}}, "required": ["a"]}),
            json!({"type": "object", "properties": {"a": {"type": "array"}}, "required": ["a"]}),
            json!({"type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "string"}}, "required": ["b"]}),
        ] {
            assert_eq!(to_short(&s), None, "{s}");
        }
    }
}
