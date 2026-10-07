//! Senses: speech-to-text and text-to-speech (SPEC §3.6, §4).
//!
//! # Organs (all first-party)
//!
//! | Tool | Risk | Args | Result |
//! |---|---|---|---|
//! | `media.speak` | act | `{text}` | `{spoken, engine, chars}` |
//! | `media.record_audio` (feature `mic`) | observe | `{seconds}` | `{path, seconds, sample_rate}` |
//! | `voice.transcribe` | observe, resource `path` | `{path}` (WAV) | `{path, text, seconds}` |
//!
//! `MediaOrgan` serves the `media` family and `VoiceOrgan` the `voice` family.
//! The host wires them up like this:
//!
//! ```no_run
//! # use std::{path::Path, sync::Arc};
//! # use xz_senses::*;
//! # let (data, home) = (Path::new("/data"), Path::new("/home/u"));
//! let reg = SpeechRegistry::builtin()?;
//! let models = data.join("models");
//! let kokoro = reg
//!     .pick(SpeechKind::Tts, "sprout")
//!     .and_then(|e| e.kokoro_files(&models, None));
//! let speaker = select_speaker(&SpeakerOptions { kokoro, piper_voice: None });
//! let media = MediaOrgan::new(speaker, data.join("recordings"));
//! let stt = reg.pick(SpeechKind::Stt, "sprout").expect("registry has whisper");
//! let voice = VoiceOrgan::new(home, Arc::new(Whisper::new(&stt.paths(&models)[0])));
//! # Ok::<(), xz_types::XzError>(())
//! ```
//!
//! # Features
//!
//! Default builds are pure Rust and cross-compile to Windows and Android.
//!
//! - `whisper`: whisper.cpp (MIT) through `whisper-rs`, compiled from source.
//!   Needs cmake and a C++ toolchain (on Android, the NDK). Without it,
//!   transcription returns `Unsupported`.
//! - `mic`: microphone capture through cpal. Linux builds need the ALSA
//!   headers (`libasound2-dev`); Windows and Android need nothing extra.
//! - `kokoro`: Kokoro-82M through ONNX Runtime (`ort`, `load-dynamic`).
//!   Nothing is downloaded at build time; the ONNX Runtime library (MIT,
//!   1.22+) is loaded when the speaker starts, from `KokoroFiles::runtime`,
//!   `ORT_DYLIB_PATH`, or the default library search. Phonemes come from the
//!   `espeak-ng` program, which must be on PATH. Playback uses cpal, so Linux
//!   builds need the ALSA headers as with `mic`.
//!
//! # Speech registry
//!
//! The `cortex` registry (`models.toml`) has no speech roles, so speech
//! models live in this crate's `speech.toml` as `[[speech]]` tables (see
//! [`SpeechRegistry`]). The cortex parser ignores those tables, so they can
//! move into `models.toml` unchanged; [`SpeechRegistry::load`] reads either file.
//!
//! # Platforms
//!
//! - Windows: SAPI speech, cpal (WASAPI) audio.
//! - Linux: piper, espeak-ng or espeak run as separate programs; nothing else
//!   is linked.
//! - Android: the shell's Kotlin plugin implements [`Speaker`] over the platform
//!   TextToSpeech service and passes it to [`MediaOrgan::new`].
//!
//! The Canvas must show a recording indicator while `media.record_audio` runs
//! (SPEC Appendix D); this crate only captures.

pub mod audio;
#[cfg(feature = "audio-io")]
pub mod device;
pub mod organ;
pub mod registry;
pub mod stt;
pub mod tts;

pub use audio::{Pcm, WHISPER_RATE, decode_wav, encode_wav, load_wav_16k, resample};
pub use organ::{MAX_RECORD_SECONDS, MAX_SPEAK_CHARS, MediaOrgan, VoiceOrgan};
pub use registry::{ModelFile, SpeechEngine, SpeechEntry, SpeechKind, SpeechRegistry};
pub use stt::{Transcriber, Whisper, transcribe};
pub use tts::{
    Engine, KokoroFiles, NoSpeaker, ProcessSpeaker, Speaker, SpeakerOptions, choose_engine,
    select_speaker,
};
