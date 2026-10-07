//! The `sys` Organ: device information (SPEC Appendix D).

use async_trait::async_trait;
use serde_json::{Value, json};
use sysinfo::System;
use xz_types::Risk::Observe;
use xz_types::{CallCtx, Organ, Result, ToolOutput, ToolSpec, XzError};

use crate::util::{Empty, blocking, parse_args, tool};

const MB: u64 = 1024 * 1024;

/// Serves `sys.info`.
#[derive(Clone, Debug, Default)]
pub struct SysOrgan;

impl SysOrgan {
    /// A device-information Organ.
    pub fn new() -> Self {
        Self
    }
}

fn info() -> Result<ToolOutput> {
    let mut sys = System::new();
    sys.refresh_memory();
    let cpus = std::thread::available_parallelism().map_or(1, |n| n.get());
    Ok(ToolOutput::clean(json!({
        "os": std::env::consts::OS,
        "os_version": System::long_os_version(),
        "arch": std::env::consts::ARCH,
        "host": System::host_name(),
        "cpus": cpus,
        "ram_total_mb": sys.total_memory() / MB,
        "ram_available_mb": sys.available_memory() / MB
    })))
}

#[async_trait]
impl Organ for SysOrgan {
    fn family(&self) -> &str {
        "sys"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![tool(
            "sys.info",
            "Describe this device: {os, os_version, arch, host, cpus, ram_total_mb, \
             ram_available_mb}.",
            Observe,
            json!({"type": "object", "properties": {}, "additionalProperties": false}),
            &[],
            false,
        )]
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        if tool != "sys.info" {
            return Err(XzError::UnknownTool(tool.into()));
        }
        parse_args::<Empty>(tool, args)?;
        blocking(info).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reports_this_machine() {
        let out = SysOrgan::new()
            .call(&CallCtx::test(), "sys.info", Value::Null)
            .await
            .unwrap();
        let c = &out.content;
        assert_eq!(c["os"], std::env::consts::OS);
        assert_eq!(c["arch"], std::env::consts::ARCH);
        assert!(c["cpus"].as_u64().unwrap() >= 1);
        assert!(c["ram_total_mb"].as_u64().unwrap() > 0);
        assert!(c["ram_available_mb"].as_u64().unwrap() <= c["ram_total_mb"].as_u64().unwrap());
    }
}
