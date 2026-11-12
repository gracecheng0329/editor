# S2 owner canvas (#24)

Scope: the owner slice of #5. This document records owner-specific behavior. Share-viewer and existing-session revocation behavior is recorded in [S2 existing-session revocation](s2-revocation.md); durable offline reopening remains separate work.

## Public contract

The formal document page uses tldraw sync as its only canvas authority. The Worker resolves the authorized document's room identifier using Supabase Auth and the document table's existing RLS policies, including the live-session predicate. No service-role key or G0 credential is used in the production path. Client and server share architecture-node property validators.

- `GET /api/documents/:id/sync-session`: own authenticated browser session only; returns its access token and display identity with `private, no-store` caching. RLS must authorize that document first.
- Worker `POST /documents/:id/session`: authenticated Supabase access token in the Authorization header. Auth verifies the user and RLS verifies live membership, then Worker signs a room ticket scoped to document, room, user, role, generation and at most 60 seconds. Tickets are obtained again on reconnect. The broad access token is never in the WebSocket URL. Existing-session membership changes are bounded by the lease described in [S2 existing-session revocation](s2-revocation.md).
- Worker WebSocket `/documents/:id?ticket=...`: signature, scope, expiry and generation checked before connecting. The Durable Object closes at ticket expiry and checks expiry on every frame. The room's generation is persisted in DO SQLite and starts at 0; generation switching belongs to S5.
- Worker `POST /documents/:id/checkpoint`: fresh Supabase/RLS authorization on every request. It captures authoritative accepted document records and revision synchronously, waits for DO `storage.sync()`, and then returns that captured snapshot. It does not persist a growing collection of version snapshots; product versions remain S5 work.

The UI automatically requests checkpoints after edits and retries failures. Only a healthy connection plus equality between the current public document records and a flushed authoritative checkpoint permits “已確認持久化”. A later edit immediately invalidates that indication. An older response cannot cover new records. Offline and failure states retain current in-memory edits; retry does not reset the connected editor. Closing/reopening before confirmation is outside this slice's offline guarantee.

Origin checks and no-store responses apply to the credential, checkpoint, authorization failures and WebSocket upgrade. Room credentials and Supabase access tokens must never be logged at a reverse proxy/CDN; Worker observability is disabled in the deployment template. No token is stored in canvas records or DO SQL.

## TDD and local evidence

Pre-agreed seams: formal product UI in real browser contexts; public Worker/API/data boundaries, as recorded by #1/#24. No test asserts SDK private store internals or wire messages and no synchronization result is mocked.

The first owner tracer test failed on the old formal page because the “新增節點” button did not exist (`/private/tmp/s2-24-red.log`, legitimate missing-control run). After the minimal production path was added, integration exposed a real SDK schema error: supplying only the custom shape util to `useSync` omits default arrow migrations required by the default arrow binding. Passing default and custom shape utils together corrected that client/server compatibility issue.

The owner journey now adds, renames, moves and deletes real custom nodes; reopens the formal document; and disposes/recreates the actual Miniflare/workerd runtime against the same SQLite directory. Independent runtime identifiers verify an actual restart. Negative cases directly call the Worker for strangers, share credentials at a write endpoint, forged/cross-document tickets, broad JWT WebSocket query credentials and untrusted origins; the owner opens the formal page afterward to verify no unauthorized records appeared. Save-race verification holds a genuine service checkpoint response, makes another real node edit, releases the old response, injects an HTTP 503 at the checkpoint boundary, then restores the endpoint and retries. The actual sync service continues processing edits throughout. A live-page offline/reconnect test closes the real sockets, preserves a pending node and checks it after reconnect and reopen.

Commands (set `S1_CREDENTIALS_FILE` to the private local credentials JSON if the worktree does not contain it):

```sh
node node_modules/@playwright/test/cli.js test --config playwright.s2.config.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project sync/tsconfig.json
node node_modules/eslint/bin/eslint.js . --max-warnings=0
node node_modules/next/dist/bin/next build --webpack
```

The runner requires real local Supabase on `127.0.0.1:54321`. It starts the production Worker code on port 8789 and formal Next UI on port 3102. A Node-only, secret-protected restart controller runs on port 8790; it is not a production Worker endpoint. Credentials remain private, Playwright traces are off, and generated artifacts are ignored. Next's installed version emits a security-upgrade recommendation and may stop the first invocation; the documented immediate retry continues. Startup failures are not counted as product red/green evidence.

## Independent demo and deployment gate

Start local Supabase using the repository's existing local setup, then run `scripts/sync-worker.mjs` with `SYNC_TEST_SECRET` (Node test controller/ephemeral room signing), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `APP_ORIGIN`. Start Next with the same public Supabase configuration and `NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789`. Sign in, create a document under `/documents`, open it, add a node, change its name and position, wait for confirmation, and reopen it. The UI's node list also provides keyboard-accessible selection and property editing; dragging and direct node editing use the actual tldraw shape.

Deployment template: `sync/wrangler.jsonc`. Replace the app origin and Supabase URL, install/use the Cloudflare deployment CLI, set Worker secrets `SUPABASE_ANON_KEY` and a random `ROOM_SIGNING_SECRET` (minimum 32 random bytes), then deploy that config to a verified Cloudflare account. Configure Next's `NEXT_PUBLIC_SYNC_URL` to the resulting HTTPS Worker endpoint and rebuild Next. The Worker requires a single exact allowed app origin. Do not deploy the Node test runner or restart controller.

Remote acceptance remains **unverified**: this workspace has no verified Cloudflare Worker account/deployment target or installed deployment CLI. A Vercel UI alone cannot satisfy the collaboration-service smoke requirement. Required remote smoke is: real deployed Supabase identity enters the deployed formal document, performs node operations, receives durable confirmation, rejects unauthorized room credentials, then recovers confirmed nodes after an actual remote test-service restart. Local Miniflare restart evidence does not claim that remote check passed. No tickets are closed by this evidence document.

## Verified local result (2026-11-05)

- Production runtime suite: **4 passed (27.2s)** using `S2_PRODUCTION=1` and the command above, covering owner/restart, authorization/reopen, live-page offline recovery and stale/failed checkpoint retry.
- App TypeScript, Worker TypeScript and whole-repository ESLint checks passed; `git diff --check` passed.
- Production `next build --webpack` passed on the immediate retry with `NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789`. This isolated worktree borrows the original checkout's dependencies, so Next warns about files outside its standalone output tracing root; the verified runtime uses `next start` with those dependencies, not the generated standalone package. Next also warns that standalone deployments should launch their generated server. A deployable standalone bundle remains a deployment-environment validation gate.
- Canvas-only screenshot: `/private/tmp/editor-s2-owner.png`; visually verified a rendered custom node and unobscured tool panel with confirmed durability. Generated screenshot/logs are not committed.

For production-runtime verification, build with the intended public Worker URL, then run `S2_PRODUCTION=1 node node_modules/@playwright/test/cli.js test --config playwright.s2.config.ts`. A deployed URL must be HTTPS and use the matching allowed app origin.
