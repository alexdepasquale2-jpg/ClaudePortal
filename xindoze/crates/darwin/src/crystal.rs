//! In-memory crystal cache (SPEC §3.9).
//!
//! QuickJS synthesis is TODO(phase 3). Until then a crystal is a versioned
//! plan template: the tool names in order, argument JSON with slot holes,
//! and the intent skeleton those holes were copied from.
//!
//! A string argument becomes a slot when it is a run of whole words copied
//! out of the intent. Other JSON stays literal. Five successful traces with
//! the same organism, the same tool sequence, and the same skeleton promote
//! one crystal. `try_run` fills the holes from a new intent and invokes the
//! tools. Alignment failure is a miss (`None`); a tool error is `Some(Err)`.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;
use xz_types::xui::Node;
use xz_types::{CrystalCache, CrystalRun, ToolCall, ToolInvoker, Trace, TraceStep, XzError};

/// Plan-template format. Bump when the serialized shape changes.
pub const TEMPLATE_VERSION: u32 = 1;

/// Successful runs with one skeleton required before a crystal is promoted.
pub const RUNS_TO_PROMOTE: usize = 5;

/// A promoted crystal: a stable id plus the plan template it runs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crystal {
    pub version: u32,
    pub crystal_id: String,
    pub organism: String,
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
    /// A string that mixes literal text with slot holes (say / UI copy).
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
    Lit { text: String },
    Slot { id: u32 },
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
}

#[derive(Debug)]
struct Bucket {
    key: String,
    organism: String,
    intent: String,
    prototype: Abstract,
    traces: Vec<Trace>,
    done: bool,
}

#[derive(Debug)]
struct Abstract {
    pattern: Vec<PatternToken>,
    slots: Vec<String>,
    steps: Vec<StepTemplate>,
    say: Option<TextTemplate>,
    ui: Option<TemplateValue>,
}

#[derive(Clone, Debug)]
struct Word {
    text: String,
    start: usize,
    end: usize,
}

#[derive(Clone, Debug)]
struct Span {
    start: usize,
    end: usize,
    text: String,
    id: u32,
}

struct Binder {
    queues: BTreeMap<String, VecDeque<u32>>,
}

struct Prepared {
    crystal_id: String,
    say: Option<String>,
    ui: Option<Node>,
    calls: Vec<ToolCall>,
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
            }),
        }
    }

    /// Crystals promoted so far, oldest first.
    pub fn crystals(&self) -> Vec<Crystal> {
        self.lock().crystals.clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[async_trait]
impl CrystalCache for MemoryCrystalCache {
    async fn try_run(
        &self,
        organism: &str,
        intent: &str,
        tools: &dyn ToolInvoker,
    ) -> Option<Result<CrystalRun, XzError>> {
        let prepared = {
            let state = self.lock();
            let mut order: Vec<usize> = (0..state.crystals.len())
                .filter(|&i| state.crystals[i].organism == organism)
                .collect();
            order.sort_by(|&a, &b| {
                specificity(&state.crystals[b])
                    .cmp(&specificity(&state.crystals[a]))
                    .then(a.cmp(&b))
            });
            order
                .into_iter()
                .find_map(|i| prepare(&state.crystals[i], intent))
        }?;

        let mut steps = Vec::with_capacity(prepared.calls.len());
        for call in prepared.calls {
            // TODO(phase 3): a failed postcondition flags the crystal for re-evolution.
            match tools.invoke(call.clone()).await {
                Ok(output) => steps.push(TraceStep {
                    call,
                    ok: true,
                    output: output.content,
                }),
                Err(err) => return Some(Err(err)),
            }
        }
        Some(Ok(CrystalRun {
            crystal_id: prepared.crystal_id,
            say: prepared.say,
            ui: prepared.ui,
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
        let Some(key) = signature_key(&trace.organism, &abs.pattern, &abs.steps) else {
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
            intent: trace.intent.clone(),
            prototype: abs,
            traces: vec![trace.clone()],
            done: false,
        });
    }
}

fn specificity(crystal: &Crystal) -> (usize, usize, usize) {
    let fixed = crystal
        .plan
        .pattern
        .iter()
        .filter(|t| matches!(t, PatternToken::Word { .. }))
        .count();
    (fixed, crystal.plan.slots.len(), crystal.plan.steps.len())
}

fn crystal_from(bucket: &Bucket, key: &str) -> Crystal {
    let abs = &bucket.prototype;
    Crystal {
        version: TEMPLATE_VERSION,
        crystal_id: crystal_id(&bucket.organism, &abs.steps, key),
        organism: bucket.organism.clone(),
        plan: PlanTemplate {
            version: TEMPLATE_VERSION,
            intent: bucket.intent.clone(),
            pattern: abs.pattern.clone(),
            slots: abs.slots.clone(),
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
struct Sig<'a> {
    version: u32,
    organism: &'a str,
    pattern: &'a [PatternToken],
    steps: &'a [StepTemplate],
}

fn signature_key(
    organism: &str,
    pattern: &[PatternToken],
    steps: &[StepTemplate],
) -> Option<String> {
    serde_json::to_string(&Sig {
        version: TEMPLATE_VERSION,
        organism,
        pattern,
        steps,
    })
    .ok()
}

fn replays(abs: &Abstract, trace: &Trace) -> bool {
    let Some(values) = align(&abs.pattern, &trace.intent) else {
        return false;
    };
    let Some(calls) = fill_calls(&abs.steps, &values) else {
        return false;
    };
    let recorded: Vec<ToolCall> = trace.steps.iter().map(|s| s.call.clone()).collect();
    calls == recorded
}

fn prepare(crystal: &Crystal, intent: &str) -> Option<Prepared> {
    let values = align(&crystal.plan.pattern, intent).or_else(|| loose(&crystal.plan, intent))?;
    if values.len() != crystal.plan.slots.len() {
        return None;
    }
    let say = match &crystal.plan.say {
        Some(text) => Some(fill_text(&text.parts, &values)?),
        None => None,
    };
    let ui = match &crystal.plan.ui {
        Some(template) => Some(fill_ui(template, &values)?),
        None => None,
    };
    Some(Prepared {
        crystal_id: crystal.crystal_id.clone(),
        say,
        ui,
        calls: fill_calls(&crystal.plan.steps, &values)?,
    })
}

/// The intent still contains every prototype slot value, so the stored
/// values can be filled without aligning a new skeleton. An empty slot
/// list does not match: that would hit every intent.
fn loose(plan: &PlanTemplate, intent: &str) -> Option<Vec<String>> {
    if plan.slots.is_empty() {
        return None;
    }
    plan.slots
        .iter()
        .all(|slot| !slot.is_empty() && intent.contains(slot.as_str()))
        .then(|| plan.slots.clone())
}

fn abstract_trace(trace: &Trace) -> Option<Abstract> {
    let words = split_words(&trace.intent);
    let strings = arg_strings(&trace.steps);
    let spans = place_spans(&trace.intent, &words, &strings);
    let pattern = pattern_from(&words, &spans);
    let mut slots = vec![String::new(); spans.len()];
    for span in &spans {
        let id = span.id as usize;
        if id >= slots.len() {
            return None;
        }
        slots[id] = span.text.clone();
    }
    let mut binder = Binder::from_spans(&spans);
    let steps = trace
        .steps
        .iter()
        .map(|step| StepTemplate {
            tool: step.call.tool.clone(),
            args: templatize(&step.call.args, &mut binder),
        })
        .collect();
    let pairs: Vec<(u32, &str)> = slots
        .iter()
        .enumerate()
        .map(|(i, text)| (i as u32, text.as_str()))
        .collect();
    let say = trace.say.as_ref().map(|text| TextTemplate {
        parts: split_by_slots(text, &pairs),
    });
    let ui = trace
        .ui
        .as_ref()
        .and_then(|node| templatize_ui(node, &pairs, &slots));
    Some(Abstract {
        pattern,
        slots,
        steps,
        say,
        ui,
    })
}

fn templatize_ui(node: &Node, pairs: &[(u32, &str)], slots: &[String]) -> Option<TemplateValue> {
    let value = serde_json::to_value(node).ok()?;
    let template = templatize_text_tree(&value, pairs);
    let filled = fill(&template, slots)?;
    let back: Node = serde_json::from_value(filled).ok()?;
    (back == *node).then_some(template)
}

fn arg_strings(steps: &[TraceStep]) -> Vec<String> {
    let mut out = Vec::new();
    for step in steps {
        collect_strings(&step.call.args, &mut out);
    }
    out
}

fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(text) if !text.is_empty() && !text.chars().all(char::is_whitespace) => {
            out.push(text.clone());
        }
        Value::Array(items) => {
            for item in items {
                collect_strings(item, out);
            }
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                collect_strings(&map[key], out);
            }
        }
        _ => {}
    }
}

fn place_spans(intent: &str, words: &[Word], args: &[String]) -> Vec<Span> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for arg in args {
        if arg.is_empty() || !intent.contains(arg.as_str()) {
            continue;
        }
        *counts.entry(arg.clone()).or_default() += 1;
    }
    let mut strings: Vec<String> = counts.keys().cloned().collect();
    strings.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));

    let mut claimed = vec![false; words.len()];
    let mut spans = Vec::new();
    for text in strings {
        let mut from = 0;
        let mut left = counts[&text];
        while left > 0 {
            let Some((start, end)) = find_span(intent, words, &text, &claimed, from) else {
                break;
            };
            for slot in &mut claimed[start..end] {
                *slot = true;
            }
            spans.push(Span {
                start,
                end,
                text: intent[words[start].start..words[end - 1].end].to_string(),
                id: 0,
            });
            from = end;
            left -= 1;
        }
    }
    spans.sort_by_key(|span| (span.start, span.end));
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id as u32;
    }
    spans
}

fn find_span(
    intent: &str,
    words: &[Word],
    slot: &str,
    claimed: &[bool],
    from: usize,
) -> Option<(usize, usize)> {
    for start in from..words.len() {
        if claimed[start] {
            continue;
        }
        for end in (start + 1)..=words.len() {
            if claimed[end - 1] {
                break;
            }
            let slice = &intent[words[start].start..words[end - 1].end];
            if slice == slot {
                return Some((start, end));
            }
            if slice.len() >= slot.len() {
                break;
            }
        }
    }
    None
}

fn pattern_from(words: &[Word], spans: &[Span]) -> Vec<PatternToken> {
    let mut tokens = Vec::new();
    let mut index = 0;
    let mut spans_at = 0;
    while index < words.len() {
        if spans_at < spans.len() && spans[spans_at].start == index {
            let span = &spans[spans_at];
            tokens.push(PatternToken::Slot {
                id: span.id,
                width: (span.end - span.start) as u32,
            });
            index = span.end;
            spans_at += 1;
        } else {
            tokens.push(PatternToken::Word {
                text: words[index].text.clone(),
            });
            index += 1;
        }
    }
    tokens
}

impl Binder {
    fn from_spans(spans: &[Span]) -> Self {
        let mut ordered = spans.to_vec();
        ordered.sort_by_key(|span| span.start);
        let mut queues: BTreeMap<String, VecDeque<u32>> = BTreeMap::new();
        for span in ordered {
            queues.entry(span.text).or_default().push_back(span.id);
        }
        Self { queues }
    }

    fn take(&mut self, text: &str) -> TemplateValue {
        let Some(queue) = self.queues.get_mut(text) else {
            return TemplateValue::String {
                value: text.to_string(),
            };
        };
        if queue.is_empty() {
            return TemplateValue::String {
                value: text.to_string(),
            };
        }
        let id = if queue.len() == 1 {
            queue[0]
        } else {
            queue.pop_front().unwrap_or(0)
        };
        TemplateValue::Slot { id }
    }
}

fn templatize(value: &Value, binder: &mut Binder) -> TemplateValue {
    match value {
        Value::Null => TemplateValue::Null,
        Value::Bool(v) => TemplateValue::Bool { value: *v },
        Value::Number(n) => TemplateValue::Number { value: n.clone() },
        Value::String(text) => binder.take(text),
        Value::Array(items) => TemplateValue::Array {
            items: items.iter().map(|item| templatize(item, binder)).collect(),
        },
        Value::Object(map) => TemplateValue::Object {
            fields: sorted_fields(map, binder),
        },
    }
}

fn sorted_fields(map: &Map<String, Value>, binder: &mut Binder) -> Vec<Field> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    keys.into_iter()
        .map(|key| Field {
            name: key.clone(),
            value: templatize(&map[key], binder),
        })
        .collect()
}

fn templatize_text_tree(value: &Value, slots: &[(u32, &str)]) -> TemplateValue {
    match value {
        Value::Null => TemplateValue::Null,
        Value::Bool(v) => TemplateValue::Bool { value: *v },
        Value::Number(n) => TemplateValue::Number { value: n.clone() },
        Value::String(text) => templatize_string_value(text, slots),
        Value::Array(items) => TemplateValue::Array {
            items: items
                .iter()
                .map(|item| templatize_text_tree(item, slots))
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
                        value: templatize_text_tree(&map[key], slots),
                    })
                    .collect(),
            }
        }
    }
}

fn templatize_string_value(text: &str, slots: &[(u32, &str)]) -> TemplateValue {
    match split_by_slots(text, slots).as_slice() {
        [] => TemplateValue::String {
            value: String::new(),
        },
        [TextPart::Lit { text }] => TemplateValue::String {
            value: text.clone(),
        },
        [TextPart::Slot { id }] => TemplateValue::Slot { id: *id },
        parts => TemplateValue::Text {
            parts: parts.to_vec(),
        },
    }
}

fn split_by_slots(input: &str, slots: &[(u32, &str)]) -> Vec<TextPart> {
    let mut parts = Vec::new();
    let mut literal = String::new();
    let mut index = 0;
    while index < input.len() {
        let rest = &input[index..];
        let found = slots
            .iter()
            .filter(|(_, text)| !text.is_empty() && rest.starts_with(text))
            .max_by(|a, b| a.1.len().cmp(&b.1.len()).then(b.0.cmp(&a.0)));
        if let Some((id, text)) = found {
            if !literal.is_empty() {
                parts.push(TextPart::Lit {
                    text: std::mem::take(&mut literal),
                });
            }
            parts.push(TextPart::Slot { id: *id });
            index += text.len();
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

fn split_words(intent: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut start: Option<usize> = None;
    for (index, ch) in intent.char_indices() {
        if ch.is_whitespace() {
            if let Some(from) = start.take() {
                words.push(Word {
                    text: intent[from..index].to_string(),
                    start: from,
                    end: index,
                });
            }
        } else if start.is_none() {
            start = Some(index);
        }
    }
    if let Some(from) = start {
        words.push(Word {
            text: intent[from..].to_string(),
            start: from,
            end: intent.len(),
        });
    }
    words
}

/// Fill `pattern` from `intent`.
///
/// Fixed words must match, in order. A hole that sits between two fixed
/// words takes the words between those anchors (one or more). A hole at the
/// end takes exactly its prototype width, so extra trailing words miss
/// instead of being glued onto the slot. Consecutive holes use the
/// prototype widths. The whole intent is consumed, or this returns `None`.
fn align(pattern: &[PatternToken], intent: &str) -> Option<Vec<String>> {
    let words = split_words(intent);
    let count = pattern
        .iter()
        .filter_map(|token| match token {
            PatternToken::Slot { id, .. } => Some(*id as usize + 1),
            PatternToken::Word { .. } => None,
        })
        .max()
        .unwrap_or(0);
    let mut slots = vec![None; count];
    if !walk(pattern, &words, intent, &mut slots) {
        return None;
    }
    slots.into_iter().collect()
}

fn walk(pat: &[PatternToken], words: &[Word], intent: &str, slots: &mut [Option<String>]) -> bool {
    if pat.is_empty() {
        return words.is_empty();
    }
    match &pat[0] {
        PatternToken::Word { text } => {
            words.first().is_some_and(|word| word.text == *text)
                && walk(&pat[1..], &words[1..], intent, slots)
        }
        PatternToken::Slot { id, width } => {
            let id = *id as usize;
            if id >= slots.len() {
                return false;
            }
            if matches!(pat.get(1), Some(PatternToken::Word { .. })) {
                let Some(PatternToken::Word { text: next }) = pat.get(1) else {
                    return false;
                };
                for taken in 1..words.len() {
                    if words[taken].text != *next {
                        continue;
                    }
                    let previous = slots[id].clone();
                    slots[id] = Some(word_slice(intent, &words[..taken]));
                    if walk(&pat[1..], &words[taken..], intent, slots) {
                        return true;
                    }
                    slots[id] = previous;
                }
                false
            } else if matches!(pat.get(1), Some(PatternToken::Slot { .. })) {
                let width = *width as usize;
                if width == 0 || words.len() < width {
                    return false;
                }
                let previous = slots[id].clone();
                slots[id] = Some(word_slice(intent, &words[..width]));
                if walk(&pat[1..], &words[width..], intent, slots) {
                    true
                } else {
                    slots[id] = previous;
                    false
                }
            } else {
                let width = *width as usize;
                if width == 0 || words.len() != width {
                    return false;
                }
                slots[id] = Some(word_slice(intent, words));
                true
            }
        }
    }
}

fn word_slice(intent: &str, words: &[Word]) -> String {
    match words {
        [] => String::new(),
        [only] => intent[only.start..only.end].to_string(),
        [first, .., last] => intent[first.start..last.end].to_string(),
    }
}

fn fill_calls(steps: &[StepTemplate], values: &[String]) -> Option<Vec<ToolCall>> {
    steps
        .iter()
        .map(|step| {
            Some(ToolCall {
                tool: step.tool.clone(),
                args: fill(&step.args, values)?,
            })
        })
        .collect()
}

fn fill_text(parts: &[TextPart], values: &[String]) -> Option<String> {
    let mut out = String::new();
    for part in parts {
        match part {
            TextPart::Lit { text } => out.push_str(text),
            TextPart::Slot { id } => out.push_str(values.get(*id as usize)?),
        }
    }
    Some(out)
}

fn fill_ui(template: &TemplateValue, values: &[String]) -> Option<Node> {
    serde_json::from_value(fill(template, values)?).ok()
}

fn fill(template: &TemplateValue, values: &[String]) -> Option<Value> {
    Some(match template {
        TemplateValue::Null => Value::Null,
        TemplateValue::Bool { value } => Value::Bool(*value),
        TemplateValue::Number { value } => Value::Number(value.clone()),
        TemplateValue::String { value } => Value::String(value.clone()),
        TemplateValue::Slot { id } => Value::String(values.get(*id as usize)?.clone()),
        TemplateValue::Text { parts } => Value::String(fill_text(parts, values)?),
        TemplateValue::Array { items } => Value::Array(
            items
                .iter()
                .map(|item| fill(item, values))
                .collect::<Option<_>>()?,
        ),
        TemplateValue::Object { fields } => {
            let mut map = Map::new();
            for field in fields {
                map.insert(field.name.clone(), fill(&field.value, values)?);
            }
            Value::Object(map)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{align, *};
    use async_trait::async_trait;
    use serde_json::{Value, json};
    use std::sync::Mutex;
    use xz_types::xui::Node;
    use xz_types::{ToolCall, ToolInvoker, ToolOutput, Trace, TraceStep, XzError};

    fn trace(organism: &str, intent: &str, steps: &[(&str, Value)], ok: bool) -> Trace {
        Trace {
            organism: organism.into(),
            intent: intent.into(),
            steps: steps
                .iter()
                .map(|(tool, args)| TraceStep {
                    call: ToolCall {
                        tool: (*tool).into(),
                        args: args.clone(),
                    },
                    ok: true,
                    output: Value::Null,
                })
                .collect(),
            ok,
            say: None,
            ui: None,
        }
    }

    fn read_trace(i: u32) -> Trace {
        let name = format!("f{i}.txt");
        let mut traced = trace(
            "notes",
            &format!("read {name}"),
            &[("fs.read", json!({"path": name, "mode": "keep", "n": 2}))],
            true,
        );
        traced.say = Some(format!("opened {name}"));
        traced.ui = Some(Node::Text {
            text: format!("file {name}"),
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

    async fn observe_reads(cache: &MemoryCrystalCache, n: u32) {
        for i in 0..n {
            cache.observe(&read_trace(i)).await;
        }
    }

    #[tokio::test]
    async fn four_traces_do_not_promote_the_fifth_does() {
        let cache = MemoryCrystalCache::new();
        observe_reads(&cache, 4).await;
        assert!(cache.crystals().is_empty());
        assert!(
            cache
                .try_run("notes", "read zed.txt", &Mock::new(vec![]))
                .await
                .is_none()
        );

        cache.observe(&read_trace(4)).await;
        let crystals = cache.crystals();
        assert_eq!(crystals.len(), 1);
        assert_eq!(crystals[0].version, TEMPLATE_VERSION);
        assert_eq!(crystals[0].plan.version, TEMPLATE_VERSION);
        assert!(
            crystals[0]
                .crystal_id
                .starts_with("crystal:notes:fs.read:v1:")
        );

        let again = MemoryCrystalCache::new();
        observe_reads(&again, 5).await;
        assert_eq!(again.crystals()[0].crystal_id, crystals[0].crystal_id);

        let json = serde_json::to_string(&crystals[0]).unwrap();
        let back: Crystal = serde_json::from_str(&json).unwrap();
        assert_eq!(back, crystals[0]);
    }

    #[tokio::test]
    async fn a_failed_trace_does_not_count() {
        let cache = MemoryCrystalCache::new();
        observe_reads(&cache, 4).await;
        let mut failed = read_trace(9);
        failed.ok = false;
        cache.observe(&failed).await;
        assert!(cache.crystals().is_empty());
        cache.observe(&read_trace(4)).await;
        assert_eq!(cache.crystals().len(), 1);
    }

    #[tokio::test]
    async fn different_tool_order_does_not_match() {
        let cache = MemoryCrystalCache::new();
        for i in 0..4 {
            let name = format!("f{i}.txt");
            cache
                .observe(&trace(
                    "notes",
                    &format!("copy {name}"),
                    &[
                        ("fs.read", json!({"path": name})),
                        ("fs.write", json!({"path": name})),
                    ],
                    true,
                ))
                .await;
        }
        cache
            .observe(&trace(
                "notes",
                "copy other.txt",
                &[
                    ("fs.write", json!({"path": "other.txt"})),
                    ("fs.read", json!({"path": "other.txt"})),
                ],
                true,
            ))
            .await;
        assert!(cache.crystals().is_empty());

        cache
            .observe(&trace(
                "notes",
                "copy last.txt",
                &[
                    ("fs.read", json!({"path": "last.txt"})),
                    ("fs.write", json!({"path": "last.txt"})),
                ],
                true,
            ))
            .await;
        assert_eq!(cache.crystals().len(), 1);

        let mock = Mock::new(vec![json!("read"), json!("wrote")]);
        let run = cache
            .try_run("notes", "copy zed.txt", &mock)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.tool, "fs.read");
        assert_eq!(run.steps[1].call.tool, "fs.write");
        assert_eq!(run.steps[0].call.args, json!({"path": "zed.txt"}));
        assert_eq!(run.steps[1].call.args, json!({"path": "zed.txt"}));
    }

    #[tokio::test]
    async fn try_run_fills_slots_and_calls_tools() {
        let cache = MemoryCrystalCache::new();
        observe_reads(&cache, 5).await;
        let mock = Mock::new(vec![json!({"bytes": 3})]);
        let run = cache
            .try_run("notes", "read zed.txt", &mock)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(run.crystal_id, cache.crystals()[0].crystal_id);
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].call.tool, "fs.read");
        assert_eq!(
            run.steps[0].call.args,
            json!({"path": "zed.txt", "mode": "keep", "n": 2})
        );
        assert!(run.steps[0].ok);
        assert_eq!(run.steps[0].output, json!({"bytes": 3}));
        assert_eq!(run.say.as_deref(), Some("opened zed.txt"));
        assert_eq!(
            run.ui,
            Some(Node::Text {
                text: "file zed.txt".into()
            })
        );
        assert_eq!(mock.seen().len(), 1);
    }

    #[tokio::test]
    async fn bounded_slot_takes_the_new_words_between_anchors() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let body = format!("hello{i}");
            let to = format!("ada{i}");
            cache
                .observe(&trace(
                    "mail",
                    &format!("send {body} to {to}"),
                    &[("mail.send", json!({"body": body, "to": to}))],
                    true,
                ))
                .await;
        }
        let mock = Mock::new(vec![json!(true)]);
        let run = cache
            .try_run("mail", "send good morning to bob", &mock)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            run.steps[0].call.args,
            json!({"body": "good morning", "to": "bob"})
        );
    }

    #[tokio::test]
    async fn the_same_slot_text_in_two_places_fills_independently() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let name = format!("a{i}.txt");
            cache
                .observe(&trace(
                    "hash",
                    &format!("hash {name} and hash {name}"),
                    &[
                        ("h.hash", json!({"text": name})),
                        ("h.hash", json!({"text": name})),
                    ],
                    true,
                ))
                .await;
        }
        let mock = Mock::new(vec![json!(1), json!(2)]);
        let run = cache
            .try_run("hash", "hash b.txt and hash c.txt", &mock)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.args, json!({"text": "b.txt"}));
        assert_eq!(run.steps[1].call.args, json!({"text": "c.txt"}));
        assert_eq!(run.steps[0].output, json!(1));
        assert_eq!(run.steps[1].output, json!(2));
    }

    #[tokio::test]
    async fn repeated_slot_is_shared_when_the_intent_mentions_it_once() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let name = format!("a{i}.txt");
            cache
                .observe(&trace(
                    "hash",
                    &format!("hash {name} twice"),
                    &[
                        ("h.hash", json!({"text": name})),
                        ("h.hash", json!({"text": name})),
                    ],
                    true,
                ))
                .await;
        }
        let run = cache
            .try_run("hash", "hash b.txt twice", &Mock::new(vec![]))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.args, json!({"text": "b.txt"}));
        assert_eq!(run.steps[1].call.args, json!({"text": "b.txt"}));
    }

    #[tokio::test]
    async fn extra_words_reuse_slot_values_when_the_skeleton_remains() {
        let cache = MemoryCrystalCache::new();
        observe_reads(&cache, 5).await;
        let run = cache
            .try_run("notes", "please read f0.txt now", &Mock::new(vec![]))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.steps[0].call.args["path"], json!("f0.txt"));
        assert_eq!(run.steps[0].call.args["mode"], json!("keep"));

        let mentioned = cache
            .try_run("notes", "the notes mention f0.txt", &Mock::new(vec![]))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(mentioned.steps[0].call.args["path"], json!("f0.txt"));
    }

    #[tokio::test]
    async fn cannot_align_is_a_miss() {
        let cache = MemoryCrystalCache::new();
        observe_reads(&cache, 5).await;
        assert!(
            cache
                .try_run("notes", "delete the downloads", &Mock::new(vec![]))
                .await
                .is_none()
        );
        assert!(
            cache
                .try_run("other", "read zed.txt", &Mock::new(vec![]))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn nested_and_array_slots_fill() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let name = format!("n{i}.txt");
            cache
                .observe(&trace(
                    "notes",
                    &format!("pack {name}"),
                    &[(
                        "fs.pack",
                        json!({"file": {"path": name}, "also": [name, "literal"]}),
                    )],
                    true,
                ))
                .await;
        }
        let run = cache
            .try_run("notes", "pack zed.txt", &Mock::new(vec![]))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            run.steps[0].call.args,
            json!({"file": {"path": "zed.txt"}, "also": ["zed.txt", "literal"]})
        );
    }

    #[tokio::test]
    async fn a_tool_error_is_some_err() {
        let cache = MemoryCrystalCache::new();
        for i in 0..5 {
            let name = format!("f{i}.txt");
            cache
                .observe(&trace(
                    "notes",
                    &format!("copy {name}"),
                    &[
                        ("fs.read", json!({"path": name})),
                        ("fs.write", json!({"path": name})),
                    ],
                    true,
                ))
                .await;
        }
        let mock = Mock::failing(1);
        let result = cache.try_run("notes", "copy zed.txt", &mock).await;
        match result {
            Some(Err(err)) => assert!(err.to_string().contains("tool failed"), "{err}"),
            other => panic!("expected Some(Err), got {other:?}"),
        }
        assert_eq!(mock.seen().len(), 2);
        assert_eq!(mock.seen()[0].tool, "fs.read");
        assert_eq!(mock.seen()[1].tool, "fs.write");
        assert_eq!(cache.crystals().len(), 1);
    }

    #[test]
    fn align_is_deterministic_for_anchor_words() {
        let pattern = vec![
            PatternToken::Word {
                text: "send".into(),
            },
            PatternToken::Slot { id: 0, width: 1 },
            PatternToken::Word { text: "to".into() },
            PatternToken::Slot { id: 1, width: 1 },
        ];
        assert_eq!(
            align(&pattern, "send goodbye to bob"),
            Some(vec!["goodbye".into(), "bob".into()])
        );
        assert_eq!(
            align(&pattern, "send good morning to bob"),
            Some(vec!["good morning".into(), "bob".into()])
        );
        assert_eq!(align(&pattern, "send goodbye to bob please"), None);
        assert_eq!(align(&pattern, "please send goodbye to bob"), None);
    }
}
