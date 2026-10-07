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
        let room = budget.saturating_sub(used);
        if memory.len() <= room {
            used = used.saturating_add(memory.len());
            kept_memories.push(memory.clone());
            continue;
        }
        if let Some(clipped) = clip_to(memory, room) {
            used = budget;
            kept_memories.push(clipped);
        }
        break;
    }
    kept_memories.reverse();

    let mut kept_notes = Vec::new();
    let mut dropped = Vec::new();
    for note in notes.iter().rev() {
        let room = budget.saturating_sub(used);
        if note.len() <= room {
            used = used.saturating_add(note.len());
            kept_notes.push(note.clone());
            continue;
        }
        // A single tool result must not push the prompt past the budget.
        // Ollama drops the front of an over-long prompt, which is the system
        // text. Clip this note, or drop it when nothing useful fits.
        match clip_to(note, room) {
            Some(clipped) => {
                used = budget;
                kept_notes.push(clipped);
            }
            None => dropped.push(note.clone()),
        }
    }
    dropped.reverse();
    kept_notes.reverse();

    let mut sections = vec![system.to_string()];
    sections.extend(kept_memories);
    sections.extend(kept_notes);
    Page { sections, dropped }
}

const CLIP_MARK: &str = "\n…[truncated]";

fn clip_to(text: &str, room: usize) -> Option<String> {
    if room <= CLIP_MARK.len() {
        return None;
    }
    let mut end = room - CLIP_MARK.len();
    if end > text.len() {
        end = text.len();
    }
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    if end == 0 {
        return None;
    }
    let mut out = text[..end].to_string();
    out.push_str(CLIP_MARK);
    Some(out)
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

    #[test]
    fn a_huge_tool_note_is_clipped_inside_the_budget() {
        let huge = format!("UNTRUSTED DATA\ntool: fs.search\n{}", "x".repeat(20_000));
        let page = page(64, "system prompt stays", &[], &[huge]);
        let total: usize = page.sections.iter().map(|section| section.len()).sum();
        assert!(total <= 64 * 4, "{total}");
        assert!(page.sections[0].starts_with("system prompt"));
        assert!(
            page.sections
                .iter()
                .any(|section| section.contains("[truncated]"))
        );
    }
}
