#!/usr/bin/env python3
"""Download public pretrained weights only. Never accepts or uploads photographs."""
import hashlib
import json
import os
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def main():
    if any(os.environ.get(key, "").lower() == "production" for key in ("NODE_ENV", "APP_ENV")):
        raise RuntimeError("Development-only downloader refuses production execution")
    config = json.loads((ROOT / "scripts/dev-segment-card-detector.config.json").read_text())
    target = ROOT / config["weightsFile"]
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".download")
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(config["weightsUrl"], timeout=60) as response, temporary.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != config["weightsSha256"]:
            raise RuntimeError("Public weights SHA-256 mismatch; downloaded file rejected")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps({"weightsFile": str(target), "sha256": digest.hexdigest(),
                      "modelId": config["modelId"], "license": config["modelLicense"]}))


if __name__ == "__main__":
    main()