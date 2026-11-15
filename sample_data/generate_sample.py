"""Generate a program-style black-and-white sketch with known artefacts.

Contents: crossing strokes (X, grid junction, T-junction), a thin 1px line,
and isolated small blobs (noise specks) that must be filtered without breaking
the genuine thin line.
"""

from __future__ import annotations

import os

import cv2
import numpy as np


def make_sample(size: int = 360, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.full((size, size), 255, np.uint8)

    # Two crossing diagonal strokes (X).
    cv2.line(img, (40, 40), (180, 180), 0, thickness=5)
    cv2.line(img, (180, 40), (40, 180), 0, thickness=5)

    # Horizontal + vertical junction (cross) with different widths.
    cv2.line(img, (220, 60), (330, 60), 0, thickness=4)
    cv2.line(img, (275, 20), (275, 130), 0, thickness=3)

    # T-junction.
    cv2.line(img, (30, 260), (150, 260), 0, thickness=4)
    cv2.line(img, (90, 260), (90, 340), 0, thickness=4)

    # Genuine thin line (1 pixel) that noise filtering must preserve.
    cv2.line(img, (200, 200), (330, 330), 0, thickness=1)

    # Short dangling spur on the middle of the horizontal bar (~32px).
    cv2.line(img, (40, 260), (40, 226), 0, thickness=3)

    # Isolated noise specks: 2-6 pixel blobs at random spots.
    for _ in range(40):
        x = int(rng.integers(0, size))
        y = int(rng.integers(0, size))
        radius = int(rng.integers(1, 3))  # area ~1-9 px
        cv2.circle(img, (x, y), radius, 0, -1)

    # A slightly larger but still isolated blob.
    cv2.circle(img, (315, 210), 4, 0, -1)

    # Anti-aliased grey fringe around strokes so threshold choice matters.
    blurred = cv2.GaussianBlur(img, (3, 3), 0.9)
    img = cv2.addWeighted(img, 0.75, blurred, 0.25, 0)

    # Mild sensor-style grey jitter (kept light so white stays > 220).
    noise = rng.normal(0, 4, img.shape)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return img


def main() -> None:
    out_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(out_dir, "sample_sketch.png")
    cv2.imwrite(path, make_sample())
    print("wrote", path)


if __name__ == "__main__":
    main()
