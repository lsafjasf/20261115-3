"""Generate the three-sentence source dub with gTTS and measure its timeline."""

from __future__ import annotations

import json
import os

import numpy as np
import soundfile as sf
from gtts import gTTS

from .audio import leading_silence


SENTENCES = [
    ("s1", "清晨的第一缕阳光，悄悄爬上了窗台。"),
    ("s2", "小猫伸了个懒腰，轻轻跳下了木椅。"),
    ("s3", "它推开房门，走向洒满金光的花园。"),
]


def synthesize(text: str, path: str, sr: int = 24000) -> tuple[np.ndarray, int]:
    tmp = path + ".mp3"
    gTTS(text=text, lang="zh-CN", slow=False).save(tmp)
    data, mp3_sr = sf.read(tmp, always_2d=False)
    mono = data.mean(axis=1) if getattr(data, "ndim", 1) > 1 else data
    if mp3_sr != sr:  # keep the pipeline at a fixed project sample rate
        raise RuntimeError(f"unexpected TTS sample rate {mp3_sr}")
    sf.write(path, mono.astype(np.float32), sr, subtype="PCM_16")
    os.remove(tmp)
    return np.asarray(mono, dtype=np.float64), sr


def build(source_dir: str) -> dict:
    os.makedirs(source_dir, exist_ok=True)
    segments = []
    cursor = 0.30  # small head offset on the source timeline
    gap = 0.25
    for sid, text in SENTENCES:
        wav_path = os.path.join(source_dir, f"{sid}.wav")
        samples, sr = synthesize(text, wav_path)
        duration = len(samples) / sr
        segments.append(
            {
                "id": sid,
                "text": text,
                "source_wav": wav_path,
                "source_start": round(cursor, 3),
                "source_duration": round(duration, 3),
                "target_start": round(cursor, 3),
                "rate": 1.0,
                "pause_after": 0.0,
                "measured_leading_silence": round(leading_silence(samples, sr), 3),
            }
        )
        cursor += duration + gap
    project = {
        "name": "garden-morning",
        "sample_rate": 24000,
        "tolerance": 0.10,
        "segments": segments,
        "source_timeline_seconds": round(cursor - gap, 3),
    }
    with open(os.path.join(source_dir, "source_project.json"), "w", encoding="utf-8") as fh:
        json.dump(project, fh, ensure_ascii=False, indent=2)
    return project


if __name__ == "__main__":
    import sys

    out = build(sys.argv[1] if len(sys.argv) > 1 else "artifacts/source")
    print(json.dumps(out, ensure_ascii=False, indent=2))
