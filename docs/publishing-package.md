# Publishing package

The failed publishing log reported `image size is over the limit of 8 GiB: total size of layers exceeds limit`, after the app build and offline scanner checks passed. It did not expose the exact total layer size.

Publishing runs `env PUBLISH_BUILD=1 node scripts/publish-package.mjs --publish` in Replit's isolated build copy. Normal workspace builds still use `npm run build`. The run command remains `npm run start`.

The publishing command:
1. Refuses cleanup unless `PUBLISH_BUILD` is exactly `1`, set inline by the deployment command only. The publishing build also exposes `REPLIT_DEV_DOMAIN`, so it cannot distinguish the workspace from the build. Other platform flags are reported as non-secret booleans for diagnosis, not assumed as prerequisites.
2. Builds the app and verifies the packaged scanner checksums/inference.
3. Removes npm development dependencies from the publishing copy.
4. Keeps only built output, production dependencies, package metadata, the production scan index, and the small runtime data dependencies listed in the script. Existing `/uploads` assets are retained because the app still serves them.
5. Checks production import resolution, the built homepage, offline DINO inference, frozen vectors, avatar files, and the reviewed-image list after cleanup.
6. Prints the remaining application-file size. Platform/Nix layers are additional and their exact total is only available from the next publishing attempt.

Everything else, including `.local`, `.pythonlibs`, `.cache`, `.config`, `.git`, attached source assets, experiment results, and test photos, is excluded from that copy. The duplicate source model is removed; the checked runtime copy remains under `dist/models`.

To inspect without changing anything: `node scripts/publish-package.mjs`.
Never set `PUBLISH_BUILD=1` in workspace secrets, shared environment settings, or a local shell to run cleanup. It is explicit authorization for the isolated deployment command, not proof of isolation on its own.

Copying into `.deploy` and changing the run directory alone would leave the original files in the Autoscale snapshot and would not resolve the image-size failure. Cleanup is therefore limited to the explicitly authorized publishing copy.

The source workspace data is neither deleted nor moved. A full copied rehearsal was blocked by the workspace filesystem quota, so the reported pre-publish size is the measured allowlist minus npm's inventoried dev-only dependency files, not a claimed final platform image size.