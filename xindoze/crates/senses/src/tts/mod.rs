//! Text-to-speech: the `Speaker` trait and engine selection.
//!
//! Engines, best first:
//! - Kokoro-82M on ONNX Runtime (feature `kokoro`), when its files are configured.
//! - Windows: SAPI, always present.
//! - Linux and other Unix: piper (with a configured voice and a WAV player),
//!   then espeak-ng, then espeak, each run as a separate process.
//! - Android: none here; the shell's Kotlin plugin implements `Speaker` with
//!   the platform TextToSpeech service and hands it to `MediaOrgan`.

#[cfg(feature = "kokoro")]
pub mod kokoro;
#[cfg(any(test, feature = "kokoro"))]
mod kokoro_text;
pub mod process;
#[cfg(windows)]
pub mod sapi;

use std::path::PathBuf;
use std::sync::Arc;
use xz_types::XzError;

pub use process::{ProcessSpeaker, find_program};

/// Speaks text aloud.
pub trait Speaker: Send + Sync {
    /// Engine id for results and logs, e.g. `espeak-ng`.
    fn name(&self) -> &str;
    /// Speaks `text` and returns when playback ends. Blocking.
    fn speak(&self, text: &str) -> Result<(), XzError>;
}

/// The speaker for hosts without a TTS engine: every call is `Unsupported`.
pub struct NoSpeaker;

impl Speaker for NoSpeaker {
    fn name(&self) -> &str {
        "none"
    }

    fn speak(&self, _text: &str) -> Result<(), XzError> {
        Err(XzError::Unsupported(
            "no text-to-speech engine on this device (on Linux, install espeak-ng or piper)".into(),
        ))
    }
}

/// Files for the Kokoro-82M speaker (the `kokoro-82m` entry in `speech.toml`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KokoroFiles {
    /// The ONNX model.
    pub model: PathBuf,
    /// A voice style file: raw little-endian f32 rows of 256 values.
    pub voice: PathBuf,
    /// The ONNX Runtime shared library. `None` uses `ORT_DYLIB_PATH`, then
    /// the platform's default library search.
    pub runtime: Option<PathBuf>,
}

/// What `select_speaker` may use beyond the platform engines.
#[derive(Clone, Debug, Default)]
pub struct SpeakerOptions {
    /// Kokoro files. Tried first when the crate is built with `kokoro`.
    pub kokoro: Option<KokoroFiles>,
    /// A piper voice model (`.onnx`, with its `.onnx.json` beside it).
    pub piper_voice: Option<PathBuf>,
}

/// A platform text-to-speech engine.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    Sapi,
    Piper,
    EspeakNg,
    Espeak,
    None,
}

/// Programs that can play piper's WAV output, in order of preference.
pub const WAV_PLAYERS: [&str; 3] = ["pw-play", "paplay", "aplay"];

/// Picks the platform engine for `os` (as in `std::env::consts::OS`).
/// `has_program` reports whether an executable is on PATH; `piper_voice`
/// whether a piper voice is configured and present.
pub fn choose_engine(os: &str, piper_voice: bool, has_program: impl Fn(&str) -> bool) -> Engine {
    match os {
        "windows" => Engine::Sapi,
        // The shell supplies the platform speaker on mobile.
        "android" | "ios" => Engine::None,
        _ if piper_voice && has_program("piper") && WAV_PLAYERS.iter().any(|p| has_program(p)) => {
            Engine::Piper
        }
        _ if has_program("espeak-ng") => Engine::EspeakNg,
        _ if has_program("espeak") => Engine::Espeak,
        _ => Engine::None,
    }
}

/// The best speaker available on this device. Never fails: without any
/// engine it returns `NoSpeaker`, whose calls report `Unsupported`.
pub fn select_speaker(opts: &SpeakerOptions) -> Arc<dyn Speaker> {
    if let Some(files) = &opts.kokoro {
        #[cfg(feature = "kokoro")]
        match kokoro::Kokoro::load(files) {
            Ok(k) => return Arc::new(k),
            Err(e) => tracing::warn!("kokoro unavailable, falling back: {e}"),
        }
        #[cfg(not(feature = "kokoro"))]
        tracing::warn!(
            "kokoro files configured ({}) but xz-senses was built without the `kokoro` feature",
            files.model.display()
        );
    }
    let piper_voice = opts.piper_voice.as_ref().filter(|p| p.is_file());
    let engine = choose_engine(std::env::consts::OS, piper_voice.is_some(), |p| {
        find_program(p).is_some()
    });
    let program = |name: &str| find_program(name).unwrap_or_else(|| PathBuf::from(name));
    match engine {
        #[cfg(windows)]
        Engine::Sapi => Arc::new(sapi::Sapi),
        Engine::Piper => {
            let player = WAV_PLAYERS
                .iter()
                .find_map(|p| find_program(p))
                .unwrap_or_else(|| PathBuf::from(WAV_PLAYERS[0]));
            let voice = piper_voice.cloned().unwrap_or_default();
            Arc::new(ProcessSpeaker::piper(program("piper"), voice, player))
        }
        Engine::EspeakNg => Arc::new(ProcessSpeaker::espeak("espeak-ng", program("espeak-ng"))),
        Engine::Espeak => Arc::new(ProcessSpeaker::espeak("espeak", program("espeak"))),
        _ => Arc::new(NoSpeaker),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn having(programs: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |p| programs.contains(&p)
    }

    #[test]
    fn windows_always_uses_sapi() {
        assert_eq!(
            choose_engine("windows", true, having(&["piper", "espeak-ng"])),
            Engine::Sapi
        );
        assert_eq!(choose_engine("windows", false, having(&[])), Engine::Sapi);
    }

    #[test]
    fn mobile_leaves_speech_to_the_shell() {
        assert_eq!(
            choose_engine("android", false, having(&["espeak-ng"])),
            Engine::None
        );
    }

    #[test]
    fn linux_prefers_piper_then_espeak_ng_then_espeak() {
        let all = having(&["piper", "aplay", "espeak-ng", "espeak"]);
        assert_eq!(choose_engine("linux", true, &all), Engine::Piper);
        // No configured voice: piper is skipped.
        assert_eq!(choose_engine("linux", false, &all), Engine::EspeakNg);
        // Piper without a player cannot be heard.
        assert_eq!(
            choose_engine("linux", true, having(&["piper", "espeak"])),
            Engine::Espeak
        );
        assert_eq!(
            choose_engine("linux", true, having(&["piper", "pw-play"])),
            Engine::Piper
        );
        assert_eq!(choose_engine("linux", false, having(&[])), Engine::None);
    }

    #[test]
    fn no_speaker_is_unsupported() {
        let err = NoSpeaker.speak("hi").unwrap_err();
        assert!(matches!(err, XzError::Unsupported(_)));
        assert_eq!(NoSpeaker.name(), "none");
    }

    #[test]
    fn select_speaker_never_fails() {
        let opts = SpeakerOptions {
            kokoro: Some(KokoroFiles {
                model: "/nonexistent/kokoro.onnx".into(),
                voice: "/nonexistent/voice.bin".into(),
                runtime: None,
            }),
            piper_voice: Some("/nonexistent/voice.onnx".into()),
        };
        let speaker = select_speaker(&opts);
        assert!(["sapi", "espeak-ng", "espeak", "none"].contains(&speaker.name()));
    }
}
