# SHOE ZAP Nike catalog job

Pure Node.js (no AI, no paid API). Each run starts from the current men's and women's Nike Japan running category pages, follows their pagination, and sends a whitelisted snapshot to SHOE ZAP's authenticated writer. Nike By You is excluded. Size-specific stock is not collected.

The site persists a baseline and subsequent differences in D1. Incomplete or failed collection leaves the previous catalog intact. A disappearance is recorded, never treated as proof of discontinuation. Model grouping normalizes Nike/ナイキ and uses audience, official model name, and width; successor relationships are not inferred.

Schedule: daily 21:17 UTC / 06:17 Asia/Tokyo. GitHub may delay scheduled runs. `workflow_dispatch` is available for verification. Actions use only standard public-repository runners, which do not consume the account's private-repository included minutes; this job does not raise spending limits. Failures appear in Actions and on the site's last-check history once the writer can be reached.

Secret: `NIKE_SYNC_KEY` (repository Actions secret, same value in the site's runtime secret). Never put it in source, artifacts, logs, or command arguments. No shopping API keys are copied here.

Manual: Node 22+, `node --test server/nike-catalog.test.mjs`, then `NIKE_SYNC_URL` and `NIKE_SYNC_KEY` in process environment and `node scripts/nike-sync.mjs --upload`. A dry run without `--upload` prints counts only.

Site: https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site/nike

When editing collection logic, synchronize `scripts/nike-sync.mjs` and `server/nike-catalog*.mjs` from the site source repository and run its tests. The endpoint module is included only for the authorization unit test. The job itself never writes SQL or republishes the site.
