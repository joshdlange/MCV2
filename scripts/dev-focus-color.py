"""One frozen, generic robust peripheral-chroma signal; no target labels."""
import json
import time
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(".local/parallel-focus")
job = json.loads((ROOT / "job.json").read_text())
policy = json.loads((ROOT / "policy.json").read_text())["parallelSignal"]
cv2.setNumThreads(2)
cv2.setRNGSeed(734822)
orb = cv2.ORB_create(nfeatures=3000, scaleFactor=1.2, nlevels=8,
                     edgeThreshold=20, patchSize=31, fastThreshold=12)
matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
verified = {r["digest"] for r in json.loads(
    Path(".local/detail-orb/reference-boundary-review.json").read_text())
            if r["boundaryVerified"]}
refs = {}
prep_start = time.perf_counter()
for ref in job["references"]:
    if ref["digest"] not in verified:
        continue
    im = cv2.imread(ref["file"])
    points, desc = orb.detectAndCompute(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), None)
    refs[ref["digest"]] = (im, points, desc)
prep_ms = (time.perf_counter() - prep_start) * 1000


def abstain(reason, **extra):
    return {"reliable": False, "reason": reason, "adjustment": 0, **extra}


def robust_chroma(query, reference, matrix):
    h, w = reference.shape[:2]
    target_w, target_h = 240, round(240 * h/w)
    scale = np.diag([target_w/w, target_h/h, 1.0])
    # Query-to-reference warp follows the geometric match, not retrieval labels.
    aligned = cv2.warpPerspective(query, scale @ np.linalg.inv(matrix),
                                   (target_w, target_h))
    target = cv2.resize(reference, (target_w, target_h), interpolation=cv2.INTER_AREA)
    labs, gradients, eligible = [], [], []
    for im in [aligned, target]:
        lab = cv2.cvtColor(im.astype(np.float32)/255, cv2.COLOR_BGR2LAB)
        gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
        grad = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0),
                             cv2.Sobel(gray, cv2.CV_32F, 0, 1))
        chroma = np.linalg.norm(lab[:, :, 1:3], axis=2)
        glare = ((lab[:, :, 0] > 90) & (chroma < 10)) | (
            (np.max(im, axis=2) >= 250) & (lab[:, :, 0] > 85))
        usable = (~glare) & (lab[:, :, 0] >= 12)
        labs.append(lab)
        gradients.append(grad)
        eligible.append(usable)
    cells = []
    # A 5% guard removes scan-edge/sleeve contamination. Only peripheral grid
    # cells are considered, avoiding central character-art dominance.
    for row in range(6):
        for col in range(4):
            if row not in [0, 5] and col not in [0, 3]:
                continue
            x0, x1 = [round(target_w*(.05+.9*x/4)) for x in [col, col+1]]
            y0, y1 = [round(target_h*(.05+.9*y/6)) for y in [row, row+1]]
            region = np.s_[y0:y1, x0:x1]
            mask = eligible[0][region] & eligible[1][region]
            for gradient in gradients:
                g = gradient[region]
                mask &= g <= np.percentile(g, 60)
            count = int(mask.sum())
            if count < 25 or count / mask.size < .12:
                continue
            qa = np.median(labs[0][region][:, :, 1:3][mask], axis=0)
            ra = np.median(labs[1][region][:, :, 1:3][mask], axis=0)
            delta = float(np.linalg.norm(qa-ra))
            cells.append({"row": row, "column": col, "pixels": count,
                          "validFraction": count/mask.size,
                          "queryMedianAB": qa.tolist(), "referenceMedianAB": ra.tolist(),
                          "chromaDelta": delta})
    if len(cells) < policy["minValidPeripheralCells"]:
        return abstain("Too few non-glare low-gradient peripheral cells", cells=cells)
    # Median makes the signal robust to isolated foil highlights/printed regions.
    delta = float(np.median([c["chromaDelta"] for c in cells]))
    similarity = float(np.exp(-delta / policy["chromaScale"]))
    adjustment = policy["maximumAdjustment"] * (2*similarity-1)
    return {"reliable": True, "similarity": similarity,
            "medianChromaDelta": delta, "adjustment": adjustment, "cells": cells,
            "warning": "Chromatic correspondence is not an optical foil model or calibrated exact-parallel probability."}


def compare(query, qp, qd, ref):
    reference, rp, rd = ref
    if rd is None or qd is None:
        return abstain("No ORB descriptors")
    pairs = matcher.knnMatch(rd, qd, k=2)
    matches = [a for pair in pairs if len(pair) == 2 for a, b in [pair]
               if a.distance < .75*b.distance]
    unique = {}
    for m in sorted(matches, key=lambda m: m.distance):
        unique.setdefault(m.trainIdx, m)
    matches = list(unique.values())
    if len(matches) < 20:
        return abstain("Fewer than20 ratio-test matches", matches=len(matches))
    src = np.float32([rp[m.queryIdx].pt for m in matches])
    dst = np.float32([qp[m.trainIdx].pt for m in matches])
    matrix, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3,
                                      maxIters=4000, confidence=.995)
    if matrix is None or mask is None:
        return abstain("No robust homography")
    keep = mask.ravel().astype(bool)
    count, ratio = int(keep.sum()), float(keep.mean())
    if count < 20 or ratio < .5:
        return abstain("Insufficient distributed low-error alignment",
                       inliers=count, inlierRatio=ratio)
    h, w = reference.shape[:2]
    hull = float(cv2.contourArea(cv2.convexHull(src[keep]))) / (w*h)
    span = np.ptp(src[keep], axis=0) / [w, h]
    projected = cv2.perspectiveTransform(src.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    errors = np.linalg.norm(projected[keep]-dst[keep], axis=1)
    median, p95 = float(np.median(errors)), float(np.percentile(errors, 95))
    metrics = {"inliers": count, "inlierRatio": ratio, "referenceHullCoverage": hull,
               "span": span.tolist(), "medianError": median, "p95Error": p95}
    if count < 20 or ratio < .5 or hull < .25 or min(span) < .5 or median > 3 or p95 > 6:
        return abstain("Insufficient distributed low-error alignment", **metrics)
    corners = np.float32([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]])
    quad = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    qh, qw = query.shape[:2]
    if (not np.isfinite(quad).all() or not cv2.isContourConvex(quad) or
            min(quad[:, 0]) < 0 or min(quad[:, 1]) < 0 or
            max(quad[:, 0]) >= qw or max(quad[:, 1]) >= qh):
        return abstain("Projected reference card not safely within query", **metrics)
    return {**robust_chroma(query, reference, matrix), **metrics, "quad": quad.tolist()}


# Signal-only sanity checks do not become development-cohort observations.
blank = np.full((360, 240, 3), 255, np.uint8)
assert not robust_chroma(blank, blank, np.eye(3))["reliable"]
colored = np.full((360, 240, 3), [35, 140, 205], np.uint8)
same = robust_chroma(colored, colored, np.eye(3))
assert same["reliable"] and abs(same["similarity"]-1) < 1e-6
other = np.full((360, 240, 3), [205, 100, 35], np.uint8)
different = robust_chroma(colored, other, np.eye(3))
assert different["reliable"] and different["similarity"] < same["similarity"]
rows = []
for case in job["queries"]:
    image = cv2.imread(case["file"])
    start = time.perf_counter()
    qp, qd = orb.detectAndCompute(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), None)
    items = []
    seen = {}
    for candidate in case["top20"]:
        digest = candidate["digest"]
        if digest not in seen:
            seen[digest] = compare(image, qp, qd, refs[digest]) if digest in refs else abstain(
                "Reference physical extent not in frozen verified set")
        items.append({"digest": digest, "cardId": candidate["cardId"], **seen[digest]})
    rows.append({"scanId": case["scanId"], "input": case["input"], "items": items,
                 "ms": (time.perf_counter()-start)*1000})
    print("CHROMA", case["scanId"], case["input"], sum(x["reliable"] for x in items),
          "reliable", flush=True)
(ROOT / "color-evidence.json").write_text(json.dumps({
    "referencePrecomputeMs": prep_ms, "verifiedReferencesPrepared": len(refs), "rows": rows,
    "unitQA": {"blankGlareAbstains": True, "identicalColorSimilarity": same["similarity"],
               "differentColorSimilarity": different["similarity"]},
}, indent=2))