//! The Charter: the user's policy, stored as `charter.toml` (SPEC §3.4).
//!
//! Every struct rejects unknown fields. The Charter is a security policy,
//! so a typo such as `[[rules]]` or `resouce` must fail loudly instead of
//! silently dropping a deny rule or widening an allow rule.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;
use std::io::Write;
use std::path::Path;
use xz_types::{Result, Risk, XzError};

use crate::glob::{Mode, ResourceGlob, domain_glob, name_glob};

/// What a rule or default says to do with a matching call. Ordered from
/// least to most restrictive, so `max` picks the winner.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Policy {
    Allow,
    Ask,
    Deny,
}

impl fmt::Display for Policy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Policy::Allow => "allow",
            Policy::Ask => "ask",
            Policy::Deny => "deny",
        })
    }
}

/// What happens to a call that no rule matches, by risk class.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Defaults {
    pub observe: Policy,
    pub act: Policy,
    pub commit: Policy,
}

impl Default for Defaults {
    fn default() -> Self {
        Self {
            observe: Policy::Allow,
            act: Policy::Allow,
            commit: Policy::Ask,
        }
    }
}

impl Defaults {
    /// The default for one risk class.
    pub fn for_risk(&self, risk: Risk) -> Policy {
        match risk {
            Risk::Observe => self.observe,
            Risk::Act => self.act,
            Risk::Commit => self.commit,
        }
    }
}

/// Where tool calls may reach over the network.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Egress {
    /// Domain globs such as `*.wikipedia.org`. Other domains ask first.
    pub allow_domains: Vec<String>,
    /// Private address ranges (10/8, 172.16/12, 192.168/16, link local, ULA).
    pub allow_lan: bool,
    /// `localhost`, 127/8 and `::1`.
    pub allow_localhost: bool,
}

impl Default for Egress {
    fn default() -> Self {
        Self {
            allow_domains: Vec::new(),
            allow_lan: true,
            allow_localhost: true,
        }
    }
}

/// Per-Organism limits.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Budgets {
    /// Calls allowed per Organism in any 60 second window. 0 allows none.
    pub tool_calls_per_minute: u32,
    /// Plan steps per task, enforced by the Organism loop.
    pub steps_per_task: u32,
}

impl Default for Budgets {
    fn default() -> Self {
        Self {
            tool_calls_per_minute: 60,
            steps_per_task: 12,
        }
    }
}

/// Extra conditions on a rule.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct When {
    /// Match only calls whose input is tainted (`true`) or clean (`false`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tainted: Option<bool>,
}

/// One Charter rule (`[[rule]]` in `charter.toml`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    /// Unique within the Charter; assigned by `add_rule` when empty.
    #[serde(default)]
    pub id: String,
    /// The user's own words for the rule.
    #[serde(default)]
    pub text: String,
    /// Glob over Organism ids; `*` means every Organism.
    #[serde(default = "any")]
    pub subject: String,
    /// Glob over tool names, e.g. `net.*`.
    pub tool: String,
    /// Optional path or URL glob; the rule then applies only to calls on
    /// matching resources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    pub decision: Policy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<When>,
}

fn any() -> String {
    "*".into()
}

fn is_glob(s: &str) -> bool {
    s.contains(['*', '?', '[', '{'])
}

impl Rule {
    /// The rule as one plain sentence, for confirmation cards. It is built
    /// from the structured fields, so the user sees what will be enforced
    /// rather than what a model claimed.
    pub fn describe(&self) -> String {
        let who = match self.subject.trim() {
            "*" => "any organism".to_string(),
            s if is_glob(s) => format!("any organism matching {s}"),
            s => format!("the organism {s}"),
        };
        let what = match self.tool.trim() {
            "*" => "any tool".to_string(),
            t if is_glob(t) => format!("any tool matching {t}"),
            t => t.to_string(),
        };
        let on = match &self.resource {
            Some(r) => format!(" on {}", r.trim()),
            None => String::new(),
        };
        let when = match self.when.and_then(|w| w.tainted) {
            Some(true) => " when its input comes from an untrusted source",
            Some(false) => " when its input is not tainted",
            None => "",
        };
        match self.decision {
            Policy::Allow => format!("Allow {who} to use {what}{on}{when}."),
            Policy::Ask => format!("Ask me before {who} uses {what}{on}{when}."),
            Policy::Deny => format!("Never let {who} use {what}{on}{when}."),
        }
    }

    /// Checks that every glob compiles and the tool glob is not empty.
    pub(crate) fn check(&self) -> std::result::Result<(), String> {
        name_glob(&self.subject, Mode::Restrict).map_err(|e| format!("subject: {e}"))?;
        name_glob(&self.tool, Mode::Restrict).map_err(|e| format!("tool: {e}"))?;
        if let Some(r) = &self.resource {
            // Glob syntax does not depend on the home directory.
            ResourceGlob::compile(Path::new("/"), r, Mode::Restrict)
                .map_err(|e| format!("resource: {e}"))?;
        }
        Ok(())
    }
}

/// Validates a rule a model drafted from the user's words. The result
/// still needs the user's confirmation before it is added.
pub fn parse_rule(value: serde_json::Value) -> Result<Rule> {
    let mut rule: Rule =
        serde_json::from_value(value).map_err(|e| XzError::InvalidArgs(format!("rule: {e}")))?;
    rule.check()
        .map_err(|e| XzError::InvalidArgs(format!("rule: {e}")))?;
    if rule.text.trim().is_empty() {
        rule.text = rule.describe();
    }
    Ok(rule)
}

/// The user's policy.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Charter {
    pub defaults: Defaults,
    pub egress: Egress,
    pub budgets: Budgets,
    #[serde(rename = "rule", skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<Rule>,
}

impl Charter {
    /// Reads `charter.toml`. A missing file means the default Charter.
    /// Rules without an id get one; an invalid Charter is an error rather
    /// than a silently weaker policy.
    pub fn load(path: &Path) -> Result<Self> {
        let text = match std::fs::read_to_string(path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e.into()),
        };
        let bad = |e: String| XzError::Parse(format!("{}: {e}", path.display()));
        let mut charter: Charter = toml::from_str(&text).map_err(|e| bad(e.to_string()))?;
        for i in 0..charter.rules.len() {
            if charter.rules[i].id.trim().is_empty() {
                charter.rules[i].id = charter.next_id();
            }
        }
        charter.check().map_err(bad)?;
        Ok(charter)
    }

    /// Writes `charter.toml` atomically: a crash leaves the old file or the
    /// new one, never a torn one.
    pub fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let text = toml::to_string_pretty(self).map_err(|e| XzError::Other(e.to_string()))?;
        let dir = path
            .parent()
            .filter(|d| !d.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir)?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        tmp.write_all(text.as_bytes())?;
        tmp.as_file().sync_all()?;
        tmp.persist(path).map_err(|e| e.error)?;
        Ok(())
    }

    /// Adds a validated rule and returns its id (assigned when empty).
    pub fn add_rule(&mut self, mut rule: Rule) -> Result<String> {
        rule.check()
            .map_err(|e| XzError::InvalidArgs(format!("rule: {e}")))?;
        if rule.id.trim().is_empty() {
            rule.id = self.next_id();
        }
        if self.rules.iter().any(|r| r.id == rule.id) {
            return Err(XzError::InvalidArgs(format!(
                "a rule with id `{}` already exists",
                rule.id
            )));
        }
        let id = rule.id.clone();
        self.rules.push(rule);
        Ok(id)
    }

    /// Removes the rule with `id`, returning it.
    pub fn remove_rule(&mut self, id: &str) -> Option<Rule> {
        let i = self.rules.iter().position(|r| r.id == id)?;
        Some(self.rules.remove(i))
    }

    /// Checks every glob and that rule ids are present and unique.
    pub fn validate(&self) -> Result<()> {
        self.check().map_err(XzError::InvalidArgs)
    }

    fn check(&self) -> std::result::Result<(), String> {
        for d in &self.egress.allow_domains {
            domain_glob(d).map_err(|e| format!("egress.allow_domains: {e}"))?;
        }
        let mut seen = HashSet::new();
        for r in &self.rules {
            if r.id.trim().is_empty() {
                return Err("every rule needs an id".into());
            }
            if !seen.insert(r.id.as_str()) {
                return Err(format!("duplicate rule id `{}`", r.id));
            }
            r.check().map_err(|e| format!("rule {}: {e}", r.id))?;
        }
        Ok(())
    }

    /// Stable id of this policy. Crystals store it so an edited Charter
    /// cannot skip the planner on the strength of the old wording.
    pub fn generation(&self) -> String {
        let text = serde_json::to_string(self).unwrap_or_default();
        let mut hash = 0xcbf29ce484222325u64;
        for byte in text.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("{hash:016x}")
    }

    /// The first free id of the form `rN`.
    fn next_id(&self) -> String {
        let mut n = self.rules.len() + 1;
        loop {
            let id = format!("r{n}");
            if self.rules.iter().all(|r| r.id != id) {
                return id;
            }
            n += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rule(id: &str, tool: &str, decision: Policy) -> Rule {
        Rule {
            id: id.into(),
            text: String::new(),
            subject: "*".into(),
            tool: tool.into(),
            resource: None,
            decision,
            when: None,
        }
    }

    #[test]
    fn generation_changes_when_a_rule_is_added() {
        let first = Charter::default();
        let mut second = first.clone();
        second
            .add_rule(rule("r1", "fs.delete", Policy::Deny))
            .unwrap();
        assert_eq!(first.generation(), Charter::default().generation());
        assert_ne!(first.generation(), second.generation());
        assert_eq!(first.generation().len(), 16);
    }

    #[test]
    fn defaults_match_spec() {
        let c = Charter::default();
        assert_eq!(c.defaults.for_risk(Risk::Observe), Policy::Allow);
        assert_eq!(c.defaults.for_risk(Risk::Act), Policy::Allow);
        assert_eq!(c.defaults.for_risk(Risk::Commit), Policy::Ask);
        assert!(c.egress.allow_domains.is_empty());
        assert!(c.egress.allow_lan && c.egress.allow_localhost);
        assert_eq!(c.budgets.tool_calls_per_minute, 60);
        assert_eq!(c.budgets.steps_per_task, 12);
        assert!(c.rules.is_empty());
        assert!(Policy::Deny > Policy::Ask && Policy::Ask > Policy::Allow);
        assert_eq!(Policy::Ask.to_string(), "ask");
        assert_eq!(Policy::Allow.to_string(), "allow");
        assert_eq!(Policy::Deny.to_string(), "deny");
    }

    #[test]
    fn missing_file_is_default() {
        let dir = tempfile::tempdir().unwrap();
        let c = Charter::load(&dir.path().join("charter.toml")).unwrap();
        assert_eq!(c, Charter::default());
    }

    #[test]
    fn unreadable_path_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        // A directory where the file should be.
        assert!(matches!(Charter::load(dir.path()), Err(XzError::Io(_))));
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("charter.toml");
        let mut c = Charter::default();
        c.defaults.commit = Policy::Deny;
        c.egress.allow_domains = vec!["*.wikipedia.org".into()];
        c.egress.allow_lan = false;
        c.budgets.tool_calls_per_minute = 5;
        let mut r = rule("", "net.post", Policy::Ask);
        r.text = "never send anything without asking me".into();
        r.resource = Some("https://*.example.com/**".into());
        r.when = Some(When {
            tainted: Some(true),
        });
        assert_eq!(c.add_rule(r).unwrap(), "r1");
        c.add_rule(rule("", "fs.*", Policy::Allow)).unwrap();
        c.save(&path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("[[rule]]"), "{text}");
        assert_eq!(Charter::load(&path).unwrap(), c);
        // Saving again replaces the file in place.
        c.budgets.steps_per_task = 3;
        c.save(&path).unwrap();
        assert_eq!(Charter::load(&path).unwrap().budgets.steps_per_task, 3);
        // No temp files are left behind.
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }

    #[test]
    fn save_refuses_invalid_charter() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = Charter::default();
        c.rules.push(rule("x", "", Policy::Deny));
        assert!(c.save(&dir.path().join("c.toml")).is_err());
        assert!(!dir.path().join("c.toml").exists());
    }

    #[test]
    fn save_reports_io_errors() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file");
        std::fs::write(&file, "x").unwrap();
        // The parent is a file, so the directory cannot be created.
        let under_file = file.join("charter.toml");
        assert!(matches!(
            Charter::default().save(&under_file),
            Err(XzError::Io(_))
        ));
        // The target is a non-empty directory, so the rename fails and the
        // temp file is cleaned up.
        let occupied = dir.path().join("occupied");
        std::fs::create_dir_all(occupied.join("inner")).unwrap();
        assert!(matches!(
            Charter::default().save(&occupied),
            Err(XzError::Io(_))
        ));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn partial_file_uses_defaults_and_assigns_ids() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("charter.toml");
        std::fs::write(
            &path,
            r#"
[defaults]
commit = "deny"

[[rule]]
tool = "net.post"
decision = "deny"

[[rule]]
id = "r1"
tool = "fs.read"
decision = "allow"
"#,
        )
        .unwrap();
        let c = Charter::load(&path).unwrap();
        assert_eq!(c.defaults.observe, Policy::Allow);
        assert_eq!(c.defaults.commit, Policy::Deny);
        assert_eq!(c.rules[0].subject, "*");
        // Ids count up from the rule count and skip ones already taken.
        assert_eq!(c.rules[0].id, "r3");
        assert_eq!(c.rules[1].id, "r1");
    }

    #[test]
    fn invalid_files_fail_loudly() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("charter.toml");
        for bad in [
            "not = [valid",
            "[[rules]]\ntool = \"x\"\ndecision = \"deny\"",
            "[[rule]]\ntool = \"x\"\nresouce = \"~/a\"\ndecision = \"allow\"",
            "[[rule]]\ntool = \"x\"\ndecision = \"never\"",
            "[[rule]]\ntool = \"x\"\ndecision = \"deny\"\nwhen = { time = \"night\" }",
            "[[rule]]\ntool = \"fs.[\"\ndecision = \"deny\"",
            "[[rule]]\ntool = \"\"\ndecision = \"deny\"",
            "[[rule]]\nid = \"a\"\ntool = \"x\"\ndecision = \"deny\"\n[[rule]]\nid = \"a\"\ntool = \"y\"\ndecision = \"deny\"",
            "[egress]\nallow_domains = [\"[\"]",
            "[egress]\nallow_domain = [\"x.org\"]",
            "[defaults]\ncomit = \"allow\"",
            "[budgets]\ntool_calls_per_minute = -1",
        ] {
            std::fs::write(&path, bad).unwrap();
            assert!(
                matches!(Charter::load(&path), Err(XzError::Parse(_))),
                "accepted: {bad}"
            );
        }
    }

    #[test]
    fn add_and_remove_rules() {
        let mut c = Charter::default();
        assert_eq!(c.add_rule(rule("", "a", Policy::Deny)).unwrap(), "r1");
        assert_eq!(c.add_rule(rule("mine", "b", Policy::Deny)).unwrap(), "mine");
        assert_eq!(c.add_rule(rule(" ", "c", Policy::Deny)).unwrap(), "r3");
        assert!(c.add_rule(rule("mine", "d", Policy::Deny)).is_err());
        assert!(c.add_rule(rule("", " ", Policy::Deny)).is_err());
        assert_eq!(c.remove_rule("mine").unwrap().tool, "b");
        assert!(c.remove_rule("mine").is_none());
        assert_eq!(c.add_rule(rule("", "e", Policy::Deny)).unwrap(), "r4");
        assert!(c.validate().is_ok());
        c.rules.push(rule("", "f", Policy::Deny));
        assert!(c.validate().is_err(), "rules need ids");
    }

    #[test]
    fn parse_rule_validates_model_drafts() {
        let r = parse_rule(json!({"tool": "net.post", "decision": "ask"})).unwrap();
        assert_eq!(r.subject, "*");
        assert_eq!(r.text, "Ask me before any organism uses net.post.");
        let r = parse_rule(json!({
            "text": "Forge may not touch my photos",
            "subject": "xindoze.forge",
            "tool": "fs.*",
            "resource": "~/Pictures/**",
            "decision": "deny",
            "when": {"tainted": false}
        }))
        .unwrap();
        assert_eq!(r.text, "Forge may not touch my photos");
        for bad in [
            json!({"tool": "", "decision": "deny"}),
            json!({"tool": "   ", "decision": "deny"}),
            json!({"decision": "deny"}),
            json!({"tool": "x"}),
            json!({"tool": "x", "decision": "maybe"}),
            json!({"tool": "x", "decision": "Deny"}),
            json!({"tool": "x[", "decision": "deny"}),
            json!({"tool": "x", "subject": "", "decision": "deny"}),
            json!({"tool": "x", "subject": "{a", "decision": "deny"}),
            json!({"tool": "x", "resource": "~/[", "decision": "deny"}),
            json!({"tool": "x", "resource": "", "decision": "deny"}),
            json!({"tool": "x", "resource": "~/a/../../**", "decision": "allow"}),
            json!({"tool": "x", "decision": "deny", "when": {"time": "night"}}),
            json!({"tool": "x", "decision": "deny", "when": {"tainted": "yes"}}),
            json!({"tool": "x", "decision": "deny", "extra": 1}),
            json!("deny everything"),
        ] {
            assert!(
                matches!(parse_rule(bad.clone()), Err(XzError::InvalidArgs(_))),
                "accepted: {bad}"
            );
        }
    }

    #[test]
    fn describe_sentences() {
        let mut r = rule("r1", "net.post", Policy::Deny);
        assert_eq!(r.describe(), "Never let any organism use net.post.");
        r.decision = Policy::Allow;
        r.subject = "xindoze.forge".into();
        r.resource = Some("~/Xindoze/Apps/**".into());
        assert_eq!(
            r.describe(),
            "Allow the organism xindoze.forge to use net.post on ~/Xindoze/Apps/**."
        );
        r.decision = Policy::Ask;
        r.subject = "xindoze.*".into();
        r.tool = "fs.*".into();
        r.when = Some(When {
            tainted: Some(true),
        });
        assert_eq!(
            r.describe(),
            "Ask me before any organism matching xindoze.* uses any tool matching fs.* on \
             ~/Xindoze/Apps/** when its input comes from an untrusted source."
        );
        r.tool = "*".into();
        r.resource = None;
        r.when = Some(When {
            tainted: Some(false),
        });
        assert_eq!(
            r.describe(),
            "Ask me before any organism matching xindoze.* uses any tool when its input is not tainted."
        );
        r.when = Some(When::default());
        assert!(r.describe().ends_with("any tool."));
    }
}
