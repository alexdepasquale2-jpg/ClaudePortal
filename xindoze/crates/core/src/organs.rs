//! In-process tools the Bridge does not own: `xz.*`, `engram.*`,
//! `notify.schedule`, and host stubs for Hive and media (SPEC Appendix D).
//!
//! Hive pairing and device sensors land in later phases. The stubs still
//! accept the call so a plan can name the tool and the Warden can refuse it.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};
use xz_engram::{Engram, Fact, RewindSelector};
use xz_types::{CallCtx, Effect, Organ, Result, Risk, ToolOutput, ToolSpec, XzError};
use xz_warden::{Warden, parse_rule};

/// `xz.*` and `engram.*`, backed by the Engram and the Charter file.
pub struct Desk {
    engram: Arc<Engram>,
    warden: Arc<Warden>,
    charter_path: PathBuf,
    genomes_dir: PathBuf,
}

impl Desk {
    /// `charter_path` is `charter.toml`. Installed genomes are written under
    /// `genomes_dir`.
    pub fn new(
        engram: Arc<Engram>,
        warden: Arc<Warden>,
        charter_path: PathBuf,
        genomes_dir: PathBuf,
    ) -> Self {
        Self {
            engram,
            warden,
            charter_path,
            genomes_dir,
        }
    }
}

#[async_trait]
impl Organ for Desk {
    fn family(&self) -> &str {
        "xz"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![
            spec("xz.journal", "Recent journal entries.", Risk::Observe, &[]),
            spec(
                "xz.pulse",
                "Whether anything is leaving this device.",
                Risk::Observe,
                &[],
            ),
            spec("xz.genomes", "Installed Organisms.", Risk::Observe, &[]),
            spec("xz.rewind", "Undo journaled actions.", Risk::Act, &[]),
            spec(
                "xz.charter_add_rule",
                "Add one Charter rule after the user confirms.",
                Risk::Commit,
                &[],
            ),
            spec(
                "xz.install_genome",
                "Install a Genome the user confirmed.",
                Risk::Act,
                &[],
            ),
            spec(
                "engram.kv_read",
                "Read one key in this Organism's state.",
                Risk::Observe,
                &[],
            ),
            spec(
                "engram.kv_write",
                "Write one key in this Organism's state.",
                Risk::Act,
                &[],
            ),
            spec(
                "engram.kv_list",
                "List keys in this Organism's state.",
                Risk::Observe,
                &[],
            ),
            spec("engram.remember", "Remember one fact.", Risk::Act, &[]),
            spec(
                "engram.search",
                "Search facts and episodes.",
                Risk::Observe,
                &[],
            ),
            spec(
                "engram.forget",
                "Delete memories matching a query.",
                Risk::Commit,
                &[],
            ),
        ]
    }

    async fn call(&self, ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        match tool {
            "xz.journal" => self.journal(args),
            "xz.pulse" => Ok(ToolOutput::clean(json!({
                "egress": [],
                "note": "this process has no network listeners"
            }))),
            "xz.genomes" => self.genomes(),
            "xz.rewind" => self.rewind(args),
            "xz.charter_add_rule" => self.add_rule(args),
            "xz.install_genome" => self.install(args),
            "engram.kv_read" => self.kv_read(ctx, args),
            "engram.kv_write" => self.kv_write(ctx, args),
            "engram.kv_list" => self.kv_list(ctx, args),
            "engram.remember" => self.remember(ctx, args),
            "engram.search" => self.search(args),
            "engram.forget" => self.forget(args),
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

impl Desk {
    fn journal(&self, args: Value) -> Result<ToolOutput> {
        let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize;
        let events = self.engram.events(&xz_engram::EventQuery {
            limit,
            include_rewound: true,
            ..xz_engram::EventQuery::default()
        })?;
        let rows: Vec<Value> = events
            .iter()
            .map(|ev| {
                json!({
                    "seq": ev.seq,
                    "task_id": ev.task_id,
                    "organism": ev.organism,
                    "tool": ev.tool,
                    "summary": ev.summary,
                    "rewound": ev.rewound,
                })
            })
            .collect();
        Ok(ToolOutput::clean(json!({"entries": rows})))
    }

    fn rewind(&self, args: Value) -> Result<ToolOutput> {
        let sel = if let Some(minutes) = args.get("minutes").and_then(Value::as_i64) {
            let delta = minutes.saturating_mul(60_000);
            RewindSelector::Since(xz_types::now_ms().saturating_sub(delta))
        } else if let Some(task) = args.get("task_id").and_then(Value::as_str) {
            RewindSelector::Task(task.to_string())
        } else {
            return Err(XzError::InvalidArgs(
                "xz.rewind needs `minutes` or `task_id`".into(),
            ));
        };
        let report = self.engram.rewind(&sel)?;
        Ok(ToolOutput::clean(json!({
            "events": report.events,
            "undone": report.undone.len(),
            "failed": report.failed.len(),
        })))
    }

    fn add_rule(&self, args: Value) -> Result<ToolOutput> {
        let rule = args
            .get("rule")
            .cloned()
            .ok_or_else(|| XzError::InvalidArgs("xz.charter_add_rule needs `rule`".into()))?;
        let rule = parse_rule(rule)?;
        let mut charter = xz_warden::Charter::load(&self.charter_path)?;
        let id = charter.add_rule(rule)?;
        if let Some(parent) = self.charter_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        charter.save(&self.charter_path)?;
        self.warden.set_charter(charter)?;
        Ok(ToolOutput::clean(json!({"id": id, "saved": true})))
    }

    fn install(&self, args: Value) -> Result<ToolOutput> {
        let markdown = args
            .get("markdown")
            .and_then(Value::as_str)
            .ok_or_else(|| XzError::InvalidArgs("xz.install_genome needs `markdown`".into()))?;
        let genome = xz_genome::Genome::parse(markdown)?;
        std::fs::create_dir_all(&self.genomes_dir)?;
        let path = self
            .genomes_dir
            .join(format!("{}.genome.md", genome.short_name()));
        let created = !path.exists();
        std::fs::write(&path, markdown)?;
        let mut out = ToolOutput::clean(json!({"id": genome.id, "path": path}));
        if created {
            out.effects.push(Effect::FileCreated { path });
        }
        Ok(out)
    }

    fn genomes(&self) -> Result<ToolOutput> {
        let loaded = xz_genome::load_dir(&self.genomes_dir);
        let ids: Vec<String> = loaded
            .iter()
            .filter_map(|(_, g)| g.as_ref().ok().map(|g| g.id.clone()))
            .collect();
        Ok(ToolOutput::clean(json!({"genomes": ids})))
    }

    fn kv_read(&self, ctx: &CallCtx, args: Value) -> Result<ToolOutput> {
        let key = require_str(&args, "key", "engram.kv_read")?;
        let value = self.engram.kv_get(&ctx.organism, key)?;
        Ok(ToolOutput::clean(json!({"key": key, "value": value})))
    }

    fn kv_write(&self, ctx: &CallCtx, args: Value) -> Result<ToolOutput> {
        let key = require_str(&args, "key", "engram.kv_write")?.to_string();
        let value = args.get("value").cloned().unwrap_or(Value::Null);
        let pre = self.engram.kv_set(&ctx.organism, &key, &value)?;
        Ok(
            ToolOutput::clean(json!({"key": key, "value": value})).with_effect(Effect::KvSet {
                ns: ctx.organism.clone(),
                key,
                pre,
            }),
        )
    }

    fn kv_list(&self, ctx: &CallCtx, args: Value) -> Result<ToolOutput> {
        let prefix = args.get("prefix").and_then(Value::as_str).unwrap_or("");
        let rows = self.engram.kv_list(&ctx.organism, prefix)?;
        let entries: Vec<Value> = rows
            .into_iter()
            .map(|(k, v)| json!({"key": k, "value": v}))
            .collect();
        Ok(ToolOutput::clean(json!({"entries": entries})))
    }

    fn remember(&self, ctx: &CallCtx, args: Value) -> Result<ToolOutput> {
        let fact = Fact {
            subject: require_str(&args, "subject", "engram.remember")?.to_string(),
            predicate: require_str(&args, "predicate", "engram.remember")?.to_string(),
            object: require_str(&args, "object", "engram.remember")?.to_string(),
            confidence: args
                .get("confidence")
                .and_then(Value::as_f64)
                .unwrap_or(1.0),
            source: ctx.organism.clone(),
        };
        let id = self.engram.remember(&fact)?;
        Ok(ToolOutput::clean(json!({"id": id})))
    }

    fn search(&self, args: Value) -> Result<ToolOutput> {
        let query = require_str(&args, "query", "engram.search")?.to_lowercase();
        let facts = self.engram.facts(None, 50)?;
        let hits: Vec<Value> = facts
            .into_iter()
            .filter(|r| {
                let f = &r.fact;
                format!("{} {} {}", f.subject, f.predicate, f.object)
                    .to_lowercase()
                    .contains(&query)
            })
            .map(|r| json!({"subject": r.fact.subject, "predicate": r.fact.predicate, "object": r.fact.object}))
            .collect();
        Ok(ToolOutput::clean(json!({"facts": hits})))
    }

    fn forget(&self, args: Value) -> Result<ToolOutput> {
        let query = require_str(&args, "query", "engram.forget")?;
        let report = self.engram.forget(query)?;
        Ok(ToolOutput::clean(json!({"removed": report.total()})))
    }
}

/// Records reminder requests. Showing them is the shell's job.
pub struct Scheduler {
    engram: Arc<Engram>,
}

impl Scheduler {
    /// Stores schedules in the Engram under the `notify` namespace.
    pub fn new(engram: Arc<Engram>) -> Self {
        Self { engram }
    }
}

#[async_trait]
impl Organ for Scheduler {
    fn family(&self) -> &str {
        "notify"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![spec(
            "notify.schedule",
            "Schedule a reminder. The shell delivers it.",
            Risk::Act,
            &[],
        )]
    }

    async fn call(&self, ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        if tool != "notify.schedule" {
            return Err(XzError::UnknownTool(tool.into()));
        }
        let title = args
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Reminder");
        let key = format!("schedule/{}", xz_types::now_ms());
        let pre = self.engram.kv_set("notify", &key, &args)?;
        let _ = ctx;
        let _ = title;
        Ok(
            ToolOutput::clean(json!({"scheduled": true, "key": key})).with_effect(Effect::KvSet {
                ns: "notify".into(),
                key,
                pre,
            }),
        )
    }
}

/// This device's Hive view. Pairing state lives in `xz-hive`. With no peers
/// paired, `hive.run_on` reports that the work ran here.
pub struct HiveOrgan {
    device: Mutex<xz_hive::Device>,
}

impl HiveOrgan {
    /// `device_id` is the session id. A 64-digit hex string is used as the
    /// Hive id. Anything else is folded into 32 bytes so the same session
    /// id always names the same device.
    pub fn new(device_id: &str) -> Self {
        let name = {
            let trimmed = device_id.trim();
            if trimmed.is_empty() {
                "This device".to_string()
            } else {
                trimmed.to_string()
            }
        };
        let identity = xz_hive::Identity::new(name, device_bytes(device_id))
            .expect("device name is non-empty");
        Self {
            device: Mutex::new(xz_hive::Device::new(identity)),
        }
    }
}

fn device_bytes(device_id: &str) -> xz_hive::DeviceId {
    if let Ok(parsed) = xz_hive::DeviceId::from_hex(device_id) {
        return parsed;
    }
    let mut bytes = [0u8; xz_hive::DEVICE_ID_LEN];
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for (i, byte) in device_id.bytes().enumerate() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        bytes[i % xz_hive::DEVICE_ID_LEN] ^= byte.wrapping_add((hash & 0xff) as u8);
    }
    if bytes.iter().all(|b| *b == 0) {
        bytes[0] = 1;
    }
    xz_hive::DeviceId::from_bytes(bytes)
}

#[async_trait]
impl Organ for HiveOrgan {
    fn family(&self) -> &str {
        "hive"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![
            spec("hive.peers", "Paired devices.", Risk::Observe, &[]),
            spec(
                "hive.send",
                "Send an item to a paired device.",
                Risk::Act,
                &[],
            ),
            spec(
                "hive.run_on",
                "Run an intent on a paired device.",
                Risk::Act,
                &[],
            ),
            spec(
                "hive.pair_begin",
                "Show a pairing code from a shared seed.",
                Risk::Act,
                &[],
            ),
            spec(
                "hive.pair_confirm",
                "Pair the device that presents this code.",
                Risk::Act,
                &[],
            ),
        ]
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput> {
        let mut device = self.device.lock().unwrap_or_else(|err| err.into_inner());
        match tool {
            "hive.peers" => {
                let peers: Vec<_> = device
                    .peers()
                    .iter()
                    .map(|peer| {
                        json!({
                            "id": peer.id().to_hex(),
                            "name": peer.identity.name(),
                            "presence": match peer.presence {
                                xz_hive::Presence::Online => "online",
                                xz_hive::Presence::Offline => "offline",
                            },
                            "stronger": peer.stronger,
                        })
                    })
                    .collect();
                Ok(ToolOutput::clean(json!({"peers": peers})))
            }
            "hive.run_on" => {
                let question = args.get("intent").and_then(Value::as_str).unwrap_or("");
                match device.route(question) {
                    xz_hive::Route::RanOn { peer, notice } => Ok(ToolOutput::clean(json!({
                        "delivered": true,
                        "ran": "peer",
                        "peer": peer.identity.name(),
                        "notice": notice,
                    }))),
                    xz_hive::Route::RanLocal { notice } => Ok(ToolOutput::clean(json!({
                        "delivered": false,
                        "ran": "local",
                        "notice": notice,
                    }))),
                }
            }
            "hive.send" => {
                let wanted = args.get("device").and_then(Value::as_str).unwrap_or("");
                let paired = device.peers().iter().any(|peer| {
                    peer.presence == xz_hive::Presence::Online
                        && peer.identity.name().eq_ignore_ascii_case(wanted)
                });
                if paired {
                    Ok(ToolOutput::clean(json!({
                        "delivered": false,
                        "reason": "paired, but this build has no socket yet",
                        "device": wanted,
                    })))
                } else {
                    Ok(ToolOutput::clean(json!({
                        "delivered": false,
                        "reason": "no device is paired",
                        "args": args,
                    })))
                }
            }
            "hive.pair_begin" => {
                let seed = require_str(&args, "seed", tool)?;
                let code = device.begin_pairing(seed.as_bytes());
                Ok(ToolOutput::clean(json!({"code": code.to_string()})))
            }
            "hive.pair_confirm" => {
                let code = xz_hive::PairingCode::parse(require_str(&args, "code", tool)?)
                    .map_err(|err| XzError::InvalidArgs(err.to_string()))?;
                let name = require_str(&args, "name", tool)?;
                let id = xz_hive::DeviceId::from_hex(require_str(&args, "id", tool)?)
                    .map_err(|err| XzError::InvalidArgs(err.to_string()))?;
                let identity = xz_hive::Identity::new(name, id)
                    .map_err(|err| XzError::InvalidArgs(err.to_string()))?;
                let stronger = args.get("stronger").and_then(Value::as_bool).unwrap_or(false);
                let peer = device
                    .confirm(&code, identity, stronger)
                    .map_err(|err| XzError::InvalidArgs(err.to_string()))?;
                Ok(ToolOutput::clean(json!({
                    "paired": true,
                    "name": peer.identity.name(),
                    "id": peer.id().to_hex(),
                    "stronger": peer.stronger,
                })))
            }
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

/// Sight tools on a host with no camera or screen capture.
pub struct MediaStub;

#[async_trait]
impl Organ for MediaStub {
    fn family(&self) -> &str {
        "media"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![
            spec(
                "media.screenshot",
                "Capture the screen.",
                Risk::Observe,
                &[],
            ),
            spec("media.capture_photo", "Take a photo.", Risk::Observe, &[]),
        ]
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, _args: Value) -> Result<ToolOutput> {
        match tool {
            "media.screenshot" | "media.capture_photo" => Ok(ToolOutput::clean(json!({
                "captured": false,
                "reason": "this host has no sensor for that"
            }))),
            _ => Err(XzError::UnknownTool(tool.into())),
        }
    }
}

fn spec(name: &str, description: &str, risk: Risk, resources: &[&str]) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: description.into(),
        input_schema: json!({"type": "object"}),
        risk,
        resource_args: resources.iter().map(|s| (*s).to_string()).collect(),
        tainted_output: false,
        first_party: true,
    }
}

fn require_str<'a>(args: &'a Value, key: &str, tool: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| XzError::InvalidArgs(format!("{tool} needs `{key}`")))
}

/// UTC calendar date for a unix timestamp. Used for note file names.
pub fn ymd(unix_secs: u64) -> String {
    let z = (unix_secs / 86_400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_epoch_is_1970() {
        assert_eq!(ymd(0), "1970-01-01");
    }

    #[tokio::test]
    async fn pairing_sends_the_next_question_to_the_pc() {
        let organ = HiveOrgan::new("phone");
        let ctx = CallCtx::test();
        let began = organ
            .call(&ctx, "hive.pair_begin", json!({"seed": "kitchen"}))
            .await
            .unwrap();
        let code = began.content["code"].as_str().unwrap();
        let id = xz_hive::DeviceId::from_bytes([2; 32]).to_hex();
        organ
            .call(
                &ctx,
                "hive.pair_confirm",
                json!({"code": code, "name": "PC", "id": id, "stronger": true}),
            )
            .await
            .unwrap();
        let ran = organ
            .call(
                &ctx,
                "hive.run_on",
                json!({"intent": "explain vaccines"}),
            )
            .await
            .unwrap();
        assert_eq!(ran.content["ran"], "peer");
        assert_eq!(ran.content["peer"], "PC");
        assert!(ran.content.get("notice").unwrap().is_null());
    }
}
