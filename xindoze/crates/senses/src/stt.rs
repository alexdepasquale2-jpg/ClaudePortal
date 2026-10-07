//! Speech-to-text with whisper.cpp (feature `whisper`).

use std::path::{Path, PathBuf};
use xz_types::XzError;

/// A speech-to-text engine.
pub trait Transcriber: Send + Sync {
    /// Transcribes 16 kHz mono samples to text.
    fn transcribe(&self, pcm_16k: &[f32]) -> Result<String, XzError>;
}

/// Whisper with a ggml model file. The model loads for each call and is freed
/// afterwards, so an idle `xinod` holds no speech model in RAM (SPEC §10).
#[derive(Clone, Debug)]
pub struct Whisper {
    model: PathBuf,
}

impl Whisper {
    /// Uses the ggml model at `model` (see `speech.toml` for downloads).
    pub fn new(model: impl Into<PathBuf>) -> Self {
        Self {
            model: model.into(),
        }
    }

    pub fn model(&self) -> &Path {
        &self.model
    }
}

impl Transcriber for Whisper {
    fn transcribe(&self, pcm_16k: &[f32]) -> Result<String, XzError> {
        transcribe(&self.model, pcm_16k)
    }
}

/// Transcribes 16 kHz mono samples with the whisper ggml model at `model_path`.
/// The language is detected automatically.
///
/// Returns `Unsupported` when the crate is built without the `whisper` feature.
pub fn transcribe(model_path: &Path, pcm_16k: &[f32]) -> Result<String, XzError> {
    if !model_path.is_file() {
        return Err(XzError::NotFound(format!(
            "whisper model {}",
            model_path.display()
        )));
    }
    if pcm_16k.is_empty() {
        return Ok(String::new());
    }
    imp::transcribe(model_path, pcm_16k)
}

#[cfg(feature = "whisper")]
mod imp {
    use super::*;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    pub fn transcribe(model_path: &Path, pcm_16k: &[f32]) -> Result<String, XzError> {
        // whisper.cpp logs to stdout/stderr by default; route it away so it
        // cannot corrupt a stdio transport. Only the first call has an effect.
        whisper_rs::install_logging_hooks();
        let err = |e: whisper_rs::WhisperError| XzError::Model(format!("whisper: {e}"));
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(err)?;
        let mut state = ctx.create_state().map_err(err)?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // The default is English only; None asks whisper to detect the language.
        params.set_language(None);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        state.full(params, pcm_16k).map_err(err)?;
        let mut text = String::new();
        for segment in state.as_iter() {
            text.push_str(&segment.to_str_lossy().map_err(err)?);
        }
        Ok(text.trim().to_string())
    }
}

#[cfg(not(feature = "whisper"))]
mod imp {
    use super::*;

    pub fn transcribe(_model_path: &Path, _pcm_16k: &[f32]) -> Result<String, XzError> {
        Err(XzError::Unsupported(
            "speech-to-text: xz-senses was built without the `whisper` feature".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_model_is_not_found() {
        let err = transcribe(Path::new("/nonexistent/ggml-tiny.bin"), &[0.0; 16]).unwrap_err();
        assert!(matches!(err, XzError::NotFound(_)), "{err}");
    }

    #[test]
    fn empty_audio_is_empty_text() {
        let model = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(transcribe(model.path(), &[]).unwrap(), "");
    }

    #[cfg(not(feature = "whisper"))]
    #[test]
    fn without_feature_is_unsupported() {
        let model = tempfile::NamedTempFile::new().unwrap();
        let err = Whisper::new(model.path())
            .transcribe(&[0.0; 16])
            .unwrap_err();
        assert!(matches!(err, XzError::Unsupported(_)), "{err}");
    }

    #[cfg(feature = "whisper")]
    #[test]
    fn garbage_model_is_a_model_error() {
        let model = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(model.path(), b"not a ggml file").unwrap();
        let err = transcribe(model.path(), &[0.0; 16_000]).unwrap_err();
        assert!(matches!(err, XzError::Model(_)), "{err}");
    }

    /// Run with `XZ_WHISPER_MODEL=<ggml file> [XZ_WHISPER_WAV=<speech.wav>]
    /// cargo test -p xz-senses --features whisper -- --ignored`.
    #[cfg(feature = "whisper")]
    #[test]
    #[ignore = "needs a whisper model: set XZ_WHISPER_MODEL"]
    fn transcribes_with_real_model() {
        let model = std::env::var("XZ_WHISPER_MODEL").expect("set XZ_WHISPER_MODEL");
        let pcm = match std::env::var("XZ_WHISPER_WAV") {
            Ok(wav) => crate::audio::load_wav_16k(Path::new(&wav)).unwrap().samples,
            Err(_) => vec![0.0; 2 * crate::audio::WHISPER_RATE as usize],
        };
        let text = Whisper::new(model).transcribe(&pcm).unwrap();
        println!("transcript: {text:?}");
    }
}
