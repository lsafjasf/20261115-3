#!/usr/bin/env bash
# Run the Python unit suite and the browser-math smoke test.
set -euo pipefail
cd "$(dirname "$0")"

echo "== Python unit tests =="
python3 -m unittest discover -s tests -v

echo
echo "== Browser demo math (node) =="
node tests/browser_smoke.js
