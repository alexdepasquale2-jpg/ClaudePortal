//! Context Pager: fit a prompt into a token budget (SPEC §3.7).
//!
//! The system prompt always stays. Memories and tool notes are kept
//! newest-first. What does not fit is returned so the caller can summarize
//! it into an episode.

/// One assembled prompt and the notes that did not fit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    /// System text, then kept memories, then kept tool notes (oldest first).
    pub sections: Vec<String>,
    /// Tool notes dropped to stay inside the budget, oldest first.
    pub dropped: Vec<String>,
}

/// Assembles `system`, `memories` and `notes` into about `budget_tokens`.
///
/// A token counts as four characters, which is enough to decide what to
/// evict. `system` is kept even when it alone exceeds the budget. Notes are
/// recent tool results, newest last; the oldest are dropped first.
pub fn page(budget_tokens: usize, system: &str, memories: &[String], notes: &[String]) -> Page {
    let budget = budget_tokens.saturating_mul(4);
    let mut used = system.len();

    let mut kept_memories = Vec::new();
    for memory in memories.iter().rev() {
        if !kept_memories.is_empty() && used.saturating_add(memory.len()) > budget {
            break;
        }
        used = used.saturating_add(memory.len());
        kept_memories.push(memory.clone());
    }
    kept_memories.reverse();

    let mut kept_notes = Vec::new();
    let mut dropped = Vec::new();
    for note in notes.iter().rev() {
        if !kept_notes.is_empty() && used.saturating_add(note.len()) > budget {
            dropped.push(note.clone());
        } else {
            used = used.saturating_add(note.len());
            kept_notes.push(note.clone());
        }
    }
    dropped.reverse();
    kept_notes.reverse();

    let mut sections = vec![system.to_string()];
    sections.extend(kept_memories);
    sections.extend(kept_notes);
    Page { sections, dropped }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_the_oldest_notes_and_keeps_the_system_prompt() {
        let notes = vec!["aaaa".repeat(10), "bbbb".repeat(10), "cccc".repeat(10)];
        let page = page(15, "system prompt", &["memory one".into()], &notes);
        assert!(page.sections[0].starts_with("system"));
        assert!(page.dropped.iter().any(|d| d.starts_with("aaaa")));
        assert!(page.sections.iter().any(|s| s.starts_with("cccc")));
    }
}
