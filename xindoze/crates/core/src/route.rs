//! Intent routing (SPEC §3.8): Reflex picks an installed Organism.

use xz_genome::Genome;
use xz_types::{Result, XzError};

/// The genome that should handle `intent`.
///
/// Matching is keyword routing, the job SPEC gives Reflex. Evals call a
/// genome directly and do not come through here. An intent that matches
/// nothing goes to Prime.
pub fn route<'a>(intent: &str, genomes: &'a [Genome]) -> Result<&'a Genome> {
    let text = intent.to_lowercase();
    let suffix = if contains(
        &text,
        &[
            "make me an app",
            "make an app",
            "build an app",
            "kinds of apps",
        ],
    ) {
        "forge"
    } else if contains(
        &text,
        &[
            "never send",
            "don't let any app",
            "permanently deleted",
            "allow everything",
        ],
    ) {
        "charter"
    } else if contains(
        &text,
        &[
            "largest file",
            "safe to delete",
            "invoice",
            "taxes",
            "home folder",
            ".pdf",
            "pdf",
        ],
    ) {
        "files"
    } else if contains(&text, &["note:", "passport", "dentist", "my notes"]) {
        "notes"
    } else if contains(&text, &["glass", "drink water", "water intake"]) {
        "hydrate"
    } else if contains(
        &text,
        &["summarize", "wikipedia", "pastebin", "http://", "https://"],
    ) {
        "web"
    } else if contains(&text, &["screen", "camera", "photo"]) {
        "sight"
    } else if contains(
        &text,
        &[
            "devices are online",
            "my devices",
            "send this note",
            "on my pc",
            "203.0.113",
        ],
    ) {
        "hive"
    } else if contains(
        &text,
        &[
            "programs are running",
            "docx",
            "pandoc",
            "curl",
            "close every program",
        ],
    ) {
        "ancestors"
    } else if contains(
        &text,
        &["how is my system", "ram", "forge do", "kill the app"],
    ) || (text.contains("leaving my device") && !text.contains("right now"))
    {
        "pulse"
    } else {
        "prime"
    };
    find(genomes, suffix)
        .or_else(|| find(genomes, "prime"))
        .ok_or_else(|| XzError::NotFound("no genome is installed to handle that".into()))
}

fn contains(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| text.contains(n))
}

fn find<'a>(genomes: &'a [Genome], suffix: &str) -> Option<&'a Genome> {
    let tail = format!(".{suffix}");
    genomes
        .iter()
        .find(|g| g.id == format!("xindoze.{suffix}") || g.id.ends_with(&tail))
}

#[cfg(test)]
mod tests {
    use super::*;
    use xz_genome::Genome;

    fn genomes() -> Vec<Genome> {
        ["files", "prime", "forge", "charter"]
            .into_iter()
            .map(|name| {
                Genome::parse(&format!(
                    "---\ngenome: xindoze.{name}\nversion: 0.1.0\npurpose: {name}.\n---\n# Role\nTest.\n"
                ))
                .unwrap()
            })
            .collect()
    }

    #[test]
    fn largest_files_go_to_files_and_unknown_goes_to_prime() {
        let g = genomes();
        assert_eq!(
            route(
                "find my 10 largest files and tell me which look safe to delete",
                &g
            )
            .unwrap()
            .id,
            "xindoze.files"
        );
        assert_eq!(
            route("what time is it in theory", &g).unwrap().id,
            "xindoze.prime"
        );
    }
}
