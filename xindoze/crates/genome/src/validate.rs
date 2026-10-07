//! Semantic checks run at Germinate and by Forge before install.

use crate::genome::Genome;
use std::collections::HashSet;

impl Genome {
    /// Every problem that should stop this genome from germinating.
    /// Empty means valid. Signatures are checked separately by [`crate::verify`].
    pub fn validate(&self) -> Vec<String> {
        let mut p = vec![];
        if !valid_id(&self.id) {
            p.push(format!(
                "genome id `{}` must be dot-separated lowercase segments of [a-z0-9_-], \
                 e.g. xindoze.notes",
                self.id
            ));
        }
        if semver::Version::parse(self.version.trim()).is_err() {
            p.push(format!(
                "version `{}` is not semver (major.minor.patch, e.g. 0.1.0)",
                self.version
            ));
        }
        let purpose = self.purpose.trim();
        if purpose.is_empty() {
            p.push("purpose is empty; the router reads it to pick this genome".into());
        } else if purpose.contains('\n') {
            p.push("purpose must be one line".into());
        }
        self.check_capabilities(&mut p);
        self.check_exports(&mut p);
        for (i, e) in self.evals.iter().enumerate() {
            if e.intent.trim().is_empty() {
                p.push(format!("evals[{i}]: intent is empty"));
            }
            for problem in e.expect.problems() {
                p.push(format!("evals[{i}] ({:?}): {problem}", e.intent));
            }
        }
        p
    }

    fn check_capabilities(&self, p: &mut Vec<String>) {
        for (i, g) in self.capabilities.iter().enumerate() {
            if g.tool.trim().is_empty() {
                p.push(format!("capabilities[{i}]: the tool glob is empty"));
            } else if let Err(e) = globset::Glob::new(&g.tool) {
                p.push(format!(
                    "capabilities[{i}]: bad tool glob `{}`: {e}",
                    g.tool
                ));
            }
            for r in &g.resources {
                if r.trim().is_empty() {
                    p.push(format!(
                        "capabilities[{i}] `{}`: a resource glob is empty",
                        g.tool
                    ));
                } else if let Err(e) = globset::Glob::new(r) {
                    p.push(format!(
                        "capabilities[{i}] `{}`: bad resource glob `{r}`: {e}",
                        g.tool
                    ));
                }
            }
        }
    }

    fn check_exports(&self, p: &mut Vec<String>) {
        let prefix = format!("{}.", self.short_name());
        let mut seen = HashSet::new();
        for e in &self.exports {
            let verb = e.name.strip_prefix(&prefix).unwrap_or("");
            if verb.is_empty() {
                p.push(format!(
                    "export `{}` must be named `{prefix}<verb>` after the genome id `{}`",
                    e.name, self.id
                ));
            }
            if !seen.insert(e.name.as_str()) {
                p.push(format!("export `{}` is declared twice", e.name));
            }
            if e.description.trim().is_empty() {
                p.push(format!(
                    "export `{}` has no description; planners choose tools by it",
                    e.name
                ));
            }
            if e.input_schema.get("type").and_then(|t| t.as_str()) != Some("object") {
                p.push(format!(
                    "export `{}`: input must describe an object (`type: object`)",
                    e.name
                ));
            }
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.split('.').all(|seg| {
            !seg.is_empty()
                && seg
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: &str = "---\ngenome: xindoze.notes\nversion: 0.1.0\npurpose: Capture and recall notes.\n\
        capabilities:\n  - fs.read: [\"~/Notes/**\"]\nexports:\n  - name: notes.capture\n    \
        description: Save a note.\n    input: { text: string }\n---\n# Role\nYou keep notes.\n";

    fn problems(edit: impl FnOnce(&mut Genome)) -> String {
        let mut g = Genome::parse(OK).unwrap();
        edit(&mut g);
        g.validate().join(" | ")
    }

    #[test]
    fn valid_genome_has_no_problems() {
        assert_eq!(problems(|_| {}), "");
    }

    #[test]
    fn checks_id_charset() {
        for bad in [
            "Xindoze.Notes",
            "notes app",
            "xindoze..notes",
            ".notes",
            "",
            "a/b",
        ] {
            assert!(
                problems(|g| g.id = bad.into()).contains("dot-separated"),
                "{bad}"
            );
        }
        assert!(!problems(|g| g.id = "my-org.notes_2".into()).contains("dot-separated"));
    }

    #[test]
    fn checks_semver() {
        for bad in ["1", "1.0", "v1.0.0", "one"] {
            assert!(
                problems(|g| g.version = bad.into()).contains("semver"),
                "{bad}"
            );
        }
        assert_eq!(problems(|g| g.version = "1.2.3-beta.1".into()), "");
    }

    #[test]
    fn checks_purpose() {
        assert!(problems(|g| g.purpose = "  ".into()).contains("purpose is empty"));
        assert!(problems(|g| g.purpose = "a\nb".into()).contains("one line"));
    }

    #[test]
    fn checks_export_names_and_shape() {
        assert!(problems(|g| g.exports[0].name = "capture".into()).contains("`notes.<verb>`"));
        assert!(
            problems(|g| g.exports[0].name = "files.capture".into()).contains("`notes.<verb>`")
        );
        assert!(problems(|g| g.exports[0].name = "notes.".into()).contains("`notes.<verb>`"));
        assert!(problems(|g| g.exports.push(g.exports[0].clone())).contains("declared twice"));
        assert!(problems(|g| g.exports[0].description.clear()).contains("no description"));
        assert!(
            problems(|g| g.exports[0].input_schema = serde_json::json!({"type": "string"}))
                .contains("describe an object")
        );
    }

    #[test]
    fn checks_capability_globs() {
        assert!(problems(|g| g.capabilities[0].tool = " ".into()).contains("tool glob is empty"));
        assert!(problems(|g| g.capabilities[0].tool = "fs.[".into()).contains("bad tool glob"));
        assert!(
            problems(|g| g.capabilities[0].resources = vec!["".into()])
                .contains("resource glob is empty")
        );
        assert!(
            problems(|g| g.capabilities[0].resources = vec!["~/{a".into()])
                .contains("bad resource glob")
        );
    }

    #[test]
    fn checks_evals() {
        let p = problems(|g| {
            g.evals.push(crate::Eval {
                intent: " ".into(),
                expect: crate::Expect::default(),
            })
        });
        assert!(
            p.contains("intent is empty") && p.contains("no condition"),
            "{p}"
        );
    }
}
