//! Device identity and the short code two devices type to pair.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::HiveError;

/// Bytes in a [`DeviceId`].
pub const DEVICE_ID_LEN: usize = 32;

/// Crockford base32 without I, L, O, or U. Eight of these make a pairing code.
pub const PAIRING_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Characters in a [`PairingCode`].
pub const PAIRING_LEN: usize = 8;

/// A device's 32-byte id, shown as 64 hex characters.
///
/// This stands in for the Ed25519 public key two devices will exchange.
/// The bytes are the caller's: tests pass a fixed array and get the same id.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceId([u8; DEVICE_ID_LEN]);

impl DeviceId {
    /// An id whose bytes are exactly `bytes`.
    pub const fn from_bytes(bytes: [u8; DEVICE_ID_LEN]) -> Self {
        Self(bytes)
    }

    /// The raw 32 bytes.
    pub const fn as_bytes(&self) -> &[u8; DEVICE_ID_LEN] {
        &self.0
    }

    /// Lowercase hex, 64 characters.
    pub fn to_hex(&self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut out = String::with_capacity(DEVICE_ID_LEN * 2);
        for byte in self.0 {
            out.push(HEX[(byte >> 4) as usize] as char);
            out.push(HEX[(byte & 0x0f) as usize] as char);
        }
        out
    }

    /// Parses 64 hex digits. Upper and lower case both work. Ends are trimmed.
    pub fn from_hex(text: &str) -> Result<Self, HiveError> {
        let text = text.trim();
        if text.len() != DEVICE_ID_LEN * 2 {
            return Err(HiveError::InvalidDeviceId);
        }
        let mut bytes = [0u8; DEVICE_ID_LEN];
        let digits = text.as_bytes();
        for (i, slot) in bytes.iter_mut().enumerate() {
            let hi = hex_value(digits[i * 2]).ok_or(HiveError::InvalidDeviceId)?;
            let lo = hex_value(digits[i * 2 + 1]).ok_or(HiveError::InvalidDeviceId)?;
            *slot = (hi << 4) | lo;
        }
        Ok(Self(bytes))
    }
}

impl fmt::Display for DeviceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl fmt::Debug for DeviceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "DeviceId({})", self.to_hex())
    }
}

impl From<[u8; DEVICE_ID_LEN]> for DeviceId {
    fn from(bytes: [u8; DEVICE_ID_LEN]) -> Self {
        Self::from_bytes(bytes)
    }
}

impl Serialize for DeviceId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for DeviceId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        DeviceId::from_hex(&text).map_err(serde::de::Error::custom)
    }
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Who a device is: a 32-byte id plus the name a person sees.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Identity {
    id: DeviceId,
    name: String,
}

impl Identity {
    /// `name` is trimmed. An empty name is rejected.
    pub fn new(name: impl Into<String>, id: DeviceId) -> Result<Self, HiveError> {
        let name = name.into().trim().to_string();
        if name.is_empty() {
            return Err(HiveError::EmptyName);
        }
        Ok(Self { id, name })
    }

    /// The device id.
    pub fn id(&self) -> DeviceId {
        self.id
    }

    /// The display name.
    pub fn name(&self) -> &str {
        &self.name
    }
}

/// Eight Crockford-ish characters derived from a caller-supplied seed.
///
/// The same seed always yields the same code, so two devices and the tests
/// can pair without a clock or a network.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PairingCode([u8; PAIRING_LEN]);

impl PairingCode {
    /// Derives a code from `seed`. An empty seed is allowed and still stable.
    pub fn from_seed(seed: &[u8]) -> Self {
        let mut state = fnv1a64(seed);
        let alphabet = PAIRING_ALPHABET.as_bytes();
        let mut chars = [0u8; PAIRING_LEN];
        for slot in &mut chars {
            state = splitmix64(state);
            let index = (state & 31) as usize;
            *slot = alphabet[index];
        }
        Self(chars)
    }

    /// Parses a code a person typed.
    ///
    /// Case is ignored. `I` and `L` count as `1`, `O` counts as `0`. Spaces
    /// and hyphens are skipped. Anything else, or a length other than 8
    /// significant characters, is rejected.
    pub fn parse(input: &str) -> Result<Self, HiveError> {
        let alphabet = PAIRING_ALPHABET.as_bytes();
        let mut chars = [0u8; PAIRING_LEN];
        let mut n = 0;
        for ch in input.chars() {
            if ch.is_whitespace() || ch == '-' {
                continue;
            }
            if n >= PAIRING_LEN {
                return Err(HiveError::InvalidPairingCode);
            }
            let mapped = match ch {
                'o' | 'O' => '0',
                'i' | 'I' | 'l' | 'L' => '1',
                other => other.to_ascii_uppercase(),
            };
            let byte = mapped as u8;
            if !alphabet.contains(&byte) {
                return Err(HiveError::InvalidPairingCode);
            }
            chars[n] = byte;
            n += 1;
        }
        if n != PAIRING_LEN {
            return Err(HiveError::InvalidPairingCode);
        }
        Ok(Self(chars))
    }

    /// The eight characters.
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).expect("pairing code is ASCII")
    }
}

impl fmt::Display for PairingCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for PairingCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("PairingCode").field(&self.as_str()).finish()
    }
}

impl Serialize for PairingCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for PairingCode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        PairingCode::parse(&text).map_err(serde::de::Error::custom)
    }
}

/// An open pairing session on one device.
///
/// Both devices call [`Pairing::open`] with the same seed (the QR payload,
/// or the code the user read out). [`Pairing::confirm`] accepts the other
/// device only when it presents that same code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pairing {
    local: Identity,
    code: PairingCode,
}

impl Pairing {
    /// Starts pairing for `local` using `seed`.
    pub fn open(local: Identity, seed: &[u8]) -> Self {
        Self {
            local,
            code: PairingCode::from_seed(seed),
        }
    }

    /// The code this device is showing.
    pub fn code(&self) -> PairingCode {
        self.code
    }

    /// The identity this device will exchange.
    pub fn local(&self) -> &Identity {
        &self.local
    }

    /// Accepts `peer` when `code` equals the code this device is showing.
    ///
    /// A mismatch returns [`HiveError::CodeMismatch`]. Pairing with this
    /// device's own id returns [`HiveError::SelfPair`]. The returned identity
    /// is what the caller stores in its peer set.
    pub fn confirm(&self, code: &PairingCode, peer: Identity) -> Result<Identity, HiveError> {
        if &self.code != code {
            return Err(HiveError::CodeMismatch);
        }
        if peer.id() == self.local.id() {
            return Err(HiveError::SelfPair);
        }
        Ok(peer)
    }
}

/// FNV-1a, 64-bit. Only used to spread a seed into a short code.
fn fnv1a64(data: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325;
    for byte in data {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// SplitMix64. Mixes the FNV state so each code character depends on the whole seed.
fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::HiveError;

    fn id(n: u8) -> DeviceId {
        let mut bytes = [0u8; DEVICE_ID_LEN];
        bytes[31] = n;
        DeviceId::from_bytes(bytes)
    }

    #[test]
    fn device_id_is_32_bytes_of_hex() {
        let raw = [0xABu8; DEVICE_ID_LEN];
        let id = DeviceId::from_bytes(raw);
        assert_eq!(id.as_bytes(), &raw);
        let hex = id.to_hex();
        assert_eq!(hex.len(), 64);
        assert!(
            hex.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
        assert_eq!(DeviceId::from_hex(&hex).unwrap(), id);
        assert_eq!(DeviceId::from_hex(&hex.to_uppercase()).unwrap(), id);
        assert_eq!(DeviceId::from_hex(&format!("  {hex}\n")).unwrap(), id);
        assert_eq!(id.to_string(), hex);
    }

    #[test]
    fn device_id_rejects_bad_hex() {
        assert_eq!(
            DeviceId::from_hex("ab").unwrap_err(),
            HiveError::InvalidDeviceId
        );
        assert_eq!(
            DeviceId::from_hex(&"zz".repeat(32)).unwrap_err(),
            HiveError::InvalidDeviceId
        );
        assert_eq!(
            DeviceId::from_hex(&format!("0x{}", "ab".repeat(32))).unwrap_err(),
            HiveError::InvalidDeviceId
        );
        assert_eq!(
            DeviceId::from_hex(&format!("{} {}", "ab".repeat(16), "cd".repeat(16))).unwrap_err(),
            HiveError::InvalidDeviceId
        );
    }

    #[test]
    fn device_id_json_is_hex() {
        let id = id(0x2a);
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{}\"", id.to_hex()));
        assert_eq!(serde_json::from_str::<DeviceId>(&json).unwrap(), id);
    }

    #[test]
    fn identity_keeps_name_and_id() {
        let id = id(1);
        let identity = Identity::new("  Phone  ", id).unwrap();
        assert_eq!(identity.name(), "Phone");
        assert_eq!(identity.id(), id);
        assert_eq!(Identity::new("My Phone", id).unwrap().name(), "My Phone");
        assert_eq!(Identity::new("", id).unwrap_err(), HiveError::EmptyName);
        assert_eq!(Identity::new("   ", id).unwrap_err(), HiveError::EmptyName);
    }

    #[test]
    fn pairing_code_is_eight_crockford_chars_from_the_seed() {
        let seeds: &[&[u8]] = &[b"", b"a", b"ab", b"hello", b"\0", &[0xff; 64]];
        for seed in seeds {
            let code = PairingCode::from_seed(seed);
            assert_eq!(code.as_str().chars().count(), PAIRING_LEN);
            assert_eq!(code, PairingCode::from_seed(seed));
            for ch in code.as_str().chars() {
                assert!(PAIRING_ALPHABET.contains(ch), "{code} has {ch}");
            }
            assert_eq!(PairingCode::parse(code.as_str()).unwrap(), code);
            assert_eq!(
                PairingCode::parse(&code.as_str().to_ascii_lowercase()).unwrap(),
                code
            );
        }
        assert_ne!(PairingCode::from_seed(b"a"), PairingCode::from_seed(b"ab"));
        assert_ne!(
            PairingCode::from_seed(b"seed"),
            PairingCode::from_seed(b"seed2")
        );
    }

    #[test]
    fn pairing_code_accepts_crockford_confusions() {
        let code = PairingCode::parse("o0-il 1111").unwrap();
        assert_eq!(code.as_str(), "00111111");
        assert_eq!(PairingCode::parse("O0IL1111").unwrap(), code);
        assert_eq!(
            PairingCode::parse("u0000000").unwrap_err(),
            HiveError::InvalidPairingCode
        );
        assert_eq!(
            PairingCode::parse("short").unwrap_err(),
            HiveError::InvalidPairingCode
        );
        assert_eq!(
            PairingCode::parse("123456789").unwrap_err(),
            HiveError::InvalidPairingCode
        );
        assert_eq!(
            PairingCode::parse("é1234567").unwrap_err(),
            HiveError::InvalidPairingCode
        );
    }

    #[test]
    fn confirm_pairs_matching_codes_and_rejects_a_mismatch() {
        let phone = Identity::new("Phone", id(1)).unwrap();
        let pc = Identity::new("PC", id(2)).unwrap();
        let seed = b"kitchen-table";
        let phone_pair = Pairing::open(phone.clone(), seed);
        let pc_pair = Pairing::open(pc.clone(), seed);
        assert_eq!(phone_pair.code(), pc_pair.code());
        assert_ne!(phone.id(), pc.id());

        let peer = phone_pair.confirm(&pc_pair.code(), pc.clone()).unwrap();
        assert_eq!(peer, pc);

        let back = pc_pair.confirm(&phone_pair.code(), phone.clone()).unwrap();
        assert_eq!(back.name(), "Phone");
        assert_eq!(back.id(), phone.id());

        let other = Pairing::open(pc.clone(), b"different-seed");
        assert_ne!(phone_pair.code(), other.code());
        assert_eq!(
            phone_pair.confirm(&other.code(), pc).unwrap_err(),
            HiveError::CodeMismatch
        );
        assert_eq!(
            phone_pair.confirm(&phone_pair.code(), phone).unwrap_err(),
            HiveError::SelfPair
        );
    }

    #[test]
    fn same_seed_matches_across_different_names() {
        let a = Pairing::open(Identity::new("Phone", id(1)).unwrap(), b"same");
        let b = Pairing::open(Identity::new("PC", id(9)).unwrap(), b"same");
        assert_eq!(a.code(), b.code());
        let typed =
            PairingCode::parse(&format!(" {} ", a.code().as_str().to_ascii_lowercase())).unwrap();
        assert_eq!(a.confirm(&typed, b.local().clone()).unwrap().name(), "PC");
    }
}
