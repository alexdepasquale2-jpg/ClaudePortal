//! Loading genome files from a directory.

use std::fs;
use xz_genome::load_dir;

const OK: &str = "---\ngenome: x.notes\nversion: 0.1.0\npurpose: Notes.\n---\n# Role\nR.\n";

#[test]
fn loads_genome_files_recursively_and_reports_bad_ones() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("notes.genome.md"), OK).unwrap();
    fs::write(root.join("broken.genome.md"), "# no frontmatter\n").unwrap();
    fs::write(root.join("README.md"), OK).unwrap();
    fs::create_dir(root.join("files")).unwrap();
    fs::write(
        root.join("files/files.genome.md"),
        OK.replace("x.notes", "x.files"),
    )
    .unwrap();
    fs::create_dir(root.join(".hidden")).unwrap();
    fs::write(root.join(".hidden/h.genome.md"), OK).unwrap();

    let loaded = load_dir(root);
    let names: Vec<String> = loaded
        .iter()
        .map(|(p, _)| p.strip_prefix(root).unwrap().display().to_string())
        .collect();
    assert_eq!(
        names,
        [
            "broken.genome.md",
            "files/files.genome.md",
            "notes.genome.md"
        ]
        .map(|n| std::path::Path::new(n).display().to_string())
    );
    assert!(loaded[0].1.is_err());
    assert_eq!(loaded[1].1.as_ref().unwrap().id, "x.files");
    assert_eq!(loaded[2].1.as_ref().unwrap().id, "x.notes");
}

#[test]
fn missing_dir_loads_nothing() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load_dir(&dir.path().join("nope")).is_empty());
}
