"""Synthetic geometry/contract tests only: not real-photo accuracy evidence."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import cv2
import numpy as np

MODULE_PATH = Path(__file__).with_name("dev-independent-card-detector.py")
spec = importlib.util.spec_from_file_location("independent_detector", MODULE_PATH)
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)


def encoded_scene(quads=(), width=900, height=800):
    image = np.full((height, width, 3), 45, np.uint8)
    for quad in quads:
        cv2.fillConvexPoly(image, np.asarray(quad, np.int32), (220, 225, 230))
    return cv2.imencode(".png", image)[1].tobytes()


RECT = [[250, 100], [650, 100], [650, 660], [250, 660]]


class GeometryTests(unittest.TestCase):
    def assert_corners_close(self, actual, expected, tolerance=8):
        actual, expected = np.asarray(actual), np.asarray(expected)
        self.assertLess(max(min(np.linalg.norm(p - actual, axis=1)) for p in expected), tolerance)

    def test_frontal_and_no_stretch(self):
        result = detector.detect_card(encoded_scene([RECT]))
        self.assertTrue(result["accepted"], result)
        self.assert_corners_close(result["corners"], RECT)
        self.assertAlmostEqual(result["outputAspect"], 5 / 7, delta=0.01)
        self.assertEqual(result["diagnostics"]["aspectSource"], "observed-near-frontal")
        self.assertIsNone(result["cropFile"])

    def test_noncanonical_near_frontal_retains_aspect(self):
        quad = [[250, 100], [625, 100], [625, 600], [250, 600]]
        result = detector.detect_card(encoded_scene([quad]))
        self.assertTrue(result["accepted"], result)
        self.assertAlmostEqual(result["outputAspect"], 0.75, delta=0.01)

    def test_perspective_prior_explicit(self):
        quad = [[280, 100], [620, 150], [670, 650], [210, 610]]
        result = detector.detect_card(encoded_scene([quad]))
        self.assertTrue(result["accepted"], result)
        self.assert_corners_close(result["corners"], quad)
        self.assertEqual(result["diagnostics"]["aspectSource"], "physical-5:7-prior")
        self.assertAlmostEqual(result["outputAspect"], 5 / 7, delta=0.005)

    def test_rotated_geometry(self):
        quad = cv2.boxPoints(((450, 400), (350, 490), 24))
        result = detector.detect_card(encoded_scene([quad]))
        self.assertTrue(result["accepted"], result)
        self.assert_corners_close(result["corners"], quad)
        self.assertAlmostEqual(result["outputAspect"], 5 / 7, delta=0.01)

    def test_landscape_rotates_without_semantic_claim(self):
        quad = [[150, 200], [710, 200], [710, 600], [150, 600]]
        result = detector.detect_card(encoded_scene([quad]))
        self.assertTrue(result["accepted"], result)
        self.assertLess(result["outputAspect"], 1)
        self.assertIn("unresolved", result["diagnostics"]["orientation"])

    def test_no_quad(self):
        result = detector.detect_card(encoded_scene())
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "no_good_quad")

    def test_multiple(self):
        quads = [
            [[60, 130], [340, 130], [340, 522], [60, 522]],
            [[540, 200], [820, 200], [820, 592], [540, 592]],
        ]
        result = detector.detect_card(encoded_scene(quads))
        self.assertFalse(result["accepted"], result)
        self.assertEqual(result["reason"], "multiple_ambiguous_rectangles")

    def test_cutoff(self):
        quad = [[0, 100], [400, 100], [400, 660], [0, 660]]
        result = detector.detect_card(encoded_scene([quad]))
        self.assertFalse(result["accepted"], result)
        self.assertEqual(result["reason"], "partial_or_cutoff_rectangle")

    def test_small_card_abstains(self):
        quad = [[350, 300], [450, 300], [450, 440], [350, 440]]
        self.assertFalse(detector.detect_card(encoded_scene([quad]))["accepted"])

    def test_nested_panel_ambiguous(self):
        image = cv2.imdecode(np.frombuffer(encoded_scene([RECT]), np.uint8), cv2.IMREAD_COLOR)
        cv2.rectangle(image, (290, 150), (610, 610), (65, 65, 65), -1)
        result = detector.detect_card(cv2.imencode(".png", image)[1].tobytes())
        self.assertFalse(result["accepted"], result)
        self.assertEqual(result["reason"], "multiple_ambiguous_rectangles")

    def test_explicit_decode_error(self):
        result = detector.detect_card(b"not an image")
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "input_or_output_error")
        self.assertIn("error", result["diagnostics"])

    def test_exif_oriented_coordinates(self):
        # Construct only orientation=6 in a JPEG APP1 segment, no personal data.
        image = cv2.imdecode(np.frombuffer(encoded_scene([RECT]), np.uint8), cv2.IMREAD_COLOR)
        jpeg = cv2.imencode(".jpg", image)[1].tobytes()
        tiff = b"II\x2a\x00\x08\x00\x00\x00\x01\x00\x12\x01\x03\x00\x01\x00\x00\x00\x06\x00\x00\x00\x00\x00\x00\x00"
        app1 = b"Exif\x00\x00" + tiff
        jpeg = jpeg[:2] + b"\xff\xe1" + (len(app1) + 2).to_bytes(2, "big") + app1 + jpeg[2:]
        result = detector.detect_card(jpeg)
        self.assertTrue(result["accepted"], result)
        self.assertEqual(result["diagnostics"]["sourceSize"], [800, 900])
        rotated = [[799 - y, x] for x, y in RECT]
        self.assert_corners_close(result["corners"], rotated)

    def test_cli_batch_and_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            image = tmp / "input.png"
            image.write_bytes(encoded_scene([RECT]))
            manifest = tmp / "manifest.json"
            manifest.write_text(json.dumps({"images": [{"input": str(image)}]}))
            proc = subprocess.run(
                [os.sys.executable, str(MODULE_PATH), "--manifest", str(manifest), "--output-dir", str(tmp / "crops")],
                capture_output=True, text=True, check=True,
            )
            result = json.loads(proc.stdout)
            self.assertTrue(result["results"][0]["accepted"])
            crop = cv2.imread(result["results"][0]["cropFile"])
            self.assertIsNotNone(crop)
            self.assertAlmostEqual(crop.shape[1] / crop.shape[0], 5 / 7, delta=0.01)
            self.assertGreaterEqual(result["processWallMs"], result["detectorStageMs"])

    def test_production_blocked(self):
        old = os.environ.get("NODE_ENV")
        try:
            os.environ["NODE_ENV"] = "production"
            with self.assertRaisesRegex(RuntimeError, "refuses production"):
                detector.detect_card(encoded_scene([RECT]))
        finally:
            if old is None:
                os.environ.pop("NODE_ENV", None)
            else:
                os.environ["NODE_ENV"] = old


if __name__ == "__main__":
    unittest.main(verbosity=2)