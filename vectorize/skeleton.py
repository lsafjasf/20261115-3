"""Zhang-Suen thinning (skeletonization) implemented on a binary foreground mask.

The mask uses 1 for ink (foreground), 0 for background. The result keeps the
topology of the strokes while reducing every stroke to a 1-pixel-wide centre
line, which is what makes thin lines survive the subsequent vectorisation.
"""

from __future__ import annotations

import cv2
import numpy as np


def zhang_suen_skeleton(mask: np.ndarray) -> np.ndarray:
    """Return a 1-pixel-wide skeleton of ``mask`` (uint8, same shape)."""
    img = (mask > 0).astype(np.uint8).copy()
    # Pad with background so border pixels have a full 3x3 neighbourhood.
    img = cv2.copyMakeBorder(img, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            padded = img
            p2 = padded[:-2, 1:-1]
            p3 = padded[:-2, 2:]
            p4 = padded[1:-1, 2:]
            p5 = padded[2:, 2:]
            p6 = padded[2:, 1:-1]
            p7 = padded[2:, :-2]
            p8 = padded[1:-1, :-2]
            p9 = padded[:-2, :-2]
            p1 = padded[1:-1, 1:-1]

            neighbours = [p2, p3, p4, p5, p6, p7, p8, p9]
            # B(P1): number of non-zero 8-neighbours.
            b = sum(neighbours)
            # A(P1): number of 0->1 transitions in the ordered neighbour ring.
            ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            a = sum(
                ((ring[i] == 0) & (ring[i + 1] == 1)).astype(np.uint8)
                for i in range(8)
            )
            if step == 0:
                cond = (
                    (p1 == 1)
                    & (b >= 2)
                    & (b <= 6)
                    & (a == 1)
                    & ((p2 * p4 * p6) == 0)
                    & ((p4 * p6 * p8) == 0)
                )
            else:
                cond = (
                    (p1 == 1)
                    & (b >= 2)
                    & (b <= 6)
                    & (a == 1)
                    & ((p2 * p4 * p8) == 0)
                    & ((p2 * p6 * p8) == 0)
                )
            if cond.any():
                img[1:-1, 1:-1][cond] = 0
                changed = True
    return img[1:-1, 1:-1]
