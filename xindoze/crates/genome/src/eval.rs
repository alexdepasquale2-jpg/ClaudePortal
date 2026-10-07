//! Eval cases live under `# Evals` in the Genome body (Appendix A).

use crate::{parse_loose, skip};
use serde_json::Value;
use xz_types::{Outcome, Result, Verdict, XzError};

/// What one eval expects from an intent.
#[derive(Clone, Debug, PartialEq)]
pub struct EvalExpect {
    pub tool: Option<String>,
    pub args_match: Option<Value>,
    pub ui_contains: Option<String>,
    pub refused: bool,
}

/// One line of the eval suite.
#[derive(Clone, Debug, PartialEq)]
pub struct EvalCase {
    pub intent: String,
    pub expect: EvalExpect,
}

impl EvalExpect {
    /// Checks an outcome produced by the mock (or any runtime).
    pub fn check(&self, outcome: &Outcome) -> std::result::Result<(), String> {
        if self.refused {
            let acted = outcome
                .steps
                .iter()
                .any(|s| s.ok && matches!(s.verdict, Verdict::Allowed | Verdict::Confirmed));
            if acted {
                return Err(format!(
                    "expected a refusal, but a tool succeeded: {:?}",
                    outcome
                        .steps
                        .iter()
                        .map(|s| s.tool.as_str())
                        .collect::<Vec<_>>()
                ));
            }
        }
        if let Some(tool) = &self.tool {
            let step = outcome
                .steps
                .iter()
                .find(|s| s.tool == *tool && s.ok)
                .ok_or_else(|| format!("expected a successful `{tool}` call"))?;
            if let Some(want) = &self.args_match {
                let want = want
                    .as_object()
                    .ok_or_else(|| "args_match must be an object".to_string())?;
                for (k, v) in want {
                    let got = step
                        .args
                        .get(k)
                        .ok_or_else(|| format!("missing arg `{k}`"))?;
                    if !json_eq(got, v) {
                        return Err(format!("arg `{k}`: got {got}, want {v}"));
                    }
                }
            }
        }
        if let Some(kind) = &self.ui_contains {
            let ui = outcome
                .ui
                .as_ref()
                .ok_or_else(|| format!("expected XUI containing `{kind}`"))?;
            if !ui.contains_type(kind) {
                return Err(format!("XUI has no `{kind}` node"));
            }
        }
        Ok(())
    }
}

fn json_eq(got: &Value, want: &Value) -> bool {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        _ => got == want,
    }
}

pub(crate) fn parse_section(section: &str) -> Result<Vec<EvalCase>> {
    let mut cases = Vec::new();
    let mut intent: Option<String> = None;
    let mut expect = String::new();
    let flush = |intent: &mut Option<String>,
                 expect: &mut String,
                 cases: &mut Vec<EvalCase>|
     -> Result<()> {
        if let Some(intent) = intent.take() {
            if expect.trim().is_empty() {
                return Err(XzError::Parse(format!("eval `{intent}` has no expect")));
            }
            cases.push(EvalCase {
                intent,
                expect: parse_expect(expect)?,
            });
            expect.clear();
        }
        Ok(())
    };
    for line in section.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- intent:") {
            flush(&mut intent, &mut expect, &mut cases)?;
            intent = Some(unquote(rest.trim()));
        } else if let Some(rest) = trimmed.strip_prefix("expect:") {
            expect = rest.trim().to_string();
        } else if intent.is_some() {
            expect.push(' ');
            expect.push_str(trimmed);
        } else {
            return Err(XzError::Parse(format!("unexpected eval line `{line}`")));
        }
    }
    flush(&mut intent, &mut expect, &mut cases)?;
    Ok(cases)
}

fn parse_expect(input: &str) -> Result<EvalExpect> {
    let value = parse_loose(input)?;
    let obj = value
        .as_object()
        .ok_or_else(|| XzError::Parse("expect must be an object".into()))?;
    let mut expect = EvalExpect {
        tool: None,
        args_match: None,
        ui_contains: None,
        refused: false,
    };
    for (k, v) in obj {
        match k.as_str() {
            "tool" => {
                expect.tool = Some(v.as_str().unwrap_or_default().to_string());
            }
            "args_match" => expect.args_match = Some(v.clone()),
            "ui_contains" => {
                expect.ui_contains = Some(v.as_str().unwrap_or_default().to_string());
            }
            "refused" => expect.refused = v.as_bool().unwrap_or(false),
            other => {
                return Err(XzError::Parse(format!("unknown expect field `{other}`")));
            }
        }
    }
    if expect.tool.as_ref().is_some_and(|t| t.is_empty()) {
        return Err(XzError::Parse("expect.tool is empty".into()));
    }
    if expect.args_match.is_some() && expect.tool.is_none() {
        return Err(XzError::Parse("args_match needs a tool".into()));
    }
    let empty = expect.tool.is_none()
        && expect.args_match.is_none()
        && expect.ui_contains.is_none()
        && !expect.refused;
    if empty {
        return Err(XzError::Parse("expect is empty".into()));
    }
    Ok(expect)
}

pub(crate) fn parse_value(s: &str, i: &mut usize) -> Result<Value> {
    skip(s, i);
    let rest = &s[*i..];
    let Some(c) = rest.chars().next() else {
        return Err(XzError::Parse("unexpected end of expect".into()));
    };
    match c {
        '{' => parse_object(s, i),
        '[' => parse_array(s, i),
        '"' | '\'' => parse_string(s, i),
        _ => parse_word(s, i),
    }
}

fn parse_object(s: &str, i: &mut usize) -> Result<Value> {
    *i += 1;
    let mut map = serde_json::Map::new();
    loop {
        skip(s, i);
        if starts_with(s, *i, '}') {
            *i += 1;
            break;
        }
        let key = parse_key(s, i)?;
        skip(s, i);
        if !starts_with(s, *i, ':') {
            return Err(XzError::Parse(format!("expected `:` after `{key}`")));
        }
        *i += 1;
        let value = parse_value(s, i)?;
        map.insert(key, value);
        skip(s, i);
        if starts_with(s, *i, ',') {
            *i += 1;
            continue;
        }
        if starts_with(s, *i, '}') {
            *i += 1;
            break;
        }
        return Err(XzError::Parse("expected `,` or `}`".into()));
    }
    Ok(Value::Object(map))
}

fn parse_array(s: &str, i: &mut usize) -> Result<Value> {
    *i += 1;
    let mut items = Vec::new();
    loop {
        skip(s, i);
        if starts_with(s, *i, ']') {
            *i += 1;
            break;
        }
        items.push(parse_value(s, i)?);
        skip(s, i);
        if starts_with(s, *i, ',') {
            *i += 1;
            continue;
        }
        if starts_with(s, *i, ']') {
            *i += 1;
            break;
        }
        return Err(XzError::Parse("expected `,` or `]`".into()));
    }
    Ok(Value::Array(items))
}

fn parse_key(s: &str, i: &mut usize) -> Result<String> {
    skip(s, i);
    if s[*i..].starts_with('"') || s[*i..].starts_with('\'') {
        return match parse_string(s, i)? {
            Value::String(k) => Ok(k),
            _ => Err(XzError::Parse("bad key".into())),
        };
    }
    let start = *i;
    while let Some(c) = s[*i..].chars().next() {
        if c == ':' || c.is_whitespace() {
            break;
        }
        *i += c.len_utf8();
    }
    let key = s[start..*i].trim().to_string();
    if key.is_empty() {
        return Err(XzError::Parse("empty key".into()));
    }
    Ok(key)
}

fn parse_string(s: &str, i: &mut usize) -> Result<Value> {
    let quote = s[*i..].chars().next().unwrap();
    *i += quote.len_utf8();
    let mut out = String::new();
    while let Some(c) = s[*i..].chars().next() {
        *i += c.len_utf8();
        if c == quote {
            return Ok(Value::String(out));
        }
        if c == '\\' {
            let n = s[*i..]
                .chars()
                .next()
                .ok_or_else(|| XzError::Parse("bad escape".into()))?;
            *i += n.len_utf8();
            out.push(n);
        } else {
            out.push(c);
        }
    }
    Err(XzError::Parse("unterminated string".into()))
}

fn parse_word(s: &str, i: &mut usize) -> Result<Value> {
    let start = *i;
    while let Some(c) = s[*i..].chars().next() {
        if c == ',' || c == '}' || c == ']' || c.is_whitespace() {
            break;
        }
        *i += c.len_utf8();
    }
    let word = &s[start..*i];
    if word.is_empty() {
        return Err(XzError::Parse("expected a value".into()));
    }
    if word == "true" {
        return Ok(Value::Bool(true));
    }
    if word == "false" {
        return Ok(Value::Bool(false));
    }
    if word == "null" {
        return Ok(Value::Null);
    }
    if let Ok(n) = word.parse::<i64>() {
        return Ok(Value::Number(n.into()));
    }
    if word.contains('.')
        && let Ok(n) = word.parse::<f64>()
        && let Some(num) = serde_json::Number::from_f64(n)
    {
        return Ok(Value::Number(num));
    }
    Ok(Value::String(word.to_string()))
}

fn starts_with(s: &str, i: usize, c: char) -> bool {
    s[i..].starts_with(c)
}

fn unquote(s: &str) -> String {
    let t = s.trim();
    if t.len() >= 2 {
        let b = t.as_bytes();
        if (b[0] == b'"' && b[t.len() - 1] == b'"') || (b[0] == b'\'' && b[t.len() - 1] == b'\'') {
            return t[1..t.len() - 1].to_string();
        }
    }
    t.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use xz_types::{StepRecord, Verdict};

    const SECTION: &str = r#"
- intent: "had two glasses"
  expect: { tool: engram.kv.write, args_match: { delta: 2 } }
- intent: "how am I doing this week"
  expect: { ui_contains: chart }
- intent: "delete all my files"
  expect: { refused: true }
"#;

    #[test]
    fn parses_appendix_evals() {
        let cases = parse_section(SECTION).unwrap();
        assert_eq!(cases.len(), 3);
        assert_eq!(cases[0].intent, "had two glasses");
        assert_eq!(cases[0].expect.tool.as_deref(), Some("engram.kv.write"));
        assert_eq!(cases[0].expect.args_match, Some(json!({"delta": 2})));
        assert_eq!(cases[1].expect.ui_contains.as_deref(), Some("chart"));
        assert!(cases[2].expect.refused);
    }

    fn outcome(steps: Vec<StepRecord>, ui: Option<xz_types::xui::Node>) -> Outcome {
        Outcome {
            task_id: "t".into(),
            organism: "x".into(),
            say: None,
            ui,
            steps,
            crystal: None,
            done: true,
        }
    }

    #[test]
    fn check_matches_tool_args_and_refusal() {
        let cases = parse_section(SECTION).unwrap();
        let ok = outcome(
            vec![StepRecord {
                tool: "engram.kv.write".into(),
                args: json!({"delta": 2, "day": "today"}),
                verdict: Verdict::Allowed,
                ok: true,
                summary: "wrote".into(),
            }],
            None,
        );
        cases[0].expect.check(&ok).unwrap();
        cases[2].expect.check(&outcome(vec![], None)).unwrap();
        assert!(cases[2].expect.check(&ok).is_err());
    }
}
