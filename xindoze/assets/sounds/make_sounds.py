#!/usr/bin/env python3
"""Synthesize the Xindoze UI sounds. No samples and no recordings.

Identity: organic and bioluminescent. Soft, confident, never smug.
Every cue is a glass membrane: two slightly detuned sines, a quiet octave,
and a little air. The boot chime is the motif — one tone that divides into
a fifth, the same story as a cell dividing into the X.

Output is mono, 44.1 kHz, peaking at about -3 dBFS.
OGG Vorbis is the primary file; WAV is the fallback.

Requires numpy. OGG encoding shells out to ffmpeg (libvorbis).
Run from anywhere:  python3 xindoze/assets/sounds/make_sounds.py
"""

from __future__ import annotations

import shutil
import struct
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 44100
PEAK = 10 ** (-3 / 20)  # -3 dBFS
HERE = Path(__file__).resolve().parent


def cents(freq: float, shift: float) -> float:
    return freq * (2 ** (shift / 1200))


def fade_edges(x: np.ndarray, ms: float = 8) -> np.ndarray:
    n = min(int(SR * ms / 1000), len(x) // 2)
    if n < 2:
        return x
    ramp = np.linspace(0, 1, n)
    y = x.copy()
    y[:n] *= ramp
    y[-n:] *= ramp[::-1]
    return y


def highpass(x: np.ndarray, fc: float = 48) -> np.ndarray:
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    prev_y = 0.0
    prev_x = 0.0
    for i, sample in enumerate(x):
        prev_y = a * (prev_y + sample - prev_x)
        prev_x = sample
        y[i] = prev_y
    return y


def lowpass(x: np.ndarray, fc: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, sample in enumerate(x):
        acc = (1 - a) * sample + a * acc
        y[i] = acc
    return y


def membrane(freq: float, n: int, decay: float, brightness: float = 0.2) -> np.ndarray:
    """A soft bioluminescent body. Attack is rounded so it never clicks."""
    t = np.arange(n) / SR
    det = cents(freq, 7.5)
    body = (
        np.sin(2 * np.pi * freq * t)
        + 0.48 * np.sin(2 * np.pi * det * t + 0.6)
        + brightness * np.sin(2 * np.pi * freq * 2 * t)
        + 0.06 * np.sin(2 * np.pi * cents(freq, 4) * 3 * t)
    )
    attack = np.clip(t / 0.018, 0, 1) ** 2
    return body * np.exp(-decay * t) * attack


def glide(f0: float, f1: float, dur: float, decay: float, brightness: float = 0.22) -> np.ndarray:
    n = max(2, int(SR * dur))
    t = np.linspace(0, 1, n)
    curve = t * t * (3 - 2 * t)
    freqs = f0 * (f1 / f0) ** curve
    phase = 2 * np.pi * np.cumsum(freqs) / SR
    det_phase = 2 * np.pi * np.cumsum(cents(freqs, 7)) / SR
    body = (
        np.sin(phase)
        + 0.42 * np.sin(det_phase + 0.5)
        + brightness * np.sin(2 * phase)
    )
    env_t = np.arange(n) / SR
    attack = np.clip(env_t / 0.016, 0, 1) ** 2
    return body * np.exp(-decay * env_t) * attack


def air(n: int, seed: int, fc: float, amount: float, decay: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = lowpass(rng.normal(0, 1, n), fc)
    t = np.arange(n) / SR
    shaped = noise * np.exp(-decay * t) * np.clip(t / 0.02, 0, 1)
    peak = np.max(np.abs(shaped)) or 1
    return shaped / peak * amount


def room(x: np.ndarray, delay_ms: float = 38, mix: float = 0.2) -> np.ndarray:
    """Two short taps. Enough space to feel like a cell, not a hall."""
    d1 = int(SR * delay_ms / 1000)
    d2 = int(SR * delay_ms * 1.73 / 1000)
    n = len(x) + d2
    wet = np.zeros(n)
    wet[: len(x)] += x
    wet[d1 : d1 + len(x)] += x * 0.22
    wet[d2 : d2 + len(x)] += x * 0.09
    dry = np.pad(x, (0, n - len(x)))
    return dry * (1 - mix) + wet * mix


def finish(x: np.ndarray) -> np.ndarray:
    y = highpass(x.astype(np.float64), 46)
    y = np.tanh(y * 1.12)
    y = fade_edges(y, 7)
    y -= np.mean(y)
    peak = np.max(np.abs(y))
    if peak < 1e-8:
        raise RuntimeError("silent buffer")
    return y * (PEAK / peak)


def place(buf: np.ndarray, seg: np.ndarray, start: float) -> None:
    i0 = int(start * SR)
    i1 = min(len(buf), i0 + len(seg))
    buf[i0:i1] += seg[: i1 - i0]


def boot_evolved() -> np.ndarray:
    """One tone divides into a fifth. The boot line, in sound."""
    dur = 1.22
    n = int(SR * dur)
    t = np.arange(n) / SR
    stay = membrane(220.0, n, decay=1.05, brightness=0.14)
    split = 0.34
    freqs = np.full(n, 220.0)
    moving = t > split
    u = (t[moving] - split) / (dur - split - 0.18)
    u = np.clip(u, 0, 1)
    u = u * u * (3 - 2 * u)
    freqs[moving] = 220.0 * (329.63 / 220.0) ** u
    phase = 2 * np.pi * np.cumsum(freqs) / SR
    child = np.sin(phase) + 0.16 * np.sin(2 * phase)
    child *= np.exp(-0.95 * t) * np.clip((t - 0.22) / 0.12, 0, 1)
    glow = membrane(659.26, n, decay=3.4, brightness=0.4) * 0.18
    glow *= np.clip((t - 0.55) / 0.2, 0, 1)
    y = stay * 0.72 + child * 0.55 + glow + air(n, 11, 1400, 0.045, 2.4)
    return room(y, 46, 0.28)


def intent_open() -> np.ndarray:
    body = glide(349.23, 587.33, 0.26, decay=4.2, brightness=0.3)
    n = len(body)
    puff = air(n, 21, 2200, 0.07, 10)
    return room(body * 0.9 + puff, 28, 0.16)


def intent_close() -> np.ndarray:
    body = glide(587.33, 311.13, 0.24, decay=4.6, brightness=0.18)
    return room(body, 26, 0.12)


def intent_sent() -> np.ndarray:
    """A single droplet leaving the bar."""
    drop = glide(784.0, 622.25, 0.15, decay=9.5, brightness=0.42)
    n = len(drop)
    tick = air(n, 31, 4200, 0.05, 28)
    return room(drop + tick, 22, 0.14)


def task_done() -> np.ndarray:
    """A quiet fifth, the boot interval heard again, higher and shorter."""
    n = int(SR * 0.58)
    y = np.zeros(n)
    place(y, membrane(392.0, int(SR * 0.34), decay=3.1, brightness=0.18), 0)
    place(y, membrane(587.33, int(SR * 0.4), decay=2.6, brightness=0.24) * 1.05, 0.16)
    place(y, air(n, 41, 1800, 0.03, 3.5), 0)
    return room(y, 40, 0.22)


def warden_ask() -> np.ndarray:
    """An unresolved rise. It waits; it does not insist."""
    n = int(SR * 0.56)
    y = np.zeros(n)
    place(y, membrane(349.23, int(SR * 0.22), decay=4.0, brightness=0.12), 0)
    place(y, glide(349.23, 415.30, 0.42, decay=1.7, brightness=0.1), 0.12)
    return room(y * 0.95, 44, 0.2)


def deny() -> np.ndarray:
    """Closed, dry, low. A door, not a buzzer."""
    body = glide(196.0, 146.83, 0.32, decay=3.4, brightness=0.02)
    n = len(body)
    knock = air(n, 51, 380, 0.18, 16)
    y = body * 0.85 + knock
    return room(y, 18, 0.06)


def rewind() -> np.ndarray:
    """A swoosh built forward, then reversed. Energy arrives first."""
    dur = 0.40
    n = int(SR * dur)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(61)
    white = rng.normal(0, 1, n)
    swept = np.empty(n)
    acc = 0.0
    for i, sample in enumerate(white):
        fc = 280 * (5200 / 280) ** t[i]
        a = np.exp(-2 * np.pi * fc / SR)
        acc = (1 - a) * sample + a * acc
        swept[i] = acc
    env = (np.sin(np.pi * t) ** 1.15) * np.clip(t * 3.2, 0, 1)
    tone = glide(587.33, 349.23, dur, decay=2.2, brightness=0.08)
    forward = swept / (np.max(np.abs(swept)) or 1) * env * 0.75 + tone * 0.22
    backward = forward[::-1].copy()
    return room(backward, 24, 0.1)


def hive_connect() -> np.ndarray:
    """Two pitches beat, then lock. A peer has joined."""
    dur = 0.48
    n = int(SR * dur)
    t = np.arange(n) / SR
    u = np.clip((t - 0.06) / 0.34, 0, 1)
    u = u * u * (3 - 2 * u)
    f_a = 440 * (493.88 / 440) ** u
    f_b = 466.16 * (493.88 / 466.16) ** u
    phase_a = 2 * np.pi * np.cumsum(f_a) / SR
    phase_b = 2 * np.pi * np.cumsum(f_b) / SR
    y = np.sin(phase_a) + np.sin(phase_b)
    y += 0.12 * np.sin(2 * phase_a)
    y *= np.exp(-1.6 * t) * np.clip(t / 0.02, 0, 1) ** 2
    y += air(n, 71, 2000, 0.025, 3)
    return room(y, 36, 0.2)


def hive_disconnect() -> np.ndarray:
    """Unison drifts apart and thins out."""
    dur = 0.46
    n = int(SR * dur)
    t = np.arange(n) / SR
    u = np.clip(t / 0.4, 0, 1)
    u = u * u * (3 - 2 * u)
    f_stay = np.full(n, 493.88)
    f_leave = 493.88 * (369.99 / 493.88) ** u
    y = np.sin(2 * np.pi * np.cumsum(f_stay) / SR)
    y += np.sin(2 * np.pi * np.cumsum(f_leave) / SR + 0.3)
    y *= np.exp(-2.15 * t) * np.clip(t / 0.015, 0, 1) ** 2
    y += air(n, 81, 1600, 0.03, 2.6)
    return room(y * 0.85, 34, 0.16)


def notification() -> np.ndarray:
    """One glass strike. Brighter than task-done, still quiet."""
    n = int(SR * 0.38)
    t = np.arange(n) / SR
    partials = [(659.25, 1.0), (1318.5 * 1.004, 0.22), (1976.0, 0.05)]
    y = np.zeros(n)
    for freq, amp in partials:
        y += amp * np.sin(2 * np.pi * freq * t)
    y *= np.exp(-5.4 * t) * np.clip(t / 0.006, 0, 1)
    return room(y, 32, 0.24)


def error() -> np.ndarray:
    """Two warm pulses. Gentle, never blaming."""
    n = int(SR * 0.52)
    y = np.zeros(n)
    first = membrane(174.61, int(SR * 0.28), decay=4.2, brightness=0.04)
    second = membrane(164.81, int(SR * 0.3), decay=3.6, brightness=0.04)
    # Slower attack than the other cues, so it doesn't jab.
    first *= np.clip(np.arange(len(first)) / SR / 0.045, 0, 1)
    second *= np.clip(np.arange(len(second)) / SR / 0.045, 0, 1)
    place(y, first, 0)
    place(y, second * 0.92, 0.2)
    return room(y, 30, 0.14)


CUES = [
    ("boot-evolved", boot_evolved),
    ("intent-open", intent_open),
    ("intent-close", intent_close),
    ("intent-sent", intent_sent),
    ("task-done", task_done),
    ("warden-ask", warden_ask),
    ("deny", deny),
    ("rewind", rewind),
    ("hive-connect", hive_connect),
    ("hive-disconnect", hive_disconnect),
    ("notification", notification),
    ("error", error),
]


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(np.round(audio * 32767), -32768, 32767).astype("<i2")
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def write_ogg(wav_path: Path, ogg_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to encode OGG Vorbis")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(wav_path),
            "-c:a",
            "libvorbis",
            "-q:a",
            "3",
            "-ac",
            "1",
            "-ar",
            str(SR),
            str(ogg_path),
        ],
        check=True,
    )


def peak_db(path: Path) -> tuple[float, float, int]:
    with wave.open(str(path)) as handle:
        if handle.getnchannels() != 1 or handle.getframerate() != SR:
            raise SystemExit(f"{path.name} is not mono 44.1 kHz")
        frames = handle.getnframes()
        raw = handle.readframes(frames)
    samples = np.array(struct.unpack("<" + "h" * (len(raw) // 2), raw), dtype=np.float64)
    peak = np.max(np.abs(samples)) / 32768
    db = 20 * np.log10(peak) if peak else -99
    return db, frames / SR, frames


def main() -> None:
    wav_dir = HERE / "wav"
    ogg_dir = HERE / "ogg"
    wav_dir.mkdir(exist_ok=True)
    ogg_dir.mkdir(exist_ok=True)
    print(f"{'cue':<18} {'sec':>6} {'peak':>8} {'wav':>8} {'ogg':>8}")
    total = 0
    for name, synth in CUES:
        audio = finish(synth())
        wav_path = wav_dir / f"{name}.wav"
        ogg_path = ogg_dir / f"{name}.ogg"
        write_wav(wav_path, audio)
        write_ogg(wav_path, ogg_path)
        db, dur, _ = peak_db(wav_path)
        total += wav_path.stat().st_size + ogg_path.stat().st_size
        print(
            f"{name:<18} {dur:6.2f} {db:7.2f}dB {wav_path.stat().st_size:8d} {ogg_path.stat().st_size:8d}"
        )
        if not -3.35 <= db <= -2.7:
            raise SystemExit(f"{name} peaks at {db:.2f} dBFS, expected about -3")
        if dur > 1.6:
            raise SystemExit(f"{name} is {dur:.2f}s, longer than the UI budget")
        edge = np.max(np.abs(audio[:32]))
        if edge > 0.05:
            raise SystemExit(f"{name} starts hot ({edge:.3f}); fade the attack")
    print(f"total bytes {total}")
    if total > 1_000_000:
        raise SystemExit(f"sound bundle is {total} bytes, over the 1 MB budget")


if __name__ == "__main__":
    main()
