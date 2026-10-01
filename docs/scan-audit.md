# Scan to Add — Audit Report

- **Date:** 2026-09-30 (audit session started 23:36 UTC)
- **Auditor:** Claude Code (read-only audit; no implementation)
- **Repository:** `/home/runner/workspace` @ `c84eb64`

**Status:** DRAFT. Not committed. Waiting for your review.

Notation used throughout:
- `file:line` points into this repo.
- "Cmd" means a shell command I ran.
- "SQL" means a read-only query against the **dev** database, run with `PGOPTIONS=-c default_transaction_read_only=on`.
- **UNVERIFIED** means I could not confirm the claim from code, files or queries.

---

## 0. Headline findings (read this first)

1. **Production today is not running any of the new recognition code.**
   - The live site does not expose `/api/admin/scan-image-index/status` or `/api/admin/scan-review`. Unauthenticated GETs return the SPA `index.html` (200, `text/html`) instead of the API's 401 JSON. For comparison, `/api/cards/scan/usage` returns a 401 JSON.
   - The live scan chunk `assets/scan-Bs-2fYP_.js` has none of these strings: `card-scan.jpg`, `backImage`, `visualVerification`, `imageIndex`.
   - Conclusion: the deployed build predates commit `b0b2d3e` (2026-09-29 17:59 UTC). That commit introduced DINO retrieval, the model download in the build, and `@huggingface/transformers`. The live build also predates the client crop UI added in `1598906` (2026-09-25).
   - **No live risk found.**

2. **LATENT RISK: the next Publish ships the experiment path to every user.** From the current `main` build:
   - Every `POST /api/cards/scan` runs DINO retrieval in parallel with GPT-4o-mini (`server/services/scanService.ts:437-454`), then a second, sequential GPT-4o-mini "artwork verification" call (`scanService.ts:465`, 8 s timeout).
   - The production build downloads a model from huggingface.co and fails if the download fails (`package.json` `build` script → `scripts/prepare-catalog-visual-model.ts:13-17`). So a HuggingFace outage would block every deploy, including unrelated hotfixes.
   - Server startup runs DDL (`CREATE TABLE IF NOT EXISTS catalog_visual_references` plus 2 indexes) against the deployment DB (`server/index.ts:910-931`).
   - With an empty production index, every scan would return the warning "Catalog image search is unavailable" (`scanService.ts:472`).
   - **Recommendation: do not Publish `main` until this is decided.**

3. **SAM, torch, OpenCV and LightGlue are not in the Node production dependency chain.** They live only in `pyproject.toml`/`uv.lock` and `.pythonlibs` (1.1 GB).
   - **NEEDS REVIEW:** it is UNVERIFIED whether Replit's deployment snapshot includes `.pythonlibs/` (1.1 GB), `.local/` (2.4 GB: SAM weights, 60 original user photos and derivatives), or runs a Python install from `pyproject.toml`.

4. **Most claimed numbers check out against the result files (§2).** The one I could not find is the batch cosine range "0.969–0.991": it is UNVERIFIED as stated. I re-measured batch instability myself (§8): min 0.966, mean 0.983–0.989, and the cause is **dynamic int8 activation quantization mixing images inside a batch**. The production path is single-image only, so it is not affected.

5. **New correctness defect in DINO preprocessing (§7).**
   - The app letterboxes every image to 224×224. The ONNX processor then upscales that to 256 and center-crops back to 224.
   - The top and bottom ~6.25% of every card never reach the model. Verified with a synthetic probe.
   - It is consistent between index and query, so it is not a mismatch bug, but it discards name bars and set logos.

6. **Catalog data problems (§9).**
   - 3,313 visual-eligible cards share one placeholder image (`card-placeholder_ysozlo.png`). The eligibility SQL does not exclude it.
   - 61% of active catalog rows have no image at all.
   - 76% of image-bearing cards belong to a multi-subset "parallel family".
   - 570 parallel families (1,923 cards) reuse the exact same image URL across parallels, so image recognition cannot tell those apart.

7. **LightGlue timing run just before this session.** It was run minutes before this audit (untracked files, 23:31–23:34 UTC). Result: ALIKED+LightGlue on CPU = **6.29 s per query** for the top 10.
   - The results JSON contains keys that the committed script never writes, so the file was edited after the run or produced by a different script version (§3).

---

## 1. Current production scan flow

Labels:
- **PRODUCTION-LIVE:** deployed today.
- **PRODUCTION-PENDING:** on `main`, will ship on next Publish.
- **DEV-ONLY**, **EXPERIMENTAL**, **DEAD**.

### 1.1 Client (web; the same UI runs inside the Android app)

| Step | Where | Label |
|---|---|---|
| Route `/scan` → `ScanToAdd`. The only gate is login. | `client/src/App.tsx:72` (lazy import), `:246` (route), `~:313` (`if (!user) return <Login/>`) | LIVE (older version) |
| Nav entry "Scan to Add" | `client/src/components/layout/sidebar.tsx:43`; dashboard quick action `client/src/components/dashboard/stats-dashboard.tsx:277` | LIVE |
| Capture: `<input type=file accept=image/* capture=environment>` for the front and optional back. No `getUserMedia`, no `@capacitor/camera`. | `client/src/pages/scan.tsx:758-773` | PENDING (the live chunk has no back-image input) |
| Monthly limit UI (`GET /api/cards/scan/usage`) | `scan.tsx:527-532` | LIVE |
| **Manual crop step**: canvas, max 2400 px, rotate in 90° steps, fixed 2:3 frame the user drags and resizes, JPEG q0.88 `card-scan.jpg` | `client/src/components/CardCrop.tsx:43-44,55-57,77-84,101-108`; `client/src/lib/cardCrop.ts:4,19,27`; used at `scan.tsx:972,1000` | PENDING (added in `1598906` 2026-09-25; absent from the live chunk) |
| Upload `POST /api/cards/scan` multipart `image` (+ `backImage`), Firebase Bearer token | `scan.tsx:361-377` | LIVE/PENDING |
| Results: confidence pill, warnings, image-index coverage, candidate tiles, "Choose card manually" | `scan.tsx:124-137,1029-1101` | PENDING |
| Admin debug panel | `scan.tsx:1097-1099`, gated by `isAdmin` at `:319` | ADMIN-ONLY |
| `confidenceLevel==='none'` sends the user to the manual picker (`/api/cards/picker/*`) | `scan.tsx:378-389,477-514` | PENDING |
| **Confirm** screen ("Scanning never adds a card automatically") and duplicate check `GET /api/collection/check/:cardId` | `scan.tsx:1347-1494,535-541` | PENDING |
| Feedback `POST /api/cards/scan/:id/feedback` (correct/wrong/not_found), sent at most once | `scan.tsx:411-424,570-576`; `client/src/lib/scanConfirmation.ts:3-5` | PENDING |
| **Collection add**: `POST /api/collection {cardId, condition:"Near Mint", acquiredVia:"scan"}` | `scan.tsx:436-440` | LIVE |
| Optional photo submission: `POST /api/cards/:id/submit-scan-image` | `scan.tsx:456,1436` | PENDING |
| `quick-actions.tsx` "Scan Card" button (only calls `console.log`, never imported) | `client/src/components/dashboard/quick-actions.tsx:38-39` | DEAD |
| Admin Scan Accuracy Review page | `client/src/pages/admin/scan-accuracy-review.tsx:647,696`; route `App.tsx:60,244`; dashboard link `admin/dashboard.tsx:254` | DEV-ONLY + ADMIN-ONLY (`import.meta.env.DEV && isAdmin`) |

### 1.2 Capacitor / native

- **Plugins**: apple-sign-in, app, push-notifications, social-login, RevenueCat (`android/app/src/main/assets/capacitor.plugins.json`; `package.json:23-29,61`). There is **no camera, ML Kit, CameraX or document-scanner plugin**.
- **Android code**: `MainActivity.java` is an empty `BridgeActivity`.
- **Manifest**: `AndroidManifest.xml:49` declares only the INTERNET permission. There is no CAMERA permission; capture relies on the WebView file chooser.
- **Remote web app**: `capacitor.config.ts` sets `server.url = https://app.marvelcardvault.com`, so the app runs the live web UI.
- **No `ios/` directory exists.**

### 1.3 Server

| Component | Where | Label |
|---|---|---|
| `GET /api/cards/scan/usage` (25 free scans/month; SUPER_HERO unlimited) | `server/routes.ts:8953-8973`; `FREE_SCAN_LIMIT_PER_MONTH` `scanService.ts:18` | LIVE |
| `POST /api/cards/scan`: auth → multer → ≤10 MB, jpeg/png/webp → monthly limit → **insert `user_scan_logs`** → **upload photo to Cloudinary folder `scan_uploads`** → `scanCard()` → **insert `scan_uploads`** (OCR, parsed, candidates, top match) | `routes.ts:8976-9053` | LIVE (older `scanCard`) / PENDING (new `scanCard`) |
| `scanCard` preprocessing: sharp EXIF rotate, resize to 1200–2400 px width, normalize, sharpen, JPEG q90 | `scanService.ts:86-110` | PENDING |
| **"OCR"** = GPT-4o-mini vision JSON extraction (`detail:high`, 10 s timeout, no retry) | `scanService.ts:112-190` | LIVE (earlier form) / PENDING |
| Parse and sanitize card number, serial, year, set | `scanService.ts:192-238`; `scanMatching.ts` helpers | PENDING |
| **DINO visual retrieval** `queryCatalogByImage` (runs in parallel with OCR) | `scanService.ts:437-454` → `server/services/catalogVisual.ts:86-126` → `catalogVisualModel.ts:94-119` | **PENDING — EXPERIMENTAL in production path** |
| Text/metadata candidates `matchCandidates` plus image-candidate rows | `scanService.ts:458-461`; `server/services/scanMatching.ts` (574 lines) | PENDING |
| Fusion `rankImageCandidates` | `scanService.ts:464`; `scanMatching.ts` | PENDING |
| Second GPT-4o-mini call `verifyCandidateArt` (top 3 references, **sequential**, 8 s timeout) plus rule reranker `rerankVisualMatches` | `scanService.ts:259-387,465` | PENDING |
| Glare and low-resolution warnings | `scanService.ts:389-406` | PENDING |
| `POST /api/cards/scan/:id/feedback` (owner check) | `routes.ts:9056-9083` | LIVE/PENDING |
| `POST /api/cards/:cardId/submit-scan-image` (admins and trusted uploaders **auto-overwrite `cards.front_image_url`**; `imageUrl` is not validated as a scan upload) | `routes.ts:9086-9115` | LIVE?/PENDING — side finding, NEEDS REVIEW |
| `GET /api/admin/scan-image-index/status` (admin) | `routes.ts:2257-2268` | PENDING (absent live) |
| Scan-review API `/api/admin/scan-review/*`. Reads and writes JSON under `.local/scan-review` only. | `server/scan-review-routes.ts:336-448`, guard `server/services/scanReview.ts:24-30` | DEV-ONLY + ADMIN |
| Visual index worker | `catalogVisual.ts:197-230`, started from `server/index.ts:933-934` | PENDING, **gated OFF** unless `CATALOG_VISUAL_INDEX_ENABLED=true` |
| Startup DDL for `catalog_visual_references` | `server/index.ts:910-931` | PENDING, **runs on every boot** |

**DB tables involved:**
- `cards`, `card_sets`, `main_sets` (catalog; read)
- `user_scan_logs` (insert)
- `scan_uploads` (insert)
- `scan_feedback` (insert)
- `pending_card_images`
- `user_collections` (collection add; `shared/schema.ts`)
- `catalog_visual_references` (new; jsonb embeddings)

---

## 2. Experimental code inventory

Common facts:
- None of the experiment scripts is imported by `server/` (excluding tests), `client/src`, `shared/`, `.replit`, `scripts/post-merge.sh`, or any `package.json` script.
- The import direction is the other way round: the scripts import production modules (`catalogVisualModel.ts`, `catalogVisualFetch.ts`).
- Scripts are run by hand with `tsx` or `.pythonlibs/bin/python3`.
- DB-touching dev scripts use `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`: `dev-image-experiment.ts:37`, `dev-bounded-dino.ts:32`, `dev-bounded-report.ts:20`, `dev-broad-prepare.ts:18`, `dev-detail-report.ts:31`, `dev-orb-report.ts:52`, `dev-focus-report.ts:34`.
- No INSERT, UPDATE, DELETE or DDL was found in `scripts/dev-*`.

| Experiment | Files (commit) | Data dir | Verified result (file → key) |
|---|---|---|---|
| Image-first experiment | `scripts/dev-image-experiment*.ts`, `dev-card-normalization*.ts` (`d2b5d10`, 09-29) | `.local/image-experiment` (29 MB) | n=16, Top-1/3/10 = 0/0/0 (all outside index) — `raw-summary.json` |
| Bounded DINO, **9-card sample** | `dev-bounded-{dino,report,verify}.ts` (`4695397`) | `.local/bounded-dino` (61 MB) | Cases defined at `scripts/dev-bounded-verify.ts:7-24`: 3032, 3077, 3088, 3093, 3095, 3110, 3113, 3126, 3127. Arm A 6/8/8, Arm B 5/7/8, 76.4 ms per query. |
| Detail reranker + ORB | `dev-detail-*.ts`, `dev-orb-*.ts`, `dev-orb-isolation.py` (`61701de`) | `.local/detail-experiment` (39 MB), `.local/detail-orb` (72 MB) | Policy `detail-v1-preregistered` (DINO 0.65 / detail 0.35) |
| Focus-color | `dev-focus-*.ts/.py` (`c953cf8`) | `.local/parallel-focus` (181 MB) | 9-card arms: 7/7/8, 6/8/8, 7/8/8 — `.local/parallel-focus/summary.json` |
| **Broad DINO, 41 cases** + reranker + reference-guided crop | `dev-broad-*.ts`, `dev-broad-private-*.ts` (`a2635a3`, `1c736d1`) | `.local/broad-validation` (794 MB; 2,938-card index survives) | `attached_assets/dev-broad-readonly-production-results.json` → `dinoOnly` {n 41, top1 **29**, top3 **32**, top10 **35**} ✔. Reranker `metrics[0]` 28/29/35 ✔. `optionalCrop.accepted` **0**/41 ✔. 41 IDs defined at `scripts/dev-broad-private-plan.ts:15`. |
| Eval harness / policy guard | `dev-dino-next-evaluation.mjs` (+ test), `dev-dino-failure-audit.mjs` (`b2d7890`) | — | 12-ID list `:30`, 41-ID list `:43` |
| Quad/edge detector, failure12 | `dev-independent-card-detector.py` (+ test), `dev-failure12-{run,report}` (`086b7b9`) | — | `dev-failure12-executed-results.json` → detector accepted **0/12**, abstained **12/12** ✔. `primaryVisualCauseCounts`: hand/background/obstruction **7**, glare **3**, similar artwork **2** ✔. Raw Top-1/3/10 on the 12 = 0/3/6. |
| **SAM ViT-B** | `dev-segment-card-detector{.py,.test.py,-download.py,.config.json}`, `dev-strong41-{run.ts,report.mjs}` (`c489e3d`) | `.local/strong-card-model/sam_vit_b_01ec64.pth` (358 MB) | `dev-strong41-results.json` → `detector.overall.fullCard` **5**/41 ✔. `meanDetectorMs` **34,961** ✔. Raw and isolated both 28/31/34 (40-case reconstruction) ✔. |
| **LightGlue timing** (untracked) | `scripts/dev-lightglue-timing.ts`, `scripts/dev-lightglue-timing-worker.py`, `attached_assets/dev-lightglue-timing-results.json` | `.local/lightglue-timing-*.json` | ALIKED-n16 1024 kp @1024 px + LightGlue + MAGSAC on DINO top-10, CPU with 2 threads, **1 query**: `warmMeanMs.fullPipeline` **6,290 ms** (query features 2,890; 327 ms per pair). Cold start 49.8 s. No accuracy measured. |
| Catalog visual bulk/index CLIs | `scripts/catalog-visual-{bulk,index}.ts` (npm scripts `catalog:visual:*`) | — | Has a `--write` path, but it is hard-guarded to `NODE_ENV=development` + no `REPLIT_DEPLOYMENT` + DB host in {helium, localhost} (`catalog-visual-bulk.ts:36-38`; `catalog-visual-index.ts:8`) |
| Older crop test | `scripts/test-scan-crop-browser.mjs` (`1598906`) | — | not examined in depth |

Claim check:

| Claim | Verdict |
|---|---|
| 1. OCR/text shortlist often misses the right card | **UNVERIFIED** as a number |
| 2. DINO 41-case Top-1/3/10 = 29/32/35 | ✔ |
| 2. 40-case reconstruction 28/31/34 | ✔ (SAM run) |
| 3. Reranker 5/9 → 7/9 on the sample | ✔ approximately. Focus-color arms reached 7/9; bounded Arm B was 5/9. |
| 3. Reranker 28/41 on the broad set | ✔ |
| 4. Reference-guided crop 0/41 | ✔ |
| 5. Quad detector 0/12 detected, 12/12 abstained | ✔ |
| 6. SAM 5/41 at ~35 s per image | ✔ |
| 7. Batch cosine 0.969–0.991 | **UNVERIFIED.** No result file contains it. My own measurement is in §8. |
| 8. 7/3/2 failure breakdown | ✔ |
| 8. ID pairs 20279/530526 and 20280/530527 | ✔ They come from `catalogRelationships` in `dev-strong41-results.json`, not failure12. |

**Where the ~3,046-card index went:** it was deleted. The report records `cleanup.status: "verified-deleted"` (757 files, 388 MB). Its format and size are UNVERIFIED because nothing remains. The 41 query photos were also deleted after the runs and **are not on disk** (the 60 photos in `.local/scan-review/originals` overlap the 41 set 0 times and the 9-card set 9 times).

**Production data provenance:** the 41 and 12 cases came from one read-only export via the Replit agent's production-DB tool (`dev-strong41-results.json` → `production`: 1 export, 41 rows, fields `scan_id, image_url, confirmed_card_id`, `writes: 0`, `accountData: false`). The photos were then fetched into a private temp dir that has since been deleted.

---

## 3. Replit change / debris audit (focus: SAM session 2026-09-30 ~21:00–22:13 UTC)

Cmds run: `git status --short`, `git diff --stat HEAD` (empty; no tracked modifications), `git log`, `git show --stat` on the last 11 commits, `ls -la --time-style`, `du`, `find -size +20M`.

| Item | Evidence | Classification |
|---|---|---|
| `pyproject.toml`: torch 2.14.1, torchvision 0.29.1, segment-anything 1.0, opencv-headless, pillow; pytorch-cpu index | created in `61701de` (opencv only), SAM deps added in `c489e3d` | **REVERT** to pre-`61701de` (file did not exist) or reduce to opencv only if experiments continue |
| `uv.lock` (+362/−143 lines in `c489e3d`) | tracked | **REVERT** with pyproject |
| `.pythonlibs/` 1.1 GB (torch 418 MB `.so`, cv2 70 MB) | mtime 21:07 | **REMOVE** (gitignored at `.gitignore:8`) |
| `.cache/uv/` 1.0 GB (duplicate torch/cv2 wheels) | `XDG_CACHE_HOME=/home/runner/workspace/.cache` | **REMOVE** |
| `.local/strong-card-model/sam_vit_b_01ec64.pth` 358 MB (Apache-2.0 weights) | mtime 21:09 | **REMOVE** |
| `.gitignore` additions (`.pythonlibs/`, `__pycache__/`, `*.py[cod]`, `.local/strong-card-model/`, …) | diff shown in `c489e3d`/`61701de` | **KEEP** (harmless, protective) |
| `scripts/dev-segment-card-detector*`, `dev-strong41-*` | tracked | **REMOVE** from main (keep in git history) |
| `scripts/dev-independent-card-detector*`, `dev-failure12-*` | tracked | REMOVE from main |
| `scripts/dev-{image,bounded,detail,orb,focus,broad,broad-private,dino-failure-audit}*`, `dev-card-normalization*` | tracked | **NEEDS REVIEW** — keep `dev-dino-next-evaluation.mjs` and `dev-broad-private-plan.ts` (the case list) as the eval harness; remove the rest |
| `scripts/dev-lightglue-timing{.ts,-worker.py}`, `attached_assets/dev-lightglue-timing-results.json` (untracked) | mtime 23:31–23:34. The JSON has keys (`warmRangesMs`, `cleanup`, `totalAuthorizedTrialElapsedSeconds`) the script does not write, and the .ts was modified after `completedAt`. | **NEEDS REVIEW** (provenance) |
| `attached_assets/dev-*.{html,json}` reports, `*_PASTED*.txt` prompts | tracked | HARMLESS DEV ARTIFACT (keep as the evidence trail, or move to `docs/experiments/`) |
| `.local/{broad-validation 794 MB, parallel-focus 181 MB, detail-orb 72 MB, bounded-dino 61 MB, detail-experiment 39 MB, image-experiment 29 MB}` | gitignored via `/etc/.gitignore:9 .local/` | **REMOVE** after you decide on retention (contain user-photo derivatives, §5) |
| `.local/scan-review/` 21 MB (60 original user photos + review state) | gitignored | **NEEDS REVIEW** (privacy retention decision) |
| `.local/{independent,strong}-card-detector-ready.json`, `.local/lightglue-timing-*.json` | small | REMOVE |
| `.agents/memory/scan-to-add.md`, `.agents/agent_assets_metadata.toml` | Replit agent memory | HARMLESS |
| `.replit` | only change in window: none to run/build/deploy. `modules` includes `python-3.11` (pre-existing). | HARMLESS; see §4 on deploy Python |
| `replit.nix` | `pkgs.expect` only | HARMLESS |
| `scripts/post-merge.sh` runs `npm install && npm run db:push` | added `dca4905` (2026-07-08), pre-existing | **NEEDS REVIEW** — runs drizzle schema push on every merge (against the workspace DB) |
| `dist/models/…/model_quantized.onnx` 23 MB, `node_modules/@huggingface/transformers/.cache/…` 2×23 MB | build output, `dist` gitignored | KEEP if DINO ships; else REMOVE with the revert |
| Env var names added | `CATALOG_VISUAL_INDEX_ENABLED`, `CATALOG_VISUAL_OFFLINE`, `SCAN_REVIEW_TEST_DIR`, `CATALOG_VISUAL_REAL_TEST` are read by code; **none is set** in the workspace env or `.replit` | HARMLESS |
| Startup hooks | Only `server/index.ts:910-934` (DDL + gated worker) | NEEDS REVIEW (§6) |
| Running processes (`ps aux`) | only the dev server (`tsx server/index.ts`), vite mockup-sandbox, LSPs. **No python/SAM/LightGlue process.** | nothing to kill |

---

## 4. Dependency audit

- **Node production dependencies** (`package.json`) include:
  - `@huggingface/transformers ^4.3.0` (added in `b0b2d3e`), which pulls `onnxruntime-node 1.30.0` and `onnxruntime-web`
  - `sharp ^0.35.3`
  - `tesseract.js ^7.0.0`
  - `openai`
  - ⚠ **These are in the production chain.**
- **Size of the ONNX runtimes in `node_modules`:**
  - linux-x64 CUDA provider `.so`: 259 MB, never used on CPU
  - linux-x64 CPU `.so`: 44 MB
  - darwin, win32 and arm64 binaries: ~150 MB
  - onnxruntime-web wasm: ~53 MB
  - Rough total for the ONNX packages: **~0.6 GB**. Estimated with the find listing in §5; the per-package `du` is UNVERIFIED.
- **Build step:** downloads a 24.5 MB q8 ONNX model plus configs from huggingface.co and runs one inference (`scripts/prepare-catalog-visual-model.ts`).
- **Python: torch, torchvision, segment-anything, opencv.** They are **not** in the Node build (`npm run build` = vite + esbuild + model prep; nothing spawns Python), and nothing under `server/` imports Python.
  - ⚠ **NEEDS REVIEW / UNVERIFIED**: `.replit` `modules` includes `python-3.11`, and `pyproject.toml` + `uv.lock` are tracked. I cannot see whether Replit's autoscale deployment runs a Python dependency install or copies `.pythonlibs` into the image. If it does, add ~1.1 GB (torch CPU) to the deploy image and several seconds to cold start.
- **Runtime memory with DINO in the path:**
  - q8 model session ≈ 25 MB weights plus an ORT arena. Estimated ~150–250 MB RSS; not measured.
  - Reference cache: 77k × 384 × 4 B = **113 MB**, plus JS object overhead (§11 timing).
  - First scan after a cold start also pays model load: 510 ms measured.
- **Licenses:**

| Item | License |
|---|---|
| DINOv2 weights and code (Meta) | Apache-2.0 (Xenova ONNX conversion inherits it) |
| SAM ViT-B weights / segment-anything | Apache-2.0 |
| torch / torchvision | BSD-3 |
| OpenCV 4.5+ | Apache-2.0 |
| LightGlue code | Apache-2.0 |
| ALIKED | BSD-3 (weights downloaded then removed per the run record) |
| onnxruntime | MIT |
| transformers.js | Apache-2.0 |

  License facts are from general knowledge; I did not re-read the license files in this session (**UNVERIFIED in-repo**).

---

## 5. Storage audit

Cmd: `du -sh` per directory, `find . -xdev -type f -size +20M`.

| Path | Size |
|---|---|
| Project total | **7.3 GB** |
| `.local/` | 2.4 GB (`state` 832 MB = Replit agent state, `broad-validation` 794 MB, `strong-card-model` 358 MB, `parallel-focus` 181 MB, …) |
| `node_modules/` | 1.5 GB |
| `.pythonlibs/` | 1.1 GB |
| `.cache/` | 1.0 GB (`uv` 1,001 MB) |
| `.git/` | 918 MB |
| `attached_assets/` | 780 MB |
| `artifacts/` | 244 MB |
| `uploads/` | 181 MB |
| `dist/` | 42 MB (`models` 24 MB) |
| `~/.cache` | 60 KB (caches are redirected into the workspace) |

Files > 20 MB (outside `node_modules`):

| Size | Path | Tracked? |
|---|---|---|
| 418 MB | `.pythonlibs/…/torch/lib/libtorch_cpu.so` and its duplicate in `.cache/uv/…` | no |
| 374 MB | `.git/objects/pack/pack-64c4….pack` | git internals |
| 358 MB | `.local/strong-card-model/sam_vit_b_01ec64.pth` | no |
| 122 MB | `.git/objects/9b/4bc3…` (loose) | git internals |
| 115.5 MB | `attached_assets/Archive_2_1786471367527.zip` (+ LFS copy 115.5 MB) | **yes (LFS)** |
| 90.8 MB | `.local/broad-validation/dev-catalog-snapshot.json` | no |
| 70.5 MB ×2 | `cv2.abi3.so` (.pythonlibs + uv cache) | no |
| 37 MB ×2, 31 MB ×2, 24 MB ×2 | openblas / libtorch_python / numpy openblas (.pythonlibs + uv cache) | no |
| 35.8 MB | `.local/state/replit/log-query.db` | no |
| 29.8 MB | `attached_assets/New Folder With Items_1752688506202.zip` | **yes** |
| 27.0 / 24.1 / 24.0 MB | `public/uploads/{new_cards_import,card_images_import,cards_import}.csv` | **yes — and under `public/`, so likely served statically. NEEDS REVIEW (not scan-related).** |
| 24–27 MB ×6 | `attached_assets/Marvel_Cards_*.csv`, `./Marvel_Cards_with_Images.csv` | **yes** |
| 26.4 MB | `.local/image-experiment/snapshot.json` | no |
| 23.3 MB | `dist/models/…/model_quantized.onnx` | no (build output) |

`node_modules` > 20 MB: onnxruntime binaries (259 MB CUDA, 44 MB, 42.5 ×2, 28, 27, 27, 25.6, 24 MB) and the transformers.js model cache (23.3 MB ×2).

**User photos and derivatives.** Counts only; I did not open or display any of them. Counts are image files; some are catalog references rather than user-derived.

| Location | Count |
|---|---|
| `.local/scan-review/originals/` | **60 original user scan photos** (+ `review.html` 13.6 MB embedding the dataset) |
| `.local/image-experiment/` | 38 images (normalized/outline derivatives) |
| `.local/bounded-dino/` | 11 contact sheets + 114 reference images (`refs/*.image`, catalog) |
| `.local/broad-validation/` | 27 jpg/png (e.g. `positive-<scanId>.jpg`) + 2,939 `.image` catalog references |
| `.local/detail-orb/` | 93 (e.g. `<scanId>-orb-crop.jpg`) |
| `.local/detail-experiment/` | 30 |
| `.local/parallel-focus/` | 162 png + 49 `.image` |

- All of `.local/` is gitignored (`/etc/.gitignore:9`), so **none of it is git-tracked**.
- Whether it ships in the deployment snapshot is **UNVERIFIED** (see §4).
- Separately, **every production scan uploads the user's photo to Cloudinary `scan_uploads`** indefinitely (`routes.ts:9019`). That is a retention-policy question, not debris.

---

## 6. Production risk

| Check | Answer | Evidence |
|---|---|---|
| SAM cannot run in prod | **YES, cannot**, from the Node side | No `server/` or `client/` import of any Python or SAM script. `npm run build`/`start` never spawn Python (`package.json` scripts). The deploy-time Python install is UNVERIFIED (§4), but even then nothing invokes it. |
| Eval scripts not reachable via public routes | **YES** | grep of `server/`, `client/src`, `shared/`, `.replit`, `post-merge.sh` finds no reference to `scripts/dev-*` (§2) |
| Experimental routes admin/dev-gated | **YES** | `scanReview.ts:24-30`: `if (process.env.NODE_ENV !== 'development') return 404; if (!req.user?.isAdmin) return 403;`, applied to every scan-review route (`scan-review-routes.ts:333-448`, registered at `routes.ts:2270`). `routes.ts:2258`: `if (!req.user.isAdmin) return 403`. Production start sets `NODE_ENV=production` (`package.json` `start`). Live probes show these routes do not exist in the current deployment. |
| No scheduled job or startup hook triggers indexing | **YES** today. **Conditional** after Publish. | Worker returns immediately unless `CATALOG_VISUAL_INDEX_ENABLED === 'true'` (`catalogVisual.ts:199`). The var is not in the workspace env or `.replit` `[userenv.production]`. Deployment secrets are **UNVERIFIED** (not visible to me). Startup **does run DDL** (`index.ts:910-931`) after Publish. |
| No production user routed through experimental recognition | **YES today** (live build predates `b0b2d3e`, evidence in §0). **NO after next Publish**: `scanService.ts:447-448` calls `queryCatalogByImage` for every scan. | — |
| No read-only extraction code has a write path | **YES** for `scripts/dev-*` (read-only transactions, no write SQL). `catalog-visual-bulk.ts` has `--write` but is host-guarded to helium/localhost (`:36-38`). | — |
| No sensitive user data retained | **NO** | 60 original user photos plus derivatives in `.local/` (§5). The 41/12 case photos were deleted per the run records. The production-export JSONs in `attached_assets/` contain scan IDs and card IDs only (`accountData:false`). I did not grep them for URLs; **UNVERIFIED** that no photo URLs remain. |

**Live risk found: none.** Latent risks, all triggered by Publish:
1. DINO in every scan.
2. Build dependency on HuggingFace.
3. Boot-time DDL.
4. Two sequential GPT calls per scan (latency).
5. Possible Python/`.local` payload in the deploy image.

---

## 7. DINO implementation

| Aspect | Value | Evidence |
|---|---|---|
| Model | `Xenova/dinov2-small` @ `c2bb04a51fab207c420665f1946016107bffc701`; config: 12 layers, hidden 384, patch 14 | `catalogVisualModel.ts:4-5`; `dist/models/.../config.json` |
| Checkpoint | `onnx/model_quantized.onnx` 24,451,943 B | `ls -la dist/models/...` |
| Quantization | **Dynamic int8**: 49 `DynamicQuantizeLinear` + 72 `MatMulInteger` ops; no static `DequantizeLinear`/`QLinearMatMul` | `grep -a -c` on the ONNX file |
| Runtime | transformers.js 4.3.0 → onnxruntime-node 1.30.0, `device:'cpu'`, `dtype:'q8'`, `intraOpNumThreads:2`, `interOpNumThreads:1`; one ONNX call at a time (scheduler, scans before backfill) | `catalogVisualModel.ts:14-41,104-108` |
| Offline mode | `allowRemoteModels=false` when `NODE_ENV=production` or `CATALOG_VISUAL_OFFLINE=true` | `:98-103` |
| Decode | sharp, `limitInputPixels 24M`, **EXIF `.rotate()` applied** ✔ | `:111` |
| Colour | `.removeAlpha().toColourspace('srgb')`, raw RGB (not BGR) ✔ | `:112-113` |
| Resize | `resize(224,224,{fit:'contain', background:'#777777'})`: letterbox, gray pad | `:112` |
| Processor (applied *after* the app's resize) | `BitImageProcessor`: resize shortest_edge **256** (bicubic), **center-crop 224**, rescale 1/255, ImageNet mean/std | `preprocessor_config.json` |
| Token | CLS (`output.data.slice(0,384)` of `[1,257,384]`) | `:115-117` |
| Dimension / normalization | 384, L2-normalized in JS | `:7,43-49` |
| Similarity | dot product of unit vectors (cosine), clamped | `:51-56` |
| Search | exact brute force, streaming min-heap top-K (K = max(100, 4×limit)), then SQL resolves URL → card IDs | `:58-90`; `catalogVisual.ts:104-116` |
| Index storage | Postgres `catalog_visual_references` (key = sha256(model_version+url), `embedding jsonb`); in-process cache of `Float32Array`s, **60 s TTL** | `catalogVisual.ts:23-27,59-84`; `index.ts:916-927` |
| Batch vs single | Only single-image inference exists; `embedCatalogVisualImages` loops single calls ("q8 inference MUST remain single-image") | `catalogVisualModel.ts:121-129` |
| Dedupe | identical image bytes (sha256 digest) reuse one embedding | `catalogVisual.ts:153-156` |

**Correctness concerns:**

1. **The double resize crops the card (verified).**
   - Probe: a 224×224 input with a red band in rows 0–9 comes out with rows 0, 12 and 20 all gray (`R=0.467`). Cmd: scratchpad `proc-check.mjs`.
   - Effect: the processor upscales 224→256 and center-crops 224, removing 16/256 = **6.25% from each edge**.
   - For a portrait card letterboxed to 224 high, that removes about 6% of card height at the top and at the bottom: the name bar and set logo zones. Horizontally only gray padding is lost.
   - Fix (not applied): set the processor's `do_resize=false, do_center_crop=false` (or feed 224 directly to the model tensor). Or letterbox at 256 and let the processor crop only padding. Either way, **re-embed all references** (the `MODEL_VERSION` string must change).
2. **Letterbox padding takes about 29% of pixels** on a portrait card (160×224 content in 224×224). It is harmless for consistency but wastes resolution. A near-card-aspect input (e.g. 224×308 with interpolated position embeddings, which DINOv2 supports) is worth testing later, not now.
3. **Preprocessing matters a lot.**
   - Feeding the raw image to the processor (no letterbox) instead of the production path changes the embeddings to cos **0.70–0.93**.
   - So any change must re-index everything. Mixing versions silently breaks retrieval, which `MODEL_VERSION` guards against (`catalogVisualModel.ts:6`).
4. **Cache refresh cost at scale.**
   - `loadCache` re-reads and JSON-parses every embedding every 60 s: 77k rows in pages of 500, each with an `EXISTS` join.
   - It then runs a count query with `ANY($1::text[])` of 77k URLs (`catalogVisual.ts:59-84`).
   - At full scale that is a multi-second stall for whichever scan triggers the refresh. Estimated, **not measured**.
   - Fix: refresh only on index change (version counter), and store vectors as `bytea`/`real[]` or a single binary snapshot.
5. **Placeholder images are eligible.** `ELIGIBLE` (`catalogVisual.ts:19-22`) accepts `card-placeholder_ysozlo.png`, used by 3,313 cards.
   - If indexed, a query near it maps to 3,313 card IDs and floods the top 20.
   - It is not currently in the dev index (SQL: 0 rows). The server's `usableImageUrl` filters placeholders only for GPT verification (`scanService.ts:245`), not for the index.
6. **Candidate→card resolution LIMIT.** The `LIMIT 10000` at `catalogVisual.ts:112` combined with the placeholder would pull 3,313 rows into every such query.
7. **Upstream client/server preprocessing before DINO.** `scanCard` feeds DINO the *OCR-enhanced* buffer: `normalize().sharpen()`, JPEG q90, resized to 1200–2400 px (`scanService.ts:102,448`).
   - Catalog references are embedded without normalize/sharpen.
   - This is a **query/reference preprocessing mismatch** (contrast stretch + sharpen on the query only).
   - Fix: feed DINO the EXIF-rotated original, not the OCR-enhanced buffer. The effect size is **UNVERIFIED**.

---

## 8. DINO determinism test (run in this session)

- **Setup:** 32 catalog reference images (`.local/bounded-dino/refs`, catalog, not user photos), the bundled offline q8 model, and the exact production preprocessing. Script: scratchpad `dino-determinism.mjs`.
- **Runtime:** 25.5 s total. Machine: 4 vCPU, 8 GB RAM.

| Test | min cos vs individual | mean |
|---|---|---|
| Individual, 3 repeats | **1.0000000** | 1.0 |
| Batch 2, two position orders | 0.9762 | 0.9894 |
| Batch 4 | 0.9749 | 0.9875 |
| Batch 8 | 0.9755 | 0.9855 |
| Batch 16 | **0.9663** | 0.9829 |
| Batch of 4 **identical copies** of one image | **1.000000** ×4 | — |
| Image paired with a flat gray image | 0.99533 | — |

Single-image latency (warm, 2 threads): **p50 66 ms, p90 83 ms, max 102 ms**. Model load: 510 ms.

**Cause isolated:**
- Padding and attention masks are ruled out: every input is exactly 224×224, `pixel_values` = `[B,3,224,224]`, and ViT uses no mask here.
- Thread nondeterminism is ruled out: repeats are bit-identical.
- Differing preprocessing is ruled out: the same tensors are used.
- An identical-copy batch is exact, while a mixed-content batch drifts. So the int8 activation scale/zero-point that each `DynamicQuantizeLinear` computes over the **whole batch tensor** depends on the other images in the batch.

**Fix (not applied):** keep single-image inference, which production already does (`catalogVisualModel.ts:121-129`). Alternatives:
- the fp32 or fp16 ONNX export (deterministic in batch; ~88 MB fp32; ~2–3× slower on CPU; UNVERIFIED on this box)
- a static per-channel quantized export

**Production impact: none**, since index and query both use the single-image path.

---

## 9. Catalog quality (dev DB `helium/heliumdb`, read-only)

The production catalog (Neon) was **not queried**, so counts may differ in production (UNVERIFIED).

| Metric | Count | % |
|---|---|---|
| All `cards` rows | 217,464 | — |
| Active catalog (card + set + main set not archived/inactive) | 207,432 | 100% |
| Active with **no front image URL** | **125,996** | **60.7%** of active |
| Visual-eligible (active + http URL, not Drive) | 81,436 | 39.3% of active |
| Distinct URLs among visual-eligible | 76,999 | — (this is the "~77k") |
| Cards on the shared **placeholder** `card-placeholder_ysozlo.png` | **3,313** | 4.1% of eligible |
| Other URLs shared by >1 eligible card | 1,065 URLs ×2 cards, 20 URLs ×4 cards (2,210 cards) | 2.7% |
| Image host | 100% `res.cloudinary.com` | — |
| front URL == back URL | 0 | — |
| Exact dup (same set_id + number + name) | 0 | — |
| **Duplicate set records** (same year + subset name ignoring a trailing "Base" + number + name, different set_id); heuristic lower bound, e.g. 20279 (set 7292 "…Base") vs 530526 (set 12179) — both active, different URLs | 150 groups / 300 cards | 0.4% |
| **Parallel families** (same main set + number + name across >1 subset) | 12,821 families / **61,727 cards** | **75.8%** of eligible |
| …families where every parallel uses the **same URL** (indistinguishable by image) | 570 / 1,923 cards | 2.4% |
| Archived cards sharing a URL with an active card | 1,510 | (excluded by ELIGIBLE ✔) |
| Card-back flag | **none exists** in schema. Heuristic `name ~ back|checklist` = 335 (these are checklist *cards*, not back images). Known instance of a back stored as front: scan 3035 (`dev-bounded-verify.ts:9`). Systematic count UNVERIFIED. | — |
| Dev visual index | 958 `ready` refs (2026-09-29 18:17–18:22), 1.2% of eligible | — |
| Dev scan tables | `scan_uploads` 0, `scan_feedback` 0, `user_scan_logs` 57 | — |

**How much of the observed failure is data-related?**
- Of the 12 Top-1 misses on the 41-case set:
  - 2 are "same artwork", and the catalog relationships file tags them as apparent duplicate base records.
  - 1 case (scan 2939 → card 533958) has no positive reference.
- So **≈ 3/41 (7 pp) is data**, not model.
- More broadly, any user card in the 61% of active rows without an image **cannot** be found visually. Text fallback is the only path for those.

---

## 10. Technical assessment: why ~70% Top-1

Measured on 41 real photos: Top-1 29, Top-3 32, Top-10 35. The 12 Top-1 misses are 6 inside the top 10 and 6 outside (`dev-failure12-executed-results.json` raw 0/3/6).

| Bucket | Misses | What could recover it |
|---|---|---|
| **Query: hand/background/obstruction** (card fills part of the frame, binder neighbours) | 7 | **Capture-side isolation**: native rectangle detection, framing guide, and the manual `CardCrop` that already exists but is unpublished. The 41 photos were taken on the live UI, which has no crop step (§0). Multi-crop TTA may recover some cheaply. Server-side segmentation was tried and failed (SAM 5/41, 35 s; quad 0/12). |
| **Query: glare** | 3 | Capture guidance (tilt, glare warning at capture time, not after upload). Local feature verification is partially robust. TTA is unlikely to help. |
| **Data: same art / duplicate records** | 2 | Catalog dedupe or family grouping. Counted as *family-correct*, these are not real errors. Geometry cannot separate identical art. |
| Missing reference | (1, inside the above) | Data fix |
| **Model limit** ("genuinely poor visual retrieval") | **0** of 12 per the visual review | — |

Implications:
- **Rerankers are capped by the top 10.** Any stage-2 reranker (custom, LightGlue, OCR) can gain at most **+6** (→ 35/41 = 85%). The measured custom reranker lost 1.
- **Top-10 is the real lever.** Lifting top-10 needs better query images, which means capture-side work.
- **DINOv2-small is not shown to be the bottleneck.** The review attributed 0/12 misses to the model. Moving to DINOv2-base (768-D, ~3–4× compute) or SigLIP 2 addresses none of the 10 query-side misses directly. **Do not model-shop** until capture is fixed and the result is re-measured.
- **Parallels are the next wall.** 76% of image-bearing cards sit in parallel families, and foil/colour parallels often share artwork. Global embeddings will find the *family* reliably before they find the *parallel*, so evaluate them separately.

---

## 11. Recommended architecture

**Choice: E. Capture-side card isolation, then global retrieval, then family-level result with parallel disambiguation. Local geometric verification (B) stays an optional, margin-triggered stage-2, deferred until measured at reduced settings.**

Why not the others, against our numbers:

- **A alone** (global only) is what gives 70.7%. It is necessary but insufficient without better query images.
- **B** (ALIKED+LightGlue+MAGSAC):
  - Measured at **6.29 s per query** for the top 10 on this CPU (2.9 s query features at 1024 px/1024 kp, 327 ms per pair).
  - That is 3–6× over budget, and it can only recover ≤6/41.
  - At 512 px / 512 kp with precomputed reference features on the top 5, I estimate ~0.8–1.3 s (quadratic attention). That is **UNMEASURED**.
  - Worth one bounded measurement *after* capture is fixed, only as a margin-triggered tie-breaker.
- **C** (OCR/metadata rerank):
  - The current pipeline already runs GPT-4o-mini OCR for every scan (10 s timeout) plus a second GPT call.
  - History item 1 says OCR shortlists were unreliable (UNVERIFIED as a number).
  - Useful for **parallel/serial/number disambiguation inside a family**, not for retrieval.
- **D** (B + OCR) combines two expensive stages. Keep OCR as a tie-break only (below).

### 11.1 Capture (Capacitor, native)

- **iOS:** `VNDetectRectanglesRequest` (aspect 0.6–0.8, min size ~0.2, choose the rectangle nearest the frame centre) plus a perspective correction via `CIPerspectiveCorrection`. Or VisionKit `VNDocumentCameraViewController` for a zero-code auto-crop. Note: **no `ios/` project exists yet.**
- **Android:** ML Kit Document Scanner (`play-services-mlkit-document-scanner`, on-device, returns a cropped/deskewed JPEG, no camera permission needed). Or CameraX + ML Kit object detection.
- **UI:** a framing-guide overlay (card-shaped cutout) plus live glare hints. Fall back to the existing `CardCrop.tsx` manual crop on the web and whenever detection fails.
- **Cost and latency:** tens of ms on-device, zero server cost.
- **Caveat from our own data:** a classical quad detector abstained 12/12 on hard photos. The framing guide (the user centres one card) is what makes rectangle picking reliable in binders. Treat detection as *assist*, never block capture.
- **Upload:** a ≤1024 px JPEG (~150–300 KB) instead of full-resolution photos.

### 11.2 Server

1. Decode and EXIF-rotate the **original** upload for DINO, not the OCR-sharpened buffer (§7.7).
2. **DINO-small single-image**, with the processor crop fixed (§7.1), and **multi-crop TTA**: full image plus centre crops at 0.85 and 0.7, taking the max per reference. That is 3 × ~66 ms ≈ 200 ms of CPU. Re-index once.
3. **Exact in-memory brute force.** Measured on this machine with synthetic unit vectors:

| Scale | Time |
|---|---|
| 77k × 384 (production `visualTopK`) | **41 ms p50, 45 ms max** |
| 77k × 384 (flat array) | 45 ms p50 |
| 217k × 384 | 132 ms |
| 77k × 768 | 90 ms |
| 217k × 768 | 229 ms |

   → **No pgvector, HNSW or FAISS needed.** Store vectors compactly (see §7.4) and load them once per process.
4. **Group candidates by family** (main set + number + name; plus duplicate-set aliases).
5. **Tie-break only when needed.** When the top family is clear but several parallels remain, use OCR/serial/back-photo evidence (the existing GPT-4o-mini call, or run OCR only for this tier). Drop the second sequential GPT "artwork verification" call from the critical path.

### 11.3 Confidence tiers (collector always confirms)

Thresholds to be set on held-out data. Not tuned here.

| Tier | Rule (initial, to calibrate) | UI |
|---|---|---|
| High | top family cosine ≥ τ₁ and family margin ≥ δ₁, and a single parallel (or parallel resolved by OCR/serial) | Show 1 card, "Is this your card?" |
| Medium | top-3 families within δ₁ | Show 2–3 candidates |
| Low | top cosine < τ₂ | Show a short list (≤8) plus a "Retake photo" tip (glare/framing) |
| Parallel-uncertain | family clear, ≥2 parallels plausible (incl. the 570 same-URL families) | Show the family plus "Which version do you have?" parallel chooser; offer a back photo |

### 11.4 End-to-end latency budget (target ≤ 1.5 s server)

| Stage | Budget | Basis |
|---|---|---|
| On-device detect + crop + encode | 30–80 ms | estimate |
| Upload 150–300 KB | 200–600 ms | network, estimate |
| Decode/EXIF/resize | 20–40 ms | estimate |
| DINO ×3 (TTA) | ~200 ms | measured 66 ms p50 single |
| Search 77k | ~45 ms | measured |
| DB resolve candidates + family grouping | 20–50 ms | estimate |
| Optional OCR tie-break (parallel tier only) | 1.5–4 s, **async/secondary** | GPT-4o-mini latency UNVERIFIED |
| Optional local verification top-5 (margin-triggered) | ≤ 1 s | **UNMEASURED** at reduced settings |
| **Server total, common path** | **~0.3–0.4 s** | — |

For comparison, the current `main` pipeline is GPT OCR (≤10 s) in parallel with DINO, then a sequential GPT verification (≤8 s). Worst case is ~18 s, and typical latency is UNVERIFIED because `timings` are returned but not persisted (`routes.ts:9034-9048` stores no timings).

---

## 12. Next experiment (exactly one)

**"Query-side fix: preprocessing correction + multi-crop TTA" on the existing 41-case set.**

- **Tests:** whether fixing the processor crop (§7.1), removing the query-only normalize/sharpen (§7.7), and 3-crop TTA lift Top-1/Top-10 without new models. This is the cheapest possible improvement and requires no installs.
- **Why this one:** the 7 hand/background misses are the largest bucket. TTA is the only zero-infrastructure lever against them before native capture work. The preprocessing fixes must happen before any re-index anyway.
- **Data:**
  - The frozen 41 verified cases (`scripts/dev-broad-private-plan.ts:15`). **Not** the 9-card sample (disjoint, verified).
  - The index is rebuilt with the frozen plan rules over the retained 2,938-card set (`.local/broad-validation`) plus the plan's positives and hard negatives.
  - **Blocker for you:** the 41 query photos were deleted after the earlier runs (§2). Running this needs one more read-only export (`scan_id, image_url, confirmed_card_id`) with your authorization, the same as before.
- **Arms:**
  - (0) current production preprocessing (baseline, must reproduce 29/32/35)
  - (1) processor crop fix
  - (2) (1) + un-sharpened query
  - (3) (2) + TTA
- **Runtime:**
  - Index ≈ 3,045 refs × 66 ms × 2 preprocessing variants ≈ 7 min.
  - Queries 41 × 4 arms × ≤3 crops ≈ 1 min.
  - Reference image downloads ≈ 5 min.
  - **Total < 20 min on CPU.**
- **Cost:** $0 (no API calls). **Installs:** none.
- **PASS** (all required):
  - Arm 0 reproduces 29/32/35 (±1).
  - The best arm reaches **Top-1 ≥ 32/41 and Top-10 ≥ 36/41**.
  - No more than 1 case regresses from correct to incorrect at Top-1.
  - Server p95 per query ≤ 400 ms (embed + search).
- **FAIL:** Top-1 ≤ 30/41 or Top-10 ≤ 35/41 for every arm. That means query-side preprocessing is exhausted and the next investment is native capture, not server tricks.
- Report family-level Top-1 (counting 20279/530526-type duplicates as correct) alongside exact Top-1.

---

## 13. Cleanup plan (NOT executed; ordered from lowest to highest risk)

Take a snapshot first: `git tag audit-2026-09-30 c84eb64` (local tag only). Replit checkpoints can also restore the workspace.

1. **Zero-risk disk reclaim** (gitignored, not referenced by code):
   ```sh
   rm -rf .cache/uv                                  # 1.0 GB wheel cache
   rm -rf .local/strong-card-model                   # 358 MB SAM weights
   rm -f  .local/{independent,strong}-card-detector-ready.json .local/lightglue-timing-*.json
   ```
2. **Python environment** (only if no further Python experiments are approved):
   ```sh
   rm -rf .pythonlibs                                # 1.1 GB torch/cv2/SAM
   git rm pyproject.toml uv.lock                     # created by 61701de/c489e3d; no pre-existing version
   ```
   Keep `python-3.11` in `.replit` `modules`; it is pre-existing.
3. **Experiment data holding user-photo derivatives** (after you decide on retention):
   ```sh
   rm -rf .local/{broad-validation,parallel-focus,detail-orb,bounded-dino,detail-experiment,image-experiment}
   ```
4. **Experiment scripts on main** (history keeps them):
   ```sh
   git rm scripts/dev-segment-card-detector* scripts/dev-strong41-* scripts/dev-independent-card-detector* \
          scripts/dev-failure12-* scripts/dev-orb-* scripts/dev-detail-* scripts/dev-focus-* \
          scripts/dev-image-experiment* scripts/dev-card-normalization* scripts/dev-bounded-* scripts/dev-broad-orb.py \
          scripts/dev-broad-private-orb.py
   rm scripts/dev-lightglue-timing.ts scripts/dev-lightglue-timing-worker.py   # untracked
   ```
   Keep `dev-dino-next-evaluation.mjs` and `dev-broad-private-plan.ts` as the eval harness. Optionally move `attached_assets/dev-*` reports to `docs/experiments/`.
5. **`.local/scan-review/` (60 user photos):** your privacy decision. Delete, or keep only while the dev review tool is in use.
6. **Highest risk: production code on `main`.** Choose one:
   - **(a) Hold DINO out of production.** Before any Publish, gate `queryCatalogByImage` behind a `SCAN_VISUAL_RETRIEVAL_ENABLED` env flag (default off) in `scanService.ts:447`. Make the model prep non-fatal or skipped when the flag is off (`package.json` build). Move the `index.ts:910-931` DDL into the normal migration process.
   - **(b) Revert** `@huggingface/transformers`, `scripts/prepare-catalog-visual-model.ts` and the `scanService` visual branch to the pre-`b0b2d3e` state (`git revert` of the relevant hunks, not a reset).

   (a) is recommended: it keeps the work and makes Publish safe.

**Rollback:** steps 1–3 are regenerable (the uv cache and pythonlibs reinstall via `uv sync`; SAM weights via `scripts/dev-segment-card-detector-download.py`). User-photo deletions are not recoverable, which is intended. Git steps are reversible with `git revert` or the tag.

---

## 14. Confirmations

- **Nothing published or deployed.** I only sent read-only GETs to the public site: `/`, two asset JS files, and three API paths without credentials.
- **No production data or code changed.** No tracked file was modified (`git diff --stat HEAD` is empty). The only new file is this report, `docs/scan-audit.md`, which is not committed.
- **No DB writes.** Every query ran against the **dev** DB (`helium/heliumdb`) with `default_transaction_read_only=on`. The Neon/production DB was **not** queried.
- **No files deleted or moved.** Scratch scripts and the live JS downloads are in the session scratchpad only.
- **No packages installed and no models downloaded.** Tests used the already-bundled `dist/models` ONNX offline.
- **No long experiment launched.** Two bounded runs: the determinism test (25.5 s) and the brute-force timing (<1 min).
- **No git add, commit, reset, checkout or clean. No processes killed. No indexing started.**
