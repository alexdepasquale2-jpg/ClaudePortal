//! Paired devices. Direct peers only: there is no relay.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{DeviceId, HiveError, Identity};

/// Whether a paired device can be reached right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    /// The peer is on the LAN and can take a sync or an offload.
    Online,
    /// The peer is paired, but nothing is sent to it.
    Offline,
}

/// One device this one has paired with.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Peer {
    /// Identity exchanged at pairing.
    pub identity: Identity,
    /// Online on the LAN, or paired but unreachable.
    pub presence: Presence,
    /// `true` when this peer takes inference offload (the PC's GPU).
    pub stronger: bool,
}

impl Peer {
    /// The peer's device id.
    pub fn id(&self) -> DeviceId {
        self.identity.id()
    }
}

/// The set of devices paired directly with this one.
///
/// Insertion order is not the iteration order: peers are ordered by device
/// id. Nothing in this set is a third-party relay.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PeerSet {
    peers: BTreeMap<DeviceId, Peer>,
}

impl PeerSet {
    /// An empty set.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds `peer`. The same device id cannot be added twice.
    pub fn insert(&mut self, peer: Peer) -> Result<(), HiveError> {
        let id = peer.id();
        if self.peers.contains_key(&id) {
            return Err(HiveError::AlreadyPaired);
        }
        self.peers.insert(id, peer);
        Ok(())
    }

    /// The peer with this id, if it was paired.
    pub fn get(&self, id: DeviceId) -> Option<&Peer> {
        self.peers.get(&id)
    }

    /// Whether `id` is paired, online or not.
    pub fn contains(&self, id: DeviceId) -> bool {
        self.peers.contains_key(&id)
    }

    /// How many devices are paired.
    pub fn len(&self) -> usize {
        self.peers.len()
    }

    /// No paired devices.
    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }

    /// Peers in device-id order.
    pub fn iter(&self) -> impl Iterator<Item = &Peer> {
        self.peers.values()
    }

    /// Marks a paired device online or offline.
    pub fn set_presence(&mut self, id: DeviceId, presence: Presence) -> Result<(), HiveError> {
        let peer = self.peers.get_mut(&id).ok_or(HiveError::NotPaired)?;
        peer.presence = presence;
        Ok(())
    }

    /// The online stronger peer with the lowest device id, if any.
    pub fn stronger_online(&self) -> Option<&Peer> {
        self.peers
            .values()
            .find(|peer| peer.stronger && peer.presence == Presence::Online)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DEVICE_ID_LEN, DeviceId, HiveError, Identity};

    fn id(n: u8) -> DeviceId {
        let mut bytes = [0u8; DEVICE_ID_LEN];
        bytes[31] = n;
        DeviceId::from_bytes(bytes)
    }

    fn peer(n: u8, name: &str, stronger: bool, presence: Presence) -> Peer {
        Peer {
            identity: Identity::new(name, id(n)).unwrap(),
            presence,
            stronger,
        }
    }

    #[test]
    fn peer_set_tracks_presence_without_a_relay() {
        let mut peers = PeerSet::new();
        peers.insert(peer(2, "PC", true, Presence::Online)).unwrap();
        peers
            .insert(peer(1, "Tablet", false, Presence::Offline))
            .unwrap();
        assert_eq!(
            peers.insert(peer(2, "PC again", true, Presence::Online)),
            Err(HiveError::AlreadyPaired)
        );
        assert_eq!(peers.len(), 2);
        assert_eq!(
            peers.iter().map(|p| p.identity.name()).collect::<Vec<_>>(),
            ["Tablet", "PC"]
        );
        assert!(peers.contains(id(1)));
        assert_eq!(peers.get(id(2)).unwrap().identity.name(), "PC");

        peers.set_presence(id(2), Presence::Offline).unwrap();
        assert_eq!(peers.get(id(2)).unwrap().presence, Presence::Offline);
        assert!(peers.stronger_online().is_none());
        peers.set_presence(id(2), Presence::Online).unwrap();
        assert_eq!(peers.stronger_online().unwrap().id(), id(2));
        assert_eq!(
            peers.set_presence(id(9), Presence::Offline).unwrap_err(),
            HiveError::NotPaired
        );
    }

    #[test]
    fn stronger_online_picks_the_lowest_id() {
        let mut peers = PeerSet::new();
        peers
            .insert(peer(5, "Desk", true, Presence::Online))
            .unwrap();
        peers
            .insert(peer(3, "Tower", true, Presence::Online))
            .unwrap();
        peers
            .insert(peer(1, "Phone", false, Presence::Online))
            .unwrap();
        assert_eq!(peers.stronger_online().unwrap().identity.name(), "Tower");
        peers.set_presence(id(3), Presence::Offline).unwrap();
        assert_eq!(peers.stronger_online().unwrap().identity.name(), "Desk");
        peers.set_presence(id(5), Presence::Offline).unwrap();
        assert!(peers.stronger_online().is_none());
    }
}
