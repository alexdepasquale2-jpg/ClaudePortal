//! Ed25519 signatures for shared genomes (SPEC §6.6).
//!
//! The signed payload is the whole file, line endings normalized to `\n`,
//! with the frontmatter's `signature:` line removed. Signing text rather
//! than the parsed struct keeps the author's formatting and comments intact.
//!
//! The signature line must be the last frontmatter line. Otherwise moving it
//! would keep the payload, and so the signature, valid while changing the
//! YAML: a plain scalar swallows the indented lines that follow it, such as
//! a capability's resource list.

use crate::text::{self, parse_err};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use xz_types::XzError;

/// A fresh random signing key. Its public half is `key.verifying_key()`.
pub fn generate_keypair() -> Result<SigningKey, XzError> {
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret)
        .map_err(|e| XzError::Other(format!("no system randomness for a key: {e}")))?;
    Ok(SigningKey::from_bytes(&secret))
}

/// Base64 of a public key, as it appears in signature lines.
pub fn pubkey_b64(key: &VerifyingKey) -> String {
    B64.encode(key.as_bytes())
}

/// Signs a genome file and returns it with its `signature:` line set as the
/// last frontmatter line, replacing any existing signature line.
pub fn sign(text: &str, key: &SigningKey) -> Result<String, XzError> {
    let text = text::normalize(text);
    let framed = text::frame(&text)?;
    let mut lines = framed.lines;
    let mut at = framed.close;
    if let Some(i) = signature_line(&lines, at)? {
        lines.remove(i);
        at -= 1;
    }
    let payload = lines.concat();
    let sig = key.sign(payload.as_bytes());
    let line = format!(
        "signature: ed25519:{}:{}\n",
        pubkey_b64(&key.verifying_key()),
        B64.encode(sig.to_bytes())
    );
    lines.insert(at, &line);
    Ok(lines.concat())
}

/// Checks a genome file's signature. `Ok(None)` means unsigned; an error
/// means a signature is present but malformed or does not match the text.
pub fn verify(text: &str) -> Result<Option<VerifyingKey>, XzError> {
    let text = text::normalize(text);
    let framed = text::frame(&text)?;
    let Some(i) = signature_line(&framed.lines, framed.close)? else {
        return Ok(None);
    };
    let Some(value) = signature_value(framed.lines[i]) else {
        return Ok(None);
    };
    if i + 1 != framed.close {
        return Err(parse_err(
            "the `signature:` line must be the last frontmatter line, right before the closing `---`",
        ));
    }
    let (key, sig) = decode(value)?;
    let payload: String = framed
        .lines
        .iter()
        .enumerate()
        .filter(|&(j, _)| j != i)
        .map(|(_, l)| *l)
        .collect();
    key.verify_strict(payload.as_bytes(), &sig).map_err(|_| {
        XzError::Denied(
            "genome signature does not match its text: it was changed after signing".into(),
        )
    })?;
    Ok(Some(key))
}

/// Index of the top-level `signature:` key inside the frontmatter.
fn signature_line(lines: &[&str], close: usize) -> Result<Option<usize>, XzError> {
    let found: Vec<usize> = (1..close)
        .filter(|&i| {
            lines[i]
                .strip_prefix("signature")
                .is_some_and(|r| r.trim_start().starts_with(':'))
        })
        .collect();
    match found[..] {
        [] => Ok(None),
        [i] => Ok(Some(i)),
        _ => Err(parse_err(
            "the frontmatter has more than one `signature:` line",
        )),
    }
}

/// The value of a `signature:` line without quotes or a trailing comment;
/// `None` when empty.
fn signature_value(line: &str) -> Option<&str> {
    let (_, v) = line.split_once(':')?;
    // Base64 has no spaces or `#`, so " #" can only start a YAML comment.
    let v = v.split(" #").next().unwrap_or("").trim();
    let v = v.trim_matches(|c| c == '"' || c == '\'').trim();
    Some(v).filter(|v| !v.is_empty() && *v != "~" && *v != "null")
}

fn decode(value: &str) -> Result<(VerifyingKey, Signature), XzError> {
    let malformed = |why: &str| {
        parse_err(format!(
            "signature must be `ed25519:<public key base64>:<signature base64>` ({why})"
        ))
    };
    let mut parts = value.split(':');
    let (Some("ed25519"), Some(key), Some(sig), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(malformed("wrong shape"));
    };
    let key: [u8; 32] = B64
        .decode(key)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| malformed("the public key is not 32 bytes of base64"))?;
    let sig: [u8; 64] = B64
        .decode(sig)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| malformed("the signature is not 64 bytes of base64"))?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| malformed("invalid public key"))?;
    Ok((key, Signature::from_bytes(&sig)))
}
