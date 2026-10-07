//! Failures from pairing, the peer set, and simulated sync.

/// What went wrong while pairing or talking to a paired device.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum HiveError {
    /// The other device showed a different short code.
    #[error("pairing code does not match")]
    CodeMismatch,
    /// [`crate::Device::confirm`] was called with no open pairing session.
    #[error("pairing is not open")]
    NotPairing,
    /// A device presented its own id.
    #[error("a device cannot pair with itself")]
    SelfPair,
    /// That device id is already in the peer set.
    #[error("peer is already paired")]
    AlreadyPaired,
    /// That device id is not in the peer set.
    #[error("peer is not paired")]
    NotPaired,
    /// The peer is paired but marked offline, so nothing is exchanged.
    #[error("peer is offline")]
    PeerOffline,
    /// The hex was not exactly 32 bytes.
    #[error("invalid device id")]
    InvalidDeviceId,
    /// The text was not 8 Crockford-ish characters.
    #[error("invalid pairing code")]
    InvalidPairingCode,
    /// A display name must contain a visible character.
    #[error("display name is empty")]
    EmptyName,
}
