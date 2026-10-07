//! Kokoro's text front end: espeak-ng IPA to Kokoro token ids.
//!
//! Pure functions, kept apart from the ONNX session so they are tested in
//! every build.

/// Phonemes per inference call: the model's 512-token context minus two pads.
pub const MAX_PHONEMES: usize = 510;

/// Kokoro v1.0's phoneme vocabulary, from the model's `config.json`.
/// Id 0 is the pad token.
const VOCAB: &[(char, i64)] = &[
    (';', 1),
    (':', 2),
    (',', 3),
    ('.', 4),
    ('!', 5),
    ('?', 6),
    ('—', 9),
    ('…', 10),
    ('"', 11),
    ('(', 12),
    (')', 13),
    ('\u{201C}', 14),
    ('\u{201D}', 15),
    (' ', 16),
    ('\u{0303}', 17),
    ('ʣ', 18),
    ('ʥ', 19),
    ('ʦ', 20),
    ('ʨ', 21),
    ('ᵝ', 22),
    ('ꭧ', 23),
    ('A', 24),
    ('I', 25),
    ('O', 31),
    ('Q', 33),
    ('S', 35),
    ('T', 36),
    ('W', 39),
    ('Y', 41),
    ('ᵊ', 42),
    ('a', 43),
    ('b', 44),
    ('c', 45),
    ('d', 46),
    ('e', 47),
    ('f', 48),
    ('h', 50),
    ('i', 51),
    ('j', 52),
    ('k', 53),
    ('l', 54),
    ('m', 55),
    ('n', 56),
    ('o', 57),
    ('p', 58),
    ('q', 59),
    ('r', 60),
    ('s', 61),
    ('t', 62),
    ('u', 63),
    ('v', 64),
    ('w', 65),
    ('x', 66),
    ('y', 67),
    ('z', 68),
    ('ɑ', 69),
    ('ɐ', 70),
    ('ɒ', 71),
    ('æ', 72),
    ('β', 75),
    ('ɔ', 76),
    ('ɕ', 77),
    ('ç', 78),
    ('ɖ', 80),
    ('ð', 81),
    ('ʤ', 82),
    ('ə', 83),
    ('ɚ', 85),
    ('ɛ', 86),
    ('ɜ', 87),
    ('ɟ', 90),
    ('ɡ', 92),
    ('ɥ', 99),
    ('ɨ', 101),
    ('ɪ', 102),
    ('ʝ', 103),
    ('ɯ', 110),
    ('ɰ', 111),
    ('ŋ', 112),
    ('ɳ', 113),
    ('ɲ', 114),
    ('ɴ', 115),
    ('ø', 116),
    ('ɸ', 118),
    ('θ', 119),
    ('œ', 120),
    ('ɹ', 123),
    ('ɾ', 125),
    ('ɻ', 126),
    ('ʁ', 128),
    ('ɽ', 129),
    ('ʂ', 130),
    ('ʃ', 131),
    ('ʈ', 132),
    ('ʧ', 133),
    ('ʊ', 135),
    ('ʋ', 136),
    ('ʌ', 138),
    ('ɣ', 139),
    ('ɤ', 140),
    ('χ', 142),
    ('ʎ', 143),
    ('ʒ', 147),
    ('ʔ', 148),
    ('ˈ', 156),
    ('ˌ', 157),
    ('ː', 158),
    ('ʰ', 162),
    ('ʲ', 164),
    ('↓', 169),
    ('→', 171),
    ('↗', 172),
    ('↘', 173),
    ('ᵻ', 177),
];

/// espeak spells affricates and diphthongs with two symbols; Kokoro v1.0 was
/// trained on misaki's phoneme set, which uses one.
const MISAKI: &[(&str, &str)] = &[
    ("tʃ", "ʧ"),
    ("dʒ", "ʤ"),
    ("eɪ", "A"),
    ("aɪ", "I"),
    ("aʊ", "W"),
    ("ɔɪ", "Y"),
    ("oʊ", "O"),
    ("əʊ", "Q"),
];

/// Turns `espeak-ng -q --ipa` output into Kokoro phonemes.
///
/// espeak prints one clause per line and drops punctuation, so clauses are
/// rejoined with commas to keep the pauses, and the text ends with a period.
pub fn normalize(ipa: &str) -> String {
    let clauses: Vec<String> = ipa
        .lines()
        .map(|line| {
            strip_lang_flags(line)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|clause| !clause.is_empty())
        .collect();
    if clauses.is_empty() {
        return String::new();
    }
    let mut s = clauses.join(", ");
    s.push('.');
    for (from, to) in MISAKI {
        s = s.replace(from, to);
    }
    s
}

/// Removes espeak's language-switch markers such as `(fr)` or `(en-us)`.
fn strip_lang_flags(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('(') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find(')') {
            Some(close)
                if close > 0
                    && after[..close]
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c == '-') =>
            {
                rest = &after[close + 1..];
            }
            _ => {
                out.push('(');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Maps phonemes to token ids, dropping symbols outside the vocabulary.
pub fn tokenize(phonemes: &str) -> Vec<i64> {
    phonemes
        .chars()
        .filter_map(|c| VOCAB.iter().find(|(v, _)| *v == c).map(|&(_, id)| id))
        .collect()
}

/// Splits phonemes into pieces of at most `max` characters, breaking at
/// spaces where possible.
pub fn chunks(phonemes: &str, max: usize) -> Vec<String> {
    let max = max.max(1);
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0;
    for word in phonemes.split(' ').filter(|w| !w.is_empty()) {
        let mut chars: Vec<char> = word.chars().collect();
        while chars.len() > max {
            if cur_len > 0 {
                out.push(std::mem::take(&mut cur));
                cur_len = 0;
            }
            out.push(chars.drain(..max).collect());
        }
        if cur_len > 0 && cur_len + 1 + chars.len() > max {
            out.push(std::mem::take(&mut cur));
            cur_len = 0;
        }
        if cur_len > 0 {
            cur.push(' ');
            cur_len += 1;
        }
        cur_len += chars.len();
        cur.extend(chars);
    }
    if cur_len > 0 {
        out.push(cur);
    }
    out
}

/// The voice style row for `n_tokens` phonemes: Kokoro voices hold one style
/// per utterance length, and `n` phonemes use row `n - 1`.
pub fn style_row(n_tokens: usize, rows: usize) -> usize {
    n_tokens.clamp(1, rows.max(1)) - 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocab_ids_are_unique_and_nonzero() {
        let mut ids: Vec<i64> = VOCAB.iter().map(|&(_, id)| id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), VOCAB.len());
        assert!(ids[0] > 0);
        assert_eq!(VOCAB.len(), 114);
    }

    #[test]
    fn normalizes_espeak_output() {
        // Real `espeak-ng -q --ipa -v en-us` output for
        // "Hello world. This is Xindoze, okay?"
        let ipa = "həlˈoʊ wˈɜːld\nðɪs ɪz zˈɪndoʊz\noʊkˈeɪ\n";
        assert_eq!(normalize(ipa), "həlˈO wˈɜːld, ðɪs ɪz zˈɪndOz, OkˈA.");
        assert_eq!(normalize("  \n\n"), "");
        assert_eq!(normalize("tʃˈɜːtʃ dʒˈʌdʒ"), "ʧˈɜːʧ ʤˈʌʤ.");
    }

    #[test]
    fn strips_language_flags_only() {
        assert_eq!(strip_lang_flags("(fr)kafe(en) ok"), "kafe ok");
        assert_eq!(strip_lang_flags("(en-us)a"), "a");
        assert_eq!(strip_lang_flags("a (B) () (x"), "a (B) () (x");
    }

    #[test]
    fn tokenizes_known_symbols() {
        assert_eq!(tokenize("hə, A"), vec![50, 83, 3, 16, 24]);
        // Digits, tie bars and Latin capitals outside the set are dropped.
        assert_eq!(tokenize("1\u{0361}Zh"), vec![50]);
    }

    #[test]
    fn chunks_respect_max_and_words() {
        assert_eq!(chunks("ab cd ef", 5), vec!["ab cd", "ef"]);
        assert_eq!(chunks("abcdefg hi", 3), vec!["abc", "def", "g", "hi"]);
        assert_eq!(chunks("  a  b ", 10), vec!["a b"]);
        assert!(chunks("", 10).is_empty());
        let long = "ab ".repeat(400);
        let pieces = chunks(&long, MAX_PHONEMES);
        assert!(pieces.iter().all(|p| p.chars().count() <= MAX_PHONEMES));
        assert_eq!(pieces.concat().replace(' ', ""), "ab".repeat(400));
    }

    #[test]
    fn style_row_follows_length() {
        assert_eq!(style_row(1, 510), 0);
        assert_eq!(style_row(20, 510), 19);
        assert_eq!(style_row(0, 510), 0);
        assert_eq!(style_row(9_999, 510), 509);
        assert_eq!(style_row(5, 0), 0);
    }
}
