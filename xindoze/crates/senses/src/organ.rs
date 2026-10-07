//! The Senses Organs: `media.speak`, `media.record_audio` (feature `mic`)
//! and `voice.transcribe`.

use crate::audio::{Pcm, load_wav_16k};
use crate::stt::Transcriber;
use crate::tts::Speaker;
use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use xz_types::{CallCtx, Organ, Risk, ToolOutput, ToolSpec, XzError, path::resolve};

/// Longest text `media.speak` accepts, in characters.
pub const MAX_SPEAK_CHARS: usize = 10_000;
/// Longest recording `media.record_audio` makes, in seconds.
pub const MAX_RECORD_SECONDS: f64 = 300.0;

const SPEAK: &str = "media.speak";
const RECORD: &str = "media.record_audio";
const TRANSCRIBE: &str = "voice.transcribe";

/// The `media` Organ: speech output and microphone capture.
pub struct MediaOrgan {
    speaker: Arc<dyn Speaker>,
    recordings: PathBuf,
}

impl MediaOrgan {
    /// `recordings` is where `media.record_audio` saves its WAV files
    /// (the host passes `<data>/recordings`).
    pub fn new(speaker: Arc<dyn Speaker>, recordings: impl Into<PathBuf>) -> Self {
        Self {
            speaker,
            recordings: recordings.into(),
        }
    }
}

#[async_trait]
impl Organ for MediaOrgan {
    fn family(&self) -> &str {
        "media"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        let mut tools = vec![spec(
            SPEAK,
            "Speak text aloud through the device's speaker.",
            json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "What to say.", "maxLength": MAX_SPEAK_CHARS}
                },
                "required": ["text"]
            }),
            Risk::Act,
            &[],
        )];
        // Advertised only when this build can record, so planners never pick a dead tool.
        if cfg!(feature = "mic") {
            tools.push(spec(
                RECORD,
                "Record from the microphone. Returns the path of a 16 kHz WAV file, \
                 which voice.transcribe turns into text.",
                json!({
                    "type": "object",
                    "properties": {
                        "seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": MAX_RECORD_SECONDS}
                    },
                    "required": ["seconds"]
                }),
                Risk::Observe,
                &[],
            ));
        }
        tools
    }

    async fn call(&self, ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput, XzError> {
        match tool {
            SPEAK => {
                let text = speak_args(&args)?;
                let chars = text.chars().count();
                let speaker = Arc::clone(&self.speaker);
                let engine = speaker.name().to_owned();
                blocking(move || speaker.speak(&text)).await?;
                Ok(ToolOutput::clean(
                    json!({"spoken": true, "engine": engine, "chars": chars}),
                ))
            }
            RECORD => {
                let seconds = record_args(&args)?;
                let path = self.recordings.join(format!(
                    "{}-{}.wav",
                    file_safe(&ctx.task_id),
                    xz_types::now_ms()
                ));
                let dir = self.recordings.clone();
                let out = path.clone();
                let pcm = blocking(move || {
                    let pcm = record(seconds)?;
                    std::fs::create_dir_all(&dir)?;
                    std::fs::write(&out, crate::audio::encode_wav(&pcm)?)?;
                    Ok(pcm)
                })
                .await?;
                Ok(ToolOutput::clean(json!({
                    "path": path.to_string_lossy(),
                    "seconds": pcm.seconds(),
                    "sample_rate": pcm.rate,
                })))
            }
            other => Err(XzError::UnknownTool(other.into())),
        }
    }
}

/// The `voice` Organ: speech-to-text.
pub struct VoiceOrgan {
    home: PathBuf,
    transcriber: Arc<dyn Transcriber>,
}

impl VoiceOrgan {
    /// Relative paths resolve against `home`, as the Warden resolves them.
    pub fn new(home: impl Into<PathBuf>, transcriber: Arc<dyn Transcriber>) -> Self {
        Self {
            home: home.into(),
            transcriber,
        }
    }
}

#[async_trait]
impl Organ for VoiceOrgan {
    fn family(&self) -> &str {
        "voice"
    }

    fn tools(&self) -> Vec<ToolSpec> {
        vec![spec(
            TRANSCRIBE,
            "Transcribe the speech in a WAV audio file to text. The language is detected automatically.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "WAV file; ~/ is the home folder."}
                },
                "required": ["path"]
            }),
            Risk::Observe,
            &["path"],
        )]
    }

    async fn call(&self, _ctx: &CallCtx, tool: &str, args: Value) -> Result<ToolOutput, XzError> {
        if tool != TRANSCRIBE {
            return Err(XzError::UnknownTool(tool.into()));
        }
        let path = resolve(&self.home, path_arg(&args)?);
        let transcriber = Arc::clone(&self.transcriber);
        let file = path.clone();
        let (text, seconds) = blocking(move || {
            let pcm = load_wav_16k(&file)?;
            Ok((transcriber.transcribe(&pcm.samples)?, pcm.seconds()))
        })
        .await?;
        Ok(ToolOutput::clean(
            json!({"path": path.to_string_lossy(), "text": text, "seconds": seconds}),
        ))
    }
}

fn spec(name: &str, description: &str, schema: Value, risk: Risk, resources: &[&str]) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: description.into(),
        input_schema: schema,
        risk,
        resource_args: resources.iter().map(|r| (*r).into()).collect(),
        tainted_output: false,
        first_party: true,
    }
}

fn speak_args(args: &Value) -> Result<String, XzError> {
    let text = args
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| XzError::InvalidArgs("media.speak needs `text`: the words to say".into()))?
        .trim();
    if text.is_empty() {
        return Err(XzError::InvalidArgs("media.speak: `text` is empty".into()));
    }
    let n = text.chars().count();
    if n > MAX_SPEAK_CHARS {
        return Err(XzError::InvalidArgs(format!(
            "media.speak: `text` has {n} characters; the limit is {MAX_SPEAK_CHARS}"
        )));
    }
    Ok(text.to_owned())
}

fn record_args(args: &Value) -> Result<f32, XzError> {
    let seconds = args.get("seconds").and_then(Value::as_f64).ok_or_else(|| {
        XzError::InvalidArgs("media.record_audio needs `seconds` as a number".into())
    })?;
    if !(seconds > 0.0 && seconds <= MAX_RECORD_SECONDS) {
        return Err(XzError::InvalidArgs(format!(
            "media.record_audio: `seconds` must be above 0 and at most {MAX_RECORD_SECONDS}"
        )));
    }
    Ok(seconds as f32)
}

fn path_arg(args: &Value) -> Result<&str, XzError> {
    match args.get("path").and_then(Value::as_str) {
        Some(p) if !p.trim().is_empty() => Ok(p),
        _ => Err(XzError::InvalidArgs(
            "voice.transcribe needs `path`: a WAV file".into(),
        )),
    }
}

/// Keeps a task id usable as part of a file name.
fn file_safe(id: &str) -> String {
    let s: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() { "rec".into() } else { s }
}

#[cfg(feature = "mic")]
fn record(seconds: f32) -> Result<Pcm, XzError> {
    crate::device::record(seconds)
}

#[cfg(not(feature = "mic"))]
fn record(_seconds: f32) -> Result<Pcm, XzError> {
    Err(XzError::Unsupported(
        "microphone capture: xz-senses was built without the `mic` feature".into(),
    ))
}

/// Runs blocking audio work off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, XzError> + Send + 'static,
) -> Result<T, XzError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| XzError::Other(format!("speech task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{WHISPER_RATE, encode_wav};
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeSpeaker {
        said: Mutex<Vec<String>>,
    }

    impl Speaker for FakeSpeaker {
        fn name(&self) -> &str {
            "fake"
        }
        fn speak(&self, text: &str) -> Result<(), XzError> {
            self.said.lock().unwrap().push(text.into());
            Ok(())
        }
    }

    /// Reports how many samples it was given.
    struct CountingTranscriber;

    impl Transcriber for CountingTranscriber {
        fn transcribe(&self, pcm_16k: &[f32]) -> Result<String, XzError> {
            Ok(format!("{} samples", pcm_16k.len()))
        }
    }

    fn media() -> (Arc<FakeSpeaker>, MediaOrgan, tempfile::TempDir) {
        let speaker = Arc::new(FakeSpeaker::default());
        let dir = tempfile::tempdir().unwrap();
        let organ = MediaOrgan::new(speaker.clone(), dir.path().join("recordings"));
        (speaker, organ, dir)
    }

    fn invalid(r: Result<ToolOutput, XzError>) -> String {
        match r {
            Err(XzError::InvalidArgs(m)) => m,
            other => panic!("expected InvalidArgs, got {other:?}"),
        }
    }

    #[test]
    fn tool_specs_match_the_catalog() {
        let (_, media, _dir) = media();
        let voice = VoiceOrgan::new("/home/u", Arc::new(CountingTranscriber));
        let mut all = media.tools();
        all.extend(voice.tools());
        let find = |n: &str| all.iter().find(|t| t.name == n).cloned();
        let speak = find(SPEAK).unwrap();
        assert_eq!(speak.risk, Risk::Act);
        assert!(speak.resource_args.is_empty());
        let transcribe = find(TRANSCRIBE).unwrap();
        assert_eq!(transcribe.risk, Risk::Observe);
        assert_eq!(transcribe.resource_args, vec!["path"]);
        assert_eq!(find(RECORD).is_some(), cfg!(feature = "mic"));
        if let Some(record) = find(RECORD) {
            assert_eq!(record.risk, Risk::Observe);
        }
        assert!(all.iter().all(|t| t.first_party && !t.tainted_output));
        assert!(all.iter().all(|t| t.input_schema["required"].is_array()));
        assert_eq!(media.family(), "media");
        assert_eq!(voice.family(), "voice");
    }

    #[tokio::test]
    async fn speak_sends_trimmed_text_to_the_speaker() {
        let (speaker, organ, _dir) = media();
        let out = organ
            .call(&CallCtx::test(), SPEAK, json!({"text": "  hello there \n"}))
            .await
            .unwrap();
        assert_eq!(
            out.content,
            json!({"spoken": true, "engine": "fake", "chars": 11})
        );
        assert!(out.taint.is_clean() && out.effects.is_empty());
        assert_eq!(*speaker.said.lock().unwrap(), vec!["hello there"]);
    }

    #[tokio::test]
    async fn speak_validates_text() {
        let (speaker, organ, _dir) = media();
        let ctx = CallCtx::test();
        for args in [json!({}), json!({"text": 5}), json!({"words": "hi"})] {
            assert!(invalid(organ.call(&ctx, SPEAK, args).await).contains("needs `text`"));
        }
        assert!(invalid(organ.call(&ctx, SPEAK, json!({"text": " \t"})).await).contains("empty"));
        let long = "a".repeat(MAX_SPEAK_CHARS + 1);
        assert!(invalid(organ.call(&ctx, SPEAK, json!({"text": long})).await).contains("limit"));
        let max = "é".repeat(MAX_SPEAK_CHARS);
        organ.call(&ctx, SPEAK, json!({"text": max})).await.unwrap();
        assert_eq!(speaker.said.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn speaker_errors_pass_through() {
        let organ = MediaOrgan::new(Arc::new(crate::tts::NoSpeaker), "/nonexistent");
        let err = organ
            .call(&CallCtx::test(), SPEAK, json!({"text": "hi"}))
            .await
            .unwrap_err();
        assert!(matches!(err, XzError::Unsupported(_)), "{err}");
    }

    #[tokio::test]
    async fn record_validates_seconds() {
        let (_, organ, dir) = media();
        let ctx = CallCtx::test();
        for args in [
            json!({}),
            json!({"seconds": "5"}),
            json!({"seconds": 0}),
            json!({"seconds": -1}),
            json!({"seconds": MAX_RECORD_SECONDS + 1.0}),
        ] {
            assert!(invalid(organ.call(&ctx, RECORD, args).await).contains("seconds"));
        }
        if !cfg!(feature = "mic") {
            let err = organ
                .call(&ctx, RECORD, json!({"seconds": 2.5}))
                .await
                .unwrap_err();
            assert!(matches!(err, XzError::Unsupported(_)), "{err}");
            assert!(!dir.path().join("recordings").exists());
        }
    }

    #[tokio::test]
    async fn unknown_tools_are_rejected() {
        let (_, organ, _dir) = media();
        let voice = VoiceOrgan::new("/home/u", Arc::new(CountingTranscriber));
        let ctx = CallCtx::test();
        assert!(matches!(
            organ.call(&ctx, "media.capture_photo", json!({})).await,
            Err(XzError::UnknownTool(_))
        ));
        assert!(matches!(
            voice.call(&ctx, SPEAK, json!({"text": "x"})).await,
            Err(XzError::UnknownTool(_))
        ));
    }

    #[tokio::test]
    async fn transcribe_resolves_home_paths() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join("Audio")).unwrap();
        let pcm = Pcm {
            rate: 48_000,
            samples: vec![0.0; 48_000],
        };
        std::fs::write(
            home.path().join("Audio/memo.wav"),
            encode_wav(&pcm).unwrap(),
        )
        .unwrap();
        let organ = VoiceOrgan::new(home.path(), Arc::new(CountingTranscriber));
        let ctx = CallCtx::test();
        for raw in [
            "~/Audio/memo.wav",
            "Audio/./memo.wav",
            "Audio/x/../memo.wav",
        ] {
            let out = organ
                .call(&ctx, TRANSCRIBE, json!({"path": raw}))
                .await
                .unwrap();
            assert_eq!(
                out.content["text"],
                format!("{WHISPER_RATE} samples"),
                "{raw}"
            );
            assert_eq!(out.content["seconds"], 1.0);
            let expected = home.path().join("Audio/memo.wav");
            assert_eq!(out.content["path"], json!(expected.to_string_lossy()));
        }
    }

    #[tokio::test]
    async fn transcribe_validates_path_and_file() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("notes.txt"), "not audio").unwrap();
        let organ = VoiceOrgan::new(home.path(), Arc::new(CountingTranscriber));
        let ctx = CallCtx::test();
        for args in [json!({}), json!({"path": ""}), json!({"path": 3})] {
            assert!(invalid(organ.call(&ctx, TRANSCRIBE, args).await).contains("needs `path`"));
        }
        let missing = organ
            .call(&ctx, TRANSCRIBE, json!({"path": "~/none.wav"}))
            .await
            .unwrap_err();
        assert!(matches!(missing, XzError::NotFound(_)), "{missing}");
        assert!(
            invalid(
                organ
                    .call(&ctx, TRANSCRIBE, json!({"path": "notes.txt"}))
                    .await
            )
            .contains("WAV")
        );
    }

    #[test]
    fn task_ids_become_safe_file_names() {
        assert_eq!(file_safe("t-1_a"), "t-1_a");
        assert_eq!(file_safe("../x/y"), "___x_y");
        assert_eq!(file_safe(""), "rec");
    }
}
