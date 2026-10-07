//! Inference offload: the phone asks, the PC answers, or the phone runs it.

use serde::{Deserialize, Serialize};

use crate::{Peer, PeerSet};

/// Shown when no stronger peer is online. One line, no trailing newline.
pub const LOCAL_NOTICE: &str = "The PC is off, so this ran on this device.";

const fn one_line(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0;
    if bytes.is_empty() {
        return false;
    }
    while i < bytes.len() {
        if bytes[i] == b'\n' || bytes[i] == b'\r' {
            return false;
        }
        i += 1;
    }
    true
}

const _: () = assert!(one_line(LOCAL_NOTICE));

/// Where a question ran.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "ran", rename_all = "snake_case")]
pub enum Route {
    /// A stronger peer was online and took the question.
    RanOn {
        /// The peer that answered.
        peer: Peer,
        /// No notice: the PC was there.
        notice: Option<String>,
    },
    /// No stronger peer was online, so this device answered.
    RanLocal {
        /// One line telling the caller the PC was off.
        notice: String,
    },
}

impl Route {
    /// The notice, if this run should tell the user something.
    pub fn notice(&self) -> Option<&str> {
        match self {
            Route::RanOn { notice, .. } => notice.as_deref(),
            Route::RanLocal { notice } => Some(notice.as_str()),
        }
    }

    /// The peer that answered, when the question was offloaded.
    pub fn peer(&self) -> Option<&Peer> {
        match self {
            Route::RanOn { peer, .. } => Some(peer),
            Route::RanLocal { .. } => None,
        }
    }
}

/// Places `question`.
///
/// The wording does not change the decision. When a stronger peer is online,
/// the result is [`Route::RanOn`] with `notice: None`. Otherwise the result
/// is [`Route::RanLocal`] and the notice is [`LOCAL_NOTICE`].
#[must_use]
pub fn route(question: &str, peers: &PeerSet) -> Route {
    let _ = question;
    match peers.stronger_online() {
        Some(peer) => Route::RanOn {
            peer: peer.clone(),
            notice: None,
        },
        None => Route::RanLocal {
            notice: LOCAL_NOTICE.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DEVICE_ID_LEN, DeviceId, Identity, Peer, PeerSet, Presence};

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
    fn stronger_peer_online_runs_there_with_no_notice() {
        let mut peers = PeerSet::new();
        peers.insert(peer(2, "PC", true, Presence::Online)).unwrap();
        peers
            .insert(peer(1, "Watch", false, Presence::Online))
            .unwrap();
        let first = route("explain how vaccines train the immune system", &peers);
        let second = route("a different question", &peers);
        match &first {
            Route::RanOn { peer, notice } => {
                assert_eq!(peer.identity.name(), "PC");
                assert_eq!(peer.id(), id(2));
                assert_eq!(notice, &None);
                assert!(first.notice().is_none());
                assert_eq!(first.peer().map(Peer::id), Some(id(2)));
            }
            Route::RanLocal { .. } => panic!("expected the PC"),
        }
        assert_eq!(first, second);
    }

    #[test]
    fn no_stronger_peer_runs_locally_with_one_line() {
        let cases = [PeerSet::new(), {
            let mut peers = PeerSet::new();
            peers
                .insert(peer(2, "PC", true, Presence::Offline))
                .unwrap();
            peers
                .insert(peer(4, "Tablet", false, Presence::Online))
                .unwrap();
            peers
        }];
        for peers in &cases {
            let routed = route("The PC is off, so this ran on this device.\nnope", peers);
            match &routed {
                Route::RanLocal { notice } => {
                    assert_eq!(notice, LOCAL_NOTICE);
                    assert_eq!(notice.lines().count(), 1);
                    assert!(!notice.contains('\n'));
                    assert!(!notice.contains('\r'));
                    assert_eq!(routed.peer(), None);
                }
                Route::RanOn { .. } => panic!("expected local"),
            }
        }
    }

    #[test]
    fn two_stronger_peers_use_the_lowest_id() {
        let mut peers = PeerSet::new();
        peers
            .insert(peer(8, "Office", true, Presence::Online))
            .unwrap();
        peers
            .insert(peer(3, "Home", true, Presence::Offline))
            .unwrap();
        peers
            .insert(peer(4, "Laptop", true, Presence::Online))
            .unwrap();
        let routed = route("q", &peers);
        assert_eq!(routed.peer().unwrap().identity.name(), "Laptop");
    }
}
