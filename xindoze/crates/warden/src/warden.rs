//! The Warden: decides every tool call deterministically (SPEC §3.4, §6).

use globset::GlobMatcher;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError, RwLock};
use std::time::{Duration, Instant};
use xz_types::path::normalize;
use xz_types::{Decision, Grant, Result, Risk, Taint, ToolSpec, XzError};

use crate::charter::{Charter, Policy, Rule};
use crate::glob::{Mode, ResourceGlob, domain_glob, is_within, name_glob, path_key};
use crate::resource::{self, Resource, WebTarget, Zone};

/// Tools that ask whatever the Charter says: a model must never rewrite
/// the Charter or erase memories silently (SPEC Appendix D).
const ALWAYS_ASK: &[&str] = &["xz.charter_add_rule", "engram.forget"];

/// The sliding window for `tool_calls_per_minute`.
const WINDOW: Duration = Duration::from_secs(60);

/// One tool call for the Warden to decide.
#[derive(Clone, Copy, Debug)]
pub struct Request<'a> {
    /// Id of the calling Organism, e.g. `xindoze.notes`.
    pub organism: &'a str,
    /// What the Organism's Genome declared and the Charter granted.
    pub grants: &'a [Grant],
    pub spec: &'a ToolSpec,
    pub args: &'a Value,
    /// Provenance of the call's arguments.
    pub taint: &'a Taint,
}

/// The deterministic policy engine. Cheap to share: every method takes
/// `&self`.
pub struct Warden {
    home: PathBuf,
    /// Lowercased `/`-separated data directory, never reachable by tools.
    data_key: String,
    policy: RwLock<Compiled>,
    /// Recent admitted calls per Organism, for the rate budget.
    calls: Mutex<HashMap<String, VecDeque<Instant>>>,
}

/// A Charter with its globs compiled once.
struct Compiled {
    charter: Charter,
    domains: Vec<GlobMatcher>,
    rules: Vec<CompiledRule>,
}

struct CompiledRule {
    id: String,
    sentence: String,
    decision: Policy,
    subject: GlobMatcher,
    tool: GlobMatcher,
    resource: Option<ResourceGlob>,
    tainted: Option<bool>,
}

impl Warden {
    /// Builds a Warden. `home` anchors relative and `~` paths; `data_dir`
    /// (engram.db, charter.toml, keys) is off limits to every tool call.
    pub fn new(charter: Charter, home: PathBuf, data_dir: PathBuf) -> Result<Self> {
        if !home.is_absolute() {
            return Err(XzError::InvalidArgs(format!(
                "home must be an absolute path, got {}",
                home.display()
            )));
        }
        let home = normalize(&home);
        let data_key = path_key(&normalize(&home.join(data_dir))).to_lowercase();
        let policy = Compiled::new(charter, &home)?;
        Ok(Self {
            home,
            data_key,
            policy: RwLock::new(policy),
            calls: Mutex::default(),
        })
    }

    /// The Charter currently enforced.
    pub fn charter(&self) -> Charter {
        self.read().charter.clone()
    }

    /// Replaces the Charter. An invalid Charter is rejected and the current
    /// one stays in force.
    pub fn set_charter(&self, charter: Charter) -> Result<()> {
        let compiled = Compiled::new(charter, &self.home)?;
        *self.policy.write().unwrap_or_else(PoisonError::into_inner) = compiled;
        Ok(())
    }

    /// Decides one tool call. Call it exactly once per attempted call: an
    /// admitted call (allowed or asked) counts toward the rate budget.
    pub fn decide(&self, req: &Request<'_>) -> Decision {
        self.decide_at(req, Instant::now())
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Compiled> {
        // A poisoned lock still holds a fully built policy: writers only
        // swap in a finished value.
        self.policy.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn decide_at(&self, req: &Request<'_>, now: Instant) -> Decision {
        let policy = self.read();
        let asks = match self.evaluate(&policy, req) {
            Ok(asks) => asks,
            Err(reason) => return Decision::Deny { reason },
        };
        let limit = policy.charter.budgets.tool_calls_per_minute;
        if !self.admit(req.organism, limit, now) {
            return Decision::Deny {
                reason: format!(
                    "budget: {} may make at most {limit} tool calls per minute",
                    req.organism
                ),
            };
        }
        if asks.is_empty() {
            Decision::Allow
        } else {
            Decision::Ask {
                reason: asks.join("; "),
            }
        }
    }

    /// Every check except the budget. `Err` is a deny reason; `Ok` holds
    /// the reasons to ask, empty when the call is allowed outright.
    fn evaluate(
        &self,
        policy: &Compiled,
        req: &Request<'_>,
    ) -> std::result::Result<Vec<String>, String> {
        let spec = req.spec;
        let risk = spec.effective_risk();
        let mut asks = Vec::new();

        let grants: Vec<&Grant> = req
            .grants
            .iter()
            .filter(|g| name_glob(&g.tool, Mode::Permit).is_ok_and(|m| m.is_match(&spec.name)))
            .collect();
        if grants.is_empty() {
            return Err(format!(
                "not granted: {} has no capability for {}",
                req.organism, spec.name
            ));
        }

        let resources = resource::collect(spec, req.args, &self.home)?;
        // A grant with no resource globs covers any resource.
        let unrestricted = grants.iter().any(|g| g.resources.is_empty());
        let globs: Vec<ResourceGlob> = grants
            .iter()
            .flat_map(|g| &g.resources)
            .filter_map(|p| ResourceGlob::compile(&self.home, p, Mode::Permit).ok())
            .collect();
        for r in &resources {
            self.check_protected(r, risk)?;
            if !unrestricted && !globs.iter().any(|g| g.permits(r)) {
                return Err(format!(
                    "not granted: {} may not use {} on {}",
                    req.organism, spec.name, r.raw
                ));
            }
            if let Some(web) = &r.url {
                asks.extend(policy.egress(web)?);
            }
        }

        let tainted = !req.taint.is_clean();
        let (decision, reason) = policy.ruling(req, &resources, risk, tainted);
        match decision {
            Policy::Deny => return Err(reason),
            Policy::Ask => asks.push(reason),
            Policy::Allow => {}
        }

        // Floors no rule can lower. A Deny has already returned above.
        if ALWAYS_ASK.contains(&spec.name.as_str()) {
            asks.push(format!("{} always needs your confirmation", spec.name));
        }
        if risk == Risk::Commit && tainted {
            let sources: Vec<&str> = req.taint.sources.iter().map(String::as_str).collect();
            asks.push(format!("tainted input from {}", sources.join(", ")));
        }
        Ok(asks)
    }

    /// Denies any path reading inside the data directory, and for state
    /// changes any path that contains it (moving or deleting a parent
    /// would take the data directory with it).
    fn check_protected(&self, r: &Resource, risk: Risk) -> std::result::Result<(), String> {
        let path = r.path.to_lowercase();
        if is_within(&path, &self.data_key) {
            return Err(format!(
                "protected: {} is inside the Xindoze data directory",
                r.raw
            ));
        }
        if risk != Risk::Observe && is_within(&self.data_key, &path) {
            return Err(format!(
                "protected: {} contains the Xindoze data directory; name a more specific path",
                r.raw
            ));
        }
        Ok(())
    }

    /// Records a call against the Organism's rate budget, or refuses it.
    fn admit(&self, organism: &str, limit: u32, now: Instant) -> bool {
        let mut calls = self.calls.lock().unwrap_or_else(PoisonError::into_inner);
        let recent = calls.entry(organism.to_owned()).or_default();
        while recent
            .front()
            .is_some_and(|&t| now.saturating_duration_since(t) >= WINDOW)
        {
            recent.pop_front();
        }
        if recent.len() >= limit as usize {
            return false;
        }
        recent.push_back(now);
        true
    }
}

impl Compiled {
    fn new(charter: Charter, home: &Path) -> Result<Self> {
        charter.validate()?;
        let bad = |e: String| XzError::InvalidArgs(format!("charter: {e}"));
        let domains = charter
            .egress
            .allow_domains
            .iter()
            .map(|d| domain_glob(d))
            .collect::<std::result::Result<_, _>>()
            .map_err(bad)?;
        let rules = charter
            .rules
            .iter()
            .map(|r| CompiledRule::new(r, home))
            .collect::<std::result::Result<_, _>>()
            .map_err(bad)?;
        Ok(Self {
            charter,
            domains,
            rules,
        })
    }

    /// The egress check for one URL. `Ok(Some)` is a reason to ask.
    fn egress(&self, web: &WebTarget) -> std::result::Result<Option<String>, String> {
        let e = &self.charter.egress;
        let host = web.host.name();
        match web.host.zone() {
            Zone::Localhost if e.allow_localhost => Ok(None),
            Zone::Localhost => Err(format!(
                "{host} is this device, and the Charter disallows localhost access"
            )),
            Zone::Lan if e.allow_lan => Ok(None),
            Zone::Lan => Err(format!(
                "{host} is on the local network, and the Charter disallows LAN access"
            )),
            Zone::Domain if self.domains.iter().any(|d| d.is_match(&host)) => Ok(None),
            Zone::Domain | Zone::PublicIp => Ok(Some(format!("first contact with {host}"))),
        }
    }

    /// The Charter's verdict: the most restrictive matching rule (first in
    /// file order on ties), else the default for the risk class.
    fn ruling(
        &self,
        req: &Request<'_>,
        resources: &[Resource],
        risk: Risk,
        tainted: bool,
    ) -> (Policy, String) {
        let reach = risk != Risk::Observe;
        let mut best: Option<&CompiledRule> = None;
        for rule in &self.rules {
            if rule.applies(req, resources, tainted, reach)
                && best.is_none_or(|b| rule.decision > b.decision)
            {
                best = Some(rule);
            }
        }
        match best {
            Some(rule) => (
                rule.decision,
                format!("Charter rule {}: {}", rule.id, rule.sentence),
            ),
            None => {
                let decision = self.charter.defaults.for_risk(risk);
                (decision, default_reason(req.spec, risk, decision))
            }
        }
    }
}

impl CompiledRule {
    fn new(rule: &Rule, home: &Path) -> std::result::Result<Self, String> {
        // Deny and ask rules match every spelling; allow rules only the exact one.
        let mode = match rule.decision {
            Policy::Allow => Mode::Permit,
            Policy::Ask | Policy::Deny => Mode::Restrict,
        };
        Ok(Self {
            id: rule.id.clone(),
            sentence: rule.describe(),
            decision: rule.decision,
            subject: name_glob(&rule.subject, mode)?,
            tool: name_glob(&rule.tool, mode)?,
            resource: match &rule.resource {
                Some(r) => Some(ResourceGlob::compile(home, r, mode)?),
                None => None,
            },
            tainted: rule.when.and_then(|w| w.tainted),
        })
    }

    fn applies(
        &self,
        req: &Request<'_>,
        resources: &[Resource],
        tainted: bool,
        reach: bool,
    ) -> bool {
        if !self.subject.is_match(req.organism) || !self.tool.is_match(&req.spec.name) {
            return false;
        }
        if self.tainted.is_some_and(|t| t != tainted) {
            return false;
        }
        match &self.resource {
            None => true,
            // An allow rule must cover every resource, or it would wave
            // through a move from an allowed folder into a forbidden one.
            Some(g) if self.decision == Policy::Allow => {
                !resources.is_empty() && resources.iter().all(|r| g.permits(r))
            }
            Some(g) => resources.iter().any(|r| g.restricts(r, reach)),
        }
    }
}

fn default_reason(spec: &ToolSpec, risk: Risk, decision: Policy) -> String {
    let what = if spec.first_party {
        let class = match risk {
            Risk::Observe => "an observe",
            Risk::Act => "an act",
            Risk::Commit => "a commit",
        };
        format!("{} is {class} action", spec.name)
    } else {
        format!("{} is a third-party tool, treated as commit", spec.name)
    };
    match decision {
        Policy::Deny => format!("{what}, which the Charter denies by default"),
        _ => format!("{what}, which the Charter asks about by default"),
    }
}

#[cfg(test)]
mod tests;
