//! Warden and Charter: deterministic policy enforcement (SPEC §3.4, §6).
//!
//! The Charter is the user's policy (`charter.toml`). The Warden applies it
//! to every tool call and answers Allow, Ask or Deny. No model runs here:
//! the same Charter, grants, call and recent history always give the same
//! decision.
//!
//! Decision order for one call, most restrictive result wins:
//! 1. The tool must match a grant.
//! 2. Every declared resource argument must be a string, resolve to a path
//!    outside the data directory, and fall inside the matching grants.
//!    URL-shaped values must be http(s) and pass the egress check.
//! 3. The most restrictive matching Charter rule, else the default for the
//!    tool's risk class (third-party tools count as commit).
//! 4. Floors: tainted commit calls and a few core tools always ask.
//! 5. The per-Organism rate budget.
//!
//! Limits: path checks are lexical. A symlink inside a granted folder can
//! point anywhere, so Organs that follow links must re-check the target.

mod charter;
mod glob;
mod resource;
mod warden;

pub use charter::{Budgets, Charter, Defaults, Egress, Policy, Rule, When, parse_rule};
pub use warden::{Request, Warden};
