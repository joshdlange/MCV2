"""Development-only, local-file CPU timing worker. No accuracy or reranking."""
import contextlib
import hashlib
import json
import os
import platform
import sys
import time
from pathlib import Path

os.umask(0o077)
start = time.perf_counter()
import cv2
import numpy as np
import torch
from PIL import Image, ImageOps
from lightglue import ALIKED, LightGlue

import_ms = (time.perf_counter() - start) * 1000
torch.set_num_threads(2)
torch.set_num_interop_threads(1)
cv2.setNumThreads(1)
job = json.loads(Path(sys.argv[1]).read_text())
torch.hub.set_dir(job["weightsDirectory"])


def emit(value):
    print(json.dumps(value), flush=True)


def load_image(path):
    with Image.open(path) as im:
        arr = np.array(ImageOps.exif_transpose(im).convert("RGB"), copy=True)
    return torch.from_numpy(arr).permute(2, 0, 1).float().div_(255)


def check_file(path, expected):
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == expected


check_file(job["queryFile"], job["queryDigest"])
t = time.perf_counter()
with contextlib.redirect_stdout(sys.stderr):
    extractor = ALIKED(model_name="aliked-n16", max_num_keypoints=1024).eval().cpu()
    matcher = LightGlue(features="aliked").eval().cpu()
init_ms = (time.perf_counter() - t) * 1000
cache = {}
preparation = []
with torch.inference_mode():
    for ref in job["references"]:
        if ref["digest"] in cache:
            continue
        check_file(ref["file"], ref["digest"])
        t = time.perf_counter()
        image = load_image(ref["file"])
        decode_ms = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        cache[ref["digest"]] = extractor.extract(image, resize=1024)
        preparation.append({
            "decodeMs": decode_ms,
            "featureMs": (time.perf_counter() - t) * 1000,
            "keypoints": int(cache[ref["digest"]]["keypoints"].shape[1]),
        })
cpu_model = next((line.split(":", 1)[1].strip() for line in
                  Path("/proc/cpuinfo").read_text().splitlines()
                  if line.startswith("model name")), "unreported")
emit({
    "ready": True,
    "importMs": import_ms,
    "modelInitializationMs": init_ms,
    "referencePreparation": preparation,
    "referenceCount": len(cache),
    "hardware": {
        "cpuModel": cpu_model, "logicalCPUs": os.cpu_count(),
        "affinityCPUs": len(os.sched_getaffinity(0)), "platform": platform.system(),
        "torch": torch.__version__, "opencv": cv2.__version__,
        "torchThreads": torch.get_num_threads(),
        "torchInteropThreads": torch.get_num_interop_threads(),
        "opencvThreads": cv2.getNumThreads(), "device": "cpu",
        "cudaAvailable": torch.cuda.is_available(), "gpuProvisioned": False,
    },
})
for line in sys.stdin:
    command = json.loads(line)
    if command.get("stop"):
        break
    start = time.perf_counter()
    image = load_image(job["queryFile"])
    decode_ms = (time.perf_counter() - start) * 1000
    with torch.inference_mode():
        t = time.perf_counter()
        query = extractor.extract(image, resize=1024)
        extraction_ms = (time.perf_counter() - t) * 1000
        pair_times = []
        geometry_times = []
        # Preserve exact Stage-1 Top10 order, including duplicate IDs.
        for ref in job["references"]:
            reference = cache[ref["digest"]]
            t = time.perf_counter()
            matches = matcher({"image0": query, "image1": reference})["matches"][0]
            pair_times.append((time.perf_counter() - t) * 1000)
            t = time.perf_counter()
            p0 = query["keypoints"][0][matches[:, 0]].numpy()
            p1 = reference["keypoints"][0][matches[:, 1]].numpy()
            if len(matches) >= 4:
                cv2.findHomography(p0, p1, cv2.USAC_MAGSAC, 3.0,
                                   maxIters=2000, confidence=0.995)
            geometry_times.append((time.perf_counter() - t) * 1000)
    emit({
        "queryDecodeMs": decode_ms, "queryFeatureMs": extraction_ms,
        "queryKeypoints": int(query["keypoints"].shape[1]),
        "pairMatchMs": pair_times, "geometryMs": geometry_times,
        "pairCount": len(pair_times),
        "stage2Ms": (time.perf_counter() - start) * 1000,
    })