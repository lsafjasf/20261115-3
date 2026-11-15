"""Small stdlib-only web app for interactive sketch vectorisation."""

from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

from vectorize.pipeline import ProcessParams, process, render_overlay
from sample_data.generate_sample import make_sample

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "web")


def _decode_png(data_url_or_b64: str) -> np.ndarray:
    if "," in data_url_or_b64 and data_url_or_b64.startswith("data:"):
        data_url_or_b64 = data_url_or_b64.split(",", 1)[1]
    raw = base64.b64decode(data_url_or_b64)
    buf = np.frombuffer(raw, np.uint8)
    image = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("could not decode image")
    return image


def _encode_png(image: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("png encode failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, rel_path: str, content_type: str) -> None:
        path = os.path.normpath(os.path.join(STATIC_DIR, rel_path))
        if not path.startswith(STATIC_DIR) or not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as handle:
            body = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send_file("index.html", "text/html; charset=utf-8")
        elif self.path == "/app.js":
            self._send_file("app.js", "application/javascript; charset=utf-8")
        elif self.path == "/styles.css":
            self._send_file("styles.css", "text/css; charset=utf-8")
        elif self.path == "/api/sample":
            png = _encode_png(make_sample())
            self._send_json({"image": png})
        else:
            self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/process":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            image = _decode_png(payload["image"])
            params = ProcessParams(
                threshold=int(payload.get("threshold", 128)),
                noise_size=int(payload.get("noise_size", 12)),
                skeletonize=int(payload.get("skeletonize", 1)),
                min_length=float(payload.get("min_length", 8)),
            )
            result = process(image, params)
            overlay = render_overlay(image, result.graph)
            self._send_json(
                {
                    "svg": result.svg,
                    "preview": _encode_png(overlay),
                    "stats": {
                        "nodes": result.node_count,
                        "edges": result.edge_count,
                        "vertices": result.vertex_count,
                        "removedNoise": result.removed_noise_components,
                        "width": result.width,
                        "height": result.height,
                    },
                }
            )
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            self._send_json({"error": str(exc)}, status=400)

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        print("[server]", fmt % args)


def main(host: str = "127.0.0.1", port: int = 8011) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"serving on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main(port=int(os.environ.get("PORT", 8011)))
