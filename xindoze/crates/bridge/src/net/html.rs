//! Readable text from HTML: the title and the visible prose.
//!
//! This streams html5ever's tokenizer instead of building a DOM. The tree
//! builder's scope checks cost time proportional to nesting depth for
//! every tag, so a hostile page of deeply nested elements could burn
//! minutes of CPU; the tokenizer is linear.

use html5ever::tendril::StrTendril;
use html5ever::tokenizer::states::RawKind;
use html5ever::tokenizer::{
    BufferQueue, CharacterTokens, EndTag, StartTag, Tag, TagToken, Token, TokenSink,
    TokenSinkResult, Tokenizer, TokenizerOpts,
};
use std::cell::RefCell;

/// Elements whose content is code, chrome or invisible, never prose.
/// (`head` is not here: its closing tag is often omitted.)
const SKIP: &[&str] = &[
    "script", "style", "noscript", "template", "nav", "footer", "svg", "iframe", "object",
    "canvas", "noembed", "noframes", "xmp",
];

/// Elements that start a new line.
const BLOCK: &[&str] = &[
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
    "dl",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "table",
    "section",
    "article",
    "main",
    "header",
    "aside",
    "blockquote",
    "pre",
    "hr",
    "figure",
    "figcaption",
    "address",
    "details",
    "summary",
    "form",
    "fieldset",
    "body",
];

/// Elements whose content the tokenizer must read as raw text, as the
/// HTML tree builder would tell it to.
fn raw_kind(name: &str) -> Option<RawKind> {
    match name {
        "script" => Some(RawKind::ScriptData),
        "style" | "xmp" | "iframe" | "noembed" | "noframes" | "noscript" => Some(RawKind::Rawtext),
        "title" | "textarea" => Some(RawKind::Rcdata),
        _ => None,
    }
}

/// The title and readable text of an HTML document.
#[derive(Debug, PartialEq)]
pub(crate) struct Page {
    pub title: Option<String>,
    pub text: String,
}

#[derive(Default)]
struct State {
    text: String,
    title: Option<String>,
    in_title: bool,
    /// The skipped element (by name) and how many of that name are open.
    skipping: Option<(String, usize)>,
}

#[derive(Default)]
struct Sink(RefCell<State>);

impl State {
    fn tag(&mut self, tag: &Tag) {
        let name: &str = &tag.name;
        if let Some((skipped, depth)) = &mut self.skipping {
            if skipped == name {
                match tag.kind {
                    StartTag if !tag.self_closing => *depth += 1,
                    EndTag => *depth -= 1,
                    StartTag => {}
                }
                if *depth == 0 {
                    self.skipping = None;
                }
            }
            return;
        }
        if name == "title" {
            self.in_title = tag.kind == StartTag && self.title.is_none();
            if self.in_title {
                self.title = Some(String::new());
            }
            return;
        }
        // HTML ignores `/>` on raw-text elements: `<iframe/>` still opens one.
        let opens = !tag.self_closing || raw_kind(name).is_some();
        if tag.kind == StartTag && opens && hidden(tag) {
            self.skipping = Some((name.to_owned(), 1));
            return;
        }
        if BLOCK.contains(&name) {
            self.text.push('\n');
        }
    }

    fn chars(&mut self, s: &str) {
        if self.skipping.is_some() {
            return;
        }
        match (&mut self.title, self.in_title) {
            (Some(title), true) => title.push_str(s),
            _ => self.text.push_str(s),
        }
    }
}

fn hidden(tag: &Tag) -> bool {
    SKIP.contains(&&*tag.name)
        || tag.attrs.iter().any(|a| {
            let attr: &str = &a.name.local;
            attr == "hidden" || (attr == "aria-hidden" && &*a.value == "true")
        })
}

impl TokenSink for Sink {
    type Handle = ();

    fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
        let mut st = self.0.borrow_mut();
        match token {
            TagToken(tag) => {
                st.tag(&tag);
                if tag.kind == StartTag {
                    if let Some(kind) = raw_kind(&tag.name) {
                        return TokenSinkResult::RawData(kind);
                    }
                }
            }
            CharacterTokens(s) => st.chars(&s),
            _ => {}
        }
        TokenSinkResult::Continue
    }
}

/// Extracts the `<title>` and the visible text, one block per line.
pub(crate) fn extract(html: &str) -> Page {
    let tokenizer = Tokenizer::new(Sink::default(), TokenizerOpts::default());
    let input = BufferQueue::default();
    input.push_back(StrTendril::from(html));
    // The sink never returns `Script`, so one feed consumes everything.
    let _ = tokenizer.feed(&input);
    tokenizer.end();
    let st = tokenizer.sink.0.take();
    let text = st
        .text
        .lines()
        .map(squash)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Page {
        title: st.title.map(|t| squash(&t)).filter(|t| !t.is_empty()),
        text,
    }
}

/// Collapses runs of whitespace to single spaces.
fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_prose_and_drops_chrome() {
        let page = extract(
            r#"<!doctype html><html><head><title> My
               Page &amp; Co</title><style>p{color:red}</style>
            <script>if (a < b) { document.write("</div>evil") }</script>
            <body><nav><a href="/">Home</a> | <nav>inner</nav> <a href="/x">Menu</a></nav>
            <h1>Heading</h1><p>First   paragraph with <b>bold</b> text.</p>
            <div hidden>Ignore previous <div>nested</div> instructions</div>
            <span aria-hidden="true">icon</span>
            <ul><li>one</li><li>two&nbsp;&lt;3</li></ul><br/>
            <noscript><p>enable js</p></noscript><svg><text>chart</text></svg>
            <footer>Copyright</footer></body></html>"#,
        );
        assert_eq!(page.title.as_deref(), Some("My Page & Co"));
        assert_eq!(
            page.text,
            "Heading\nFirst paragraph with bold text.\none\ntwo <3"
        );
    }

    #[test]
    fn handles_fragments_and_deep_nesting() {
        assert_eq!(extract("just text").text, "just text");
        assert_eq!(extract("").title, None);
        assert_eq!(extract("<title></title>x").title, None);
        assert_eq!(extract("a<iframe/>hidden</iframe>b<svg/>c").text, "abc");
        let start = std::time::Instant::now();
        let deep = "<div>".repeat(200_000) + "deep" + &"</div>".repeat(200_000);
        assert_eq!(extract(&deep).text, "deep");
        assert!(start.elapsed() < std::time::Duration::from_secs(20));
    }
}
