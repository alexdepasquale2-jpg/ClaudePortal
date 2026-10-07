//! WAV decoding, downmixing and resampling for the speech models.

use std::fs::File;
use std::io::{BufReader, Cursor, Read};
use std::path::Path;
use xz_types::XzError;

/// The sample rate whisper.cpp expects.
pub const WHISPER_RATE: u32 = 16_000;

/// Longest audio `decode_wav` accepts. Decoding holds every sample in memory,
/// so this bounds RAM use for a file of unknown size.
pub const MAX_WAV_SECONDS: u32 = 30 * 60;

/// Mono audio: f32 samples in [-1, 1] at `rate` Hz.
#[derive(Clone, Debug, PartialEq)]
pub struct Pcm {
    pub rate: u32,
    pub samples: Vec<f32>,
}

impl Pcm {
    /// Duration in seconds.
    pub fn seconds(&self) -> f32 {
        if self.rate == 0 {
            0.0
        } else {
            self.samples.len() as f32 / self.rate as f32
        }
    }

    /// A copy resampled to `rate`.
    pub fn resampled(&self, rate: u32) -> Pcm {
        Pcm {
            rate,
            samples: resample(&self.samples, self.rate, rate),
        }
    }
}

/// Decodes a WAV stream (integer or float PCM, any channel count) to mono.
pub fn decode_wav(reader: impl Read) -> Result<Pcm, XzError> {
    let mut wav = hound::WavReader::new(reader).map_err(wav_err)?;
    let spec = wav.spec();
    if spec.channels == 0 || spec.sample_rate == 0 {
        return Err(XzError::InvalidArgs(
            "WAV header has no channels or rate".into(),
        ));
    }
    if wav.duration() / spec.sample_rate > MAX_WAV_SECONDS {
        return Err(XzError::InvalidArgs(format!(
            "audio is longer than {} minutes",
            MAX_WAV_SECONDS / 60
        )));
    }
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => wav
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(wav_err)?,
        hound::SampleFormat::Int => {
            if !(1..=32).contains(&spec.bits_per_sample) {
                return Err(XzError::InvalidArgs(format!(
                    "unsupported WAV sample size: {} bits",
                    spec.bits_per_sample
                )));
            }
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            wav.samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()
                .map_err(wav_err)?
        }
    };
    Ok(Pcm {
        rate: spec.sample_rate,
        samples: downmix(&interleaved, spec.channels),
    })
}

/// Reads a WAV file as 16 kHz mono, ready for whisper.
pub fn load_wav_16k(path: &Path) -> Result<Pcm, XzError> {
    let file = File::open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => XzError::NotFound(path.display().to_string()),
        _ => XzError::Io(e),
    })?;
    Ok(decode_wav(BufReader::new(file))?.resampled(WHISPER_RATE))
}

/// Encodes mono audio as a 16-bit PCM WAV file.
pub fn encode_wav(pcm: &Pcm) -> Result<Vec<u8>, XzError> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: pcm.rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut out = Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut out, spec).map_err(wav_err)?;
    for &s in &pcm.samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        writer.write_sample(v).map_err(wav_err)?;
    }
    writer.finalize().map_err(wav_err)?;
    Ok(out.into_inner())
}

/// Averages interleaved frames into one channel.
pub fn downmix(interleaved: &[f32], channels: u16) -> Vec<f32> {
    let n = usize::from(channels.max(1));
    if n == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(n)
        .map(|frame| frame.iter().sum::<f32>() / n as f32)
        .collect()
}

/// Resamples mono audio from `from` Hz to `to` Hz.
///
/// Downsampling averages each output sample's source window (a box filter),
/// which keeps aliasing low enough for speech recognition without pulling in
/// a DSP crate. Upsampling interpolates linearly.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || from == 0 || to == 0 || input.is_empty() {
        return input.to_vec();
    }
    let len = input.len();
    let out_len = (len as u64 * u64::from(to)).div_ceil(u64::from(from)) as usize;
    let step = f64::from(from) / f64::from(to);
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * step;
        let start = (pos as usize).min(len - 1);
        if step > 1.0 {
            let end = (((i + 1) as f64 * step) as usize).clamp(start + 1, len);
            let window = &input[start..end];
            out.push(window.iter().sum::<f32>() / window.len() as f32);
        } else {
            let next = (start + 1).min(len - 1);
            let frac = (pos - start as f64) as f32;
            out.push(input[start] + (input[next] - input[start]) * frac);
        }
    }
    out
}

fn wav_err(e: hound::Error) -> XzError {
    match e {
        hound::Error::IoError(io) => XzError::Io(io),
        other => XzError::InvalidArgs(format!("not a readable WAV file: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: u32, seconds: f32) -> Vec<f32> {
        let n = (rate as f32 * seconds) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.5)
            .collect()
    }

    fn zero_crossings(s: &[f32]) -> usize {
        s.windows(2)
            .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
            .count()
    }

    fn wav_bytes(
        spec: hound::WavSpec,
        write: impl FnOnce(&mut hound::WavWriter<&mut Cursor<Vec<u8>>>),
    ) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        let mut w = hound::WavWriter::new(&mut out, spec).unwrap();
        write(&mut w);
        w.finalize().unwrap();
        out.into_inner()
    }

    #[test]
    fn decodes_stereo_i16_to_mono() {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let bytes = wav_bytes(spec, |w| {
            for _ in 0..100 {
                w.write_sample(i16::MAX).unwrap();
                w.write_sample(0i16).unwrap();
            }
        });
        let pcm = decode_wav(Cursor::new(bytes)).unwrap();
        assert_eq!(pcm.rate, 44_100);
        assert_eq!(pcm.samples.len(), 100);
        assert!(pcm.samples.iter().all(|&s| (s - 0.5).abs() < 1e-3));
    }

    #[test]
    fn decodes_float_and_8_bit() {
        let float = hound::WavSpec {
            channels: 1,
            sample_rate: 8_000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let bytes = wav_bytes(float, |w| {
            w.write_sample(0.25f32).unwrap();
            w.write_sample(-0.75f32).unwrap();
        });
        assert_eq!(
            decode_wav(Cursor::new(bytes)).unwrap().samples,
            vec![0.25, -0.75]
        );

        let byte = hound::WavSpec {
            channels: 1,
            sample_rate: 8_000,
            bits_per_sample: 8,
            sample_format: hound::SampleFormat::Int,
        };
        let bytes = wav_bytes(byte, |w| {
            w.write_sample(-128i8).unwrap();
            w.write_sample(64i8).unwrap();
        });
        assert_eq!(
            decode_wav(Cursor::new(bytes)).unwrap().samples,
            vec![-1.0, 0.5]
        );
    }

    #[test]
    fn rejects_non_wav() {
        let err = decode_wav(Cursor::new(b"ID3 not a wav file at all".to_vec())).unwrap_err();
        assert!(matches!(err, XzError::InvalidArgs(_)), "{err}");
    }

    #[test]
    fn encode_roundtrips() {
        let pcm = Pcm {
            rate: WHISPER_RATE,
            samples: sine(440.0, WHISPER_RATE, 0.1),
        };
        let back = decode_wav(Cursor::new(encode_wav(&pcm).unwrap())).unwrap();
        assert_eq!(back.rate, pcm.rate);
        assert_eq!(back.samples.len(), pcm.samples.len());
        let max_err = back
            .samples
            .iter()
            .zip(&pcm.samples)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f32::max);
        assert!(max_err < 1e-3, "{max_err}");
    }

    #[test]
    fn resample_keeps_duration_and_pitch() {
        for (from, to) in [
            (48_000, 16_000),
            (44_100, 16_000),
            (8_000, 16_000),
            (22_050, 16_000),
        ] {
            let input = sine(300.0, from, 1.0);
            let out = resample(&input, from, to);
            assert_eq!(out.len(), to as usize, "{from} -> {to}");
            // A 300 Hz tone crosses zero 600 times a second at any sample rate.
            let crossings = zero_crossings(&out) as i64;
            assert!((crossings - 600).abs() <= 2, "{from} -> {to}: {crossings}");
        }
    }

    #[test]
    fn resample_edge_cases() {
        assert_eq!(resample(&[], 48_000, 16_000), Vec::<f32>::new());
        assert_eq!(resample(&[0.1, 0.2], 16_000, 16_000), vec![0.1, 0.2]);
        assert_eq!(resample(&[0.3], 48_000, 16_000), vec![0.3]);
        assert_eq!(
            resample(&[0.0, 1.0], 8_000, 16_000),
            vec![0.0, 0.5, 1.0, 1.0]
        );
    }

    #[test]
    fn downmix_averages_frames() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.2, 0.4], 1), vec![0.2, 0.4]);
    }

    #[test]
    fn loads_file_at_16k() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.wav");
        let pcm = Pcm {
            rate: 48_000,
            samples: sine(200.0, 48_000, 0.5),
        };
        std::fs::write(&path, encode_wav(&pcm).unwrap()).unwrap();
        let loaded = load_wav_16k(&path).unwrap();
        assert_eq!(loaded.rate, WHISPER_RATE);
        assert_eq!(loaded.samples.len(), 8_000);
        assert!((loaded.seconds() - 0.5).abs() < 1e-3);
        let missing = load_wav_16k(&dir.path().join("none.wav")).unwrap_err();
        assert!(matches!(missing, XzError::NotFound(_)));
    }
}
