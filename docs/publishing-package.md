# Publishing package

The failed publishing log reported `image size is over the limit of 8 GiB: total size of layers exceeds limit`, after the app build and offline scanner checks passed. It did not expose the exact total layer size.

Publishing now runs `node scripts/publish-package.mjs --publish` in Replit's isolated build copy. Normal workspace builds still use `npm run build`.

The publishing command:
1. Refuses to run when `REPLIT_DEV_DOMAIN` identifies the development workspace.
2. Builds the app and verifies the packaged scanner checksums/inference.
3. Removes npm development dependencies from the publishing copy.
4. Keeps only built output, production dependencies, package metadata, the production scan index, and the small runtime data dependencies listed in the script. Existing `/uploads` assets are retained because the app still serves them.
5. Checks production import resolution, the built homepage, offline DINO inference, frozen vectors, avatar files, and the reviewed-image list after cleanup.
6. Prints the remaining application-file size. Platform/Nix layers are additional and their exact total is only available from the next publishing attempt.

Everything else, including `.local`, `.pythonlibs`, `.cache`, `.config`, `.git`, attached source assets, experiment results, and test photos, is excluded from that copy. The duplicate source model is removed; the checked runtime copy remains under `dist/models`.

To inspect without changing anything: `node scripts/publish-package.mjs`.
Never unset the workspace guard to run the publishing command in development.

The source workspace data is neither deleted nor moved. A full copied rehearsal was blocked by the workspace filesystem quota, so the reported pre-publish size is the measured allowlist minus npm's inventoried dev-only dependency files, not a claimed final platform image size.