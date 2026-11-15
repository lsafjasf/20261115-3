import numpy as np
import pytest

from dubalign.audio import time_stretch, leading_silence


SR = 24000


def _tone(freq=440.0, seconds=2.0):
    t = np.arange(int(seconds * SR)) / SR
    return 0.5 * np.sin(2 * np.pi * freq * t)


def _peak_freq(samples):
    windowed = samples * np.hanning(samples.size)
    spectrum = np.abs(np.fft.rfft(windowed))
    idx = int(np.argmax(spectrum))
    freqs = np.fft.rfftfreq(samples.size, 1 / SR)
    return freqs[idx]


@pytest.mark.parametrize("factor", [0.8, 0.9, 1.1, 1.15])
def test_stretch_hits_exact_target_length(factor):
    x = _tone()
    result = time_stretch(x, SR, factor)
    assert result.samples.size == int(round(x.size * factor))
    assert result.output_seconds == pytest.approx(x.size / SR * factor, abs=1 / SR)


@pytest.mark.parametrize("factor", [0.8, 1.2])
def test_stretch_preserves_pitch(factor):
    x = _tone(freq=440.0)
    stretched = time_stretch(x, SR, factor).samples
    # FFT bin resolution is ~0.5 Hz; pitch must stay on the 440 Hz bin.
    assert _peak_freq(stretched) == pytest.approx(440.0, abs=0.6)


def test_factor_one_returns_unchanged_audio():
    x = _tone()
    result = time_stretch(x, SR, 1.0)
    assert np.array_equal(result.samples, x)


def test_interior_loudness_remains_stable():
    t = np.arange(SR * 2) / SR
    x = 0.5 * np.sin(2 * np.pi * 300 * t)  # steady, full-amplitude tone
    trim = SR // 4
    total_energy = float(np.sum(np.square(x[trim:-trim])))
    for factor in (0.85, 1.1):
        out = time_stretch(x, SR, factor).samples
        inner = out[trim:-trim]
        # Per-sample energy in the steady interior stays roughly constant
        # (phase-vocoder amplitude wobble is expected at some hop ratios).
        assert float(np.mean(np.square(inner))) == pytest.approx(
            total_energy / (x.size - 2 * trim), rel=0.20
        )


def test_invalid_factor_rejected():
    with pytest.raises(ValueError):
        time_stretch(_tone(), SR, 0.0)


def test_leading_silence_detection():
    silence = np.zeros(int(0.3 * SR))
    voice = _tone(seconds=1.0)
    assert leading_silence(np.concatenate([silence, voice]), SR) == pytest.approx(0.3, abs=0.02)
