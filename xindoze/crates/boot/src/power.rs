//! `power` on the native host.
//!
//! Status is observe-only. Sleep and shutdown are not offered unless a caller
//! injects an actuator, and the actuator that ships refuses. Nothing in this
//! file calls `shutdown`, `reboot`, or `systemctl`.

use async_trait::async_trait;
use serde_json::{Value, json};
#[cfg(test)]
use std::sync::Mutex;
use xz_types::{CallCtx, Organ, Result, Risk, ToolOutput, ToolSpec, XzError};

/// A power change. There is no variant that means "do this on the real machine".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PowerAction {
    Sleep,
    Shutdown,
}

/// Performs a power change. The default implementation never succeeds.
pub trait PowerActuator: Send + Sync {
    fn exposes_changes(&self) -> bool;
    fn perform(&self, action: PowerAction) -> Result<(), XzError>;
}

/// Ships in `NativeHost`. Power changes stay unavailable.
#[derive(Clone, Copy, Debug, Default)]
pub struct RefusePower;

impl PowerActuator for RefusePower {
    fn exposes_changes(&self) -> bool {
        false
    }

    fn perform(&self, _action: PowerAction) -> Result<(), XzError> {
        Err(XzError::Denied(
            "power changes stay off until an actuator is approved".into(),
        ))
    }
}

/// Records a power request in tests. Not used by the running host.
#[cfg(test)]
#[derive(Debug, Default)]
struct RecordingActuator {
    log: Mutex<Vec<PowerAction>>,
}

#[cfg(test)]
impl PowerActuator for RecordingActuator {
    fn exposes_changes(&self) -> bool {
        true
    }

    fn perform(&self, action: PowerAction) -> Result<(), XzError> {
        self.log.lock().expect("power log").push(action);
        Ok(())
    }
}

/// Reads `/sys/class/power_supply` on Linux. Other hosts get an empty list.
#[derive(Clone, Copy, Debug, Default)]
pub struct HostPower;

pub trait PowerProbe: Send + Sync {
    fn status(&self) -> Value;
}

impl PowerProbe for HostPower {
    fn status(&self) -> Value {
        host_power()
    }
}

#[cfg(target_os = "linux")]
fn read_line(path: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn host_power() -> Value {
    #[cfg(target_os = "linux")]
    {
        let root = std::path::Path::new("/sys/class/power_supply");
        let mut supplies = Vec::new();
        if let Ok(entries) = std::fs::read_dir(root) {
            let mut entries: Vec<_> = entries.flatten().collect();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let path = entry.path();
                supplies.push(json!({
                    "name": entry.file_name().to_string_lossy(),
                    "type": read_line(&path.join("type")),
                    "online": read_line(&path.join("online")),
                    "capacity_pct": read_line(&path.join("capacity")),
                    "status": read_line(&path.join("status")),
                }));
            }
        }
        return json!({ "supplies": supplies });
    }
    #[cfg(not(target_os = "linux"))]
    {
        json!({ "supplies": [] })
    }
}

pub struct PowerOrgan<A, P> {
    actuator: A,
    probe: P,
}

impl<A, P> PowerOrgan<A, P> {
    pub fn new(actuator: A, probe: P) -> Self {
        Self { actuator, probe }
    }
}

impl Default for PowerOrgan<RefusePower, HostPower> {
    fn default() -> Self {
        Self::new(RefusePower, HostPower)
    }
}

fn spec(name: &str, description: &str, risk: Risk) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: description.into(),
        input_schema: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
        risk,
        resource_args: vec![],
        tainted_output: false,
        first_party: true,
    }
}

fn expect_empty(tool: &str, args: &Value) -> Result<()> {
    match args {
        Value::Null => Ok(()),
        Value::Object(map) if map.is_empty() => Ok(()),
        _ => Err(XzError::InvalidArgs(format!("{tool}: takes no arguments"))),
    }
}

#[async_trait]
impl<A, P> Organ for PowerOrgan<A, P>
where
    A: PowerActuator + Send + Sync,
    P: PowerProbe + Send + Sync,
{
    fn family(&self) -> &str {
        "power"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        let mut tools = vec![spec(
            "power.status",
            "Report power source. Changes are not offered by the default actuator.",
            Risk::Observe,
        )];
        if self.actuator.exposes_changes() {
            tools.push(spec(
                "power.sleep",
                "Request sleep through an injected actuator. The default host refuses.",
                Risk::Commit,
            ));
            tools.push(spec(
                "power.shutdown",
                "Request shutdown through an injected actuator. The default host refuses.",
                Risk::Commit,
            ));
        }
        tools
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        expect_empty(tool, &args)?;
        match tool {
            "power.status" => Ok(ToolOutput::clean(self.probe.status())),
            "power.sleep" | "power.shutdown" if !self.actuator.exposes_changes() => {
                Err(XzError::UnknownTool(tool.into()))
            }
            "power.sleep" => {
                self.actuator.perform(PowerAction::Sleep)?;
                Ok(ToolOutput::clean(json!({"requested": "sleep"})))
            }
            "power.shutdown" => {
                self.actuator.perform(PowerAction::Shutdown)?;
                Ok(ToolOutput::clean(json!({"requested": "shutdown"})))
            }
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn default_organ_reports_status_and_hides_changes() {
        let organ = PowerOrgan::default();
        let names: Vec<_> = organ.tools().into_iter().map(|tool| tool.name).collect();
        assert_eq!(names, ["power.status"]);
        let out = organ
            .call(&CallCtx::test(), "power.status", Value::Null)
            .await
            .unwrap();
        assert!(out.content.get("supplies").is_some());
        let err = organ
            .call(&CallCtx::test(), "power.shutdown", Value::Null)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("unknown tool"));
    }

    #[tokio::test]
    async fn recording_actuator_does_not_need_the_kernel() {
        let organ = PowerOrgan::new(RecordingActuator::default(), HostPower);
        organ
            .call(
                &CallCtx::test(),
                "power.sleep",
                Value::Object(Default::default()),
            )
            .await
            .unwrap();
        assert_eq!(
            organ.actuator.log.lock().unwrap().as_slice(),
            &[PowerAction::Sleep]
        );
    }

    #[test]
    fn refuse_power_denies() {
        assert!(RefusePower.perform(PowerAction::Shutdown).is_err());
        assert!(!RefusePower.exposes_changes());
    }
}
