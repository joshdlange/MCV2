#!/usr/bin/env python3
"""Development-only, query-pixels-only conservative quadrilateral detector.

Coordinates refer to the EXIF-oriented decoded photograph, not the stored JPEG
raster. OpenCV IMREAD_COLOR applies EXIF orientation; no EXIF values are features.
No identity, OCR, retrieval, network, or reference inputs are accepted.

A single uncalibrated view cannot determine physical aspect under perspective.
Near-frontal quads retain their observed aspect; other quads use the explicit
standard-card 5:7 physical prior. This is not a general document detector.
Rectangular sleeves, slabs, art panels, and cards can be visually indistinguishable.
The conservative ambiguity checks help, but do not guarantee physical-card identity.
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


# Frozen before held-out evaluation. No scan-specific thresholds or identity data.
POLICY = {
    "version": "photo-quad-v1",
    "max_detection_side": 1400,
    "min_area_fraction": 0.08,
    "max_area_fraction": 0.94,
    "min_short_edge_fraction": 0.12,
    "border_margin_fraction": 0.009,
    "approximation_fractions": [0.012, 0.020, 0.030],
    "min_angle_degrees": 40,
    "max_angle_degrees": 140,
    "min_observed_aspect": 0.48,
    "max_observed_aspect": 0.90,
    "min_edge_support": 0.60,
    "duplicate_corner_distance_fraction": 0.018,
    "ambiguous_relative_area": 0.45,
    "frontal_parallel_degrees": 7,
    "frontal_opposite_edge_ratio": 1.12,
    "frontal_min_aspect": 0.62,
    "frontal_max_aspect": 0.81,
    "physical_aspect_prior": 5 / 7,
    "max_crop_long_side": 1600,
}


def development_only():
    if os.environ.get("NODE_ENV", "").lower() == "production" or os.environ.get(
        "APP_ENV", ""
    ).lower() == "production":
        raise RuntimeError("Development-only detector refuses production execution")


def source_hash():
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def order_corners(points):
    """Clockwise image coordinates, beginning at the topmost-leftish corner."""
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    center = points.mean(axis=0)
    angles = np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0])
    points = points[np.argsort(angles)]
    start = int(np.argmin(points.sum(axis=1)))
    return np.roll(points, -start, axis=0)


def edge_lengths(points):
    return np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)


def corner_angles(points):
    before = np.roll(points, 1, axis=0) - points
    after = np.roll(points, -1, axis=0) - points
    cosines = (before * after).sum(axis=1) / (
        np.linalg.norm(before, axis=1) * np.linalg.norm(after, axis=1)
    )
    return np.degrees(np.arccos(np.clip(cosines, -1, 1)))


def edge_support(points, edge_mask):
    scores = []
    h, w = edge_mask.shape
    for a, b in zip(points, np.roll(points, -1, axis=0)):
        # Avoid corners; sample each full side independently.
        xy = a[None, :] + np.linspace(0.04, 0.96, 100)[:, None] * (b - a)[None, :]
        xy = np.rint(xy).astype(int)
        xy[:, 0] = np.clip(xy[:, 0], 0, w - 1)
        xy[:, 1] = np.clip(xy[:, 1], 0, h - 1)
        scores.append(float(np.mean(edge_mask[xy[:, 1], xy[:, 0]] > 0)))
    return scores


def same_quad(a, b, tolerance):
    return min(
        float(np.max(np.linalg.norm(a - np.roll(b, offset, axis=0), axis=1)))
        for offset in range(4)
    ) < tolerance


def aspect_and_orientation(points):
    # Only rotate 90 degrees geometrically. No attempt to infer semantic upright.
    lengths = edge_lengths(points)
    if (lengths[0] + lengths[2]) > (lengths[1] + lengths[3]):
        points = np.roll(points, -1, axis=0)
        lengths = edge_lengths(points)
    horizontal = (lengths[0] + lengths[2]) / 2
    vertical = (lengths[1] + lengths[3]) / 2
    observed = float(horizontal / vertical)
    vectors = np.roll(points, -1, axis=0) - points
    parallel_errors = []
    for a, b in [(vectors[0], -vectors[2]), (vectors[1], -vectors[3])]:
        cos = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
        parallel_errors.append(float(np.degrees(np.arccos(np.clip(cos, -1, 1)))))
    opposite_ratio = max(
        max(lengths[0], lengths[2]) / min(lengths[0], lengths[2]),
        max(lengths[1], lengths[3]) / min(lengths[1], lengths[3]),
    )
    frontal = (
        max(parallel_errors) <= POLICY["frontal_parallel_degrees"]
        and opposite_ratio <= POLICY["frontal_opposite_edge_ratio"]
        and POLICY["frontal_min_aspect"] <= observed <= POLICY["frontal_max_aspect"]
    )
    aspect = observed if frontal else POLICY["physical_aspect_prior"]
    return points, float(aspect), {
        "observedAspect": observed,
        "aspectSource": "observed-near-frontal" if frontal else "physical-5:7-prior",
        "aspectLimitation": "Physical aspect is not recoverable uniquely from an uncalibrated projective view.",
        "parallelErrorsDegrees": parallel_errors,
        "orientation": "portrait-by-short-edge-only; 180-degree semantic orientation unresolved",
    }


def detect_card(image_input, output=None):
    """image_input: path or encoded image bytes, and nothing else.

    Result corners (if accepted) are cyclic, clockwise in oriented source pixels,
    in the same order used by rectification. Rejected results have corners=[].
    detectorMs includes decode/detection/rectification, excludes disk crop writing.
    No square padding or model processing happens here.
    """
    development_only()
    started = time.perf_counter()
    result = {
        "accepted": False, "corners": [], "reason": "no_good_quad",
        "detectorMs": 0.0, "cropFile": None, "diagnostics": {}, "outputAspect": None,
    }
    diagnostics = result["diagnostics"]
    diagnostics.update({
        "policyVersion": POLICY["version"],
        "coordinateSpace": "EXIF-oriented source image pixels",
        "physicalIdentityGuaranteed": False,
    })
    try:
        if isinstance(image_input, (str, os.PathLike)):
            encoded = Path(image_input).read_bytes()
        elif isinstance(image_input, bytes):
            encoded = image_input
        else:
            raise TypeError("Input must be an image path or encoded image bytes")
        image = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Image decoder rejected input")
        h, w = image.shape[:2]
        diagnostics["sourceSize"] = [w, h]
        if min(w, h) < 80:
            result["reason"] = "image_too_small"
            return result
        scale = min(1.0, POLICY["max_detection_side"] / max(w, h))
        small = cv2.resize(image, (round(w * scale), round(h * scale))) if scale < 1 else image
        sh, sw = small.shape[:2]
        # Use actual scale on each axis to map corners without rounding drift.
        source_scale = np.array([w / sw, h / sh], dtype=np.float32)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        median = float(np.median(gray))
        lower = int(max(20, min(100, median * 0.50)))
        upper = int(max(lower + 30, min(220, median * 1.25)))
        edges = cv2.Canny(gray, lower, upper)
        supported_edges = cv2.dilate(edges, np.ones((5, 5), np.uint8))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        candidates = []
        cutoff = 0
        rejected = {}
        diag = math.hypot(sw, sh)
        margin = max(3, min(sw, sh) * POLICY["border_margin_fraction"])
        for mask in [closed, binary, cv2.bitwise_not(binary)]:
            contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                area = abs(cv2.contourArea(contour))
                fraction = area / (sw * sh)
                if not POLICY["min_area_fraction"] <= fraction <= POLICY["max_area_fraction"]:
                    continue
                perimeter = cv2.arcLength(contour, True)
                for epsilon in POLICY["approximation_fractions"]:
                    poly = cv2.approxPolyDP(contour, epsilon * perimeter, True)
                    if len(poly) != 4 or not cv2.isContourConvex(poly):
                        continue
                    points = order_corners(poly)
                    lengths = edge_lengths(points)
                    angles = corner_angles(points)
                    aspect = min(lengths[0] + lengths[2], lengths[1] + lengths[3]) / max(
                        lengths[0] + lengths[2], lengths[1] + lengths[3]
                    )
                    if (
                        min(lengths) < min(sw, sh) * POLICY["min_short_edge_fraction"]
                        or min(angles) < POLICY["min_angle_degrees"]
                        or max(angles) > POLICY["max_angle_degrees"]
                        or not POLICY["min_observed_aspect"] <= aspect <= POLICY["max_observed_aspect"]
                    ):
                        rejected["geometry"] = rejected.get("geometry", 0) + 1
                        continue
                    if (
                        points[:, 0].min() < margin or points[:, 1].min() < margin
                        or points[:, 0].max() > sw - 1 - margin
                        or points[:, 1].max() > sh - 1 - margin
                    ):
                        cutoff += 1
                        continue
                    support = edge_support(points, supported_edges)
                    if min(support) < POLICY["min_edge_support"]:
                        rejected["edgeSupport"] = rejected.get("edgeSupport", 0) + 1
                        continue
                    if any(same_quad(points, c["points"], diag * POLICY["duplicate_corner_distance_fraction"]) for c in candidates):
                        continue
                    candidates.append({"points": points, "area": float(abs(cv2.contourArea(points))), "edgeSupport": support})
        candidates.sort(key=lambda c: c["area"], reverse=True)
        diagnostics.update({
            "candidateCount": len(candidates), "cutoffCandidateCount": cutoff,
            "rejectedCounts": rejected,
            "detectionSize": [sw, sh],
        })
        # Any substantial plausible second boundary is unsafe, including nested
        # sleeves/pockets/panels. Never choose using card identity or center bias.
        if cutoff:
            result["reason"] = "partial_or_cutoff_rectangle"
            return result
        if not candidates:
            return result
        if len(candidates) > 1 and candidates[1]["area"] >= candidates[0]["area"] * POLICY["ambiguous_relative_area"]:
            result["reason"] = "multiple_ambiguous_rectangles"
            return result
        points = candidates[0]["points"] * source_scale
        points, aspect, aspect_info = aspect_and_orientation(points)
        diagnostics.update(aspect_info)
        diagnostics["selectedEdgeSupport"] = candidates[0]["edgeSupport"]
        lengths = edge_lengths(points)
        out_h = int(round(min(POLICY["max_crop_long_side"], max(lengths[1], lengths[3]))))
        out_w = max(2, int(round(out_h * aspect)))
        out_h = max(2, out_h)
        target = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32)
        transform = cv2.getPerspectiveTransform(points.astype(np.float32), target)
        crop = cv2.warpPerspective(image, transform, (out_w, out_h), flags=cv2.INTER_CUBIC)
        result.update({
            "accepted": True, "corners": points.astype(float).tolist(),
            "reason": "single_supported_card_like_quad",
            "outputAspect": out_w / out_h,
        })
        diagnostics["outputSize"] = [out_w, out_h]
        diagnostics["padding"] = "none; downstream runner must square-pad without stretching"
        result["detectorMs"] = (time.perf_counter() - started) * 1000
        if output is not None:
            output_path = Path(output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            if not cv2.imwrite(str(output_path), crop):
                raise ValueError("Crop writer failed")
            result["cropFile"] = str(output_path)
        return result
    except (OSError, ValueError, TypeError, cv2.error) as exc:
        result.update({"accepted": False, "corners": [], "reason": "input_or_output_error", "cropFile": None, "outputAspect": None})
        diagnostics["error"] = str(exc)
        return result
    finally:
        if not result["detectorMs"]:
            result["detectorMs"] = (time.perf_counter() - started) * 1000


def main():
    started = time.perf_counter()
    development_only()
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--input", help="One image path")
    mode.add_argument("--manifest", help='JSON array of paths or {"images":[{"input":"path","output":"optional crop"}]}')
    parser.add_argument("--output", help="Optional rectified crop for single-image mode")
    parser.add_argument("--output-dir", help="Optional batch crop directory")
    args = parser.parse_args()
    if args.input:
        print(json.dumps(detect_card(args.input, args.output), allow_nan=False))
        return
    if args.output:
        parser.error("--output is only valid with --input")
    manifest = json.loads(Path(args.manifest).read_text())
    entries = manifest["images"] if isinstance(manifest, dict) else manifest
    if not isinstance(entries, list):
        parser.error("manifest must contain a list")
    results = []
    for index, entry in enumerate(entries):
        if isinstance(entry, str):
            path, output = entry, None
        elif isinstance(entry, dict) and set(entry) <= {"input", "output"} and "input" in entry:
            path, output = entry["input"], entry.get("output")
        else:
            parser.error("entries accept input path and optional output only; no identity/metadata fields")
        if output is None and args.output_dir:
            output = str(Path(args.output_dir) / f"{index:04d}-card.png")
        results.append({"input": path, **detect_card(path, output)})
    print(json.dumps({
        "results": results,
        "detectorStageMs": sum(r["detectorMs"] for r in results),
        "processWallMs": (time.perf_counter() - started) * 1000,
        "processWallScope": "main-entry to output; interpreter/import startup excluded; caller should time subprocess for full wall",
        "sourceHash": source_hash(),
    }, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc), "developmentOnly": True}), file=sys.stderr)
        sys.exit(2)