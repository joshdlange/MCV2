#!/usr/bin/env python3
"""Contract tests plus mandatory real pretrained-weight invocation (not accuracy)."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

SOURCE = Path(__file__).with_name("dev-segment-card-detector.py")
SPEC = importlib.util.spec_from_file_location("learned_detector", SOURCE)
D = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)
INFERENCE_EVIDENCE = {}


def prediction(points, shape=(600, 600)):
    mask = np.zeros(shape, np.uint8)
    cv2.fillConvexPoly(mask, np.asarray(points, np.int32), 1)
    return {"segmentation": mask.astype(bool), "predicted_iou": 0.99, "stability_score": 0.99}


CARD = [[175, 125], [425, 125], [425, 475], [175, 475]]


class Contracts(unittest.TestCase):
    def test_full_mask_quad(self):
        candidate, reason, _ = D.select_mask([prediction(CARD)], (600, 600))
        self.assertIsNotNone(candidate)
        self.assertEqual(reason, "single_learned_full_object_quad")
        self.assertGreater(candidate["quadMaskIoU"], 0.99)
        self.assertLess(np.max(np.abs(candidate["points"] - np.array(CARD))), 1)

    def test_no_mask(self):
        self.assertIsNone(D.select_mask([], (600, 600))[0])

    def test_nested_art_panel(self):
        panel = [[200, 170], [400, 170], [400, 440], [200, 440]]
        selected, reason, _ = D.select_mask([prediction(CARD), prediction(panel)], (600, 600))
        self.assertIsNone(selected)
        self.assertIn("nested", reason)

    def test_nested_slab(self):
        slab = [[145, 75], [455, 75], [455, 525], [145, 525]]
        self.assertIsNone(D.select_mask([prediction(slab), prediction(CARD)], (600, 600))[0])

    def test_multiple_cards(self):
        a = [[25, 150], [235, 150], [235, 450], [25, 450]]
        b = [[365, 150], [575, 150], [575, 450], [365, 450]]
        selected, reason, _ = D.select_mask([prediction(a), prediction(b)], (600, 600))
        self.assertIsNone(selected)
        self.assertIn("multiple", reason)

    def test_cutoff(self):
        a = [[0, 125], [250, 125], [250, 475], [0, 475]]
        self.assertIsNone(D.select_mask([prediction(a)], (600, 600))[0])

    def test_occluded_not_hull_completed(self):
        p = prediction(CARD)
        p["segmentation"][220:370, 175:235] = False
        self.assertIsNone(D.fit_mask(p["segmentation"])[0])

    def test_duplicate_masks(self):
        selected, _, diagnostics = D.select_mask([prediction(CARD), prediction(CARD)], (600, 600))
        self.assertIsNotNone(selected)
        self.assertEqual(diagnostics["quadCandidateCount"], 1)

    def test_frontal_natural_aspect(self):
        points = D.order_corners([[100, 100], [400, 100], [400, 500], [100, 500]])
        _, aspect, diagnostics = D.aspect_and_orientation(points)
        self.assertAlmostEqual(aspect, 0.75)
        self.assertEqual(diagnostics["aspectSource"], "observed-near-frontal")

    def test_perspective_explicit_5_7_prior(self):
        points = D.order_corners([[120, 100], [380, 130], [450, 520], [100, 510]])
        _, aspect, diagnostics = D.aspect_and_orientation(points)
        self.assertAlmostEqual(aspect, 5 / 7)
        self.assertEqual(diagnostics["aspectSource"], "explicit-physical-5:7-prior")

    def test_safe_90_no_semantic_180(self):
        points = D.order_corners([[100, 100], [450, 100], [450, 350], [100, 350]])
        _, aspect, diagnostics = D.aspect_and_orientation(points)
        self.assertAlmostEqual(aspect, 5 / 7)
        self.assertTrue(diagnostics["geometric90DegreeRotation"])
        self.assertIn("180", diagnostics["orientation"])

    def test_manifest_input_only(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / "manifest.json"
            manifest.write_text(json.dumps({"images": [{"input": "image.png"}]}))
            self.assertEqual(D.parse_manifest(manifest), ["image.png"])
            for value in ([{"input": "a.png", "label": "secret"}],
                          {"images": ["a.png"], "metadata": {}},
                          [{"input": "a.png", "output": "b.png"}]):
                manifest.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    D.parse_manifest(manifest)

    def test_production_guard(self):
        with patch.dict(os.environ, {"NODE_ENV": "production"}):
            with self.assertRaises(RuntimeError):
                D.development_only()

    def test_exif_coordinates_and_rectification_contract(self):
        # Controlled masks test coordinate/crop plumbing only, not learned quality.
        class SyntheticGenerator:
            def generate(self, rgb):
                self.shape = rgb.shape
                return [prediction(CARD, rgb.shape[:2])]

        detector = object.__new__(D.LearnedDetector)
        detector.generator = SyntheticGenerator()
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "exif.jpg"
            encoded = Image.new("RGB", (600, 800), "gray")
            exif = Image.Exif()
            exif[274] = 6
            encoded.save(image, exif=exif)
            output = Path(folder) / "crop.png"
            result = detector.detect_card(str(image), str(output))
            self.assertEqual(result["diagnostics"]["sourceSize"], [800, 600])
            self.assertEqual(detector.generator.shape, (600, 800, 3))
            self.assertTrue(result["accepted"], result)
            self.assertEqual(len(result["corners"]), 4)
            self.assertTrue(output.is_file())
            crop = Image.open(output)
            self.assertAlmostEqual(crop.width / crop.height, 5 / 7, places=2)

    def test_decode_error_explicit(self):
        detector = object.__new__(D.LearnedDetector)
        result = detector.detect_card("/nonexistent/detector-contract-test.jpg")
        self.assertFalse(result["accepted"])
        self.assertIn("error", result["diagnostics"])
        self.assertFalse(result["diagnostics"]["modelInvoked"])

    def test_real_pretrained_inference_and_batch_cli(self):
        """Mandatory actual SAM weights/inference; no benchmark/query photographs."""
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            image = folder / "synthetic-card.png"
            rgb = np.full((640, 512, 3), [75, 105, 82], dtype=np.uint8)
            cv2.rectangle(rgb, (115, 95), (395, 487), (232, 222, 192), -1)
            cv2.rectangle(rgb, (129, 109), (381, 473), (137, 87, 45), 3)
            cv2.circle(rgb, (255, 270), 68, (174, 75, 84), -1)
            cv2.line(rgb, (170, 425), (340, 425), (90, 70, 40), 8)
            Image.fromarray(rgb).save(image)
            manifest = folder / "manifest.json"
            manifest.write_text(json.dumps([str(image)]))
            start = time.perf_counter()
            completed = subprocess.run(
                [sys.executable, str(SOURCE), "--manifest", str(manifest),
                 "--output-dir", str(folder / "crops")],
                capture_output=True, text=True, timeout=180, check=True)
            wall_ms = (time.perf_counter() - start) * 1000
            batch = json.loads(completed.stdout)
            result = batch["results"][0]
            self.assertTrue(result["diagnostics"]["modelInvoked"], result)
            self.assertNotIn("error", result["diagnostics"], result)
            self.assertGreater(result["diagnostics"]["learnedMaskCount"], 0, result)
            self.assertGreater(batch["modelInitializationMs"], 0)
            self.assertGreater(result["detectorMs"], 0)
            self.assertEqual(batch["weightsHash"], D.CONFIG["weightsSha256"])
            self.assertEqual(len(result["corners"]), 4 if result["accepted"] else 0)
            INFERENCE_EVIDENCE.update({
                "fixture": "generated synthetic card-like scene, not a benchmark photograph",
                "actualPretrainedInference": True, "modelId": D.CONFIG["modelId"],
                "weightsHash": batch["weightsHash"], "modelInitializationMs": batch["modelInitializationMs"],
                "detectorMs": result["detectorMs"], "subprocessWallMs": wall_ms,
                "learnedMaskCount": result["diagnostics"]["learnedMaskCount"],
                "accepted": result["accepted"], "reason": result["reason"],
                "accuracyClaim": "none; held-out real-photo evaluation not performed by this worker"
            })


if __name__ == "__main__":
    started = time.perf_counter()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Contracts)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({"passed": result.testsRun - len(result.failures) - len(result.errors),
                      "failed": len(result.failures) + len(result.errors),
                      "durationSeconds": time.perf_counter() - started,
                      "inference": INFERENCE_EVIDENCE}, allow_nan=False))
    sys.exit(0 if result.wasSuccessful() else 1)