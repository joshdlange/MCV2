#!/usr/bin/env python3
"""Development-only learned PHOTO-ONLY SAM segmentation, with conservative quad fit.

SAM ViT-B automatic masks are the only region proposal source. No intensity/edge
detector, reference images, identities, OCR, retrieval or network inference.
Geometric fitting is applied to predicted object masks, never photograph edges.
Ambiguous nested object boundaries (panel/card/sleeve/slab) cause abstention.
Generic segmentation cannot guarantee that a single rectangular object is a card.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
from segment_anything import SamAutomaticMaskGenerator, sam_model_registry


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(__file__).with_suffix(".config.json")
CONFIG = json.loads(CONFIG_PATH.read_text())


def development_only():
    if any(os.environ.get(key, "").lower() == "production" for key in ("NODE_ENV", "APP_ENV")):
        raise RuntimeError("Development-only detector refuses production execution")


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def order_corners(points):
    points = np.asarray(points, np.float32).reshape(4, 2)
    center = points.mean(axis=0)
    points = points[np.argsort(np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0]))]
    return np.roll(points, -int(np.argmin(points.sum(axis=1))), axis=0)


def lengths(points):
    return np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)


def angles(points):
    before = np.roll(points, 1, axis=0) - points
    after = np.roll(points, -1, axis=0) - points
    cosine = (before * after).sum(axis=1) / (
        np.linalg.norm(before, axis=1) * np.linalg.norm(after, axis=1)
    )
    return np.degrees(np.arccos(np.clip(cosine, -1, 1)))


def fit_mask(mask, policy=None):
    """Fit only a learned object silhouette. Incomplete/irregular masks abstain."""
    policy = policy or CONFIG["selection"]
    binary = np.ascontiguousarray(mask, dtype=np.uint8)
    h, w = binary.shape
    pixel_area = int(binary.sum())
    if not pixel_area:
        return None, "empty_mask"
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contour = max(contours, key=cv2.contourArea)
    component = np.zeros_like(binary)
    cv2.drawContours(component, [contour], -1, 1, -1)
    connected = int(np.logical_and(component, binary).sum())
    if connected / pixel_area < 1 - policy["maxDisconnectedFraction"]:
        return None, "disconnected_object"
    hull = cv2.convexHull(contour)
    hull_mask = np.zeros_like(binary)
    cv2.fillConvexPoly(hull_mask, hull, 1)
    if pixel_area / max(1, int(hull_mask.sum())) < policy["minConvexFill"]:
        return None, "incomplete_or_nonconvex_object"
    fits = []
    for epsilon in policy["quadApproximationFractions"]:
        poly = cv2.approxPolyDP(hull, epsilon * cv2.arcLength(hull, True), True)
        if len(poly) != 4 or not cv2.isContourConvex(poly):
            continue
        points = order_corners(poly)
        sides = lengths(points)
        corner_angles = angles(points)
        aspect = min(sides[0] + sides[2], sides[1] + sides[3]) / max(
            sides[0] + sides[2], sides[1] + sides[3]
        )
        if not (policy["minObservedAspect"] <= aspect <= policy["maxObservedAspect"]):
            continue
        if min(corner_angles) < policy["minAngle"] or max(corner_angles) > policy["maxAngle"]:
            continue
        quad_mask = np.zeros_like(binary)
        cv2.fillConvexPoly(quad_mask, np.rint(points).astype(np.int32), 1)
        intersection = int(np.logical_and(binary, quad_mask).sum())
        union = int(np.logical_or(binary, quad_mask).sum())
        iou = intersection / max(1, union)
        if iou >= policy["minQuadMaskIoU"]:
            fits.append({"points": points, "quadMask": quad_mask.astype(bool),
                         "quadMaskIoU": iou, "area": pixel_area,
                         "areaFraction": pixel_area / (w * h)})
    if not fits:
        return None, "not_complete_card_like_quad"
    return max(fits, key=lambda item: item["quadMaskIoU"]), None


def select_mask(masks, shape):
    """Fixed center/largest generic objectness, with global ambiguity vetoes."""
    policy = CONFIG["selection"]
    h, w = shape
    candidates, clipped, rejected = [], [], {}
    for prediction in masks:
        mask = prediction["segmentation"]
        fraction = int(np.count_nonzero(mask)) / (w * h)
        # Consider smaller interior panels for nested-boundary ambiguity too.
        if not policy["minAreaFraction"] * policy["nestedMinRelativeArea"] <= fraction <= policy["maxAreaFraction"]:
            continue
        candidate, reason = fit_mask(mask)
        if candidate is None:
            rejected[reason] = rejected.get(reason, 0) + 1
            continue
        candidate.update({"predictedIoU": float(prediction["predicted_iou"]),
                          "stabilityScore": float(prediction["stability_score"])})
        points = candidate["points"]
        margin = max(2, min(w, h) * policy["borderMarginFraction"])
        cutoff = (points[:, 0].min() < margin or points[:, 1].min() < margin
                  or points[:, 0].max() > w - 1 - margin
                  or points[:, 1].max() > h - 1 - margin)
        if cutoff:
            clipped.append(candidate)
        else:
            candidates.append(candidate)
    # Only deduplicate truly overlapping whole masks, not distinct nested panels.
    candidates.sort(key=lambda item: item["area"], reverse=True)
    unique = []
    for candidate in candidates:
        duplicate = False
        for existing in unique:
            intersection = int(np.logical_and(candidate["quadMask"], existing["quadMask"]).sum())
            union = int(np.logical_or(candidate["quadMask"], existing["quadMask"]).sum())
            if intersection / max(1, union) >= policy["duplicateIoU"]:
                duplicate = True
                break
        if not duplicate:
            unique.append(candidate)
    diagnostics = {"learnedMaskCount": len(masks), "quadCandidateCount": len(unique),
                   "clippedQuadCount": len(clipped), "rejectedMasks": rejected}
    selectable = [item for item in unique if item["areaFraction"] >= policy["minAreaFraction"]]
    centered = [item for item in selectable if np.linalg.norm(
        (item["points"].mean(axis=0) - np.array([w / 2, h / 2])) / np.array([w, h])
    ) <= policy["centerRadiusFraction"]]
    if not centered:
        return None, "no_unambiguous_centered_learned_card_mask", diagnostics
    selected = centered[0]  # largest, since sorted above
    for other in unique + clipped:
        if other is selected:
            continue
        small, large = sorted((selected, other), key=lambda item: item["area"])
        relative = small["area"] / large["area"]
        intersection = int(np.logical_and(small["quadMask"], large["quadMask"]).sum())
        containment = intersection / max(1, int(small["quadMask"].sum()))
        if (policy["nestedMinRelativeArea"] <= relative <= policy["nestedMaxRelativeArea"]
                and containment >= policy["nestedContainment"]):
            return None, "nested_panel_card_sleeve_or_slab_ambiguity", diagnostics
        if other["area"] >= selected["area"] * policy["ambiguityRelativeArea"]:
            return None, "multiple_or_clipped_card_like_objects", diagnostics
    return selected, "single_learned_full_object_quad", diagnostics


def aspect_and_orientation(points):
    policy = CONFIG["rectification"]
    sides = lengths(points)
    rotated = bool(sides[0] + sides[2] > sides[1] + sides[3])
    if rotated:
        points = np.roll(points, -1, axis=0)
        sides = lengths(points)
    observed = float((sides[0] + sides[2]) / (sides[1] + sides[3]))
    vectors = np.roll(points, -1, axis=0) - points
    parallel = []
    for a, b in ((vectors[0], -vectors[2]), (vectors[1], -vectors[3])):
        parallel.append(float(np.degrees(np.arccos(np.clip(
            np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)), -1, 1)))))
    opposite = max(max(sides[0], sides[2]) / min(sides[0], sides[2]),
                   max(sides[1], sides[3]) / min(sides[1], sides[3]))
    frontal = (max(parallel) <= policy["nearFrontalParallelDegrees"]
               and opposite <= policy["nearFrontalOppositeRatio"]
               and policy["nearFrontalMinAspect"] <= observed <= policy["nearFrontalMaxAspect"])
    aspect = observed if frontal else policy["physicalAspectPrior"]
    return points, aspect, {
        "observedAspect": observed,
        "aspectSource": "observed-near-frontal" if frontal else "explicit-physical-5:7-prior",
        "aspectLimitation": "Physical aspect cannot be uniquely recovered from an uncalibrated perspective photograph.",
        "geometric90DegreeRotation": rotated,
        "orientation": "short-edge portrait only; semantic 180-degree orientation unresolved",
    }


class LearnedDetector:
    def __init__(self):
        development_only()
        started = time.perf_counter()
        weights = ROOT / CONFIG["weightsFile"]
        if not weights.is_file():
            raise RuntimeError("Missing local SAM weights; run scripts/dev-segment-card-detector-download.py")
        if file_hash(weights) != CONFIG["weightsSha256"]:
            raise RuntimeError("SAM weight SHA-256 mismatch; inference refused")
        torch.set_num_threads(CONFIG["cpuThreads"])
        self.model = sam_model_registry[CONFIG["modelArchitecture"]](checkpoint=None)
        state = torch.load(weights, map_location="cpu", weights_only=True)
        self.model.load_state_dict(state, strict=True)
        del state
        self.model.eval()
        self.generator = SamAutomaticMaskGenerator(self.model, **CONFIG["automaticMasks"])
        self.model_initialization_ms = (time.perf_counter() - started) * 1000

    def detect_card(self, image_input, output=None):
        development_only()
        started = time.perf_counter()
        result = {"accepted": False, "corners": [], "reason": "no_learned_card_mask",
                  "detectorMs": 0.0, "cropFile": None, "diagnostics": {}, "outputAspect": None}
        diagnostics = result["diagnostics"]
        diagnostics.update({"policyVersion": CONFIG["version"], "modelId": CONFIG["modelId"],
                            "coordinateSpace": "EXIF-oriented source image pixels",
                            "physicalIdentityGuaranteed": False, "modelInvoked": False,
                            "regionProposalSource": "pretrained-SAM-automatic-learned-masks-only"})
        try:
            if not isinstance(image_input, (str, os.PathLike)):
                raise TypeError("Input must be a local image path only")
            with Image.open(image_input) as decoded:
                rgb = np.array(ImageOps.exif_transpose(decoded).convert("RGB"))
            h, w = rgb.shape[:2]
            diagnostics["sourceSize"] = [w, h]
            if min(w, h) < 80:
                result["reason"] = "image_too_small"
                return result
            scale = min(1.0, CONFIG["maxDetectionSide"] / max(w, h))
            small = cv2.resize(rgb, (round(w * scale), round(h * scale))) if scale < 1 else rgb
            sh, sw = small.shape[:2]
            diagnostics["detectionSize"] = [sw, sh]
            with torch.inference_mode():
                masks = self.generator.generate(small)
            diagnostics["modelInvoked"] = True
            selected, reason, selection_info = select_mask(masks, (sh, sw))
            diagnostics.update(selection_info)
            result["reason"] = reason
            if selected is None:
                return result
            points = selected["points"] * np.array([w / sw, h / sh], np.float32)
            points, aspect, aspect_info = aspect_and_orientation(points)
            diagnostics.update(aspect_info)
            diagnostics.update({key: selected[key] for key in
                                ("predictedIoU", "stabilityScore", "quadMaskIoU", "areaFraction")})
            side_lengths = lengths(points)
            out_h = max(2, round(min(CONFIG["rectification"]["maxCropLongSide"],
                                    max(side_lengths[1], side_lengths[3]))))
            out_w = max(2, round(out_h * aspect))
            target = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32)
            transform = cv2.getPerspectiveTransform(points.astype(np.float32), target)
            crop = cv2.warpPerspective(rgb, transform, (out_w, out_h), flags=cv2.INTER_CUBIC)
            result.update({"accepted": True, "corners": points.astype(float).tolist(),
                           "outputAspect": out_w / out_h})
            diagnostics["outputSize"] = [out_w, out_h]
            diagnostics["padding"] = "none; downstream square-pad without stretching"
            result["detectorMs"] = (time.perf_counter() - started) * 1000
            if output:
                output_path = Path(output)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(crop).save(output_path)
                result["cropFile"] = str(output_path)
            return result
        except Exception as exc:
            result.update({"accepted": False, "corners": [], "reason": "input_inference_or_output_error",
                           "cropFile": None, "outputAspect": None})
            diagnostics["error"] = f"{type(exc).__name__}: {exc}"
            return result
        finally:
            if not result["detectorMs"]:
                result["detectorMs"] = (time.perf_counter() - started) * 1000


def parse_manifest(path):
    manifest = json.loads(Path(path).read_text())
    if isinstance(manifest, dict):
        if set(manifest) != {"images"}:
            raise ValueError("Manifest only accepts an images list, no metadata")
        manifest = manifest["images"]
    if not isinstance(manifest, list):
        raise ValueError("Manifest must be an array of image paths or {images:[{input:path}]}")
    paths = []
    for item in manifest:
        if isinstance(item, dict) and set(item) == {"input"}:
            item = item["input"]
        if not isinstance(item, str) or not item:
            raise ValueError("Manifest entries accept input path only; no metadata or output fields")
        paths.append(item)
    return paths


def main():
    started = time.perf_counter()
    development_only()
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--input")
    mode.add_argument("--manifest")
    parser.add_argument("--output")
    parser.add_argument("--output-dir")
    args = parser.parse_args()
    if args.input and args.output_dir or args.manifest and args.output:
        parser.error("--output requires --input; --output-dir requires --manifest")
    paths = [args.input] if args.input else parse_manifest(args.manifest)
    detector = LearnedDetector()
    if args.input:
        result = detector.detect_card(args.input, args.output)
        result["modelInitializationMs"] = detector.model_initialization_ms
    else:
        results = []
        for index, path in enumerate(paths):
            output = str(Path(args.output_dir) / f"{index:04d}-card.png") if args.output_dir else None
            results.append({"input": path, **detector.detect_card(path, output)})
        result = {"results": results,
                  "modelInitializationMs": detector.model_initialization_ms,
                  "detectorStageMs": sum(item["detectorMs"] for item in results),
                  "processWallMs": (time.perf_counter() - started) * 1000,
                  "processWallScope": "main-entry through output; interpreter/import startup excluded",
                  "sourceHash": file_hash(__file__), "configHash": file_hash(CONFIG_PATH),
                  "weightsHash": CONFIG["weightsSha256"]}
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}", "developmentOnly": True}), file=sys.stderr)
        sys.exit(2)