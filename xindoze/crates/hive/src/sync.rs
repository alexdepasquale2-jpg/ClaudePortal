//! Engram sync: append-only events by `(device, seq)`, key-value last-writer-wins.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use xz_types::JournalEvent;

/// One key-value write, tagged with when and who so two devices can merge.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KvEntry {
    /// The stored JSON value.
    pub value: Value,
    /// Writer's clock, milliseconds. The greater timestamp wins.
    pub ts_ms: i64,
    /// Writer's device id (hex, or any stable id string).
    pub device: String,
}

/// Merges two append-only logs.
///
/// An event's identity is `(device, seq)`. The result keeps the first copy
/// of each key: every local event in its original order, then remote events
/// whose key was not already seen, in their original order. Duplicates
/// inside either slice collapse the same way. Merging the result with either
/// input again changes nothing.
#[must_use]
pub fn merge_events(local: &[JournalEvent], remote: &[JournalEvent]) -> Vec<JournalEvent> {
    let mut seen = HashSet::with_capacity(local.len() + remote.len());
    let mut out = Vec::with_capacity(local.len() + remote.len());
    for event in local.iter().chain(remote.iter()) {
        if seen.insert((event.device.clone(), event.seq)) {
            out.push(event.clone());
        }
    }
    out
}

/// Merges two key-value maps. Last writer wins.
///
/// For each key the entry with the greater `ts_ms` is kept. Equal timestamps
/// keep the entry whose `device` is greater in lexicographic order. If the
/// device is also equal, the local entry is kept. Keys present on only one
/// side are copied. Merging the result with either input again changes nothing.
#[must_use]
pub fn merge_kv(
    local: &BTreeMap<String, KvEntry>,
    remote: &BTreeMap<String, KvEntry>,
) -> BTreeMap<String, KvEntry> {
    let mut out = BTreeMap::new();
    let mut keys = BTreeSet::new();
    keys.extend(local.keys().map(String::as_str));
    keys.extend(remote.keys().map(String::as_str));
    for key in keys {
        let chosen = match (local.get(key), remote.get(key)) {
            (Some(left), Some(right)) => pick_lww(left, right),
            (Some(left), None) => left,
            (None, Some(right)) => right,
            (None, None) => unreachable!("key came from one of the maps"),
        };
        out.insert(key.to_string(), chosen.clone());
    }
    out
}

fn pick_lww<'a>(local: &'a KvEntry, remote: &'a KvEntry) -> &'a KvEntry {
    match local.ts_ms.cmp(&remote.ts_ms) {
        std::cmp::Ordering::Greater => local,
        std::cmp::Ordering::Less => remote,
        std::cmp::Ordering::Equal => match local.device.cmp(&remote.device) {
            std::cmp::Ordering::Less => remote,
            std::cmp::Ordering::Greater | std::cmp::Ordering::Equal => local,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use xz_types::{JournalEvent, Risk, Taint, Verdict};

    fn event(device: &str, seq: i64, summary: &str) -> JournalEvent {
        JournalEvent {
            seq,
            device: device.into(),
            ts_ms: seq,
            organism: "test".into(),
            task_id: format!("{device}-{seq}"),
            tool: "hive.sync".into(),
            args: json!({}),
            risk: Risk::Observe,
            verdict: Verdict::Allowed,
            taint: Taint::none(),
            ok: true,
            summary: summary.into(),
            effects: vec![],
            rewound: false,
        }
    }

    fn kv(value: Value, ts_ms: i64, device: &str) -> KvEntry {
        KvEntry {
            value,
            ts_ms,
            device: device.into(),
        }
    }

    fn map(entries: &[(&str, KvEntry)]) -> BTreeMap<String, KvEntry> {
        entries
            .iter()
            .map(|(k, v)| ((*k).to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn merge_events_dedups_by_device_and_seq_in_stable_order() {
        let local = vec![
            event("phone", 2, "local-2"),
            event("phone", 1, "local-1"),
            event("phone", 2, "local-2-dup"),
        ];
        let remote = vec![
            event("pc", 5, "remote-5"),
            event("phone", 2, "remote-overwrites"),
            event("pc", 1, "remote-1"),
            event("pc", 5, "remote-5-dup"),
            event("pc", 3, "remote-3"),
        ];
        let once = merge_events(&local, &remote);
        let summaries: Vec<_> = once.iter().map(|e| e.summary.as_str()).collect();
        assert_eq!(
            summaries,
            ["local-2", "local-1", "remote-5", "remote-1", "remote-3"]
        );
        assert_eq!(once[0].seq, 2);
        assert_eq!(once[2].device, "pc");

        let twice = merge_events(&once, &remote);
        let with_local = merge_events(&once, &local);
        let with_self = merge_events(&once, &once);
        assert_eq!(twice, once);
        assert_eq!(with_local, once);
        assert_eq!(with_self, once);
    }

    #[test]
    fn merge_events_handles_empty_and_disjoint_logs() {
        let local = vec![event("a", 1, "a")];
        assert!(merge_events(&[], &[]).is_empty());
        assert_eq!(merge_events(&local, &[]), local);
        assert_eq!(merge_events(&[], &local), local);
        let remote = vec![event("b", 9, "b"), event("b", 1, "b1")];
        let merged = merge_events(&local, &remote);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[1].seq, 9);
        assert_eq!(merged[2].seq, 1);
    }

    #[test]
    fn merge_kv_is_last_writer_wins_and_idempotent() {
        let local = map(&[
            ("note", kv(json!("phone"), 10, "aaa")),
            ("only-local", kv(json!(1), 1, "aaa")),
            ("tie", kv(json!("from-aaa"), 5, "aaa")),
            ("same", kv(json!("local"), 7, "aaa")),
        ]);
        let remote = map(&[
            ("note", kv(json!("pc"), 11, "bbb")),
            ("only-remote", kv(json!(2), 2, "bbb")),
            ("tie", kv(json!("from-bbb"), 5, "bbb")),
            ("same", kv(json!("remote"), 7, "aaa")),
            ("older", kv(json!("stale"), 4, "zzz")),
        ]);
        let local = {
            let mut local = local;
            local.insert("older".into(), kv(json!("fresh"), 9, "aaa"));
            local
        };

        let once = merge_kv(&local, &remote);
        assert_eq!(once.get("note").unwrap().value, json!("pc"));
        assert_eq!(once.get("only-local").unwrap().value, json!(1));
        assert_eq!(once.get("only-remote").unwrap().value, json!(2));
        assert_eq!(once.get("tie").unwrap().value, json!("from-bbb"));
        assert_eq!(once.get("tie").unwrap().device, "bbb");
        assert_eq!(once.get("same").unwrap().value, json!("local"));
        assert_eq!(once.get("older").unwrap().value, json!("fresh"));

        assert_eq!(merge_kv(&once, &remote), once);
        assert_eq!(merge_kv(&once, &local), once);
        assert_eq!(merge_kv(&once, &once), once);

        let swapped_tie = map(&[("tie", kv(json!("from-bbb"), 5, "bbb"))]);
        let swapped_local = map(&[("tie", kv(json!("from-aaa"), 5, "aaa"))]);
        assert_eq!(
            merge_kv(&swapped_local, &swapped_tie),
            merge_kv(&swapped_tie, &swapped_local)
        );
    }

    #[test]
    fn merge_kv_clock_order_ignores_which_side_wrote() {
        let earlier = map(&[("k", kv(json!("old"), -5, "zzz"))]);
        let later = map(&[("k", kv(json!("new"), -1, "aaa"))]);
        let merged = merge_kv(&later, &earlier);
        assert_eq!(merged.get("k").unwrap().value, json!("new"));
        assert_eq!(merge_kv(&earlier, &later), merged);

        let case_keys = map(&[("Note", kv(json!(1), 1, "a"))]);
        let other = map(&[("note", kv(json!(2), 9, "b"))]);
        let both = merge_kv(&case_keys, &other);
        assert_eq!(both.len(), 2);
    }
}
