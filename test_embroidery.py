import math
import os
import tempfile
import unittest

import embroidery as e


class GeometryTests(unittest.TestCase):
    def test_wrap_point(self):
        self.assertEqual(e.wrap_point((-5.0, 120.0)), (e.TILE - 5.0, 20.0))

    def test_resample_even_spacing(self):
        pts = e.resample_polyline([(0.0, 0.0), (12.0, 0.0)], 2.4)
        gaps = [round(e.vlen(e.vsub(b, a)), 6) for a, b in zip(pts, pts[1:])]
        self.assertTrue(all(g <= e.STITCH_MAX for g in gaps))

    def test_segment_distance(self):
        self.assertAlmostEqual(
            e.segment_point_distance((0, 0), (10, 0), (5, 7)), 7.0)


class LayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.layout = e.build_layout()

    def test_two_colors_present(self):
        colors = {st.color for st in self.layout.stitches
                  if st.color != e.NEEDLE_COLOR}
        self.assertEqual(colors, {e.COLOR_A, e.COLOR_B})

    def test_center_protected(self):
        for st in self.layout.stitches:
            if st.motif or st.color == e.NEEDLE_COLOR:
                continue
            self.assertGreaterEqual(
                e.segment_point_distance(st.a, st.b, e.CENTER),
                e.R_PROTECT - 1e-9)

    def test_motif_inside_protection(self):
        for run, is_motif in zip(self.layout.runs, self.layout.run_motif):
            if not is_motif:
                continue
            for pt in run:
                self.assertLess(e.vlen(e.vsub(pt, e.CENTER)), e.R_PROTECT)

    def test_stitch_band(self):
        self.assertTrue(e.check_stitch_lengths(self.layout)["pass"])

    def test_jump_limit(self):
        self.assertTrue(e.check_jumps(self.layout)["pass"])

    def test_backstitch_ratio(self):
        self.assertTrue(e.check_backstitches(self.layout)["pass"])

    def test_four_edge_seams(self):
        result = e.check_seams(self.layout)
        self.assertTrue(result["pass"])
        self.assertEqual(result["malformed"], 0)
        self.assertTrue(all(v > 0 for v in result["edges"].values()))

    def test_density_band(self):
        self.assertTrue(e.density_pass(e.density_metrics(self.layout)))

    def test_torus_seam_points_pair_on_edges(self):
        for link in self.layout.seam_links:
            on_x = (min(link.exit_pt[0], e.TILE - link.exit_pt[0]) <= e.SEAM_EPS
                    or min(link.entry_pt[0], e.TILE - link.entry_pt[0]) <= e.SEAM_EPS)
            on_y = (min(link.exit_pt[1], e.TILE - link.exit_pt[1]) <= e.SEAM_EPS
                    or min(link.entry_pt[1], e.TILE - link.entry_pt[1]) <= e.SEAM_EPS)
            self.assertTrue(on_x or on_y)


class RelayoutTests(unittest.TestCase):
    def test_line_width_keeps_center_clear(self):
        for width in (1.0, 1.6, 2.4, 3.2):
            layout = e.relayout_for_width(width)
            exclusion = e.R_PROTECT + width
            violations = [
                st for st in layout.stitches
                if not st.motif and st.color != e.NEEDLE_COLOR and
                e.segment_point_distance(st.a, st.b, e.CENTER) < exclusion]
            self.assertEqual(violations, [])

    def test_scaling_relayout_density(self):
        base = e.build_layout()
        for row in e.scaling_study(base):
            self.assertTrue(row["relayout"]["density_pass"], row)
            self.assertTrue(row["relayout"]["stitch_band_pass"], row)


class ExportTests(unittest.TestCase):
    def test_svg_and_png_written(self):
        layout = e.build_layout()
        with tempfile.TemporaryDirectory() as tmp:
            svg = os.path.join(tmp, "p.svg")
            png = os.path.join(tmp, "p.png")
            e.render_svg(layout, svg)
            e.render_png(layout, png, px_per_mm=3.0)
            with open(svg, "rb") as fh:
                self.assertIn(b"<svg", fh.read())
            with open(png, "rb") as fh:
                self.assertEqual(fh.read()[:8], b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    unittest.main()
