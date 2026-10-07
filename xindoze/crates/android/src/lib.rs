//! Android companion policy (SPEC §4, NOTES.md).
//!
//! The phone pairs through [`xz_hive::Device`]. Inference is embedded
//! llama.cpp, never Ollama. There is no AccessibilityService, no input
//! injection, and `people.message_send` only describes a draft the user sends.

use serde_json::Value;
use xz_cortex::{Hardware, Profile, Registry};
use xz_hive::{Device, DeviceId, HiveError, Identity, LOCAL_NOTICE, Presence, Route};
use xz_types::Role;

/// Direct APK / F-Droid, or the Play Lite build.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edition {
    Fdroid,
    Play,
}

impl Edition {
    pub fn parse(text: &str) -> Self {
        if text.eq_ignore_ascii_case("play") {
            Self::Play
        } else {
            Self::Fdroid
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fdroid => "fdroid",
            Self::Play => "play",
        }
    }

    /// HOME-launcher Takeover. Play Lite leaves the system launcher alone.
    pub fn home_launcher(self) -> bool {
        matches!(self, Self::Fdroid)
    }
}

/// Android inference backend. Ollama has no phone build.
pub const INFERENCE_BACKEND: &str = "llamacpp";

pub fn allows_backend(name: &str) -> bool {
    name == INFERENCE_BACKEND
}

/// Foreground-service contract the Kotlin service must match.
pub const CHANNEL_ID: &str = "xindoze.xinod";
pub const NOTIFICATION_TITLE: &str = "Xindoze";
pub const NOTIFICATION_TEXT: &str = "Xindoze has evolved.";

/// Dream Cycle runs only while the phone is charging (SPEC §4).
pub fn dream_allowed(charging: bool) -> bool {
    charging
}

/// Mid-range phone budgets (SPEC §10).
pub struct PhoneBudgets {
    pub reflex_routing_ms: u64,
    pub first_token_ms: u64,
    pub canvas_cold_start_ms: u64,
    pub idle_ram_mb: u64,
}

pub const MIDRANGE: PhoneBudgets = PhoneBudgets {
    reflex_routing_ms: 400,
    first_token_ms: 2_000,
    canvas_cold_start_ms: 3_000,
    idle_ram_mb: 120,
};

/// Genesis: tier from RAM, weights for embedded llama.cpp only.
pub fn genesis(registry: &Registry, hw: Hardware) -> Profile {
    Profile::plan(registry, hw, INFERENCE_BACKEND)
}

/// Stable 32-byte id from the install id Android gives this app.
pub fn device_id_from_install(install_id: &str) -> DeviceId {
    let mut bytes = [0u8; 32];
    let prefix = b"xindoze-phone";
    for (i, b) in prefix.iter().enumerate() {
        bytes[i] = *b;
    }
    for (i, b) in install_id.as_bytes().iter().enumerate() {
        bytes[(i + prefix.len()) % 32] ^= b.wrapping_add((i as u8).wrapping_mul(17));
    }
    DeviceId::from_bytes(bytes)
}

/// Where Hive placed a question, plus the one line the Stream should show.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Placement {
    /// Nothing is paired.
    Alone,
    /// A stronger peer is paired but not online. Notice is [`LOCAL_NOTICE`].
    Local { notice: String },
    /// Hive would offload, but this crate's socket is still in-memory only.
    PairedNoLink { peer: String },
}

impl Placement {
    pub fn line(&self) -> String {
        match self {
            Self::Alone => "Not paired. This phone is on its own.".into(),
            Self::Local { notice } => notice.clone(),
            Self::PairedNoLink { peer } => {
                format!("Paired with {peer}. The live link is not open, so this ran on this phone.")
            }
        }
    }
}

pub fn place(device: &Device, question: &str) -> Placement {
    if device.peers().is_empty() {
        return Placement::Alone;
    }
    match device.route(question) {
        Route::RanLocal { notice } => Placement::Local { notice },
        Route::RanOn { peer, .. } => Placement::PairedNoLink {
            peer: peer.identity.name().to_string(),
        },
    }
}

/// Prompt handed to embedded llama.cpp.
pub fn model_prompt(user: &str) -> String {
    format!("You are Xindoze on this phone. Be brief.\nUser: {user}\nAssistant:")
}

pub fn say_with_line(answer: &str, placement: &Placement) -> String {
    let answer = answer.trim();
    let line = placement.line();
    if answer.is_empty() {
        line
    } else {
        format!("{answer}\n\n{line}")
    }
}

/// What the Intent Bar asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Intent {
    Model {
        text: String,
    },
    Pair {
        seed: String,
    },
    Confirm {
        code: String,
        name: String,
        id_hex: String,
        stronger: bool,
    },
    Draft {
        to: String,
        body: String,
    },
    Refused {
        reason: String,
    },
}

pub fn classify(text: &str) -> Intent {
    let trimmed = text.trim();
    let lower = trimmed.to_lowercase();
    if lower.contains("accessibility service")
        || lower.contains("accessibilityservice")
        || lower.contains("inject input")
        || lower.contains("input injection")
    {
        return Intent::Refused {
            reason: "Xindoze on Android has no AccessibilityService and does not inject input into other apps.".into(),
        };
    }
    if let Some(draft) = parse_draft(trimmed) {
        return Intent::Draft {
            to: draft.0,
            body: draft.1,
        };
    }
    if let Some(rest) = lower.strip_prefix("hive confirm ") {
        return parse_confirm(rest, trimmed);
    }
    if lower == "pair" || lower.starts_with("pair ") {
        let seed = trimmed.split_once(' ').map(|(_, s)| s.trim()).unwrap_or("");
        if seed.is_empty() {
            return Intent::Refused {
                reason: "Say which word to pair with, for example: pair kitchen".into(),
            };
        }
        return Intent::Pair {
            seed: seed.to_string(),
        };
    }
    Intent::Model {
        text: trimmed.to_string(),
    }
}

fn parse_confirm(lower_rest: &str, original: &str) -> Intent {
    // hive confirm CODE NAME HEX [phone]
    let original_rest = original
        .trim()
        .split_once(' ')
        .and_then(|(_, rest)| rest.split_once(' '))
        .map(|(_, rest)| rest.trim())
        .unwrap_or(lower_rest);
    let mut parts = original_rest.split_whitespace();
    let Some(code) = parts.next() else {
        return Intent::Refused {
            reason: "Say: hive confirm CODE NAME HEX".into(),
        };
    };
    let Some(name) = parts.next() else {
        return Intent::Refused {
            reason: "Say: hive confirm CODE NAME HEX".into(),
        };
    };
    let Some(id_hex) = parts.next() else {
        return Intent::Refused {
            reason: "Say: hive confirm CODE NAME HEX".into(),
        };
    };
    let stronger = !matches!(parts.next(), Some(flag) if flag.eq_ignore_ascii_case("phone"));
    Intent::Confirm {
        code: code.to_string(),
        name: name.to_string(),
        id_hex: id_hex.to_string(),
        stronger,
    }
}

/// `Some` when the user asked to send a text. The body is never sent from here.
fn parse_draft(text: &str) -> Option<(String, String)> {
    let lower = text.to_lowercase();
    let sms = lower.contains("send a message")
        || lower.contains("send a text")
        || lower.contains("sms")
        || lower.starts_with("text ")
        || lower.contains(" text ");
    if !sms {
        return None;
    }
    if let Some((_, rest)) = lower.split_once(" to ") {
        let rest_orig = &text[text.to_lowercase().find(" to ").unwrap() + 4..];
        if let Some((name, body)) = split_saying(rest_orig) {
            return Some((name, body));
        }
        let _ = rest;
    }
    Some((String::new(), text.to_string()))
}

fn split_saying(rest: &str) -> Option<(String, String)> {
    let lower = rest.to_lowercase();
    let marker = [" saying ", " : ", ": "]
        .into_iter()
        .find_map(|m| lower.find(m).map(|i| (i, m.len())))?;
    let name = rest[..marker.0].trim().to_string();
    let body = rest[marker.0 + marker.1..].trim().to_string();
    if name.is_empty() || body.is_empty() {
        None
    } else {
        Some((name, body))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolDecision {
    Deny { reason: String },
    Draft { to: String, body: String },
    Unsupported { reason: String },
}

pub fn decide_tool(edition: Edition, tool: &str, args: &Value) -> ToolDecision {
    let tool = tool.trim();
    if tool.starts_with("ui.")
        || tool.contains("accessibility")
        || tool == "proc.spawn"
        || tool == "proc.kill"
    {
        return ToolDecision::Deny {
            reason: "Android does not inject input, read other apps, or start other programs."
                .into(),
        };
    }
    if tool.starts_with("ancestor.") {
        let why = if edition == Edition::Play {
            "Play Lite does not include Ancestors."
        } else {
            "Ancestors are not in this Android build."
        };
        return ToolDecision::Unsupported { reason: why.into() };
    }
    if tool == "people.message_send" {
        let to = args.get("to").and_then(Value::as_str).unwrap_or("");
        let body = args
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return ToolDecision::Draft {
            to: to.to_string(),
            body,
        };
    }
    ToolDecision::Unsupported {
        reason: format!("{tool} is not on this phone build."),
    }
}

/// One phone's Hive device. Pairs with [`Device::begin_pairing`] and [`Device::confirm`].
#[derive(Clone, Debug)]
pub struct PhoneBook {
    device: Device,
    edition: Edition,
}

impl PhoneBook {
    pub fn new(install_id: &str, edition: Edition) -> Result<Self, HiveError> {
        let id = device_id_from_install(install_id);
        let identity = Identity::new("Phone", id)?;
        Ok(Self {
            device: Device::new(identity),
            edition,
        })
    }

    pub fn edition(&self) -> Edition {
        self.edition
    }

    pub fn device(&self) -> &Device {
        &self.device
    }

    pub fn begin_pairing(&mut self, seed: &str) -> String {
        self.device.begin_pairing(seed.as_bytes()).to_string()
    }

    pub fn confirm(
        &mut self,
        code: &str,
        name: &str,
        id_hex: &str,
        stronger: bool,
    ) -> Result<String, HiveError> {
        let code = xz_hive::PairingCode::parse(code)?;
        let id = DeviceId::from_hex(id_hex)?;
        let identity = Identity::new(name, id)?;
        let peer = self.device.confirm(&code, identity, stronger)?;
        Ok(peer.identity.name().to_string())
    }

    pub fn peers(&self) -> Vec<(String, bool)> {
        self.device
            .peers()
            .iter()
            .map(|p| {
                (
                    p.identity.name().to_string(),
                    p.presence == Presence::Online,
                )
            })
            .collect()
    }

    pub fn set_offline(&mut self, id_hex: &str) -> Result<(), HiveError> {
        let id = DeviceId::from_hex(id_hex)?;
        self.device.set_presence(id, Presence::Offline)
    }
}

pub fn draft_say(to: &str, body: &str) -> String {
    let who = if to.is_empty() {
        "someone".into()
    } else {
        to.to_string()
    };
    format!("Opened a draft to {who}. Nothing was sent.\n\n{body}")
}

/// The line a paired-but-offline phone must show. Re-exported for the shell.
pub fn local_notice() -> &'static str {
    LOCAL_NOTICE
}

pub fn tier_label(registry: &Registry, ram_mb: u64) -> String {
    let hw = Hardware {
        ram_total_mb: ram_mb,
        ram_available_mb: ram_mb / 2,
        cpus: 8,
        gpu_vram_mb: None,
        os: "android".into(),
        arch: "aarch64".into(),
    };
    let profile = genesis(registry, hw);
    let reflex = profile
        .roles
        .get(&Role::Reflex)
        .map(String::as_str)
        .unwrap_or("none");
    format!("{} (reflex {reflex})", profile.tier)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pair_then_offline_notice_and_no_silent_send() {
        let mut phone = PhoneBook::new("install-a", Edition::Fdroid).unwrap();
        assert!(matches!(place(phone.device(), "hello"), Placement::Alone));
        assert!(!phone.edition().home_launcher() || phone.edition() == Edition::Fdroid);
        assert!(!Edition::Play.home_launcher());
        assert!(!allows_backend("ollama"));

        let code = phone.begin_pairing("kitchen");
        let mut pc_id = [0u8; 32];
        pc_id[31] = 9;
        let hex = DeviceId::from_bytes(pc_id).to_hex();
        phone.confirm(&code, "PC", &hex, true).unwrap();
        assert!(matches!(
            place(phone.device(), "explain vaccines"),
            Placement::PairedNoLink { .. }
        ));
        phone.set_offline(&hex).unwrap();
        match place(phone.device(), "explain vaccines") {
            Placement::Local { notice } => assert_eq!(notice, LOCAL_NOTICE),
            other => panic!("{other:?}"),
        }

        match classify("send a message to Ada saying lunch is ready") {
            Intent::Draft { to, body } => {
                assert_eq!(to, "Ada");
                assert_eq!(body, "lunch is ready");
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            decide_tool(Edition::Play, "ui.click", &json!({})),
            ToolDecision::Deny { .. }
        ));
        assert!(matches!(
            decide_tool(
                Edition::Fdroid,
                "people.message_send",
                &json!({"to": "Ada", "body": "hi"})
            ),
            ToolDecision::Draft { .. }
        ));
        let registry = Registry::builtin().unwrap();
        let tier = tier_label(&registry, 6 * 1024);
        assert!(tier.contains("sprout") || tier.contains("spore") || tier.contains("apex"));
        assert!(dream_allowed(true) && !dream_allowed(false));
    }
}
