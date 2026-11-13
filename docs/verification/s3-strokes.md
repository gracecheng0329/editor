# S3 freehand strokes and whole-stroke eraser (#8)

## Scope and public contract

The formal document canvas uses tldraw's built-in `draw` shape and `eraser` tool. Stroke records remain in the existing tldraw sync schema and Durable Object room; there is no second canvas writer, custom stroke protocol, pressure brush, pixel eraser, or stroke splitting.

Editors can choose any default tldraw color and one of four thicknesses before drawing. The object list exposes strokes for keyboard selection, color, thickness, position, and bounds. The existing object inspector moves, scales, and deletes a selected stroke through the public editor API. The built-in eraser removes each touched shape as a whole. Viewers continue to use the read-only room role; hiding editor tools is not the authorization boundary.

## Test seams

- Formal editor UI in independent owner/editor browser contexts: draw and style distinct strokes, observe remote changes, move/scale/delete one stroke, and erase another by crossing only part of it.
- Authenticated public checkpoint contract: verify saved stroke records and confirmed persistence after page reload and an actual Miniflare/SQLite room restart.
- Viewer synchronization contract: a Playwright-only probe uses the public tldraw store API to submit a valid copied stroke with a unique metadata marker; the real room must reject it and the owner must not see the copy after reload.
- AC-15: the opt-in five-session baseline seeds 300 nodes, 100 connections and 100 strokes, then each session moves one node per second for five minutes. It records resource, browser/runtime/library versions, region/network conditions, timing samples, convergence, persistence, and browser errors.

## Commands

Start the local services and apply the local-only migrations. Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.local-supabase/app.env` into `.env.local` as described in [the local Supabase guide](local-supabase.md). This keeps the app build, test identities, and database on the same local project. Fixtures create random test-only Auth users and documents in this database; no production account or dataset is used.

```sh
node scripts/local-supabase.mjs up
node scripts/migrate-local-supabase.mjs
NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789 node node_modules/next/dist/bin/next build --webpack
S1_CREDENTIALS_FILE=.local-supabase/credentials.json S2_PRODUCTION=1 \
  node node_modules/@playwright/test/cli.js test --config playwright.s3.config.ts tests/s3/smoke.spec.ts
S1_CREDENTIALS_FILE=.local-supabase/credentials.json S2_PRODUCTION=1 \
  node node_modules/@playwright/test/cli.js test --config playwright.s3.config.ts
```

The focused Chrome smoke test creates temporary local Auth identities and a document, draws one stroke, checks the authoritative local SQLite checkpoint, and reloads the document. Run it after the local app build when validating the basic S3 path; the fixtures clean up the test identities and document when finished.

Run the five-minute baseline separately:

```sh
S1_CREDENTIALS_FILE=.local-supabase/credentials.json S2_PRODUCTION=1 S3_LOAD=1 \
  node node_modules/@playwright/test/cli.js test --config playwright.s3.config.ts \
  --grep 'AC-15 S3 baseline'
```

The load test writes a raw report to `/private/tmp/s3-8-load.json`; the verified run is retained in [s3-8-load.json](s3-8-load.json). The report describes only loopback performance and is not a WAN or remote-service SLA.

## Independent demonstration

Start the formal Next app and the real local Worker as described in [the S2 owner guide](s2-owner.md). Open one document in two independent editor sessions.

1. Choose a color and thickness, select **自由手繪工具**, and draw. Repeat from the other session using a different style; both canvases should show each whole stroke and the confirmed-save state.
2. Select a stroke from **畫布筆畫**, edit its position and width, then delete it. The other session should show the same movement, scale, and removal.
3. Draw another stroke, select **整筆橡皮擦工具**, and cross a short section of it. The complete stroke should disappear from both sessions.
4. Wait for confirmed persistence, reopen the document, restart the local test Worker, and reopen again. The confirmed strokes and their styles should remain.

## Local verification (2026-11-13)

Local Supabase, test-generated identities, the production Next app, and the real Miniflare/SQLite sync Worker were used throughout. The S2 revocation/viewer prerequisite passed **4/4 browser tests (3.4m)** with its default 60-second session lease. The S3 functional suite passed **4/4 tests (24.3s)**, covering two-session draw/style sync, whole-stroke move/scale/delete/erase, reload plus actual Worker restart persistence, and server rejection of a viewer's public-store stroke write.

The focused S3 smoke passed **1/1 test (16.8s)** in headed Chrome, covering local authentication, stroke drawing, checkpoint persistence, and reload.

AC-15 passed with **5 sessions, 300 nodes, 100 connections, 100 strokes, and a 300-second operation window**. It recorded 1,500 peer-convergence samples, p95 **153.8 ms**, maximum **784.8 ms**, no cadence/convergence failures, and no browser errors. The run used Node 24.18.0, Chrome 157.0.8103.51, Next 16.4.5, tldraw sync 5.5.2, Apple M5 / 10 cores / 24 GiB RAM. Full details are in [s3-8-load.json](s3-8-load.json).

The first browser run exposed test setup issues (the drag started beneath the component drawer, and Chrome required `local-network-access` for the isolated public-store probe); those were corrected before the passing runs. Local app/Worker TypeScript checks, whole-repository Biome lint, `git diff --check`, and the Next.js 16.4.5 Webpack production build passed. No remote deployment smoke is claimed; this evidence covers local loopback only.
