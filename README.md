# SHOE ZAP official catalog jobs

Additional brands use `scripts/brands-sync.mjs`: Brooks, Saucony and Salomon start from the public official running collections and match exact style/color codes to Rakuten merchants. ASICS, New Balance and PUMA collect every page of their official Rakuten shops' running search and exclude clothing, children and accessories. ASICS listing-level codes are retained as listing-level records, without inventing color codes. Mizuno, HOKA and On are pending; the site keeps their acquisition findings separately. The existing daily 06:17 Japan schedule now covers these catalogs and merchant matching. API credentials stay in the site; jobs use the existing `NIKE_SYNC_KEY`. Incomplete collections and failed merchant checks preserve previous successful data. `--catalog-only`, `--market-only`, and `--brand=<id>` support independent diagnosis. A `--limit` is diagnostic only and is never used by the schedule.

Pure Node.js (no AI, no paid API). Each run starts from the current men's and women's Nike Japan running category pages, follows their pagination, and sends a whitelisted snapshot to SHOE ZAP's authenticated writer. Nike By You is excluded. Size-specific stock is not collected.

The site persists a baseline and subsequent differences in D1. Incomplete or failed collection leaves the previous catalog intact. A disappearance is recorded, never treated as proof of discontinuation. Model grouping normalizes Nike/ナイキ and uses audience, official model name, and width; successor relationships are not inferred.

Schedule: daily 21:17 UTC / 06:17 Asia/Tokyo. GitHub may delay scheduled runs. `workflow_dispatch` is available for verification. Actions use only standard public-repository runners, which do not consume the account's private-repository included minutes; this job does not raise spending limits. Failures appear in Actions and on the site's last-check history once the writer can be reached.

Secret: `NIKE_SYNC_KEY` (repository Actions secret, same value in the site's runtime secret). Never put it in source, artifacts, logs, or command arguments. No shopping API keys are copied here.

Manual: Node 22+, `node --test server/nike-catalog.test.mjs`, then `NIKE_SYNC_URL` and `NIKE_SYNC_KEY` in process environment and `node scripts/nike-sync.mjs --upload`. A dry run without `--upload` prints counts only.

Site: https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site/nike

When editing collection logic, synchronize `scripts/nike-sync.mjs` and `server/nike-catalog*.mjs` from the site source repository and run its tests. The endpoint module is included only for the authorization unit test. The job itself never writes SQL or republishes the site.

## Adidas official Rakuten shop

The second independent job uses `scripts/adidas-sync.mjs` and the site's protected `/api/adidas/source-page` bridge. Rakuten application credentials remain exclusively in the site's runtime secrets. The public job receives only the existing catalog writer key, fetches all pages with 1.4-second gaps and bounded backoff, and submits a normalized snapshot to `/api/adidas/sync`. No shopping API key or raw product caption is printed in logs or stored in this repository.

Only adult running footwear identifiable by explicit official shop fields is included. Size tags in descriptions never imply size-level stock. Model grouping normalizes spelling while keeping generation and edition names distinct. The page identifies the source as Adidas's official Rakuten shop, whose inventory is different from adidas.jp.

Validate with `node --test server/adidas-catalog.test.mjs`. Localhost-only preview seeds and the dated official-site comparison are not part of this recurring job.

## Nike catalog → Rakuten merchants

After the Nike catalog job succeeds, `nike_market` searches every current Nike article through a protected fixed-query server bridge. All Rakuten shops are eligible; each query is `NIKE <article>` with used listings excluded, ordered by item price, with a maximum of five pages / 150 candidates. The matcher requires a full style/color code in the item title or an explicit product-code field, rejects conflicting gender, children, accessories and used titles, and never infers size stock from a mention in text. Listings with no title gender use the official style code's audience and disclose that basis.

Each article result is persisted independently. Failed checks retain the previous result. Browser requests read saved records without shopping API calls. A result is a merchant page candidate, not a guarantee of authenticity, the lowest total price, or availability/price for a specific size or color. Multi-color pages and API price ranges are identified. Rakuten credentials remain only in the site's runtime secrets. The scheduled workflow always scans all current articles; a local `--articles=AA1234,BB5678` argument is diagnostic only.

A single explicit cm size in the item title may be retained as `listedSize` metadata, but the site now intentionally ignores size when reading stock and prices. All saved available listings for the exact style/color are returned. The combined Nike/adidas site draws one style/color at a time with swipe/arrow navigation, without brand tabs or size/color selectors. Item-level availability never sets `sizeVerified` to true.

Equal-price listings can move across search pages. Item IDs are deduplicated; coverage counts unique fetched listings and does not claim complete coverage when items are missed. Manual dispatch can set `retry_failed=true` to retry only failed or unchecked articles, without refreshing successful articles again. Scheduled runs always check all articles.
