"""Development-only ORB/RANSAC isolation. Never reads correct-card labels."""
import hashlib
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(".local/detail-orb")
job = json.loads((ROOT / "job.json").read_text())
policy = job["policy"]
cv2.setNumThreads(2)
cv2.setRNGSeed(734822)

# Label-independent image-extent review of all 63 raw-top10 reference rasters.
# No per-query corners: complete, tightly framed card faces only. Graded slabs,
# scenes, store branding panels, uncertain external margins are conservatively
# unavailable. These reviewed references are an explicit experiment prerequisite,
# not a claim that arbitrary catalog rasters already have valid card boundaries.
safe_extent_indices = {
    1, 5, 6, 7, 11, 15, 17, 18, 19, 27, 30, 31, 34, 35, 36, 39, 40, 41,
    43, 44, 45, 46, 47, 50, 51, 52, 54, 56, 57, 58, 59, 60, 61, 62,
}
reference_review = [
    {
        "digest": r["digest"], "reviewIndex": r["reviewIndex"],
        "cardIds": r["cardIds"],
        "boundaryVerified": r["reviewIndex"] in safe_extent_indices,
        "note": (
            "Visually verified tightly framed complete card face; raster corners represent card extent."
            if r["reviewIndex"] in safe_extent_indices else
            "Reference extent unverified: slab, scene, photograph margin, watermark/branding panel, or uncertain framing. Not used for projected boundaries."
        ),
    }
    for r in job["refs"]
]
(ROOT / "reference-boundary-review.json").write_text(json.dumps(reference_review, indent=2))
(ROOT / "orb-policy.json").write_text(json.dumps({
    "createdBeforeMatching": True, "sourceHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "policy": policy, "referenceBoundaryReview": reference_review,
    "opencv": cv2.__version__, "numpy": np.__version__,
}, indent=2))

orb = cv2.ORB_create(nfeatures=policy["orbFeatures"], scaleFactor=1.2,
                     nlevels=8, edgeThreshold=20, patchSize=31, fastThreshold=12)
matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
reference_cache = {}
prep_start = time.perf_counter()
for r in job["refs"]:
    if r["reviewIndex"] not in safe_extent_indices:
        continue
    image = cv2.imread(r["file"])
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    points, desc = orb.detectAndCompute(gray, None)
    reference_cache[r["digest"]] = {"row": r, "image": image, "points": points, "desc": desc}
reference_precompute_ms = (time.perf_counter() - prep_start) * 1000


def reject(reason, **metrics):
    return {"accepted": False, "reason": reason, **metrics}


def match_candidate(ref, qpoints, qdesc, query_shape):
    if ref["desc"] is None or qdesc is None:
        return reject("No ORB descriptors")
    pairs = matcher.knnMatch(ref["desc"], qdesc, k=2)
    matches = [a for pair in pairs if len(pair) == 2 for a, b in [pair]
               if a.distance < policy["ratioTest"] * b.distance]
    # Many-to-one reference-to-query matches must not inflate RANSAC support.
    by_target = {}
    for match in sorted(matches, key=lambda x: x.distance):
        if match.trainIdx not in by_target:
            by_target[match.trainIdx] = match
    matches = list(by_target.values())
    if len(matches) < policy["minInliers"]:
        return reject("Too few ratio-test matches", matches=len(matches))
    src = np.float32([ref["points"][m.queryIdx].pt for m in matches])
    dst = np.float32([qpoints[m.trainIdx].pt for m in matches])
    matrix, mask = cv2.findHomography(src, dst, cv2.RANSAC, policy["ransacPixels"],
                                      maxIters=4000, confidence=0.995)
    if matrix is None or mask is None:
        return reject("RANSAC homography unavailable", matches=len(matches))
    inliers = mask.ravel().astype(bool)
    count = int(inliers.sum())
    ratio = count / len(matches)
    if count < policy["minInliers"] or ratio < policy["minInlierRatio"]:
        return reject("Insufficient inlier count/ratio", matches=len(matches),
                      inliers=count, inlierRatio=ratio)
    h, w = ref["image"].shape[:2]
    hull_area = float(cv2.contourArea(cv2.convexHull(src[inliers])))
    coverage = hull_area / (w * h)
    span = np.ptp(src[inliers], axis=0) / np.array([w, h])
    predicted = cv2.perspectiveTransform(src.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    errors = np.linalg.norm(predicted[inliers] - dst[inliers], axis=1)
    median, p95 = float(np.median(errors)), float(np.percentile(errors, 95))
    metrics = {"matches": len(matches), "inliers": count, "inlierRatio": ratio,
               "referenceHullCoverage": coverage, "referenceSpan": span.tolist(),
               "medianReprojectionError": median, "p95ReprojectionError": p95}
    if (coverage < policy["minReferenceHullCoverage"] or
            float(span.min()) < policy["minInlierSpan"]):
        return reject("Local-only inliers: insufficient full-card reference coverage", **metrics)
    if median > policy["maxMedianError"] or p95 > policy["maxP95Error"]:
        return reject("Reprojection error too high", **metrics)
    corners = np.float32([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]])
    quad = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    qh, qw = query_shape[:2]
    if not np.isfinite(quad).all() or not cv2.isContourConvex(quad):
        return reject("Non-finite/non-convex projected boundary", **metrics)
    if (quad[:, 0].min() < 0 or quad[:, 1].min() < 0 or
            quad[:, 0].max() >= qw or quad[:, 1].max() >= qh):
        return reject("Projected card boundary extends outside original", **metrics)
    area = float(cv2.contourArea(quad)) / (qw * qh)
    lengths = np.linalg.norm(quad - np.roll(quad, -1, axis=0), axis=1)
    opposite = max(lengths[0]/lengths[2], lengths[2]/lengths[0],
                   lengths[1]/lengths[3], lengths[3]/lengths[1])
    ratio_shape = min((lengths[0]+lengths[2]), (lengths[1]+lengths[3])) / max(
        (lengths[0]+lengths[2]), (lengths[1]+lengths[3]))
    if not policy["minQueryArea"] <= area <= policy["maxQueryArea"]:
        return reject("Projected card area implausible", queryArea=area, **metrics)
    if opposite > policy["maxOppositeSideRatio"] or not 0.50 <= ratio_shape <= 0.90:
        return reject("Projected card shape/perspective implausible", **metrics)
    support = count * ratio * coverage / (1 + median)
    return {"accepted": True, "quad": quad.tolist(), "quality": support,
            "queryArea": area, "referenceAspect": w/h, **metrics}


results = []
for case in job["cases"]:
    image = cv2.imread(case["file"])
    start = time.perf_counter()
    qpoints, qdesc = orb.detectAndCompute(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), None)
    candidates, seen = [], set()
    for candidate in case["candidates"]:
        digest = candidate["digest"]
        if digest in seen:
            continue
        seen.add(digest)
        ref = reference_cache.get(digest)
        if ref is None:
            candidate_result = reject("Reference physical boundary unverified; not projected")
        else:
            candidate_result = match_candidate(ref, qpoints, qdesc, image.shape)
        candidates.append({"digest": digest, "cardId": candidate["cardId"], **candidate_result})
    valid = sorted([c for c in candidates if c["accepted"]], key=lambda c: -c["quality"])
    selected = valid[0] if valid else None
    ambiguity = False
    if selected:
        diag = math.hypot(*image.shape[:2])
        for alternative in valid[1:]:
            if alternative["quality"] < selected["quality"] * policy["ambiguitySupportFraction"]:
                continue
            distance = float(np.linalg.norm(np.array(alternative["quad"]) -
                                            np.array(selected["quad"]), axis=1).mean()) / diag
            if distance > policy["maxAmbiguousCornerDistance"]:
                ambiguity = True
    accepted = selected is not None and not ambiguity
    outline = image.copy()
    if selected:
        cv2.polylines(outline, [np.array(selected["quad"], dtype=np.int32)], True,
                      (0, 220, 0) if accepted else (0, 165, 255), 4)
    cv2.imwrite(str(ROOT / f"{case['scanId']}-orb-outline.jpg"), outline)
    if accepted:
        # Reference extent has been verified as the card itself. Preserve that
        # aspect through the homography, then uniform contain padding to 2:3.
        out_h, out_w = 900, round(900 * selected["referenceAspect"])
        target = np.float32([[0, 0], [out_w-1, 0], [out_w-1, out_h-1], [0, out_h-1]])
        transform = cv2.getPerspectiveTransform(np.float32(selected["quad"]), target)
        crop = cv2.warpPerspective(image, transform, (out_w, out_h), flags=cv2.INTER_LINEAR)
        scale = min(600/out_w, 900/out_h)
        nw, nh = round(out_w*scale), round(out_h*scale)
        resized = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
        canvas = np.full((900, 600, 3), 119, dtype=np.uint8)
        left, top = (600-nw)//2, (900-nh)//2
        canvas[top:top+nh, left:left+nw] = resized
        cv2.imwrite(str(ROOT / f"{case['scanId']}-orb-crop.jpg"), canvas,
                    [cv2.IMWRITE_JPEG_QUALITY, 94])
    result = {"scanId": case["scanId"], "automaticAccepted": accepted,
              "ambiguity": ambiguity, "selected": selected,
              "candidates": candidates, "queryKeypoints": len(qpoints),
              "guidedIsolationMs": (time.perf_counter()-start)*1000,
              "usedRaw": not accepted}
    results.append(result)
    print("ORB", case["scanId"], "accepted", accepted,
          "selected", selected["cardId"] if selected else None,
          "inliers", selected["inliers"] if selected else None,
          "ms", result["guidedIsolationMs"], flush=True)
(ROOT / "orb-results.json").write_text(json.dumps({
    "referencePrecomputeMs": reference_precompute_ms,
    "referenceCount": len(reference_cache),
    "automaticAccepted": sum(r["automaticAccepted"] for r in results),
    "results": results,
    "note": "Automatic gates only. Subsequent offline crop visual QA is reported separately, never silently edits these automatic decisions.",
}, indent=2))