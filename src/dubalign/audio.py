"""Audio primitives: WAV I/O, WSOLA time-stretch, silence/energy helpers.

Everything here operates on mono float arrays at a fixed sample rate.
WSOLA (waveform similarity overlap-add) changes duration without changing
pitch, which is what keeps the stretched speech sounding natural.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import soundfile as sf

try:  # librosa ships a battle-tested phase vocoder
    import librosa
except Exception:  # pragma: no cover - optional dependency
    librosa = None


def read_wav(path: str) -> tuple[np.ndarray, int]:
    data, sr = sf.read(path, always_2d=False)
    mono = data.mean(axis=1) if getattr(data, "ndim", 1) > 1 else np.asarray(data, dtype=np.float64)
    return mono.astype(np.float64), int(sr)


def write_wav(path: str, samples: np.ndarray, sr: int) -> None:
    out = np.asarray(samples, dtype=np.float32)
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.99:
        out = out * (0.99 / peak)
    sf.write(path, out, sr, subtype="PCM_16")


def rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


def leading_silence(samples: np.ndarray, sr: int, threshold: float = 0.01) -> float:
    """Return seconds of leading samples below an absolute amplitude threshold."""
    envelope = np.abs(samples)
    window = max(1, int(0.01 * sr))
    if envelope.size < window:
        return 0.0
    blocks = envelope[: (envelope.size // window) * window].reshape(-1, window)
    block_rms = np.sqrt(np.mean(np.square(blocks), axis=1))
    voiced = np.flatnonzero(block_rms > threshold)
    if voiced.size == 0:
        return samples.size / sr
    return float(voiced[0] * window) / sr


@dataclass
class StretchResult:
    samples: np.ndarray
    sr: int
    factor: float
    input_seconds: float
    output_seconds: float


def time_stretch(
    samples: np.ndarray,
    sr: int,
    factor: float,
    frame_ms: float = 46.0,
) -> StretchResult:
    """Stretch `samples` in time by `factor` while preserving pitch (phase vocoder).

    factor > 1 makes speech longer (slower); factor < 1 shorter (faster).
    """
    if factor <= 0:
        raise ValueError("stretch factor must be positive")
    x = np.asarray(samples, dtype=np.float64)
    if x.ndim != 1:
        raise ValueError("time_stretch expects mono samples")
    n = x.size
    target_n = int(round(n * factor))
    if n == 0:
        return StretchResult(x.copy(), sr, factor, 0.0, 0.0)
    if target_n == n or abs(target_n - n) < 2:
        return StretchResult(x.copy(), sr, factor, n / sr, n / sr)

    if librosa is not None:
        y = librosa.effects.time_stretch(x, rate=1.0 / factor)
        if y.size > target_n:
            y = y[:target_n]
        elif y.size < target_n:
            y = np.pad(y, (0, target_n - y.size))
        return StretchResult(y, sr, factor, n / sr, target_n / sr)

    # ---- pure-numpy phase vocoder fallback ----
    nfft = 1
    while nfft < sr * frame_ms / 1000.0:
        nfft *= 2
    hop_s = nfft // 4  # synthesis hop
    hop_a = hop_s * factor  # analysis hop (fractional)
    window = np.hanning(nfft)
    bin_omega = 2.0 * math.pi * hop_s * np.arange(nfft // 2 + 1) / nfft

    frames_out = max(1, int(round(target_n / hop_s)) + 2)
    prev_phase = np.zeros(nfft // 2 + 1)
    acc_phase = np.zeros(nfft // 2 + 1)
    synth_frames = np.zeros((frames_out, nfft // 2 + 1), dtype=np.complex128)

    for k in range(frames_out):
        start = int(round(k * hop_a))
        frame = np.zeros(nfft)
        avail = max(0, min(nfft, n - start))
        if avail:
            frame[:avail] = x[start : start + avail]
        spectrum = np.fft.rfft(frame * window)
        mag = np.abs(spectrum)
        phase = np.angle(spectrum)
        if k == 0:
            acc_phase = phase.copy()
        else:
            deviation = phase - prev_phase - bin_omega
            deviation = (deviation + math.pi) % (2.0 * math.pi) - math.pi
            acc_phase += bin_omega + deviation
        synth_frames[k] = mag * np.exp(1j * acc_phase)
        prev_phase = phase

    # inverse FFT + overlap-add with synthesis hop
    y = np.zeros(frames_out * hop_s + nfft)
    wsum = np.zeros_like(y)
    for k in range(frames_out):
        sig = np.fft.irfft(synth_frames[k], nfft) * window
        y[k * hop_s : k * hop_s + nfft] += sig
        wsum[k * hop_s : k * hop_s + nfft] += window * window
    mask = wsum > 1e-8
    y[mask] /= wsum[mask]

    # force the exact target length
    if y.size > target_n:
        y = y[:target_n]
    elif y.size < target_n:
        y = np.pad(y, (0, target_n - y.size))
    return StretchResult(y, sr, factor, n / sr, target_n / sr)
