//! One device's Hive state. Two of these pair and merge with no socket.

use std::collections::BTreeMap;

use serde_json::Value;
use xz_types::JournalEvent;

use crate::{
    DeviceId, HiveError, Identity, KvEntry, Pairing, PairingCode, Peer, PeerSet, Presence, Route,
    merge_events, merge_kv, route,
};

/// A simulated device: identity, paired peers, event log, and key-value map.
///
/// Discovery stays on the LAN ([`crate::LAN_ONLY`]). There is no relay.
/// [`Device::sync_with`] copies state in memory.
#[derive(Clone, Debug)]
pub struct Device {
    identity: Identity,
    peers: PeerSet,
    events: Vec<JournalEvent>,
    kv: BTreeMap<String, KvEntry>,
    pairing: Option<Pairing>,
}

impl Device {
    /// A device with no peers and an empty log.
    pub fn new(identity: Identity) -> Self {
        Self {
            identity,
            peers: PeerSet::new(),
            events: Vec::new(),
            kv: BTreeMap::new(),
            pairing: None,
        }
    }

    /// This device's identity.
    pub fn identity(&self) -> &Identity {
        &self.identity
    }

    /// Devices paired directly with this one.
    pub fn peers(&self) -> &PeerSet {
        &self.peers
    }

    /// The event log, in merge order.
    pub fn events(&self) -> &[JournalEvent] {
        &self.events
    }

    /// The key-value map.
    pub fn kv(&self) -> &BTreeMap<String, KvEntry> {
        &self.kv
    }

    /// This build discovers peers on the local network only.
    pub fn lan_only(&self) -> bool {
        crate::LAN_ONLY
    }

    /// No third-party relay. Always `None`.
    pub fn relay(&self) -> Option<&'static str> {
        crate::RELAY
    }

    /// Opens pairing. `seed` is the shared secret the user carried across
    /// (the QR payload). Returns the short code to show. Replaces any code
    /// already on screen. Does not drop peers already paired.
    pub fn begin_pairing(&mut self, seed: &[u8]) -> PairingCode {
        let pairing = Pairing::open(self.identity.clone(), seed);
        let code = pairing.code();
        self.pairing = Some(pairing);
        code
    }

    /// The code on screen, if pairing is open.
    pub fn pairing_code(&self) -> Option<PairingCode> {
        self.pairing.as_ref().map(Pairing::code)
    }

    /// Pairs `peer` when it presents `code`.
    ///
    /// The code has to match the one [`Device::begin_pairing`] is showing.
    /// `stronger` is true for a PC that should take inference. The peer
    /// starts online. A mismatch leaves the peer set unchanged.
    pub fn confirm(
        &mut self,
        code: &PairingCode,
        peer: Identity,
        stronger: bool,
    ) -> Result<&Peer, HiveError> {
        let id = peer.id();
        let identity = self
            .pairing
            .as_ref()
            .ok_or(HiveError::NotPairing)?
            .confirm(code, peer)?;
        self.peers.insert(Peer {
            identity,
            presence: Presence::Online,
            stronger,
        })?;
        Ok(self.peers.get(id).expect("peer was just inserted"))
    }

    /// Marks a paired device online or offline on this device's view.
    pub fn set_presence(&mut self, id: DeviceId, presence: Presence) -> Result<(), HiveError> {
        self.peers.set_presence(id, presence)
    }

    /// Appends an event. The caller sets `device` and `seq`; merge uses that pair.
    pub fn record(&mut self, event: JournalEvent) {
        self.events.push(event);
    }

    /// Writes `key` as this device, at `ts_ms`.
    pub fn put(&mut self, key: impl Into<String>, value: Value, ts_ms: i64) {
        self.kv.insert(
            key.into(),
            KvEntry {
                value,
                ts_ms,
                device: self.identity.id().to_hex(),
            },
        );
    }

    /// Folds a remote log and map into this device. Idempotent.
    pub fn apply_remote(&mut self, events: &[JournalEvent], kv: &BTreeMap<String, KvEntry>) {
        self.events = merge_events(&self.events, events);
        self.kv = merge_kv(&self.kv, kv);
    }

    /// Exchanges logs and key-value maps with `other`.
    ///
    /// Both devices must list each other as paired and online. Afterwards
    /// both hold the same merged log and the same merged map. Calling this
    /// again with no new writes changes nothing.
    pub fn sync_with(&mut self, other: &mut Device) -> Result<(), HiveError> {
        // TODO(phase 2): real QUIC socket.
        self.require_online(other.identity.id())?;
        other.require_online(self.identity.id())?;
        let events = merge_events(&self.events, &other.events);
        let kv = merge_kv(&self.kv, &other.kv);
        self.events.clone_from(&events);
        other.events = events;
        self.kv.clone_from(&kv);
        other.kv = kv;
        Ok(())
    }

    /// Routes `question` using this device's peer set.
    pub fn route(&self, question: &str) -> Route {
        route(question, &self.peers)
    }

    fn require_online(&self, id: DeviceId) -> Result<(), HiveError> {
        match self.peers.get(id) {
            Some(peer) if peer.presence == Presence::Online => Ok(()),
            Some(_) => Err(HiveError::PeerOffline),
            None => Err(HiveError::NotPaired),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DEVICE_ID_LEN, DeviceId, HiveError, Identity, KvEntry, LOCAL_NOTICE, Presence, Route,
    };
    use serde_json::json;
    use xz_types::{JournalEvent, Risk, Taint, Verdict};

    fn id(n: u8) -> DeviceId {
        let mut bytes = [0u8; DEVICE_ID_LEN];
        bytes[31] = n;
        DeviceId::from_bytes(bytes)
    }

    fn device(name: &str, n: u8) -> Device {
        Device::new(Identity::new(name, id(n)).unwrap())
    }

    fn event(device: &str, seq: i64, summary: &str) -> JournalEvent {
        JournalEvent {
            seq,
            device: device.into(),
            ts_ms: seq * 1000,
            organism: "notes".into(),
            task_id: format!("t{seq}"),
            tool: "fs.write".into(),
            args: json!({"path": summary}),
            risk: Risk::Act,
            verdict: Verdict::Allowed,
            taint: Taint::none(),
            ok: true,
            summary: summary.into(),
            effects: vec![],
            rewound: false,
        }
    }

    fn pair(phone: &mut Device, pc: &mut Device, seed: &[u8]) {
        let phone_code = phone.begin_pairing(seed);
        let pc_code = pc.begin_pairing(seed);
        phone
            .confirm(&pc_code, pc.identity().clone(), true)
            .unwrap();
        pc.confirm(&phone_code, phone.identity().clone(), false)
            .unwrap();
    }

    #[test]
    fn two_devices_pair_sync_and_offload_without_a_network() {
        let mut phone = device("Phone", 1);
        let mut pc = device("PC", 2);
        assert!(phone.lan_only());
        assert!(phone.relay().is_none());
        assert!(pc.relay().is_none());

        pair(&mut phone, &mut pc, b"kitchen-table");
        assert_eq!(phone.peers().len(), 1);
        assert_eq!(pc.peers().get(id(1)).unwrap().identity.name(), "Phone");
        assert!(phone.peers().get(id(2)).unwrap().stronger);
        assert!(!pc.peers().get(id(1)).unwrap().stronger);
        assert_eq!(phone.peers().get(id(2)).unwrap().presence, Presence::Online);

        let phone_hex = phone.identity().id().to_hex();
        let pc_hex = pc.identity().id().to_hex();
        phone.record(event(&phone_hex, 1, "phone-1"));
        phone.record(event(&phone_hex, 2, "phone-2"));
        pc.record(event(&pc_hex, 1, "pc-1"));
        phone.put("note", json!("from-phone"), 10);
        pc.put("note", json!("from-pc"), 20);
        pc.put("only-pc", json!(true), 1);

        phone.sync_with(&mut pc).unwrap();
        assert_eq!(phone.events().len(), 3);
        assert_eq!(pc.events(), phone.events());
        assert_eq!(phone.events()[0].summary, "phone-1");
        assert_eq!(phone.events()[1].summary, "phone-2");
        assert_eq!(phone.events()[2].summary, "pc-1");
        assert_eq!(phone.kv().get("note").unwrap().value, json!("from-pc"));
        assert_eq!(pc.kv().get("only-pc").unwrap().value, json!(true));
        assert_eq!(phone.kv(), pc.kv());

        let events_before = phone.events().to_vec();
        let kv_before = phone.kv().clone();
        phone.sync_with(&mut pc).unwrap();
        assert_eq!(phone.events(), events_before.as_slice());
        assert_eq!(phone.kv(), &kv_before);
        assert_eq!(pc.events(), phone.events());

        match phone.route("explain how vaccines train the immune system") {
            Route::RanOn { peer, notice } => {
                assert_eq!(peer.id(), id(2));
                assert_eq!(notice, None);
            }
            Route::RanLocal { .. } => panic!("PC is online"),
        }

        phone.set_presence(id(2), Presence::Offline).unwrap();
        assert!(phone.peers().contains(id(2)));
        let err = phone.sync_with(&mut pc).unwrap_err();
        assert_eq!(err, HiveError::PeerOffline);
        assert_eq!(phone.events(), events_before.as_slice());
        match phone.route("explain how vaccines train the immune system") {
            Route::RanLocal { notice } => {
                assert_eq!(notice, LOCAL_NOTICE);
                assert_eq!(notice.lines().count(), 1);
            }
            Route::RanOn { .. } => panic!("PC is offline"),
        }

        phone.set_presence(id(2), Presence::Online).unwrap();
        phone.put("note", json!("phone-later"), 30);
        phone.sync_with(&mut pc).unwrap();
        assert_eq!(pc.kv().get("note").unwrap().value, json!("phone-later"));
        assert_eq!(pc.kv().get("note").unwrap().device, phone_hex);
    }

    #[test]
    fn mismatch_self_and_double_confirm_do_not_pair() {
        let mut phone = device("Phone", 1);
        let mut pc = device("PC", 2);
        let phone_code = phone.begin_pairing(b"one");
        let _pc_code = pc.begin_pairing(b"two");
        assert_ne!(phone_code, pc.pairing_code().unwrap());
        assert_eq!(
            phone
                .confirm(&pc.pairing_code().unwrap(), pc.identity().clone(), true)
                .unwrap_err(),
            HiveError::CodeMismatch
        );
        assert!(phone.peers().is_empty());
        assert!(pc.peers().is_empty());

        assert_eq!(
            phone
                .confirm(&phone_code, phone.identity().clone(), false)
                .unwrap_err(),
            HiveError::SelfPair
        );
        assert!(phone.peers().is_empty());

        let same = pc.begin_pairing(b"one");
        assert_eq!(same, phone_code);
        phone.confirm(&same, pc.identity().clone(), true).unwrap();
        assert_eq!(
            phone
                .confirm(&same, pc.identity().clone(), true)
                .unwrap_err(),
            HiveError::AlreadyPaired
        );
        assert_eq!(phone.peers().len(), 1);

        let mut stranger = device("Tablet", 3);
        assert_eq!(
            stranger
                .confirm(&same, pc.identity().clone(), false)
                .unwrap_err(),
            HiveError::NotPairing
        );

        let old = phone.begin_pairing(b"one");
        phone.begin_pairing(b"replaced");
        assert_ne!(phone.pairing_code().unwrap(), old);
        assert_eq!(
            phone
                .confirm(&old, stranger.identity().clone(), false)
                .unwrap_err(),
            HiveError::CodeMismatch
        );
        assert_eq!(phone.peers().len(), 1);
    }

    #[test]
    fn sync_requires_both_sides_paired() {
        let mut phone = device("Phone", 1);
        let mut pc = device("PC", 2);
        let code = phone.begin_pairing(b"solo");
        phone.confirm(&code, pc.identity().clone(), true).unwrap();
        phone.record(event("phone", 1, "only"));
        assert_eq!(phone.sync_with(&mut pc).unwrap_err(), HiveError::NotPaired);
        assert_eq!(phone.events().len(), 1);
        assert!(pc.events().is_empty());
    }

    #[test]
    fn apply_remote_is_idempotent() {
        let mut phone = device("Phone", 1);
        let batch = vec![
            event("pc", 1, "a"),
            event("pc", 2, "b"),
            event("pc", 1, "dup"),
        ];
        let mut kv = BTreeMap::new();
        kv.insert(
            "k".into(),
            KvEntry {
                value: json!(1),
                ts_ms: 5,
                device: "pc".into(),
            },
        );
        phone.apply_remote(&batch, &kv);
        phone.apply_remote(&batch, &kv);
        assert_eq!(phone.events().len(), 2);
        assert_eq!(phone.events()[0].summary, "a");
        assert_eq!(phone.kv().get("k").unwrap().value, json!(1));
        phone.put("k", json!(0), 1);
        phone.apply_remote(&[], &kv);
        assert_eq!(phone.kv().get("k").unwrap().value, json!(1));
    }

    #[test]
    fn equal_timestamps_break_ties_by_device_id_across_sync() {
        let mut low = device("Low", 1);
        let mut high = device("High", 2);
        pair(&mut low, &mut high, b"tie");
        low.put("k", json!("low"), 50);
        high.put("k", json!("high"), 50);
        low.sync_with(&mut high).unwrap();
        let winner = high.identity().id().to_hex();
        assert!(winner > low.identity().id().to_hex());
        assert_eq!(low.kv().get("k").unwrap().device, winner);
        assert_eq!(low.kv().get("k").unwrap().value, json!("high"));
        assert_eq!(high.kv(), low.kv());
        low.sync_with(&mut high).unwrap();
        assert_eq!(low.kv().get("k").unwrap().value, json!("high"));
    }
}
