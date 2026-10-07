//! Just enough Markdown structure for genomes: ATX headings outside code fences.

use std::ops::Range;

/// A run of lines that starts at a heading of the split level (or at line 0
/// for the text before the first heading).
pub(crate) struct Chunk {
    /// Heading text, `None` for the preamble.
    pub title: Option<String>,
    /// Lines covered, heading line included.
    pub lines: Range<usize>,
}

impl Chunk {
    /// Lines after the heading.
    pub fn content(&self) -> Range<usize> {
        let skip = usize::from(self.title.is_some());
        self.lines.start + skip..self.lines.end
    }

    /// Case-insensitive title match.
    pub fn is(&self, title: &str) -> bool {
        self.title
            .as_deref()
            .is_some_and(|t| t.eq_ignore_ascii_case(title))
    }
}

/// Whether a line opens or closes a fenced code block.
fn is_fence(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("```") || t.starts_with("~~~")
}

/// The heading text if `line` is an ATX heading of exactly `level`.
fn heading(line: &str, level: usize) -> Option<&str> {
    let rest = line.strip_prefix(&"#".repeat(level))?;
    rest.strip_prefix(' ').map(str::trim)
}

/// Splits `lines[range]` at headings of exactly `level`, ignoring `#` lines
/// inside code fences. Empty chunks (a preamble of zero lines) are dropped.
pub(crate) fn split(lines: &[&str], range: Range<usize>, level: usize) -> Vec<Chunk> {
    let mut chunks = vec![Chunk {
        title: None,
        lines: range.start..range.start,
    }];
    let mut fenced = false;
    for i in range.clone() {
        let line = lines[i];
        if is_fence(line) {
            fenced = !fenced;
        }
        match heading(line, level).filter(|_| !fenced) {
            Some(title) => chunks.push(Chunk {
                title: Some(title.to_string()),
                lines: i..i + 1,
            }),
            None => {
                if let Some(last) = chunks.last_mut() {
                    last.lines.end = i + 1;
                }
            }
        }
    }
    chunks.retain(|c| c.title.is_some() || !c.lines.is_empty());
    chunks
}

/// The YAML lines of an Evals section: the first fenced block if there is
/// one, otherwise the whole section.
pub(crate) fn yaml_lines(lines: &[&str], range: Range<usize>) -> Range<usize> {
    let Some(open) = range.clone().find(|&i| is_fence(lines[i])) else {
        return range;
    };
    let close = (open + 1..range.end)
        .find(|&i| is_fence(lines[i]))
        .unwrap_or(range.end);
    open + 1..close
}
