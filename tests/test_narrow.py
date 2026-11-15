"""Known-answer tests for the narrow phase contact geometry."""

import math
import unittest

from collision import Body, collide


class CircleCircleTests(unittest.TestCase):
    def test_overlapping_on_x_axis(self):
        a = Body.circle(0, 0.0, 0.0, 5.0)
        b = Body.circle(1, 8.0, 0.0, 5.0)
        manifold = collide(a, b)
        self.assertIsNotNone(manifold)
        contact = manifold.contacts[0]
        self.assertEqual(contact.point, (5.0, 0.0))
        self.assertAlmostEqual(contact.normal[0], 1.0)
        self.assertAlmostEqual(contact.normal[1], 0.0)
        self.assertAlmostEqual(contact.penetration, 2.0)

    def test_separate_circles_return_none(self):
        a = Body.circle(0, 0.0, 0.0, 1.0)
        b = Body.circle(1, 10.0, 0.0, 1.0)
        self.assertIsNone(collide(a, b))

    def test_touching_circles_are_contacts(self):
        a = Body.circle(0, 0.0, 0.0, 5.0)
        b = Body.circle(1, 10.0, 0.0, 5.0)
        manifold = collide(a, b)
        self.assertIsNotNone(manifold)
        self.assertAlmostEqual(manifold.contacts[0].penetration, 0.0)


class RectRectTests(unittest.TestCase):
    def test_axis_aligned_overlap_depth_and_normal(self):
        a = Body.rect(0, 0.0, 0.0, 4.0, 4.0)
        b = Body.rect(1, 6.0, 0.0, 4.0, 4.0)
        manifold = collide(a, b)
        self.assertIsNotNone(manifold)
        contact = manifold.contacts[0]
        # Faces at x=4 and x=2 -> 2 units of overlap along +X.
        self.assertAlmostEqual(contact.penetration, 2.0)
        self.assertAlmostEqual(abs(contact.normal[0]), 1.0)
        self.assertAlmostEqual(contact.normal[1], 0.0)

    def test_rotated_rects_separated(self):
        a = Body.rect(0, 0.0, 0.0, 2.0, 2.0, angle=0.4)
        b = Body.rect(1, 20.0, 20.0, 2.0, 2.0, angle=0.9)
        self.assertIsNone(collide(a, b))

    def test_crossed_rects_produce_two_contacts(self):
        # Two long thin rects crossing each other share an edge-like region.
        a = Body.rect(0, 0.0, 0.0, 12.0, 1.5)
        b = Body.rect(1, 0.0, 0.0, 12.0, 1.5, angle=math.pi / 2)
        manifold = collide(a, b)
        self.assertIsNotNone(manifold)
        self.assertEqual(len(manifold.contacts), 2)
        for contact in manifold.contacts:
            self.assertGreater(contact.penetration, 0.0)
            # Contact points must lie on the narrow reference strip.
            self.assertLessEqual(abs(contact.point[0]), 12.0)
            self.assertLessEqual(abs(contact.point[1]), 12.0)


class CircleRectTests(unittest.TestCase):
    def test_circle_pressed_into_rect_face(self):
        rect = Body.rect(0, 0.0, 0.0, 4.0, 4.0)
        circle = Body.circle(1, 7.0, 0.0, 5.0)
        manifold = collide(circle, rect)
        self.assertIsNotNone(manifold)
        contact = manifold.contacts[0]
        # Closest point on rect is (4, 0); circle reaches x=2 -> depth 2.
        self.assertAlmostEqual(contact.penetration, 2.0)
        # Normal points from the circle toward the rect (-X).
        self.assertAlmostEqual(contact.normal[0], -1.0)
        self.assertAlmostEqual(contact.normal[1], 0.0)

    def test_circle_near_corner_uses_diagonal_normal(self):
        rect = Body.rect(0, 0.0, 0.0, 2.0, 2.0)
        circle = Body.circle(1, 3.0, 3.0, 2.0)
        manifold = collide(circle, rect)
        self.assertIsNotNone(manifold)
        normal = manifold.contacts[0].normal
        expected = -math.sqrt(0.5)
        self.assertAlmostEqual(normal[0], expected, places=6)
        self.assertAlmostEqual(normal[1], expected, places=6)

    def test_circle_inside_rect(self):
        rect = Body.rect(0, 0.0, 0.0, 10.0, 10.0)
        circle = Body.circle(1, 1.0, 1.0, 2.0)
        manifold = collide(circle, rect)
        self.assertIsNotNone(manifold)
        self.assertGreater(manifold.contacts[0].penetration, 0.0)


if __name__ == "__main__":
    unittest.main()
