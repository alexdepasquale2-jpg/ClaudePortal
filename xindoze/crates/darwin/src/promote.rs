//! Champion / challenger (SPEC §3.10).
//!
//! A challenger is promoted only when it is strictly better on eval pass
//! count and no worse on latency. Equal latency is allowed. `evals_total`
//! is part of the score the caller records; the gate is `evals_passed`.
//!
//! Darwin never edits the Charter, the Warden, or the Prime Genome. Those
//! targets are rejected before scores are compared.

use std::fmt;

/// How a champion or challenger scored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Score {
    pub evals_passed: u32,
    pub evals_total: u32,
    pub median_millis: u64,
}

/// A genome version Darwin is comparing, plus the label of what would change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Champion {
    /// Organism id, genome name, or path of the thing being evolved.
    pub target: String,
    pub score: Score,
}

/// Why a challenger was not promoted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reject {
    /// Charter, Warden, or the Prime Genome (`xindoze.prime`).
    Protected { target: String },
    /// `evals_passed` was not strictly greater than the champion.
    NotBetter { champion: u32, challenger: u32 },
    /// Median latency increased. Equal latency is not this variant.
    Slower {
        champion_millis: u64,
        challenger_millis: u64,
    },
}

impl fmt::Display for Reject {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Reject::Protected { target } => {
                write!(f, "cannot promote protected target {target}")
            }
            Reject::NotBetter {
                champion,
                challenger,
            } => write!(
                f,
                "challenger passed {challenger} evals, champion passed {champion}"
            ),
            Reject::Slower {
                champion_millis,
                challenger_millis,
            } => write!(
                f,
                "challenger median {challenger_millis} ms is slower than {champion_millis} ms"
            ),
        }
    }
}

impl std::error::Error for Reject {}

/// Promote `challenger` over `champion`, or say why not.
///
/// Protected targets are rejected outright, even when the scores would win.
/// A target is protected when it is the Prime Genome (`xindoze.prime`, or a
/// path segment whose name is `prime`), or when the path or name contains
/// `charter` or `warden`.
pub fn promote(champion: Champion, challenger: Champion) -> Result<Champion, Reject> {
    if let Some(target) = protected_target(&challenger, &champion) {
        return Err(Reject::Protected { target });
    }
    if challenger.score.evals_passed <= champion.score.evals_passed {
        return Err(Reject::NotBetter {
            champion: champion.score.evals_passed,
            challenger: challenger.score.evals_passed,
        });
    }
    if challenger.score.median_millis > champion.score.median_millis {
        return Err(Reject::Slower {
            champion_millis: champion.score.median_millis,
            challenger_millis: challenger.score.median_millis,
        });
    }
    Ok(challenger)
}

fn protected_target(challenger: &Champion, champion: &Champion) -> Option<String> {
    [&challenger.target, &champion.target]
        .into_iter()
        .find(|t| is_protected(t))
        .cloned()
}

fn is_protected(target: &str) -> bool {
    let lower = target.to_lowercase();
    if lower.contains("xindoze.prime") || lower.contains("charter") || lower.contains("warden") {
        return true;
    }
    lower.split(['/', '\\']).map(stem).any(|seg| seg == "prime")
}

/// File names: `prime`, `prime.toml`, and `prime.tar.gz` are the Prime
/// Genome. `xindoze.prime` is caught by the substring check above, so
/// peeling at the first dot does not hide it.
fn stem(segment: &str) -> &str {
    segment
        .split('.')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(segment)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scored(target: &str, passed: u32, total: u32, millis: u64) -> Champion {
        Champion {
            target: target.to_string(),
            score: Score {
                evals_passed: passed,
                evals_total: total,
                median_millis: millis,
            },
        }
    }

    #[test]
    fn worse_challenger_is_rejected() {
        let err = promote(scored("notes", 4, 5, 10), scored("notes", 3, 5, 10)).unwrap_err();
        assert_eq!(
            err,
            Reject::NotBetter {
                champion: 4,
                challenger: 3
            }
        );
    }

    #[test]
    fn equal_evals_are_rejected_even_when_faster() {
        let err = promote(scored("notes", 4, 5, 20), scored("notes", 4, 5, 5)).unwrap_err();
        assert_eq!(
            err,
            Reject::NotBetter {
                champion: 4,
                challenger: 4
            }
        );
    }

    #[test]
    fn slower_challenger_is_rejected() {
        let err = promote(scored("notes", 4, 5, 10), scored("notes", 5, 5, 11)).unwrap_err();
        assert_eq!(
            err,
            Reject::Slower {
                champion_millis: 10,
                challenger_millis: 11
            }
        );
    }

    #[test]
    fn equal_latency_is_allowed_when_evals_improve() {
        let challenger = scored("notes", 5, 5, 10);
        let got = promote(scored("notes", 4, 5, 10), challenger.clone()).unwrap();
        assert_eq!(got, challenger);
    }

    #[test]
    fn faster_and_strictly_better_is_promoted() {
        let challenger = scored("xindoze.files", 5, 6, 9);
        let got = promote(scored("xindoze.files", 4, 6, 10), challenger.clone()).unwrap();
        assert_eq!(got, challenger);
    }

    #[test]
    fn prime_is_rejected_even_when_scores_win() {
        let err = promote(
            scored("xindoze.prime", 1, 2, 30),
            scored("xindoze.prime", 2, 2, 10),
        )
        .unwrap_err();
        assert_eq!(
            err,
            Reject::Protected {
                target: "xindoze.prime".into()
            }
        );
    }

    #[test]
    fn prime_path_and_bare_name_are_rejected() {
        for target in [
            "genomes/xindoze.prime",
            "genomes/xindoze.prime.md",
            "prime",
            "genomes/prime.toml",
            "C:\\xindoze\\prime",
        ] {
            let err = promote(scored("notes", 1, 1, 1), scored(target, 9, 9, 1)).unwrap_err();
            assert!(
                matches!(err, Reject::Protected { .. }),
                "{target} should be protected, got {err}"
            );
        }
    }

    #[test]
    fn charter_name_and_path_are_rejected() {
        for target in [
            "xindoze.charter",
            "Charter",
            "/home/ada/.local/share/xindoze/charter.toml",
            "rules/CHARTER.md",
        ] {
            let err = promote(scored(target, 1, 1, 1), scored(target, 3, 3, 1)).unwrap_err();
            assert!(
                matches!(err, Reject::Protected { .. }),
                "{target} should be protected, got {err}"
            );
        }
    }

    #[test]
    fn warden_is_rejected() {
        for target in ["warden", "Warden", "crates/warden/src/lib.rs", "xz_warden"] {
            let err = promote(scored("notes", 1, 1, 5), scored(target, 4, 4, 5)).unwrap_err();
            assert!(
                matches!(err, Reject::Protected { .. }),
                "{target} should be protected, got {err}"
            );
        }
    }

    #[test]
    fn a_normal_genome_is_not_protected() {
        let challenger = scored("xindoze.files", 2, 2, 8);
        assert!(promote(scored("xindoze.files", 1, 2, 8), challenger).is_ok());
    }
}
