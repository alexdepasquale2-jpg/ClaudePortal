//! Line-ending normalization, frontmatter framing and YAML error wording,
//! shared by parsing and signing so both see the same lines.

use xz_types::XzError;

/// Strips a leading BOM and converts CRLF and lone CR line endings to `\n`.
pub(crate) fn normalize(text: &str) -> String {
    text.strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

/// A normalized genome file cut into lines, each keeping its `\n`.
pub(crate) struct Framed<'a> {
    pub lines: Vec<&'a str>,
    /// Index of the closing `---` line. Line 0 is the opening one.
    pub close: usize,
}

/// Locates the frontmatter block. Expects normalized text.
pub(crate) fn frame(text: &str) -> Result<Framed<'_>, XzError> {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    if lines.first().map(|l| l.trim_end()) != Some("---") {
        return Err(parse_err(
            "a genome must start with a `---` line, then the YAML frontmatter keys, \
             then a closing `---` line, then the Markdown body",
        ));
    }
    let close = lines
        .iter()
        .skip(1)
        .position(|l| l.trim_end() == "---")
        .map(|i| i + 1)
        .ok_or_else(|| {
            parse_err(
                "the frontmatter opened by `---` on line 1 is never closed: \
                 add a `---` line after the YAML keys",
            )
        })?;
    Ok(Framed { lines, close })
}

impl Framed<'_> {
    /// The YAML between the two `---` lines.
    pub fn yaml(&self) -> String {
        self.lines[1..self.close].concat()
    }

    /// Everything after the closing `---` line.
    pub fn body(&self) -> String {
        self.lines[self.close + 1..].concat()
    }

    /// Number of file lines before the body.
    pub fn body_offset(&self) -> usize {
        self.close + 1
    }
}

/// Parses YAML whose first line is file line `offset + 1`.
///
/// Padding with blank lines makes the parser's "at line N" match the file,
/// which is the line number an author or Forge needs to fix the text.
pub(crate) fn from_yaml<T: serde::de::DeserializeOwned>(
    yaml: &str,
    offset: usize,
    context: &str,
) -> Result<T, XzError> {
    let padded = format!("{}{yaml}", "\n".repeat(offset));
    serde_yaml_ng::from_str(&padded).map_err(|e| {
        let msg = e.to_string();
        // serde_yaml_ng writes paths into a top-level list as `.[0]`.
        let msg = msg
            .strip_prefix('.')
            .filter(|m| m.starts_with('['))
            .unwrap_or(&msg);
        // A leading `*` starts a YAML alias, which surprises people writing globs.
        let hint = if msg.contains("anchor") || msg.contains("alias") {
            " (a value starting with `*` is a YAML alias: quote globs, e.g. \"**/*.md\")"
        } else {
            ""
        };
        parse_err(format!("{context}: {msg}{hint}"))
    })
}

pub(crate) fn parse_err(msg: impl Into<String>) -> XzError {
    XzError::Parse(msg.into())
}
