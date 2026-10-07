//! Tool specs for `fs.*`: names, risks and resource args are fixed by the
//! core catalog.

use serde_json::{Value, json};
use xz_types::Risk::{Act, Commit, Observe};
use xz_types::ToolSpec;

use crate::util::tool;

const PATH_HINT: &str = "Path; `~` is your home folder and relative paths are relative to it";

fn path_prop(what: &str) -> Value {
    json!({"type": "string", "description": format!("{what}. {PATH_HINT}.")})
}

fn object(props: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": false
    })
}

pub(super) fn all() -> Vec<ToolSpec> {
    vec![
        tool(
            "fs.read",
            "Read a file. Text files return their text (cut at max_bytes, default 256 KB), \
             PDFs return their extracted text, other binary files return only \
             {binary: true, size}.",
            Observe,
            object(
                json!({
                    "path": path_prop("File to read, e.g. ~/Notes/today.md"),
                    "max_bytes": {"type": "integer", "minimum": 1,
                                  "description": "Most bytes of text to return."}
                }),
                &["path"],
            ),
            &["path"],
            false,
        ),
        tool(
            "fs.list",
            "List a folder, sorted by name. Each entry has name, path, kind \
             (file, dir, symlink, other), size and modified time. Symbolic links are \
             reported, never followed.",
            Observe,
            object(
                json!({
                    "path": path_prop("Folder to list, e.g. ~/Documents"),
                    "recursive": {"type": "boolean", "default": false,
                                  "description": "Also list everything below."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10000, "default": 200,
                              "description": "Most entries to return."}
                }),
                &["path"],
            ),
            &["path"],
            false,
        ),
        tool(
            "fs.stat",
            "Describe one path: {exists, kind, size, modified, readonly}; a symbolic link \
             is described itself (with its target), not followed.",
            Observe,
            object(json!({"path": path_prop("Path to describe")}), &["path"]),
            &["path"],
            false,
        ),
        tool(
            "fs.search",
            "Find files below root. Filters (all optional, combined with AND): name_glob \
             (case-insensitive glob on the file name, e.g. *.pdf), contains (case-insensitive \
             text inside text files and PDFs up to 20 MB), min_size (bytes). sort: size \
             (largest first), modified (newest first) or name. Hidden folders are skipped. \
             With only name_glob, matching folders are returned too.",
            Observe,
            object(
                json!({
                    "root": path_prop("Folder to search, e.g. ~ or ~/Documents"),
                    "name_glob": {"type": "string"},
                    "contains": {"type": "string"},
                    "sort": {"type": "string", "enum": ["size", "modified", "name"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 50},
                    "min_size": {"type": "integer", "minimum": 0}
                }),
                &["root"],
            ),
            &["root"],
            false,
        ),
        tool(
            "fs.write",
            "Write text to a file, creating it and any missing parent folders. Replaces the \
             file's contents unless append is true. Undoable with Rewind.",
            Act,
            object(
                json!({
                    "path": path_prop("File to write"),
                    "content": {"type": "string"},
                    "append": {"type": "boolean", "default": false}
                }),
                &["path", "content"],
            ),
            &["path"],
            false,
        ),
        tool(
            "fs.mkdir",
            "Create a folder and any missing parent folders. Undoable with Rewind.",
            Act,
            object(json!({"path": path_prop("Folder to create")}), &["path"]),
            &["path"],
            false,
        ),
        tool(
            "fs.move",
            "Move or rename a file or folder. If `to` is an existing folder, the item moves \
             into it. Never overwrites an existing file. Undoable with Rewind.",
            Act,
            object(
                json!({
                    "from": path_prop("What to move"),
                    "to": path_prop("New path, or an existing folder to move into")
                }),
                &["from", "to"],
            ),
            &["from", "to"],
            false,
        ),
        tool(
            "fs.copy",
            "Copy a file or folder (folders recursively). If `to` is an existing folder, the \
             copy goes into it. Never overwrites an existing file. Undoable with Rewind.",
            Act,
            object(
                json!({
                    "from": path_prop("What to copy"),
                    "to": path_prop("Path of the copy, or an existing folder to copy into")
                }),
                &["from", "to"],
            ),
            &["from", "to"],
            false,
        ),
        tool(
            "fs.trash",
            "Move a file or folder to the Xindoze trash. Undoable with Rewind; prefer this \
             over fs.delete_permanent.",
            Act,
            object(json!({"path": path_prop("What to trash")}), &["path"]),
            &["path"],
            false,
        ),
        tool(
            "fs.delete_permanent",
            "Delete a file or folder permanently. This cannot be undone; use fs.trash unless \
             the user asked for permanent deletion.",
            Commit,
            object(json!({"path": path_prop("What to delete")}), &["path"]),
            &["path"],
            false,
        ),
    ]
}
