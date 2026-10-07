//! Genome format: parse, validate, and check evals (SPEC §3.8, Appendix A).
//!
//! A Genome is Markdown with YAML frontmatter. Signatures are stored and
//! shown; verification is TODO(phase 4). A model never installs a Genome
//! by writing this file itself — Forge asks, and the user confirms.

mod eval;
mod parse;

pub use eval::{EvalCase, EvalExpect};
pub use parse::Genome;

/// The loose object after `expect:` in an eval. Not JSON: keys and bare
/// words are unquoted, as in Appendix A.
pub(crate) fn parse_loose(input: &str) -> xz_types::Result<serde_json::Value> {
    let mut i = 0;
    let value = eval::parse_value(input, &mut i)?;
    skip(input, &mut i);
    if i < input.len() {
        return Err(xz_types::XzError::Parse(format!(
            "trailing input in `{input}`"
        )));
    }
    Ok(value)
}

pub(crate) fn skip(s: &str, i: &mut usize) {
    while let Some(c) = s[*i..].chars().next() {
        if c.is_whitespace() {
            *i += c.len_utf8();
        } else {
            break;
        }
    }
}
