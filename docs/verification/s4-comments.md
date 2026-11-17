# S4 persistent comments

Verified: 2026-11-17. Comment threads and messages are stored in Postgres, independently of the synchronized canvas. Every read, write, and Realtime ticket request checks the current document access. Realtime carries only a thread ID and revision; clients reload content through the protected comments endpoint.

## Local verification

Start the isolated local Supabase services and apply the migrations before running the real-service suite:

```sh
node scripts/local-supabase.mjs up
node scripts/migrate-local-supabase.mjs
node node_modules/@playwright/test/cli.js test --config playwright.s4-comments.config.ts
```

The final S4 run passed **3 tests** against the local Auth, Postgres, PostgREST, Realtime v2.148.3, and Supabase JS 2.118.0:

- The comments endpoint denies a private-document read without a session or share link.
- API integration covers owner/editor writes, signed-in share-viewer replies, anonymous read-only access, cross-document denial, revoked permissions, short viewer tickets, and object anchor movement/deletion/relinking while preserving the stable object ID and local offset.
- Independent owner, signed-in viewer, and anonymous browser contexts use the document and share pages. The owner creates a thread, the viewer replies, both contexts receive the discussion through Realtime, the anonymous viewer can only read it, and reloading the owner page reads the persisted discussion back.

The first API contract test was run before implementation and failed because the comments route returned 404 instead of the required 401. It passed after the route, database functions, and access checks were added.

The following checks passed:

- `pnpm exec tsc --noEmit`
- Biome lint for the S4 implementation, integration test, local test config, and touched UI files.
- `pnpm exec next build --webpack` on Next.js 16.4.5.
- The verified private Broadcast authorization and expiry behavior recorded in [S4 Realtime authorization](s4-realtime.md).

Full `pnpm lint` currently reports the unreachable second return in the pre-existing worktree change to `app/documents/page.tsx`. That file was left untouched; targeted lint for the S4 changes passes.

## Deployment requirements and scope

Before deploying, apply both S4 migrations to the target Supabase project and configure `SUPABASE_JWT_SECRET` as a server-only environment variable containing that project's JWT signing secret. Never expose it as `NEXT_PUBLIC_*`. The local setup writes it to the ignored, permission-restricted `.local-supabase/app.env` for the test server.

No hosted deployment smoke test was run. The hosted Supabase Realtime version and JWT signing configuration still need confirmation before release. Viewer Realtime tickets last at most 45 seconds and the client renews them every 20 seconds; the earlier S4 authorization verification documents the limit for an already joined viewer channel.

This implementation covers discussion creation, replies, persistence, access enforcement, object/world anchors, and live notification with Postgres rereads. It does not claim missed-event recovery guarantees, resolved/reopened discussions, or full AC-07/AC-19 coverage. Full restore/reconnect behavior remains for S5 as the issue specifies.
