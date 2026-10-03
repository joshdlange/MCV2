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