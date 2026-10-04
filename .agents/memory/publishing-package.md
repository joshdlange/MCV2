---
name: Publishing package boundaries
description: Image-size failures, preserving dev evidence, and production dependency checks.
---

Do not treat `.gitignore` or `.replit`'s `hidden` setting as a reliable publishing exclusion.

**Why:** Publishing exceeded the 8 GiB image limit even though the large development data folders were gitignored. `hidden` only changes the editor's file tree.

**How to apply:** Use an explicit runtime allowlist in the isolated publishing build, never prune or move the user's original dev evidence. Report measured application bytes separately from the total platform image, which also contains system layers.

Do not identify publishing builds by workspace path or presence of `REPLIT_DEV_DOMAIN`.

**Why:** The actual publishing build exposed that variable and used the same workspace path, causing a false refusal before packaging.

**How to apply:** Require an explicit signal passed inline only by the deployment build command. Do not persist it in shared environment settings. Treat other platform markers as diagnostic unless directly verified in build logs.

Production dependency pruning must be checked against the compiled server, not just the source imports.

**Why:** Bundling a dynamic local Vite-config import hoists its static plugin imports into the server entry point, so simply making the config import dynamic still leaves production dependent on devDependencies.

**How to apply:** Keep development-only config imports opaque to the production bundler and validate the resulting entry-point dependencies after pruning.

Preserve Replit's toolchain metadata when excluding application caches.

**Why:** A publish passed Build and Bundle, then failed before Node started with `exec: "npm": executable file not found in $PATH`. The application allowlist had removed `.cache/replit` along with ordinary caches. A successful build-time inference check did not test the hosting runtime's command resolution.

**How to apply:** Retain the platform metadata, not the entire model/cache tree. Rehearse the exact run command after production dependency pruning in an isolated payload. A local rehearsal still cannot prove the hosting container's PATH; verify the next Promote result.

Production-mode rehearsals must not use the live database or identities.

**Why:** The user describes MCV as a live app with approximately 2,000 users and requires preserving its established behavior. Production startup runs migrations, recovery, and background work, so simply starting a second server against existing credentials is not a harmless test.

**How to apply:** Use a temporary catalog-only database and isolated external-service fixtures. Distinguish real inference from fixture authentication, and wait for both startup readiness and the data-update write gate before measuring scans.