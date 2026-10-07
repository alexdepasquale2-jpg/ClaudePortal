//! Small helpers shared by the Organs.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use xz_types::{Result, Risk, ToolSpec, XzError};

/// Builds the spec of a first-party tool.
pub(crate) fn tool(
    name: &str,
    description: &str,
    risk: Risk,
    input_schema: Value,
    resource_args: &[&str],
    tainted_output: bool,
) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: description.into(),
        input_schema,
        risk,
        resource_args: resource_args.iter().map(|s| s.to_string()).collect(),
        tainted_output,
        first_party: true,
    }
}

/// Arguments of a tool that takes none.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Empty {}

/// Parses a call's `args` into `T`, treating `null` as `{}`.
///
/// Serde's messages ("missing field `path`", "unknown field `recursve`,
/// expected one of ...") name the offending field, which is exactly what
/// a model needs to fix its call.
pub(crate) fn parse_args<T: DeserializeOwned>(tool: &str, args: Value) -> Result<T> {
    let args = if args.is_null() {
        Value::Object(Map::new())
    } else {
        args
    };
    serde_json::from_value(args).map_err(|e| XzError::InvalidArgs(format!("{tool}: {e}")))
}

/// Checks that an optional numeric argument lies in `min..=max`.
pub(crate) fn in_range(tool: &str, name: &str, v: u64, min: u64, max: u64) -> Result<u64> {
    if (min..=max).contains(&v) {
        Ok(v)
    } else {
        Err(XzError::InvalidArgs(format!(
            "{tool}: `{name}` must be between {min} and {max}, got {v}"
        )))
    }
}

/// Runs blocking work (filesystem walks, process tables, clipboard) off
/// the async runtime.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| XzError::Other(format!("worker failed: {e}")))?
}

/// Cuts `s` to at most `max` bytes on a char boundary. Returns true if cut.
pub(crate) fn truncate(s: &mut String, max: usize) -> bool {
    if s.len() <= max {
        return false;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s.truncate(end);
    true
}

/// Formats a time as RFC 3339 UTC with second precision.
pub(crate) fn rfc3339(t: SystemTime) -> String {
    let secs = match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(e) => -(e.duration().as_secs() as i64),
    };
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (H. Hinnant's
/// algorithm), so timestamps need no date-time dependency.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn formats_rfc3339() {
        assert_eq!(rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        let t = UNIX_EPOCH + Duration::from_secs(1_709_210_096);
        assert_eq!(rfc3339(t), "2024-02-29T12:34:56Z");
        let before = UNIX_EPOCH - Duration::from_secs(86_400);
        assert_eq!(rfc3339(before), "1969-12-31T00:00:00Z");
    }

    #[test]
    fn truncates_on_char_boundary() {
        let mut s = "héllo".to_string();
        assert!(truncate(&mut s, 2));
        assert_eq!(s, "h");
        let mut s = "abc".to_string();
        assert!(!truncate(&mut s, 3));
    }

    #[derive(Deserialize, Debug)]
    #[serde(deny_unknown_fields)]
    struct A {
        #[allow(dead_code)]
        path: String,
    }

    #[test]
    fn parse_errors_name_the_field() {
        let e = parse_args::<A>("fs.read", json!({})).unwrap_err();
        assert!(e.to_string().contains("missing field `path`"), "{e}");
        let e = parse_args::<A>("fs.read", json!({"path": "a", "x": 1})).unwrap_err();
        assert!(e.to_string().contains("unknown field `x`"), "{e}");
        assert!(matches!(
            parse_args::<A>("fs.read", Value::Null),
            Err(XzError::InvalidArgs(_))
        ));
        assert!(in_range("t", "limit", 0, 1, 5).is_err());
        assert_eq!(in_range("t", "limit", 5, 1, 5).unwrap(), 5);
    }
}
