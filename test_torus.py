"""Unit tests for toroidal brush geometry and seamless noise."""

import texture_editor as te

SIZE = 32


def mask_at(cx, cy, radius=4):
    layer = te.WearLayer(SIZE, seed=1, spots=0)
    layer.stroke(cx, cy, radius, 1.0)
    return list(layer.mask)


def roll(mask, sx, sy):
    out = [0] * (SIZE * SIZE)
    for y in range(SIZE):
        for x in range(SIZE):
            out[((y + sy) % SIZE) * SIZE + (x + sx) % SIZE] = mask[y * SIZE + x]
    return out


def test_corner_brushes_are_rotations():
    origin = mask_at(0, 0)
    assert roll(mask_at(31, 0), 1, 0) == origin
    assert roll(mask_at(0, 31), 0, 1) == origin
    assert roll(mask_at(31, 31), 1, 1) == origin


def test_edge_crossing_wraps():
    assert roll(mask_at(31.5, 16), 1, 0) == mask_at(0.5, 16)


def test_each_cell_emitted_once():
    points = list(te._torus_points(SIZE, 0.5, 16.0, 5))
    assert len(points) == len(set((x, y) for x, y, _ in points))


def test_interior_brush_stays_local():
    mask = mask_at(16, 16, radius=3)
    assert all(mask[y * SIZE + x] == 0 for x in (0, 31) for y in range(SIZE))


def test_noise_seams_no_worse_than_interior():
    field = te.NoiseLayer(SIZE, seed=1, cell=8)._field
    seam_v = max(abs(field[y][0] - field[y][31]) for y in range(SIZE))
    seam_h = max(abs(field[0][x] - field[31][x]) for x in range(SIZE))
    interior_v = max(abs(field[y][x] - field[y][x + 1])
                     for y in range(SIZE) for x in range(SIZE - 1))
    interior_h = max(abs(field[y][x] - field[y + 1][x])
                     for y in range(SIZE - 1) for x in range(SIZE))
    assert seam_v <= interior_v
    assert seam_h <= interior_h


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("ALL UNIT TESTS PASSED")
