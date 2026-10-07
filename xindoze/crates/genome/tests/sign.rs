//! Signing round trip and tamper detection.

use xz_genome::{Genome, generate_keypair, pubkey_b64, sign, verify};
use xz_types::XzError;

const HYDRATE: &str = include_str!("fixtures/hydrate.genome.md");

const UNSIGNED: &str = "---\ngenome: x.notes\nversion: 0.1.0\npurpose: Notes.  # keep\n---\n\
    # Role\nKeep notes.\n";

#[test]
fn unsigned_genome_verifies_as_none() {
    assert!(verify(UNSIGNED).unwrap().is_none());
    let empty = UNSIGNED.replace("---\n#", "signature:\n---\n#");
    assert!(verify(&empty).unwrap().is_none());
}

#[test]
fn round_trip_returns_the_signer() {
    let key = generate_keypair().unwrap();
    let signed = sign(UNSIGNED, &key).unwrap();
    assert_eq!(verify(&signed).unwrap(), Some(key.verifying_key()));
    // Formatting and comments survive; only the signature line is added.
    assert_eq!(signed.replace(&signature_line(&signed), ""), UNSIGNED);
    let g = Genome::parse(&signed).unwrap();
    let sig = g.signature.unwrap();
    assert!(sig.starts_with(&format!("ed25519:{}:", pubkey_b64(&key.verifying_key()))));
}

#[test]
fn signs_the_appendix_example_in_place() {
    let key = generate_keypair().unwrap();
    let signed = sign(HYDRATE, &key).unwrap();
    assert_eq!(signed.matches("\nsignature:").count(), 1);
    assert!(!signed.contains("ed25519:…"));
    // The line keeps its place, right before `---`.
    assert!(signed.contains("ui: canvas\nsignature: ed25519:"));
    assert_eq!(verify(&signed).unwrap(), Some(key.verifying_key()));
    assert!(Genome::parse(&signed).unwrap().validate().is_empty());
}

#[test]
fn moving_the_signature_line_is_rejected() {
    // Moved between a capability and its resources, the line would swallow
    // them as a multi-line plain scalar while the payload stays the same.
    let text = "---\ngenome: x.notes\nversion: 0.1.0\npurpose: Notes.\ncapabilities:\n  \
        - fs.read:\n      - \"~/Notes/**\"\n---\n# Role\nR.\n";
    let key = generate_keypair().unwrap();
    let signed = sign(text, &key).unwrap();
    let line = signature_line(&signed);
    let moved = signed
        .replace(&line, "")
        .replace("  - fs.read:\n", &format!("  - fs.read:\n{line}"));
    let err = verify(&moved).unwrap_err().to_string();
    assert!(err.contains("last frontmatter line"), "{err}");
    // Re-signing such a file moves the line back to the end.
    let fixed = sign(&moved, &key).unwrap();
    assert!(fixed.contains("**\"\nsignature: ed25519:"), "{fixed}");
    assert!(verify(&fixed).unwrap().is_some());
}

#[test]
fn resigning_replaces_the_signature() {
    let (a, b) = (generate_keypair().unwrap(), generate_keypair().unwrap());
    let twice = sign(&sign(UNSIGNED, &a).unwrap(), &b).unwrap();
    assert_eq!(twice.matches("signature:").count(), 1);
    assert_eq!(verify(&twice).unwrap(), Some(b.verifying_key()));
}

#[test]
fn crlf_copies_still_verify() {
    let key = generate_keypair().unwrap();
    let signed = sign(UNSIGNED, &key).unwrap();
    assert!(verify(&signed.replace('\n', "\r\n")).unwrap().is_some());
}

#[test]
fn tampering_is_detected() {
    let key = generate_keypair().unwrap();
    let signed = sign(UNSIGNED, &key).unwrap();
    for tampered in [
        signed.replace("Keep notes.", "Delete notes."),
        signed.replace("purpose: Notes.", "purpose: Notes!"),
        signed.replace("purpose:", "capabilities:\n  - fs.*\npurpose:"),
        format!("{signed}\nextra"),
    ] {
        let err = verify(&tampered).unwrap_err();
        assert!(matches!(err, XzError::Denied(_)), "{err}");
    }
    // Keys added after the signature line are refused by position.
    let appended = signed.replace("\n---\n# Role", "\ncapabilities:\n  - fs.*\n---\n# Role");
    assert!(matches!(verify(&appended), Err(XzError::Parse(_))));
    // A valid signature from another key over different text does not transfer.
    let other = sign(&UNSIGNED.replace("Notes.", "Other."), &key).unwrap();
    let spliced = signed.replace(&signature_line(&signed), &signature_line(&other));
    assert!(verify(&spliced).is_err());
}

#[test]
fn malformed_signatures_are_errors() {
    // The Appendix A placeholder is present but not a real signature.
    assert!(matches!(verify(HYDRATE), Err(XzError::Parse(_))));
    for bad in [
        "signature: rsa:AAAA:BBBB\n",
        "signature: ed25519:notbase64!:AAAA\n",
        "signature: ed25519:AAAA:AAAA\n",
    ] {
        let text = UNSIGNED.replace("---\n#", &format!("{bad}---\n#"));
        let err = verify(&text).unwrap_err().to_string();
        assert!(err.contains("ed25519:<public key base64>"), "{bad}: {err}");
    }
    let two = UNSIGNED.replace("---\n#", "signature: a\nsignature: b\n---\n#");
    assert!(
        verify(&two)
            .unwrap_err()
            .to_string()
            .contains("more than one")
    );
    assert!(sign("no frontmatter", &generate_keypair().unwrap()).is_err());
}

fn signature_line(text: &str) -> String {
    let line = text
        .lines()
        .find(|l| l.starts_with("signature:"))
        .expect("signed text has a signature line");
    format!("{line}\n")
}
