//! Genome format: parse, validate, sign (SPEC 3.8, Appendix A).
//!
//! A genome is a Markdown file with YAML frontmatter. [`Genome::parse`]
//! reads it, [`Genome::validate`] lists what would stop it germinating,
//! [`Genome::system_prompt`] builds the Organism's prompt, and
//! [`sign`] / [`verify`] handle Ed25519 signatures on shared genomes.
//! [`Expect::check`] scores a run against one of the genome's evals.

mod eval;
mod genome;
mod load;
mod markdown;
mod schema;
mod sign;
mod text;
mod validate;

pub use ed25519_dalek::{SigningKey, VerifyingKey};
pub use eval::{Eval, Expect, Observed};
pub use genome::{Behavior, Export, Genome, Ui};
pub use load::{EXTENSION, load_dir};
pub use sign::{generate_keypair, pubkey_b64, sign, verify};
