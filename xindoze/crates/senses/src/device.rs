//! Audio devices through cpal: microphone capture and playback
//! (features `mic` and `kokoro`).

use crate::audio::{Pcm, WHISPER_RATE, downmix, resample};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, SampleFormat, SizedSample, Stream, StreamConfig};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use xz_types::XzError;

/// Records `seconds` from the default microphone as 16 kHz mono. Blocking.
pub fn record(seconds: f32) -> Result<Pcm, XzError> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| XzError::Unsupported("no microphone found".into()))?;
    let supported = device.default_input_config().map_err(device_err)?;
    let config = supported.config();
    let buf = Arc::new(Mutex::new(Vec::new()));
    let stream = match supported.sample_format() {
        SampleFormat::F32 => input::<f32>(&device, &config, &buf),
        SampleFormat::F64 => input::<f64>(&device, &config, &buf),
        SampleFormat::I8 => input::<i8>(&device, &config, &buf),
        SampleFormat::I16 => input::<i16>(&device, &config, &buf),
        SampleFormat::I32 => input::<i32>(&device, &config, &buf),
        SampleFormat::U8 => input::<u8>(&device, &config, &buf),
        SampleFormat::U16 => input::<u16>(&device, &config, &buf),
        SampleFormat::U32 => input::<u32>(&device, &config, &buf),
        other => Err(unsupported_format(other)),
    }?;
    stream.play().map_err(device_err)?;
    std::thread::sleep(Duration::from_secs_f32(seconds));
    drop(stream);
    let interleaved = std::mem::take(&mut *buf.lock().map_err(|_| poisoned())?);
    let mono = downmix(&interleaved, config.channels);
    Ok(Pcm {
        rate: WHISPER_RATE,
        samples: resample(&mono, config.sample_rate, WHISPER_RATE),
    })
}

/// Plays mono audio on the default output device. Blocks until it ends.
pub fn play(pcm: &Pcm) -> Result<(), XzError> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| XzError::Unsupported("no audio output device found".into()))?;
    let supported = device.default_output_config().map_err(device_err)?;
    let config = supported.config();
    let samples = Arc::new(resample(&pcm.samples, pcm.rate, config.sample_rate));
    let duration =
        Duration::from_secs_f64(samples.len() as f64 / f64::from(config.sample_rate.max(1)));
    let (done_tx, done_rx) = mpsc::channel();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => output::<f32>(&device, &config, &samples, done_tx),
        SampleFormat::F64 => output::<f64>(&device, &config, &samples, done_tx),
        SampleFormat::I8 => output::<i8>(&device, &config, &samples, done_tx),
        SampleFormat::I16 => output::<i16>(&device, &config, &samples, done_tx),
        SampleFormat::I32 => output::<i32>(&device, &config, &samples, done_tx),
        SampleFormat::U8 => output::<u8>(&device, &config, &samples, done_tx),
        SampleFormat::U16 => output::<u16>(&device, &config, &samples, done_tx),
        SampleFormat::U32 => output::<u32>(&device, &config, &samples, done_tx),
        other => Err(unsupported_format(other)),
    }?;
    stream.play().map_err(device_err)?;
    // The callback reports the last sample; the timeout covers a stalled device.
    let _ = done_rx.recv_timeout(duration + Duration::from_secs(2));
    // Let the device drain what it has buffered before the stream stops.
    std::thread::sleep(Duration::from_millis(250));
    Ok(())
}

fn input<T>(
    device: &Device,
    config: &StreamConfig,
    buf: &Arc<Mutex<Vec<f32>>>,
) -> Result<Stream, XzError>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let buf = Arc::clone(buf);
    device
        .build_input_stream(
            *config,
            move |data: &[T], _: &_| {
                if let Ok(mut b) = buf.lock() {
                    b.extend(data.iter().map(|s| s.to_sample::<f32>()));
                }
            },
            |e| tracing::warn!("microphone: {e}"),
            None,
        )
        .map_err(device_err)
}

fn output<T>(
    device: &Device,
    config: &StreamConfig,
    samples: &Arc<Vec<f32>>,
    done: Sender<()>,
) -> Result<Stream, XzError>
where
    T: SizedSample + FromSample<f32>,
{
    let samples = Arc::clone(samples);
    let channels = usize::from(config.channels.max(1));
    let mut pos = 0;
    device
        .build_output_stream(
            *config,
            move |out: &mut [T], _: &_| {
                for frame in out.chunks_mut(channels) {
                    let s = samples.get(pos).copied().unwrap_or(0.0);
                    frame.fill(T::from_sample(s));
                    pos += 1;
                }
                if pos >= samples.len() {
                    let _ = done.send(());
                }
            },
            |e| tracing::warn!("audio output: {e}"),
            None,
        )
        .map_err(device_err)
}

fn device_err(e: impl std::fmt::Display) -> XzError {
    XzError::Other(format!("audio device: {e}"))
}

fn unsupported_format(f: SampleFormat) -> XzError {
    XzError::Unsupported(format!("audio sample format {f}"))
}

fn poisoned() -> XzError {
    XzError::Other("audio buffer poisoned".into())
}
