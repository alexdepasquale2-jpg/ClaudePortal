//! Kokoro-82M text-to-speech on ONNX Runtime (feature `kokoro`).
//!
//! Text becomes IPA through espeak-ng (run as a separate program, so its GPL
//! code is never linked), IPA becomes Kokoro token ids, the ONNX model renders
//! 24 kHz audio in the chosen voice, and cpal plays it.
//!
//! `ort` is built with `load-dynamic`: ONNX Runtime is loaded when the speaker
//! starts, so builds never download binaries and cross-compile cleanly. Ship
//! the ONNX Runtime library (MIT, 1.22 or newer for ort 2.0.0-rc.10) beside
//! `xinod`, or point `KokoroFiles::runtime` or `ORT_DYLIB_PATH` at it.

use super::kokoro_text::{MAX_PHONEMES, chunks, normalize, style_row, tokenize};
use super::{KokoroFiles, Speaker, find_program};
use crate::audio::Pcm;
use ort::session::Session;
use ort::value::Tensor;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use xz_types::XzError;

/// Kokoro's output sample rate.
const SAMPLE_RATE: u32 = 24_000;
/// Values in one voice style row.
const STYLE_DIM: usize = 256;
/// espeak-ng voice used for phonemes; the default Kokoro voice is American English.
const ESPEAK_VOICE: &str = "en-us";

/// A loaded Kokoro model and voice.
pub struct Kokoro {
    // `Session::run` needs `&mut`; speech requests are serialized anyway.
    session: Mutex<Session>,
    /// Older exports call the token input `tokens`, newer ones `input_ids`.
    tokens_input: String,
    /// Voice style rows, `STYLE_DIM` values each.
    styles: Vec<f32>,
    espeak: PathBuf,
}

impl Kokoro {
    /// Loads the model and voice. Fails with `Unsupported` when espeak-ng or
    /// the ONNX Runtime library is missing, so callers can fall back.
    pub fn load(files: &KokoroFiles) -> Result<Self, XzError> {
        let espeak = find_program("espeak-ng").ok_or_else(|| {
            XzError::Unsupported("kokoro needs espeak-ng on PATH to turn text into phonemes".into())
        })?;
        let styles = read_styles(&files.voice)?;
        if !files.model.is_file() {
            return Err(XzError::NotFound(format!(
                "kokoro model {}",
                files.model.display()
            )));
        }
        let session = load_session(files)?;
        let tokens_input = if session.inputs.iter().any(|i| i.name == "input_ids") {
            "input_ids"
        } else {
            "tokens"
        };
        Ok(Self {
            tokens_input: tokens_input.into(),
            session: Mutex::new(session),
            styles,
            espeak,
        })
    }

    /// Renders one chunk of token ids to audio samples.
    fn render(&self, tokens: Vec<i64>) -> Result<Vec<f32>, XzError> {
        let err = |e: ort::Error| XzError::Model(format!("kokoro: {e}"));
        let row = style_row(tokens.len(), self.styles.len() / STYLE_DIM);
        let style = self.styles[row * STYLE_DIM..(row + 1) * STYLE_DIM].to_vec();
        let mut ids = Vec::with_capacity(tokens.len() + 2);
        ids.push(0);
        ids.extend(tokens);
        ids.push(0);
        let len = ids.len();
        let ids = Tensor::from_array(([1usize, len], ids)).map_err(err)?;
        let style = Tensor::from_array(([1usize, STYLE_DIM], style)).map_err(err)?;
        let speed = Tensor::from_array(([1usize], vec![1.0f32])).map_err(err)?;
        let mut session = self
            .session
            .lock()
            .map_err(|_| XzError::Other("kokoro session poisoned".into()))?;
        let outputs = session
            .run(ort::inputs![
                self.tokens_input.as_str() => ids,
                "style" => style,
                "speed" => speed,
            ])
            .map_err(err)?;
        let (_, audio) = outputs[0].try_extract_tensor::<f32>().map_err(err)?;
        Ok(audio.to_vec())
    }
}

impl Speaker for Kokoro {
    fn name(&self) -> &str {
        "kokoro"
    }

    fn speak(&self, text: &str) -> Result<(), XzError> {
        let phonemes = phonemize(&self.espeak, text)?;
        let mut samples = Vec::new();
        for chunk in chunks(&phonemes, MAX_PHONEMES) {
            let tokens = tokenize(&chunk);
            if !tokens.is_empty() {
                samples.extend(self.render(tokens)?);
            }
        }
        if samples.is_empty() {
            return Ok(());
        }
        crate::device::play(&Pcm {
            rate: SAMPLE_RATE,
            samples,
        })
    }
}

fn load_session(files: &KokoroFiles) -> Result<Session, XzError> {
    if let Some(rt) = &files.runtime {
        if !rt.is_file() {
            return Err(XzError::NotFound(format!(
                "ONNX Runtime library {}",
                rt.display()
            )));
        }
    }
    let runtime = files.runtime.clone();
    let model = files.model.clone();
    // ort panics when the runtime library is missing or too old. Contain the
    // panic so `select_speaker` can fall back to a platform speaker.
    std::panic::catch_unwind(move || -> Result<Session, ort::Error> {
        if let Some(rt) = runtime {
            ort::init_from(rt.to_string_lossy()).commit()?;
        }
        Session::builder()?.commit_from_file(model)
    })
    .map_err(|_| {
        XzError::Unsupported(
            "ONNX Runtime library could not be loaded (set ORT_DYLIB_PATH or KokoroFiles::runtime)"
                .into(),
        )
    })?
    .map_err(|e| XzError::Model(format!("kokoro: {e}")))
}

/// Reads a voice file: raw little-endian f32 rows of `STYLE_DIM` values.
fn read_styles(path: &Path) -> Result<Vec<f32>, XzError> {
    let bytes = std::fs::read(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => {
            XzError::NotFound(format!("kokoro voice {}", path.display()))
        }
        _ => XzError::Io(e),
    })?;
    let row_bytes = STYLE_DIM * 4;
    if bytes.is_empty() || bytes.len() % row_bytes != 0 {
        return Err(XzError::Parse(format!(
            "kokoro voice {}: size {} is not a whole number of {STYLE_DIM}-value rows",
            path.display(),
            bytes.len()
        )));
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// Runs espeak-ng to turn text into Kokoro phonemes.
fn phonemize(espeak: &Path, text: &str) -> Result<String, XzError> {
    let mut child = Command::new(espeak)
        .args(["-q", "--ipa", "-v", ESPEAK_VOICE, "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| XzError::Other(format!("cannot start espeak-ng: {e}")))?;
    // Write from another thread so a full stdout pipe cannot deadlock the write.
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| XzError::Other("espeak-ng stdin unavailable".into()))?;
    let input = text.to_owned();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let output = child.wait_with_output()?;
    writer
        .join()
        .map_err(|_| XzError::Other("espeak-ng writer panicked".into()))??;
    if !output.status.success() {
        return Err(XzError::Other(format!(
            "espeak-ng failed: {}",
            output.status
        )));
    }
    Ok(normalize(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_style_rows() {
        let dir = tempfile::tempdir().unwrap();
        let voice = dir.path().join("v.bin");
        let values: Vec<u8> = (0..2 * STYLE_DIM)
            .flat_map(|i| (i as f32).to_le_bytes())
            .collect();
        std::fs::write(&voice, values).unwrap();
        let styles = read_styles(&voice).unwrap();
        assert_eq!(styles.len(), 2 * STYLE_DIM);
        assert_eq!(styles[STYLE_DIM], STYLE_DIM as f32);

        std::fs::write(&voice, [0u8; 10]).unwrap();
        assert!(matches!(read_styles(&voice), Err(XzError::Parse(_))));
        assert!(matches!(
            read_styles(&dir.path().join("none.bin")),
            Err(XzError::NotFound(_))
        ));
    }

    #[test]
    fn missing_runtime_library_is_reported() {
        let files = KokoroFiles {
            model: "/nonexistent/model.onnx".into(),
            voice: "/nonexistent/voice.bin".into(),
            runtime: Some("/nonexistent/libonnxruntime.so".into()),
        };
        assert!(matches!(load_session(&files), Err(XzError::NotFound(_))));
    }

    #[test]
    fn unloadable_runtime_is_an_error_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let model = dir.path().join("model.onnx");
        std::fs::write(&model, b"not an onnx model").unwrap();
        let files = KokoroFiles {
            model,
            voice: dir.path().join("voice.bin"),
            runtime: None,
        };
        // With no ONNX Runtime installed, ort panics while loading it; with one
        // installed, the bogus model fails to parse. Either way: an error.
        let err = load_session(&files).unwrap_err();
        assert!(
            matches!(err, XzError::Unsupported(_) | XzError::Model(_)),
            "{err}"
        );
    }

    #[test]
    fn phonemizes_with_espeak_ng_when_present() {
        let Some(espeak) = find_program("espeak-ng") else {
            eprintln!("espeak-ng not installed; skipping");
            return;
        };
        let phonemes = phonemize(&espeak, "Hello world. Okay?").unwrap();
        assert!(phonemes.contains('O'), "{phonemes}");
        assert!(phonemes.contains(", "), "{phonemes}");
        assert!(!tokenize(&phonemes).is_empty());
    }

    /// Run with `XZ_KOKORO_MODEL=<model.onnx> XZ_KOKORO_VOICE=<voice.bin>
    /// [ORT_DYLIB_PATH=<libonnxruntime>] cargo test -p xz-senses --features kokoro -- --ignored`.
    #[test]
    #[ignore = "needs Kokoro files: set XZ_KOKORO_MODEL and XZ_KOKORO_VOICE"]
    fn renders_with_real_model() {
        let files = KokoroFiles {
            model: std::env::var("XZ_KOKORO_MODEL")
                .expect("set XZ_KOKORO_MODEL")
                .into(),
            voice: std::env::var("XZ_KOKORO_VOICE")
                .expect("set XZ_KOKORO_VOICE")
                .into(),
            runtime: None,
        };
        let kokoro = Kokoro::load(&files).unwrap();
        let phonemes = phonemize(&kokoro.espeak, "Xindoze speaks.").unwrap();
        let audio = kokoro.render(tokenize(&phonemes)).unwrap();
        assert!(
            audio.len() > SAMPLE_RATE as usize / 4,
            "{} samples",
            audio.len()
        );
    }
}
