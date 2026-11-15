#!/usr/bin/env python3
"""Independently validate the exported WAV using only the Python stdlib."""

import array
import hashlib
import json
import math
import os
import struct
import sys
import wave
from pathlib import Path


DURATION = 16.0
SAMPLE_RATE = 48000
CHANNELS = 2
BIT_DEPTH = 16
PEAK_CEILING_DB = -1.2


def rms(values):
    return math.sqrt(sum(value * value for value in values) / max(1, len(values)))


def to_db(value):
    return round(20 * math.log10(value), 4) if value > 0 else None


def decode_wav(path):
    with wave.open(str(path), "rb") as audio:
        params = audio.getparams()
        raw = audio.readframes(params.nframes)
    if params.sampwidth != 2:
        raise AssertionError(f"expected 16-bit PCM, got {params.sampwidth * 8}-bit")
    if params.comptype != "NONE":
        raise AssertionError(f"expected uncompressed PCM, got {params.comptype}")

    samples = array.array("h")
    samples.frombytes(raw)
    if sys.byteorder == "big":
        samples.byteswap()
    left = samples[0::2]
    right = samples[1::2]
    return params, raw, left, right


def channel_metrics(samples):
    peak_int = max(abs(value) for value in samples)
    peak = peak_int / 32768
    rms_value = rms(samples) / 32768
    return {
        "peak_amplitude": round(peak, 6),
        "peak_dbfs": to_db(peak),
        "rms_amplitude": round(rms_value, 6),
        "rms_dbfs": to_db(rms_value),
    }


def segment_metrics(left, right, count):
    result = []
    frame_count = len(left)
    for index in range(count):
        start = round(index * frame_count / count)
        end = round((index + 1) * frame_count / count)
        combined = left[start:end] + right[start:end]
        value = rms(combined) / 32768
        result.append({
            "start": round(start / SAMPLE_RATE, 3),
            "end": round(end / SAMPLE_RATE, 3),
            "rms_amplitude": round(value, 6),
            "rms_dbfs": to_db(value),
        })
    return result


def build_waveform_svg(left, right, stats, output_path, buckets=700):
    width, height = 1400, 640
    plot_left, plot_width = 50, 1300
    step = len(left) / buckets
    envelopes = []
    for channel in (left, right):
        points = []
        for bucket in range(buckets):
            start = int(bucket * step)
            end = min(len(channel), int((bucket + 1) * step))
            chunk = channel[start:end]
            positive = max((value for value in chunk if value > 0), default=0) / 32768
            negative = min((value for value in chunk if value < 0), default=0) / 32768
            points.append((bucket, positive, negative))
        envelopes.append(points)

    top_y, plot_height = 270, 110
    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="640" viewBox="0 0 1400 640">',
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#141719"/><stop offset="1" stop-color="#08090a"/>',
        '</linearGradient></defs>',
        '<rect width="1400" height="640" fill="url(#bg)"/>',
        '<text x="50" y="58" fill="#f2eee7" font-family="DejaVu Sans,sans-serif" font-size="27" font-weight="700">FOUR·16 EXPORT VERIFICATION</text>',
        '<text x="50" y="86" fill="#8d9397" font-family="DejaVu Sans Mono,monospace" font-size="11" letter-spacing="2">16.000 s · 2 CHANNELS · 48 kHz · 16-BIT PCM</text>',
        f'<text x="1350" y="60" text-anchor="end" fill="#87dfb8" font-family="DejaVu Sans Mono,monospace" font-size="12">{stats["validation"]["passed"] and "PASS" or "FAIL"}</text>',
    ]

    for second in range(17):
        x = plot_left + plot_width * second / DURATION
        opacity = "0.22" if second % 2 == 0 else "0.1"
        svg.append(f'<line x1="{x:.2f}" y1="112" x2="{x:.2f}" y2="530" stroke="#ffffff" stroke-opacity="{opacity}"/>')
        if second % 2 == 0:
            svg.append(f'<text x="{x:.2f}" y="105" fill="#777d81" font-family="DejaVu Sans Mono,monospace" font-size="9">{second}s</text>')

    for channel_index, points in enumerate(envelopes):
        baseline = top_y + channel_index * (plot_height + 55)
        color = "#efb35f" if channel_index == 0 else "#83c8f2"
        channel_label = "L" if channel_index == 0 else "R"
        svg.append(f'<text x="50" y="{baseline - plot_height - 10}" fill="{color}" font-family="DejaVu Sans Mono,monospace" font-size="12" font-weight="700">{channel_label}</text>')
        svg.append(f'<line x1="{plot_left}" y1="{baseline}" x2="1350" y2="{baseline}" stroke="#ffffff" stroke-opacity="0.09"/>')
        top_points = []
        bottom_points = []
        for bucket, positive, negative in points:
            x = plot_left + plot_width * bucket / (buckets - 1)
            top_points.append(f"{x:.2f},{baseline - positive * plot_height:.2f}")
            bottom_points.append(f"{x:.2f},{baseline - negative * plot_height:.2f}")
        svg.append(f'<path d="M {" L ".join(top_points)} L {" L ".join(reversed(bottom_points))} Z" fill="{color}" fill-opacity="0.62"/>')
        channel_stat = stats["channels"][channel_label]
        svg.append(
            f'<text x="1350" y="{baseline - plot_height - 10}" text-anchor="end" fill="#8d9397" '
            f'font-family="DejaVu Sans Mono,monospace" font-size="10">'
            f'PEAK {channel_stat["peak_dbfs"]:.2f} dBFS · RMS {channel_stat["rms_dbfs"]:.2f} dB</text>'
        )

    svg.extend([
        '<line x1="50" y1="558" x2="1350" y2="558" stroke="#ffffff" stroke-opacity="0.12"/>',
        f'<text x="50" y="588" fill="#8d9397" font-family="DejaVu Sans Mono,monospace" font-size="10">FRAMES {stats["frames"]:,}</text>',
        f'<text x="355" y="588" fill="#8d9397" font-family="DejaVu Sans Mono,monospace" font-size="10">PEAK {stats["peak_dbfs"]:.2f} dBFS</text>',
        f'<text x="650" y="588" fill="#8d9397" font-family="DejaVu Sans Mono,monospace" font-size="10">RMS {stats["rms_dbfs"]:.2f} dB</text>',
        f'<text x="945" y="588" fill="#8d9397" font-family="DejaVu Sans Mono,monospace" font-size="10">CLIPPED {stats["clipped_samples"]}</text>',
        f'<text x="1350" y="588" text-anchor="end" fill="#8d9397" font-family="DejaVu Sans Mono,monospace" font-size="10">SHA256 {stats["sha256"][:16]}…</text>',
        '<text x="50" y="616" fill="#555b5f" font-family="DejaVu Sans Mono,monospace" font-size="8">L/R PEAK ENVELOPE OF DECODED PCM. PEAK GUARD CEILING: -1.20 dBFS.</text>',
        '</svg>',
    ])
    output_path.write_text("\n".join(svg), encoding="utf-8")


def main():
    root = Path(__file__).resolve().parents[1]
    wav_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "artifacts" / "FOUR16_16s_mix.wav"
    params, raw, left, right = decode_wav(wav_path)
    frame_count = params.nframes
    duration = frame_count / params.framerate
    left_metrics = channel_metrics(left)
    right_metrics = channel_metrics(right)
    combined_peak_int = max(max(abs(value) for value in left), max(abs(value) for value in right))
    combined_peak = combined_peak_int / 32768
    combined_rms = rms(left + right) / 32768
    segments = segment_metrics(left, right, 16)
    stereo_difference = sum(abs(a - b) for a, b in zip(left, right)) / max(1, frame_count) / 32768
    clipped = sum(value >= 32767 or value <= -32768 for value in left + right)
    ceil_amplitude = 10 ** (PEAK_CEILING_DB / 20)

    validation = {
        "duration_16s": abs(duration - DURATION) <= 0.001,
        "stereo": params.nchannels == CHANNELS,
        "sample_rate_48k": params.framerate == SAMPLE_RATE,
        "bit_depth_16": params.sampwidth * 8 == BIT_DEPTH,
        "frame_count_exact": frame_count == round(DURATION * SAMPLE_RATE),
        "data_size_consistent": len(raw) == frame_count * params.nchannels * params.sampwidth,
        "non_silent": combined_peak > 0.05 and combined_rms > 0.01,
        "both_channels_active": min(left_metrics["peak_amplitude"], right_metrics["peak_amplitude"]) > 0.01,
        "all_segments_active": all(item["rms_amplitude"] > 0.005 for item in segments),
        "stereo_channels_distinct": stereo_difference > 0.001,
        "peak_guard_ceiling": combined_peak <= ceil_amplitude + 0.0001,
        "no_clipping": clipped == 0,
    }
    validation["passed"] = all(validation.values())

    stats = {
        "file": wav_path.name,
        "file_bytes": os.path.getsize(wav_path),
        "sha256": hashlib.sha256(wav_path.read_bytes()).hexdigest(),
        "format": {
            "container": "RIFF/WAVE",
            "encoding": "PCM",
            "channels": params.nchannels,
            "sample_rate": params.framerate,
            "bit_depth": params.sampwidth * 8,
        },
        "frames": frame_count,
        "duration": round(duration, 6),
        "peak_amplitude": round(combined_peak, 6),
        "peak_dbfs": to_db(combined_peak),
        "rms_amplitude": round(combined_rms, 6),
        "rms_dbfs": to_db(combined_rms),
        "clipped_samples": clipped,
        "stereo_difference_amplitude": round(stereo_difference, 6),
        "peak_guard_ceiling_dbfs": PEAK_CEILING_DB,
        "peak_guard_ceiling_amplitude": round(ceil_amplitude, 6),
        "channels": {"L": left_metrics, "R": right_metrics},
        "segments": segments,
        "validation": validation,
    }

    report_path = root / "artifacts" / "verification.json"
    waveform_path = root / "artifacts" / "export-waveform.svg"
    report_path.write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    build_waveform_svg(left, right, stats, waveform_path)

    print(json.dumps({
        "passed": validation["passed"],
        "duration": stats["duration"],
        "channels": stats["format"]["channels"],
        "sample_rate": stats["format"]["sample_rate"],
        "frames": stats["frames"],
        "peak_dbfs": stats["peak_dbfs"],
        "rms_dbfs": stats["rms_dbfs"],
        "clipped_samples": stats["clipped_samples"],
        "stereo_difference": stats["stereo_difference_amplitude"],
        "report": str(report_path),
        "waveform": str(waveform_path),
    }, indent=2))


if __name__ == "__main__":
    main()
