//! Content sniffing shared by `fs.read`, `fs.search` and `net.fetch`.

use xz_types::{Result, XzError};

/// Bytes inspected for NUL when deciding text versus binary.
const SNIFF: usize = 8 * 1024;

/// True if the bytes carry a PDF header near the start.
pub(crate) fn is_pdf(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(1024)]
        .windows(5)
        .any(|w| w == b"%PDF-")
}

/// Returns the bytes as text if they look like UTF-8 text.
///
/// `cut` says the bytes are a prefix of a longer file, so a multi-byte
/// character split at the end is not evidence of binary data.
pub(crate) fn as_text(bytes: &[u8], cut: bool) -> Option<String> {
    if bytes[..bytes.len().min(SNIFF)].contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => Some(s.to_owned()),
        Err(e) if cut && e.error_len().is_none() => {
            String::from_utf8(bytes[..e.valid_up_to()].to_vec()).ok()
        }
        Err(_) => None,
    }
}

/// Extracts the text of a PDF.
///
/// PDF parsers are large and see hostile input; a panic inside one must
/// not take the daemon down, so it becomes an ordinary error.
pub(crate) fn pdf_text(bytes: &[u8]) -> Result<String> {
    match std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes)) {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(XzError::Parse(format!("could not read PDF: {e}"))),
        Err(_) => Err(XzError::Parse(
            "could not read PDF: the parser crashed on this file".into(),
        )),
    }
}

/// A one-page PDF showing `text` in Helvetica, for tests.
#[cfg(test)]
pub(crate) fn tiny_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
         /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
            .to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_string(),
        format!(
            "<< /Length {} >>\nstream\n{stream}\nendstream",
            stream.len()
        ),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{body}\nendobj\n", i + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_text_and_binary() {
        assert_eq!(as_text(b"hello", false).as_deref(), Some("hello"));
        assert_eq!(as_text(b"a\0b", false), None);
        let cut = "hé".as_bytes();
        assert_eq!(as_text(&cut[..2], true).as_deref(), Some("h"));
        assert_eq!(as_text(&cut[..2], false), None);
        assert_eq!(as_text(&[0xff, 0xfe, 0x41], true), None);
    }

    #[test]
    fn extracts_pdf_text() {
        let pdf = tiny_pdf("Quarterly Invoice 42");
        assert!(is_pdf(&pdf));
        let text = pdf_text(&pdf).unwrap();
        assert!(text.contains("Quarterly Invoice 42"), "{text:?}");
    }

    #[test]
    fn broken_pdf_is_an_error_not_a_panic() {
        let mut pdf = tiny_pdf("x");
        pdf.truncate(40);
        assert!(pdf_text(&pdf).is_err());
        assert!(pdf_text(b"%PDF-1.4 garbage").is_err());
    }
}
