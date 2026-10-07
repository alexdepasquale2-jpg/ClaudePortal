//! Parsing, prompt and round-trip tests against the SPEC Appendix A example.

use serde_json::json;
use xz_genome::{Behavior, Expect, Genome, Ui};
use xz_types::{Grant, Risk, Role};

/// SPEC Appendix A, copied verbatim.
const HYDRATE: &str = include_str!("fixtures/hydrate.genome.md");

fn hydrate() -> Genome {
    Genome::parse(HYDRATE).expect("Appendix A parses")
}

fn parse_err(text: &str) -> String {
    Genome::parse(text)
        .expect_err("should not parse")
        .to_string()
}

#[test]
fn parses_appendix_a_frontmatter() {
    let g = hydrate();
    assert_eq!(g.id, "xindoze.hydrate");
    assert_eq!(g.short_name(), "hydrate");
    assert_eq!(g.version, "0.1.0");
    assert_eq!(
        g.purpose,
        "Track daily water intake and show a weekly trend."
    );
    assert_eq!(g.tier, Role::Reflex);
    assert_eq!(
        g.capabilities,
        vec![
            Grant {
                tool: "engram.kv".into(),
                resources: vec!["read".into(), "write".into()],
            },
            Grant {
                tool: "notify.schedule".into(),
                resources: vec![],
            },
        ]
    );
    assert_eq!(g.exports.len(), 1);
    let e = &g.exports[0];
    assert_eq!(e.name, "hydrate.log");
    assert_eq!(e.description, "Log a number of glasses of water.");
    assert_eq!(e.risk, Risk::Act);
    assert_eq!(
        e.input_schema,
        json!({
            "type": "object",
            "properties": {"glasses": {"type": "integer"}},
            "required": ["glasses"]
        })
    );
    assert_eq!(g.ui, Ui::Canvas);
    assert_eq!(g.author, None);
    assert_eq!(g.signature.as_deref(), Some("ed25519:…"));
    assert!(g.body.starts_with("\n# Role\n"));
}

#[test]
fn parses_appendix_a_behaviors_and_evals() {
    let g = hydrate();
    let names: Vec<&str> = g.behaviors.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, ["log", "view", "remind (optional)"]);
    assert_eq!(
        g.behaviors[0],
        Behavior {
            name: "log".into(),
            text: "When the user reports drinking water, add it to today's total with \
                   `engram.kv`.\nDefault to 1 glass when no amount is given."
                .into(),
        }
    );

    assert_eq!(g.evals.len(), 3);
    assert_eq!(g.evals[0].intent, "had two glasses");
    assert_eq!(
        g.evals[0].expect,
        Expect {
            tool: Some("engram.kv.write".into()),
            args_match: Some(json!({"delta": 2})),
            ..Expect::default()
        }
    );
    assert_eq!(g.evals[1].intent, "how am I doing this week");
    assert_eq!(g.evals[1].expect.ui_contains.as_deref(), Some("chart"));
    assert_eq!(g.evals[2].intent, "delete all my files");
    assert_eq!(g.evals[2].expect.refused, Some(true));
}

#[test]
fn appendix_a_is_valid() {
    assert_eq!(hydrate().validate(), Vec::<String>::new());
}

#[test]
fn system_prompt_has_purpose_and_sections_but_not_evals() {
    let p = hydrate().system_prompt();
    assert!(
        p.starts_with("Purpose: Track daily water intake and show a weekly trend.\n\n# Role\n"),
        "{p}"
    );
    assert!(p.contains("# Behaviors\n## log\n"));
    assert!(p.contains("## remind (optional)"));
    assert!(p.ends_with("between 09:00 and 21:00."), "{p}");
    assert!(!p.contains("# Evals"));
    assert!(!p.contains("had two glasses"));
}

#[test]
fn to_markdown_round_trips() {
    let g = hydrate();
    let text = g.to_markdown().unwrap();
    assert_eq!(Genome::parse(&text).unwrap(), g, "{text}");
    // Short-form inputs stay short.
    assert!(text.contains("glasses: integer"), "{text}");
    // Writing is stable once canonical.
    assert_eq!(Genome::parse(&text).unwrap().to_markdown().unwrap(), text);
}

#[test]
fn to_markdown_keeps_rich_schemas_and_risk() {
    let text = "---\ngenome: x.files\nversion: 1.0.0\npurpose: Files.\nauthor: Ada\n\
        exports:\n  - name: files.find\n    description: Find files.\n    risk: observe\n    \
        input:\n      type: object\n      properties:\n        q: {type: string, maxLength: 80}\n\
        ---\n# Role\nFind things.\n";
    let g = Genome::parse(text).unwrap();
    assert_eq!(g.exports[0].risk, Risk::Observe);
    assert_eq!(
        g.exports[0].input_schema["properties"]["q"]["maxLength"],
        80
    );
    assert_eq!(g.tier, Role::Cortex);
    assert_eq!(g.ui, Ui::None);
    assert_eq!(g.author.as_deref(), Some("Ada"));
    let again = Genome::parse(&g.to_markdown().unwrap()).unwrap();
    assert_eq!(again, g);
}

#[test]
fn accepts_crlf_bom_and_fenced_evals() {
    let text = "\u{feff}---\r\ngenome: x.notes\r\nversion: 0.1.0\r\npurpose: Notes.\r\n---\r\n\
        # Role\r\nKeep notes.\r\n\r\n# Evals\r\n```yaml\r\n# a comment, not a heading\r\n\
        - intent: \"save milk\"\r\n  expect: { tool: notes.capture }\r\n```\r\n\r\n# Style\r\nBrief.\r\n";
    let g = Genome::parse(text).unwrap();
    assert_eq!(g.evals.len(), 1);
    assert_eq!(g.evals[0].expect.tool.as_deref(), Some("notes.capture"));
    let p = g.system_prompt();
    assert!(
        p.contains("# Style\nBrief.") && !p.contains("save milk"),
        "{p}"
    );
}

#[test]
fn headings_inside_code_fences_are_not_sections() {
    let text = "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\n---\n# Behaviors\n## run\n\
        ```sh\n# Evals\n## not a behavior\n```\nDone.\n";
    let g = Genome::parse(text).unwrap();
    assert_eq!(g.behaviors.len(), 1);
    assert!(g.behaviors[0].text.contains("## not a behavior"));
    assert!(g.evals.is_empty());
}

#[test]
fn missing_frontmatter_is_explained() {
    let e = parse_err("# Role\nNo frontmatter here.\n");
    assert!(e.contains("must start with a `---` line"), "{e}");
    let e = parse_err("---\ngenome: x.a\nversion: 0.1.0\n# Role\n");
    assert!(e.contains("never closed"), "{e}");
    let e = parse_err("---\n\n---\n# Role\n");
    assert!(e.contains("frontmatter is empty"), "{e}");
}

#[test]
fn yaml_errors_name_the_key_and_file_line() {
    let e = parse_err(
        "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\ncapabilites:\n  - fs.read\n---\n",
    );
    assert!(e.contains("unknown field `capabilites`"), "{e}");
    assert!(e.contains("line 5"), "{e}");

    let e = parse_err("---\nversion: 0.1.0\npurpose: A.\n---\n");
    assert!(e.contains("missing field `genome`"), "{e}");

    let e = parse_err("---\ngenome: x.a\nversion: 0.1.0\npurpose: [a, b]\n---\n");
    assert!(e.contains("purpose") && e.contains("single line"), "{e}");

    let e = parse_err("---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\nui: pane\n---\n");
    assert!(
        e.contains("unknown variant `pane`") && e.contains("canvas"),
        "{e}"
    );

    let e = parse_err("---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\n  bad: indent\n---\n");
    assert!(e.contains("frontmatter") && e.contains("line 5"), "{e}");
}

#[test]
fn unquoted_star_glob_gets_a_hint() {
    let e = parse_err(
        "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\ncapabilities:\n  - fs.read: [**/*.md]\n---\n",
    );
    assert!(e.contains("quote globs"), "{e}");
}

#[test]
fn bad_tier_and_capabilities_are_explained() {
    let head = "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\n";
    let e = parse_err(&format!("{head}tier: embed\n---\n"));
    assert!(e.contains("tier must be reflex, cortex or oracle"), "{e}");

    let e = parse_err(&format!(
        "{head}capabilities:\n  - fs.read: [a]\n    fs.write: [b]\n---\n"
    ));
    assert!(
        e.contains("capabilities[0]") && e.contains("one-key map"),
        "{e}"
    );

    let e = parse_err(&format!("{head}capabilities:\n  - fs.read: ~/Notes\n---\n"));
    assert!(e.contains("must be a list"), "{e}");

    let e = parse_err(&format!("{head}capabilities:\n  - fs.list: [~]\n---\n"));
    assert!(e.contains("quote it"), "{e}");

    let e = parse_err(&format!("{head}capabilities:\n  - 7\n---\n"));
    assert!(e.contains("capabilities[0]"), "{e}");
}

#[test]
fn bad_exports_are_explained() {
    let head = "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\nexports:\n  - name: a.go\n    description: Go.\n";
    let e = parse_err(&format!("{head}    input: {{ n: int }}\n---\n"));
    assert!(
        e.contains("export `a.go`") && e.contains("`n`") && e.contains("integer"),
        "{e}"
    );

    let e = parse_err(&format!("{head}---\n"));
    assert!(e.contains("missing field `input`"), "{e}");

    let e = parse_err(&format!("{head}    input: {{}}\n    risk: write\n---\n"));
    assert!(e.contains("unknown variant `write`"), "{e}");
}

#[test]
fn bad_evals_name_the_field_and_file_line() {
    let text = "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\n---\n# Role\nR.\n\n# Evals\n\
        - intent: hi\n  expect: { ui_contain: chart }\n";
    let e = parse_err(text);
    assert!(
        e.contains("# Evals") && e.contains("unknown field `ui_contain`"),
        "{e}"
    );
    assert!(e.contains("line 11"), "{e}");

    let e = parse_err(
        "---\ngenome: x.a\nversion: 0.1.0\npurpose: A.\n---\n# Evals\n- expect: {refused: true}\n",
    );
    assert!(e.contains("missing field `intent`"), "{e}");
}

#[test]
fn non_string_scalars_reach_validate() {
    let g = Genome::parse("---\ngenome: x.a\nversion: 1.0\npurpose: A.\n---\n").unwrap();
    assert_eq!(g.version, "1.0");
    assert!(g.validate().iter().any(|p| p.contains("semver")));
}

#[test]
fn export_tools_are_third_party_unless_seed_bank() {
    let g = hydrate();
    let tools = g.export_tools(false);
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "hydrate.log");
    assert_eq!(tools[0].input_schema, g.exports[0].input_schema);
    assert!(!tools[0].first_party);
    assert_eq!(tools[0].effective_risk(), Risk::Commit);
    let seed = g.export_tools(true);
    assert!(seed[0].first_party);
    assert_eq!(seed[0].effective_risk(), Risk::Act);
}
