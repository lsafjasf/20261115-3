#!/usr/bin/env bash
# End-to-end pipeline: build source -> adjust three sentences -> export -> verify.
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH=src

echo "== 1. generate three-sentence TTS source =="
python3 -m dubalign.make_source artifacts/source

echo "== 2. apply the three sentence-level adjustments and export =="
python3 -m dubalign.apply_demo_adjustments

echo "== 3. playback verification (timeline checks + live pulse playback) =="
python3 - <<'PY'
import json
from dubalign.playback_check import run
report = run("artifacts/export/project.json",
             "artifacts/export/dub_adjusted.wav",
             "artifacts/export")
print(json.dumps(report["live_playback"], ensure_ascii=False))
for s in report["segments"]:
    print(f"{s['id']}: start_err={s['start_error_ms']}ms "
          f"rate={s['requested_rate']} measured={s['measured_rate']} "
          f"within_tolerance={s['within_tolerance']} "
          f"gap_after={s['silence_gap_after_measured_seconds']}s")
PY

echo "== 4. per-segment isolation proof =="
python3 -m dubalign.verify_isolation artifacts/export/project.json

echo "== 5. unit tests =="
python3 -m pytest test/ -q
