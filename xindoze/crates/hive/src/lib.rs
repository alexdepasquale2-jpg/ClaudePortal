//! Hive: the user's devices as one mind (SPEC §3.12).
//!
//! Devices pair with a short code and exchange identities. Every byte on a
//! real link is end-to-end encrypted; this crate is the state machine and
//! the sync rules, so two simulated devices can pair and merge with no
//! network. A socket is phase 2 (see [`Device::sync_with`]).
//!
//! Discovery is LAN-only ([`LAN_ONLY`]). There is no third-party relay
//! ([`RELAY`]).
//!
//! * **Engram sync.** The event log is append-only and merged by
//!   `(device, seq)` ([`merge_events`]). Key-value data is last-writer-wins
//!   ([`merge_kv`]).
//! * **Inference offload.** The phone asks and the PC answers ([`route`]).
//!   When the PC is off, the question runs locally and the caller gets one
//!   line: [`LOCAL_NOTICE`].
//!
//! ```
//! use xz_hive::{Device, DeviceId, Identity, Presence, Route, LOCAL_NOTICE};
//!
//! let mut phone = Device::new(Identity::new("Phone", DeviceId::from_bytes([1; 32])).unwrap());
//! let mut pc = Device::new(Identity::new("PC", DeviceId::from_bytes([2; 32])).unwrap());
//! let phone_code = phone.begin_pairing(b"kitchen");
//! let pc_code = pc.begin_pairing(b"kitchen");
//! phone
//!     .confirm(&pc_code, pc.identity().clone(), true)
//!     .unwrap();
//! pc.confirm(&phone_code, phone.identity().clone(), false)
//!     .unwrap();
//! assert!(matches!(
//!     phone.route("explain vaccines"),
//!     Route::RanOn { notice: None, .. }
//! ));
//! phone
//!     .set_presence(pc.identity().id(), Presence::Offline)
//!     .unwrap();
//! match phone.route("explain vaccines") {
//!     Route::RanLocal { notice } => assert_eq!(notice, LOCAL_NOTICE),
//!     Route::RanOn { .. } => panic!("pc is offline"),
//! }
//! ```

mod device;
mod error;
mod identity;
mod offload;
mod peer;
mod sync;

pub use device::Device;
pub use error::HiveError;
pub use identity::{
    DEVICE_ID_LEN, DeviceId, Identity, PAIRING_ALPHABET, PAIRING_LEN, Pairing, PairingCode,
};
pub use offload::{LOCAL_NOTICE, Route, route};
pub use peer::{Peer, PeerSet, Presence};
pub use sync::{KvEntry, merge_events, merge_kv};

/// Devices are discovered on the local network only.
pub const LAN_ONLY: bool = true;

/// No third-party relay. Peers connect directly, or not at all.
pub const RELAY: Option<&str> = None;
