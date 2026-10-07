//! Crystal cache (SPEC §3.9).
//!
//! QuickJS synthesis is TODO(phase 3). Until then a crystal is a versioned
//! plan template. It skips the planner only when the command and its context
//! both match: organism, charter generation, grants, taint, the wording, and
//! plan-choosing values that were not typed (search root, destination,
//! recipient, account).
//!
//! Paths that came back from tools are not frozen into the template and are
//! not part of the key. `try_run` re-derives them by running the crystal's
//! tools, in order, through the caller's invoker (the Warden, in the session).
//! A miss is `None`. A tool error is `Some(Err)` and flags that crystal.
//! [`Crystal::source`] and [`diff`] render the plan as text. They do not run
//! JavaScript.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::sync::Mutex;
use xz_types::xui::Node;
use xz_types::{
    ContextAnchor, CrystalCache, CrystalQuery, CrystalRun, Grant, Taint, ToolCall, ToolInvoker,
    Trace, TraceStep, XzError,
};

/// Plan-template format. Bump when the serialized shape changes.
///
/// Version 2 keys on command and context. Version 1 keyed on organism,
/// wording skeleton and tool skeleton, which skipped on wording alone.
pub const TEMPLATE_VERSION: u32 = 2;

/// Engram namespace for promoted crystals. In-progress counts stay in memory.
pub const CRYSTAL_NS: &str = "crystal";

/// Successful runs with one skeleton required before a crystal is promoted.
pub const RUNS_TO_PROMOTE: usize = 5;

/// A promoted crystal: a stable id plus the plan template it runs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crystal {
    pub version: u32,
    pub crystal_id: String,
    pub organism: String,
    /// Exact command this crystal replays.
    pub wording: String,
    /// Charter generation of the policy in force when it was learned.
    pub charter_generation: String,
    pub grants: Vec<Grant>,
    /// Untyped plan-choosing values (search root, destination, recipient, account).
    pub anchors: Vec<ContextAnchor>,
    pub taint: Taint,
    pub plan: PlanTemplate,
}

/// Versioned tool plan. Diffable JSON; not QuickJS source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanTemplate {
    pub version: u32,
    /// Intent the skeleton was taken from.
    pub intent: String,
    /// Fixed words and slot holes, left to right.
    pub pattern: Vec<PatternToken>,
    /// Prototype slot texts, index = slot id.
    pub slots: Vec<String>,
    pub steps: Vec<StepTemplate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub say: Option<TextTemplate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<TemplateValue>,
}

/// One token of the intent skeleton.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PatternToken {
    Word {
        text: String,
    },
    /// `width` is how many words this hole occupied in the prototype intent.
    /// A hole between two fixed words may take a different number of words
    /// at runtime. A hole at the end keeps `width`, so trailing words do
    /// not get swallowed into the slot.
    Slot {
        id: u32,
        width: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepTemplate {
    pub tool: String,
    pub args: TemplateValue,
}

/// Argument JSON with slot holes. Objects keep fields sorted by name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TemplateValue {
    Null,
    Bool {
        value: bool,
    },
    Number {
        value: serde_json::Number,
    },
    String {
        value: String,
    },
    Slot {
        id: u32,
    },
    /// A value copied from an earlier step's output. Re-derived on replay.
    FromOutput {
        step: u32,
        pointer: String,
    },
    /// A string that mixes literal text with holes (say / UI copy).
    Text {
        parts: Vec<TextPart>,
    },
    Array {
        items: Vec<TemplateValue>,
    },
    Object {
        fields: Vec<Field>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub name: String,
    pub value: TemplateValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextTemplate {
    pub parts: Vec<TextPart>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TextPart {
    Lit {
        text: String,
    },
    Slot {
        id: u32,
    },
    /// Text copied from an earlier step's output.
    FromOutput {
        step: u32,
        pointer: String,
    },
}

/// Process-local crystal cache. `observe` and `try_run` share it.
#[derive(Debug)]
pub struct MemoryCrystalCache {
    inner: Mutex<State>,
}

#[derive(Debug)]
struct State {
    buckets: Vec<Bucket>,
    crystals: Vec<Crystal>,
    /// Crystal ids whose last fast-path run hit a tool error.
    flagged: Vec<String>,
}

#[derive(Debug)]
struct Bucket {
    key: String,
    organism: String,
    intent: String,
    charter_generation: String,
    grants: Vec<Grant>,
    taint: Taint,
    prototype: Abstract,
    traces: Vec<Trace>,
    done: bool,
}

#[derive(Debug)]
struct Abstract {
    anchors: Vec<ContextAnchor>,
    pattern: Vec<PatternToken>,
    steps: Vec<StepTemplate>,
    say: Option<TextTemplate>,
    ui: Option<TemplateValue>,
}

impl Default for MemoryCrystalCache {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryCrystalCache {
    pub const fn new() -> Self {
        Self {
            inner: Mutex::new(State {
                buckets: Vec::new(),
                crystals: Vec::new(),
                flagged: Vec::new(),
            }),
        }
    }

    /// Crystals promoted so far, oldest first.
    pub fn crystals(&self) -> Vec<Crystal> {
        self.lock().crystals.clone()
    }

    /// Loads promoted crystals. Version 1 records, and any record without a
    /// charter generation or wording, are ignored so a wording-only key
    /// cannot skip the planner after a restart.
    pub fn import(&self, crystals: &[Crystal]) {
        let mut state = self.lock();
        for crystal in crystals {
            if crystal.version != TEMPLATE_VERSION {
                continue;
            }
            if crystal.charter_generation.is_empty() || crystal.wording.is_empty() {
                continue;
            }
            if state
                .crystals
                .iter()
                .any(|have| have.crystal_id == crystal.crystal_id)
            {
                continue;
            }
            state.crystals.push(crystal.clone());
        }
    }

    /// Crystals flagged for re-evolution after a tool error, first failure first.
    /// The crystal stays in the cache; the caller still takes the fluid path.
    pub fn flagged(&self) -> Vec<String> {
        self.lock().flagged.clone()
    }

    fn note_failure(&self, crystal_id: &str) {
        let mut state = self.lock();
        if !state.flagged.iter().any(|id| id == crystal_id) {
            state.flagged.push(crystal_id.to_string());
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[async_trait]
impl CrystalCache for MemoryCrystalCache {
    async fn try_run(
        &self,
        query: &CrystalQuery,
        tools: &dyn ToolInvoker,
    ) -> Option<Result<CrystalRun, XzError>> {
        let crystal = {
            let state = self.lock();
            let mut order: Vec<usize> = (0..state.crystals.len())
                .filter(|&i| matches_query(&state.crystals[i], query))
                .collect();
            order.sort_by(|&a, &b| {
                specificity(&state.crystals[b])
                    .cmp(&specificity(&state.crystals[a]))
                    .then(a.cmp(&b))
            });
            order.first().map(|&i| state.crystals[i].clone())
        }?;

        let mut outputs: Vec<Value> = Vec::new();
        let mut steps = Vec::with_capacity(crystal.plan.steps.len());
        for step in &crystal.plan.steps {
            let Some(args) = fill(&step.args, &outputs) else {
                self.note_failure(&crystal.crystal_id);
                return Some(Err(XzError::Other(
                    "crystal could not re-derive a tool argument".into(),
                )));
            };
            let call = ToolCall {
                tool: step.tool.clone(),
                args,
            };
            match tools.invoke(call.clone()).await {
                Ok(output) => {
                    outputs.push(output.content.clone());
                    steps.push(TraceStep {
                        call,
                        ok: true,
                        output: output.content,
                    });
                }
                Err(err) => {
                    self.note_failure(&crystal.crystal_id);
                    return Some(Err(err));
                }
            }
        }
        let say = match &crystal.plan.say {
            Some(text) => match fill_text(&text.parts, &outputs) {
                Some(text) => Some(text),
                None => {
                    self.note_failure(&crystal.crystal_id);
                    return Some(Err(XzError::Other(
                        "crystal could not re-derive its reply".into(),
                    )));
                }
            },
            None => None,
        };
        let ui = match &crystal.plan.ui {
            Some(template) => match fill_ui(template, &outputs) {
                Some(node) => Some(node),
                None => {
                    self.note_failure(&crystal.crystal_id);
                    return Some(Err(XzError::Other(
                        "crystal could not re-derive its canvas".into(),
                    )));
                }
            },
            None => None,
        };
        Some(Ok(CrystalRun {
            crystal_id: crystal.crystal_id,
            say,
            ui,
            steps,
        }))
    }

    async fn observe(&self, trace: &Trace) {
        if !trace.ok {
            return;
        }
        let Some(abs) = abstract_trace(trace) else {
            return;
        };
        let Some(key) = context_key(trace, &abs.anchors) else {
            return;
        };
        let mut state = self.lock();
        if let Some(idx) = state.buckets.iter().position(|b| b.key == key) {
            if state.buckets[idx].done {
                return;
            }
            if !replays(&state.buckets[idx].prototype, trace) {
                return;
            }
            state.buckets[idx].traces.push(trace.clone());
            if state.buckets[idx].traces.len() < RUNS_TO_PROMOTE {
                return;
            }
            state.buckets[idx].done = true;
            state.buckets[idx].traces.clear();
            let crystal = crystal_from(&state.buckets[idx], &key);
            state.crystals.push(crystal);
            return;
        }
        if !replays(&abs, trace) {
            return;
        }
        state.buckets.push(Bucket {
            key,
            organism: trace.organism.clone(),
            intent: wording(&trace.intent),
            charter_generation: trace.charter_generation.clone(),
            grants: canon_grants(&trace.grants),
            taint: trace.taint.clone(),
            prototype: abs,
            traces: vec![trace.clone()],
            done: false,
        });
    }
}

fn specificity(crystal: &Crystal) -> (usize, usize) {
    (crystal.anchors.len(), crystal.plan.steps.len())
}

fn crystal_from(bucket: &Bucket, key: &str) -> Crystal {
    let abs = &bucket.prototype;
    Crystal {
        version: TEMPLATE_VERSION,
        crystal_id: crystal_id(&bucket.organism, &abs.steps, key),
        organism: bucket.organism.clone(),
        wording: bucket.intent.clone(),
        charter_generation: bucket.charter_generation.clone(),
        grants: bucket.grants.clone(),
        anchors: abs.anchors.clone(),
        taint: bucket.taint.clone(),
        plan: PlanTemplate {
            version: TEMPLATE_VERSION,
            intent: bucket.intent.clone(),
            pattern: abs.pattern.clone(),
            slots: Vec::new(),
            steps: abs.steps.clone(),
            say: abs.say.clone(),
            ui: abs.ui.clone(),
        },
    }
}

fn crystal_id(organism: &str, steps: &[StepTemplate], key: &str) -> String {
    let tools = steps
        .iter()
        .map(|s| s.tool.as_str())
        .collect::<Vec<_>>()
        .join("+");
    format!(
        "crystal:{organism}:{tools}:v{TEMPLATE_VERSION}:{:016x}",
        fnv1a64(key)
    )
}

fn fnv1a64(data: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in data.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[derive(Serialize)]
struct Key<'a> {
    version: u32,
    organism: &'a str,
    wording: &'a str,
    charter_generation: &'a str,
    grants: &'a [Grant],
    anchors: &'a [ContextAnchor],
    taint: &'a Taint,
}

fn wording(intent: &str) -> String {
    intent.trim().to_string()
}

/// Organism, charter, grants, untyped plan-choosing values, taint and wording.
/// Tool results and the tool skeleton are not in this key.
fn context_key(trace: &Trace, anchors: &[ContextAnchor]) -> Option<String> {
    let grants = canon_grants(&trace.grants);
    let wording = wording(&trace.intent);
    serde_json::to_string(&Key {
        version: TEMPLATE_VERSION,
        organism: &trace.organism,
        wording: &wording,
        charter_generation: &trace.charter_generation,
        grants: &grants,
        anchors,
        taint: &trace.taint,
    })
    .ok()
}

fn canon_grants(grants: &[Grant]) -> Vec<Grant> {
    let mut grants = grants.to_vec();
    for grant in &mut grants {
        grant.resources.sort();
    }
    grants.sort_by(|a, b| a.tool.cmp(&b.tool).then(a.resources.cmp(&b.resources)));
    grants.dedup();
    grants
}

fn matches_query(crystal: &Crystal, query: &CrystalQuery) -> bool {
    crystal.version == TEMPLATE_VERSION
        && crystal.organism == query.organism
        && crystal.charter_generation == query.charter_generation
        && crystal.taint == query.taint
        && crystal.wording == wording(&query.intent)
        && crystal.grants == canon_grants(&query.grants)
        && crystal
            .anchors
            .iter()
            .all(|anchor| query.anchors.iter().any(|have| have == anchor))
}

fn replays(abs: &Abstract, trace: &Trace) -> bool {
    if abs.steps.len() != trace.steps.len() {
        return false;
    }
    let mut outputs = Vec::new();
    for (step, recorded) in abs.steps.iter().zip(&trace.steps) {
        let Some(args) = fill(&step.args, &outputs) else {
            return false;
        };
        if step.tool != recorded.call.tool || args != recorded.call.args {
            return false;
        }
        outputs.push(recorded.output.clone());
    }
    true
}

struct Binding {
    step: u32,
    pointer: String,
    text: String,
}

fn abstract_trace(trace: &Trace) -> Option<Abstract> {
    let anchors = collect_anchors(&trace.intent, &trace.steps);
    let mut prior = Vec::new();
    let mut steps = Vec::with_capacity(trace.steps.len());
    for step in &trace.steps {
        steps.push(StepTemplate {
            tool: step.call.tool.clone(),
            args: templatize(&step.call.args, &prior),
        });
        prior.push(step.output.clone());
    }
    let bindings = output_bindings(&trace.steps);
    let say = trace
        .say
        .as_ref()
        .map(|text| templatize_prose(text, &bindings));
    let ui = trace
        .ui
        .as_ref()
        .and_then(|node| templatize_ui(node, trace, &bindings));
    Some(Abstract {
        anchors,
        pattern: split_words(&trace.intent)
            .into_iter()
            .map(|word| PatternToken::Word { text: word })
            .collect(),
        steps,
        say,
        ui,
    })
}

fn collect_anchors(intent: &str, steps: &[TraceStep]) -> Vec<ContextAnchor> {
    let mut anchors = BTreeSet::new();
    let mut prior = Vec::new();
    for step in steps {
        walk_anchors(
            &step.call.tool,
            &step.call.args,
            intent,
            &prior,
            &mut anchors,
        );
        prior.push(step.output.clone());
    }
    anchors.into_iter().collect()
}

fn walk_anchors(
    tool: &str,
    value: &Value,
    intent: &str,
    prior: &[Value],
    out: &mut BTreeSet<ContextAnchor>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                walk_anchors(tool, item, intent, prior, out);
            }
        }
        Value::Object(map) => {
            for (key, child) in map {
                if let Some(text) = child.as_str() {
                    if let Some(field) = anchor_field(tool, key) {
                        if !text.is_empty()
                            && !intent.contains(text)
                            && find_exact(prior, text).is_none()
                        {
                            out.insert(ContextAnchor {
                                field: field.into(),
                                value: text.into(),
                            });
                        }
                    }
                }
                walk_anchors(tool, child, intent, prior, out);
            }
        }
        _ => {}
    }
}

fn anchor_field(tool: &str, key: &str) -> Option<&'static str> {
    match key {
        "root" | "search_root" | "folder" | "cwd" => Some("root"),
        "dest" | "destination" => Some("destination"),
        "recipient" => Some("recipient"),
        "account" => Some("account"),
        "to" if destination_tool(tool) => Some("destination"),
        "to" => Some("recipient"),
        _ => None,
    }
}

fn destination_tool(tool: &str) -> bool {
    tool == "fs.move" || tool == "fs.copy" || tool.ends_with(".move") || tool.ends_with(".copy")
}

fn templatize(value: &Value, prior: &[Value]) -> TemplateValue {
    match value {
        Value::Null => TemplateValue::Null,
        Value::Bool(v) => TemplateValue::Bool { value: *v },
        Value::Number(n) => TemplateValue::Number { value: n.clone() },
        Value::String(text) => match find_exact(prior, text) {
            Some((step, pointer)) => TemplateValue::FromOutput { step, pointer },
            None => TemplateValue::String {
                value: text.clone(),
            },
        },
        Value::Array(items) => TemplateValue::Array {
            items: items.iter().map(|item| templatize(item, prior)).collect(),
        },
        Value::Object(map) => TemplateValue::Object {
            fields: sorted_fields(map, prior),
        },
    }
}

fn sorted_fields(map: &Map<String, Value>, prior: &[Value]) -> Vec<Field> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    keys.into_iter()
        .map(|key| Field {
            name: key.clone(),
            value: templatize(&map[key], prior),
        })
        .collect()
}

fn templatize_ui(node: &Node, trace: &Trace, bindings: &[Binding]) -> Option<TemplateValue> {
    let value = serde_json::to_value(node).ok()?;
    let template = templatize_text_tree(&value, bindings);
    let outputs: Vec<Value> = trace.steps.iter().map(|step| step.output.clone()).collect();
    let filled = fill(&template, &outputs)?;
    let back: Node = serde_json::from_value(filled).ok()?;
    (back == *node).then_some(template)
}

fn templatize_text_tree(value: &Value, bindings: &[Binding]) -> TemplateValue {
    match value {
        Value::Null => TemplateValue::Null,
        Value::Bool(v) => TemplateValue::Bool { value: *v },
        Value::Number(n) => TemplateValue::Number { value: n.clone() },
        Value::String(text) => templatize_string_value(text, bindings),
        Value::Array(items) => TemplateValue::Array {
            items: items
                .iter()
                .map(|item| templatize_text_tree(item, bindings))
                .collect(),
        },
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            TemplateValue::Object {
                fields: keys
                    .into_iter()
                    .map(|key| Field {
                        name: key.clone(),
                        value: templatize_text_tree(&map[key], bindings),
                    })
                    .collect(),
            }
        }
    }
}

fn templatize_string_value(text: &str, bindings: &[Binding]) -> TemplateValue {
    match split_by_bindings(text, bindings).as_slice() {
        [] => TemplateValue::String {
            value: String::new(),
        },
        [TextPart::Lit { text }] => TemplateValue::String {
            value: text.clone(),
        },
        [TextPart::FromOutput { step, pointer }] => TemplateValue::FromOutput {
            step: *step,
            pointer: pointer.clone(),
        },
        parts => TemplateValue::Text {
            parts: parts.to_vec(),
        },
    }
}

fn templatize_prose(text: &str, bindings: &[Binding]) -> TextTemplate {
    TextTemplate {
        parts: split_by_bindings(text, bindings),
    }
}

fn output_bindings(steps: &[TraceStep]) -> Vec<Binding> {
    let mut bindings = Vec::new();
    for (index, step) in steps.iter().enumerate() {
        collect_bindings(index as u32, &step.output, "", &mut bindings);
    }
    bindings.retain(|binding| binding.text.chars().count() >= 4);
    bindings.sort_by(|a, b| b.text.len().cmp(&a.text.len()).then(a.text.cmp(&b.text)));
    bindings
}

fn collect_bindings(step: u32, value: &Value, pointer: &str, out: &mut Vec<Binding>) {
    match value {
        Value::String(text) if !text.is_empty() => out.push(Binding {
            step,
            pointer: pointer.to_string(),
            text: text.clone(),
        }),
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                collect_bindings(step, item, &format!("{pointer}/{index}"), out);
            }
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                collect_bindings(
                    step,
                    &map[key],
                    &format!("{pointer}/{}", escape_pointer(key)),
                    out,
                );
            }
        }
        _ => {}
    }
}

fn find_exact(prior: &[Value], text: &str) -> Option<(u32, String)> {
    if text.is_empty() {
        return None;
    }
    for (index, output) in prior.iter().enumerate() {
        let mut found = Vec::new();
        collect_bindings(index as u32, output, "", &mut found);
        if let Some(hit) = found.into_iter().find(|binding| binding.text == text) {
            return Some((hit.step, hit.pointer));
        }
    }
    None
}

fn escape_pointer(text: &str) -> String {
    text.replace('~', "~0").replace('/', "~1")
}

fn split_by_bindings(input: &str, bindings: &[Binding]) -> Vec<TextPart> {
    let mut parts = Vec::new();
    let mut literal = String::new();
    let mut index = 0;
    while index < input.len() {
        let rest = &input[index..];
        let found = bindings
            .iter()
            .filter(|binding| !binding.text.is_empty() && rest.starts_with(&binding.text))
            .max_by(|a, b| a.text.len().cmp(&b.text.len()).then(b.step.cmp(&a.step)));
        if let Some(binding) = found {
            if !literal.is_empty() {
                parts.push(TextPart::Lit {
                    text: std::mem::take(&mut literal),
                });
            }
            parts.push(TextPart::FromOutput {
                step: binding.step,
                pointer: binding.pointer.clone(),
            });
            index += binding.text.len();
        } else {
            let ch = rest.chars().next().unwrap_or('\0');
            if ch == '\0' {
                break;
            }
            literal.push(ch);
            index += ch.len_utf8();
        }
    }
    if !literal.is_empty() {
        parts.push(TextPart::Lit { text: literal });
    }
    parts
}

fn split_words(intent: &str) -> Vec<String> {
    intent.split_whitespace().map(str::to_string).collect()
}

fn fill_text(parts: &[TextPart], outputs: &[Value]) -> Option<String> {
    let mut out = String::new();
    for part in parts {
        match part {
            TextPart::Lit { text } => out.push_str(text),
            TextPart::Slot { .. } => return None,
            TextPart::FromOutput { step, pointer } => {
                let value = outputs.get(*step as usize)?.pointer(pointer)?;
                out.push_str(value.as_str()?);
            }
        }
    }
    Some(out)
}

fn fill_ui(template: &TemplateValue, outputs: &[Value]) -> Option<Node> {
    serde_json::from_value(fill(template, outputs)?).ok()
}

fn fill(template: &TemplateValue, outputs: &[Value]) -> Option<Value> {
    Some(match template {
        TemplateValue::Null => Value::Null,
        TemplateValue::Bool { value } => Value::Bool(*value),
        TemplateValue::Number { value } => Value::Number(value.clone()),
        TemplateValue::String { value } => Value::String(value.clone()),
        TemplateValue::Slot { .. } => return None,
        TemplateValue::FromOutput { step, pointer } => {
            outputs.get(*step as usize)?.pointer(pointer)?.clone()
        }
        TemplateValue::Text { parts } => Value::String(fill_text(parts, outputs)?),
        TemplateValue::Array { items } => Value::Array(
            items
                .iter()
                .map(|item| fill(item, outputs))
                .collect::<Option<_>>()?,
        ),
        TemplateValue::Object { fields } => {
            let mut map = Map::new();
            for field in fields {
                map.insert(field.name.clone(), fill(&field.value, outputs)?);
            }
            Value::Object(map)
        }
    })
}

impl Crystal {
    /// The plan as diffable text. This is the template, not a QuickJS program.
    pub fn source(&self) -> String {
        let mut lines = vec![
            format!("version: {}", self.version),
            format!("id: {}", self.crystal_id),
            format!("organism: {}", self.organism),
            format!("wording: {}", self.wording),
            format!("charter: {}", self.charter_generation),
            format!(
                "grants: {}",
                self.grants
                    .iter()
                    .map(|grant| grant.tool.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            format!(
                "taint: {}",
                if self.taint.is_clean() {
                    "clean".to_string()
                } else {
                    self.taint
                        .sources
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(",")
                }
            ),
            format!("intent: {}", self.plan.intent),
            format!("pattern: {}", render_pattern(&self.plan.pattern)),
        ];
        for anchor in &self.anchors {
            lines.push(format!("anchor {}: {}", anchor.field, anchor.value));
        }
        for (id, slot) in self.plan.slots.iter().enumerate() {
            lines.push(format!("slot {id}: {slot}"));
        }
        for step in &self.plan.steps {
            lines.push(format!(
                "step: {} {}",
                step.tool,
                render_template(&step.args)
            ));
        }
        if let Some(say) = &self.plan.say {
            lines.push(format!("say: {}", render_parts(&say.parts)));
        }
        if let Some(ui) = &self.plan.ui {
            lines.push(format!("ui: {}", render_template(ui)));
        }
        lines.join("\n")
    }
}

/// Line diff of two crystals' [`Crystal::source`] text.
pub fn diff(before: &Crystal, after: &Crystal) -> String {
    format!(
        "--- {}\n+++ {}\n{}",
        before.crystal_id,
        after.crystal_id,
        line_diff(&before.source(), &after.source())
    )
}

fn render_pattern(pattern: &[PatternToken]) -> String {
    pattern
        .iter()
        .map(|token| match token {
            PatternToken::Word { text } => text.clone(),
            PatternToken::Slot { id, .. } => format!("{{{id}}}"),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn render_parts(parts: &[TextPart]) -> String {
    let mut out = String::new();
    for part in parts {
        match part {
            TextPart::Lit { text } => out.push_str(text),
            TextPart::Slot { id } => out.push_str(&format!("{{{id}}}")),
            TextPart::FromOutput { step, pointer } => {
                out.push_str(&format!("<out {step} {pointer}>"));
            }
        }
    }
    out
}

fn render_template(value: &TemplateValue) -> String {
    match value {
        TemplateValue::Null => "null".to_string(),
        TemplateValue::Bool { value } => value.to_string(),
        TemplateValue::Number { value } => value.to_string(),
        TemplateValue::String { value } => {
            serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
        }
        TemplateValue::Slot { id } => format!("{{{id}}}"),
        TemplateValue::FromOutput { step, pointer } => format!("<out {step} {pointer}>"),
        TemplateValue::Text { parts } => render_parts(parts),
        TemplateValue::Array { items } => {
            let inner = items
                .iter()
                .map(render_template)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{inner}]")
        }
        TemplateValue::Object { fields } => {
            let inner = fields
                .iter()
                .map(|field| {
                    let name = serde_json::to_string(&field.name).unwrap_or_default();
                    format!("{name}:{}", render_template(&field.value))
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{inner}}}")
        }
    }
}

fn line_diff(before: &str, after: &str) -> String {
    let left: Vec<&str> = before.lines().collect();
    let right: Vec<&str> = after.lines().collect();
    let mut score = vec![vec![0usize; right.len() + 1]; left.len() + 1];
    for i in (0..left.len()).rev() {
        for j in (0..right.len()).rev() {
            score[i][j] = if left[i] == right[j] {
                score[i + 1][j + 1] + 1
            } else {
                score[i + 1][j].max(score[i][j + 1])
            };
        }
    }
    let mut i = 0;
    let mut j = 0;
    let mut lines = Vec::new();
    while i < left.len() && j < right.len() {
        if left[i] == right[j] {
            lines.push(format!(" {}", left[i]));
            i += 1;
            j += 1;
        } else if score[i + 1][j] >= score[i][j + 1] {
            lines.push(format!("-{}", left[i]));
            i += 1;
        } else {
            lines.push(format!("+{}", right[j]));
            j += 1;
        }
    }
    while i < left.len() {
        lines.push(format!("-{}", left[i]));
        i += 1;
    }
    while j < right.len() {
        lines.push(format!("+{}", right[j]));
        j += 1;
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use serde_json::{Value, json};
    use std::sync::Mutex;
    use xz_types::xui::Node;
    use xz_types::{
        ContextAnchor, CrystalQuery, Grant, Taint, ToolCall, ToolInvoker, ToolOutput, Trace,
        TraceStep, XzError,
    };

    fn grants() -> Vec<Grant> {
        vec![Grant {
            tool: "fs.*".into(),
            resources: vec![],
        }]
    }

    fn query(organism: &str, intent: &str) -> CrystalQuery {
        CrystalQuery {
            organism: organism.into(),
            intent: intent.into(),
            charter_generation: "gen".into(),
            grants: grants(),
            taint: Taint::none(),
            anchors: vec![ContextAnchor {
                field: "root".into(),
                value: "~".into(),
            }],
        }
    }

    fn trace(organism: &str, intent: &str, steps: &[(&str, Value, Value)]) -> Trace {
        Trace {
            organism: organism.into(),
            intent: intent.into(),
            steps: steps
                .iter()
                .map(|(tool, args, output)| TraceStep {
                    call: ToolCall {
                        tool: (*tool).into(),
                        args: args.clone(),
                    },
                    ok: true,
                    output: output.clone(),
                })
                .collect(),
            ok: true,
            say: None,
            ui: None,
            charter_generation: "gen".into(),
            grants: grants(),
            taint: Taint::none(),
        }
    }

    fn read_trace() -> Trace {
        let mut traced = trace(
            "notes",
            "read notes.txt",
            &[(
                "fs.read",
                json!({"path": "notes.txt", "mode": "keep", "n": 2}),
                json!({"bytes": 3}),
            )],
        );
        traced.say = Some("opened notes.txt".into());
        traced.ui = Some(Node::Text {
            text: "file notes.txt".into(),
        });
        traced
    }

    struct Mock {
        fail_at: Option<usize>,
        outputs: Vec<Value>,
        seen: Mutex<Vec<ToolCall>>,
    }

    impl Mock {
        fn new(outputs: Vec<Value>) -> Self {
            Self {
                fail_at: None,
                outputs,
                seen: Mutex::new(Vec::new()),
            }
        }

        fn failing(at: usize) -> Self {
            Self {
                fail_at: Some(at),
                outputs: Vec::new(),
                seen: Mutex::new(Vec::new()),
            }
        }

        fn seen(&self) -> Vec<ToolCall> {
            self.seen.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }
    }

    #[async_trait]
    impl ToolInvoker for Mock {
        async fn invoke(&self, call: ToolCall) -> Result<ToolOutput, XzError> {
            let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
            let index = seen.len();
            seen.push(call);
            if self.fail_at == Some(index) {
                return Err(XzError::Other("tool failed".into()));
            }
            let content = self.outputs.get(index).cloned().unwrap_or(Value::Null);
            Ok(ToolOutput::clean(content))
        }
    }

    async fn observe_same(cache: &MemoryCrystalCache, n: usize) {
        for _ in 0..n {
            cache.observe(&read_trace()).await;
        }
    }

    #[tokio::test]
    async fn four_traces_do_not_promote_the_fifth_does() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 4).await;
        assert!(cache.crystals().is_empty());
        assert!(
            cache
                .try_run(&query("notes", "read notes.txt"), &Mock::new(vec![]))
                .await
                .is_none()
        );

        cache.observe(&read_trace()).await;
        let crystals = cache.crystals();
        assert_eq!(crystals.len(), 1);
        assert_eq!(crystals[0].version, TEMPLATE_VERSION);
        assert_eq!(crystals[0].wording, "read notes.txt");
        assert_eq!(crystals[0].charter_generation, "gen");
        assert!(
            crystals[0]
                .crystal_id
                .starts_with("crystal:notes:fs.read:v2:")
        );

        let again = MemoryCrystalCache::new();
        observe_same(&again, 5).await;
        assert_eq!(again.crystals()[0].crystal_id, crystals[0].crystal_id);

        let json = serde_json::to_string(&crystals[0]).unwrap();
        let back: Crystal = serde_json::from_str(&json).unwrap();
        assert_eq!(back, crystals[0]);
    }

    #[tokio::test]
    async fn a_failed_trace_does_not_count() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 4).await;
        let mut failed = read_trace();
        failed.ok = false;
        cache.observe(&failed).await;
        assert!(cache.crystals().is_empty());
        cache.observe(&read_trace()).await;
        assert_eq!(cache.crystals().len(), 1);
    }

    #[tokio::test]
    async fn different_tool_order_does_not_match() {
        let cache = MemoryCrystalCache::new();
        for _ in 0..4 {
            cache
                .observe(&trace(
                    "notes",
                    "copy notes.txt",
                    &[
                        ("fs.read", json!({"path": "notes.txt"}), json!("read")),
                        ("fs.write", json!({"path": "notes.txt"}), json!("wrote")),
                    ],
                ))
                .await;
        }
        cache
            .observe(&trace(
                "notes",
                "copy notes.txt",
                &[
                    ("fs.write", json!({"path": "notes.txt"}), json!("wrote")),
                    ("fs.read", json!({"path": "notes.txt"}), json!("read")),
                ],
            ))
            .await;
        assert!(cache.crystals().is_empty());

        cache
            .observe(&trace(
                "notes",
                "copy notes.txt",
                &[
                    ("fs.read", json!({"path": "notes.txt"}), json!("read")),
                    ("fs.write", json!({"path": "notes.txt"}), json!("wrote")),
                ],
            ))
            .await;
        assert_eq!(cache.crystals().len(), 1);

        let mock = Mock::new(vec![json!("read"), json!("wrote")]);
        let run = cache
            .try_run(&query("notes", "copy notes.txt"), &mock)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.tool, "fs.read");
        assert_eq!(run.steps[1].call.tool, "fs.write");
        assert_eq!(run.steps[0].call.args, json!({"path": "notes.txt"}));
        assert!(
            cache
                .try_run(&query("notes", "copy other.txt"), &Mock::new(vec![]))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn the_same_command_and_context_replays_tools() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 5).await;
        let mock = Mock::new(vec![json!({"bytes": 9})]);
        let run = cache
            .try_run(&query("notes", "read notes.txt"), &mock)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.crystal_id, cache.crystals()[0].crystal_id);
        assert_eq!(
            run.steps[0].call.args,
            json!({"path": "notes.txt", "mode": "keep", "n": 2})
        );
        assert_eq!(run.say.as_deref(), Some("opened notes.txt"));
        assert_eq!(
            run.ui,
            Some(Node::Text {
                text: "file notes.txt".into()
            })
        );
        assert_eq!(mock.seen().len(), 1);
    }

    #[tokio::test]
    async fn similar_words_or_a_different_file_do_not_skip() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 5).await;
        for intent in [
            "read other.txt",
            "please read notes.txt now",
            "the notes mention notes.txt",
        ] {
            assert!(
                cache
                    .try_run(&query("notes", intent), &Mock::new(vec![]))
                    .await
                    .is_none(),
                "{intent}"
            );
        }
        assert!(
            cache
                .try_run(&query("other", "read notes.txt"), &Mock::new(vec![]))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn charter_grants_and_taint_must_match() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 5).await;

        let mut other_charter = query("notes", "read notes.txt");
        other_charter.charter_generation = "later".into();
        assert!(
            cache
                .try_run(&other_charter, &Mock::new(vec![]))
                .await
                .is_none()
        );

        let mut other_grants = query("notes", "read notes.txt");
        other_grants.grants = vec![Grant {
            tool: "fs.read".into(),
            resources: vec!["~/Private/**".into()],
        }];
        assert!(
            cache
                .try_run(&other_grants, &Mock::new(vec![]))
                .await
                .is_none()
        );

        let mut tainted = query("notes", "read notes.txt");
        tainted.taint = Taint::from_source("msg:sms");
        assert!(cache.try_run(&tainted, &Mock::new(vec![])).await.is_none());
    }

    #[tokio::test]
    async fn an_untyped_search_root_is_part_of_the_key() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let path = format!("/tmp/f{i}.bin");
            let mut traced = trace(
                "files",
                "find the largest files",
                &[(
                    "fs.search",
                    json!({"root": "~", "sort": "size", "limit": 10}),
                    json!({"matches": [{"path": path}]}),
                )],
            );
            traced.say = Some(format!("Largest files:\n{path}"));
            cache.observe(&traced).await;
        }
        assert_eq!(cache.crystals().len(), 1);
        let stored = serde_json::to_string(&cache.crystals()[0]).unwrap();
        assert!(!stored.contains("/tmp/f0.bin"), "{stored}");
        assert!(
            cache.crystals()[0]
                .anchors
                .iter()
                .any(|anchor| { anchor.field == "root" && anchor.value == "~" })
        );

        let mock = Mock::new(vec![json!({"matches": [{"path": "/tmp/new.bin"}]})]);
        let run = cache
            .try_run(&query("files", "find the largest files"), &mock)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.args["root"], json!("~"));
        assert_eq!(run.say.as_deref(), Some("Largest files:\n/tmp/new.bin"));

        let mut downloads = query("files", "find the largest files");
        downloads.anchors = vec![ContextAnchor {
            field: "root".into(),
            value: "~/Downloads".into(),
        }];
        assert!(
            cache
                .try_run(&downloads, &Mock::new(vec![]))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn a_folder_the_plan_chose_does_not_match_home() {
        let cache = MemoryCrystalCache::new();
        for _ in 0..5 {
            cache
                .observe(&trace(
                    "files",
                    "find the documents",
                    &[(
                        "fs.search",
                        json!({"root": "~/Downloads", "name_glob": "*.docx"}),
                        json!({"matches": []}),
                    )],
                ))
                .await;
        }
        assert_eq!(cache.crystals().len(), 1);
        assert!(
            cache.crystals()[0]
                .anchors
                .iter()
                .any(|anchor| anchor.field == "root" && anchor.value == "~/Downloads")
        );
        assert!(
            cache
                .try_run(&query("files", "find the documents"), &Mock::new(vec![]))
                .await
                .is_none()
        );
        let mut there = query("files", "find the documents");
        there.anchors.push(ContextAnchor {
            field: "root".into(),
            value: "~/Downloads".into(),
        });
        assert!(
            cache
                .try_run(&there, &Mock::new(vec![json!({"matches": []})]))
                .await
                .unwrap()
                .is_ok()
        );
    }

    #[tokio::test]
    async fn tool_results_do_not_keep_log_a_glass_from_hitting() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            cache
                .observe(&trace(
                    "hydrate",
                    "log a glass",
                    &[(
                        "engram.kv_write",
                        json!({"key": "day/2026-10-07", "value": {"glasses": 1}}),
                        json!({"stored": i}),
                    )],
                ))
                .await;
        }
        assert_eq!(cache.crystals().len(), 1);
        let stored = serde_json::to_string(&cache.crystals()[0]).unwrap();
        assert!(!stored.contains("\"stored\""), "{stored}");
        let run = cache
            .try_run(
                &query("hydrate", "log a glass"),
                &Mock::new(vec![json!({"stored": 99})]),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.args["key"], json!("day/2026-10-07"));
        assert_eq!(run.steps[0].output, json!({"stored": 99}));
    }

    #[tokio::test]
    async fn tool_returned_paths_are_rederived_not_frozen() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let path = format!("/home/a{i}.pdf");
            cache
                .observe(&trace(
                    "files",
                    "file the invoices",
                    &[
                        (
                            "fs.search",
                            json!({"root": "~", "contains": "invoice"}),
                            json!({"matches": [{"path": path}]}),
                        ),
                        (
                            "fs.move",
                            json!({"from": path, "to": "~/Taxes 2026"}),
                            json!({"ok": true}),
                        ),
                    ],
                ))
                .await;
        }
        let crystal = &cache.crystals()[0];
        let stored = serde_json::to_string(crystal).unwrap();
        assert!(!stored.contains("/home/a0.pdf"), "{stored}");
        assert!(
            stored.contains("<out")
                || stored.contains("FromOutput")
                || stored.contains("from_output"),
            "{stored}"
        );
        assert!(
            crystal
                .anchors
                .iter()
                .any(|anchor| anchor.field == "destination" && anchor.value == "~/Taxes 2026")
        );

        let mut home_only = query("files", "file the invoices");
        assert!(
            cache
                .try_run(&home_only, &Mock::new(vec![]))
                .await
                .is_none()
        );

        home_only.anchors.push(ContextAnchor {
            field: "destination".into(),
            value: "~/Taxes 2026".into(),
        });
        let mock = Mock::new(vec![
            json!({"matches": [{"path": "/home/fresh.pdf"}]}),
            json!({"ok": true}),
        ]);
        let run = cache.try_run(&home_only, &mock).await.unwrap().unwrap();
        assert_eq!(run.steps[1].call.args["from"], json!("/home/fresh.pdf"));
        assert_eq!(run.steps[1].call.args["to"], json!("~/Taxes 2026"));
        assert_eq!(mock.seen()[0].tool, "fs.search");
        assert_eq!(mock.seen()[1].tool, "fs.move");
    }

    #[tokio::test]
    async fn a_typed_recipient_stays_in_the_wording() {
        let cache = MemoryCrystalCache::new();
        for _ in 0..5 {
            cache
                .observe(&trace(
                    "mail",
                    "send good morning to bob",
                    &[(
                        "mail.send",
                        json!({"body": "good morning", "to": "bob"}),
                        json!(true),
                    )],
                ))
                .await;
        }
        assert!(
            cache.crystals()[0].anchors.is_empty(),
            "{:?}",
            cache.crystals()[0].anchors
        );
        let run = cache
            .try_run(
                &query("mail", "send good morning to bob"),
                &Mock::new(vec![json!(true)]),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.args["to"], json!("bob"));
        assert!(
            cache
                .try_run(
                    &query("mail", "send good morning to ada"),
                    &Mock::new(vec![])
                )
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn an_untyped_account_must_match() {
        let cache = MemoryCrystalCache::new();
        for _ in 0..5 {
            cache
                .observe(&trace(
                    "mail",
                    "list mail",
                    &[("mail.list", json!({"account": "work"}), json!({"rows": []}))],
                ))
                .await;
        }
        assert!(
            cache.crystals()[0]
                .anchors
                .iter()
                .any(|anchor| anchor.field == "account" && anchor.value == "work")
        );
        assert!(
            cache
                .try_run(&query("mail", "list mail"), &Mock::new(vec![]))
                .await
                .is_none()
        );
        let mut work = query("mail", "list mail");
        work.anchors.push(ContextAnchor {
            field: "account".into(),
            value: "work".into(),
        });
        assert!(
            cache
                .try_run(&work, &Mock::new(vec![json!({"rows": []})]))
                .await
                .unwrap()
                .is_ok()
        );
    }

    #[tokio::test]
    async fn a_tool_error_flags_the_crystal_and_keeps_it() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 5).await;
        let id = cache.crystals()[0].crystal_id.clone();
        let failed = cache
            .try_run(&query("notes", "read notes.txt"), &Mock::failing(0))
            .await;
        assert!(matches!(failed, Some(Err(_))));
        assert_eq!(cache.flagged(), vec![id.clone()]);
        assert_eq!(cache.crystals().len(), 1);
        let ok = cache
            .try_run(
                &query("notes", "read notes.txt"),
                &Mock::new(vec![json!(1)]),
            )
            .await;
        assert!(matches!(ok, Some(Ok(_))));
    }

    #[tokio::test]
    async fn import_keeps_the_context_key_and_drops_the_old_one() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 5).await;
        let crystal = cache.crystals()[0].clone();

        let fresh = MemoryCrystalCache::new();
        fresh.import(std::slice::from_ref(&crystal));
        assert_eq!(fresh.crystals().len(), 1);
        assert!(
            fresh
                .try_run(
                    &query("notes", "read notes.txt"),
                    &Mock::new(vec![json!(1)])
                )
                .await
                .unwrap()
                .is_ok()
        );

        let mut version_one = crystal.clone();
        version_one.version = 1;
        version_one.crystal_id = "crystal:notes:fs.read:v1:old".into();
        let rejected = MemoryCrystalCache::new();
        rejected.import(&[version_one]);
        assert!(rejected.crystals().is_empty());
        assert!(
            rejected
                .try_run(&query("notes", "read notes.txt"), &Mock::new(vec![]))
                .await
                .is_none()
        );

        let mut wording_only = crystal.clone();
        wording_only.charter_generation.clear();
        wording_only.crystal_id = "wording-only".into();
        rejected.import(&[wording_only]);
        assert!(rejected.crystals().is_empty());
    }

    #[tokio::test]
    async fn source_shows_the_context_key() {
        let cache = MemoryCrystalCache::new();
        observe_same(&cache, 5).await;
        let crystal = &cache.crystals()[0];
        let text = crystal.source();
        assert!(text.contains("wording: read notes.txt"), "{text}");
        assert!(text.contains("charter: gen"), "{text}");
        assert!(text.contains("step: fs.read"), "{text}");
        assert!(!text.contains("{0}"), "{text}");

        let mut other = crystal.clone();
        other.charter_generation = "later".into();
        other.crystal_id = "other".into();
        let delta = diff(crystal, &other);
        assert!(delta.contains("-charter: gen"), "{delta}");
        assert!(delta.contains("+charter: later"), "{delta}");
    }
}
