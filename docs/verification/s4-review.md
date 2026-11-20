# S4 participant mentions and discussion review (#13)

Local evidence, 2026-11-17. This slice adds document-scoped participant selection, stable user-ID mentions on messages, and persistent open/resolved discussion state with resolver ID and timestamp. No notifications are sent.

## Contract and demonstration

Open the same document in independent owner and signed-in share-viewer sessions. Open 留言討論. Select a person with 提及參與者, enter a message and send. The other session displays the stored mention identity. The owner can 解決討論 and 重新開啟討論; the viewer can reply to all threads and change the state of their own threads only. Reload to verify persistence. Deleting an anchored object retains its thread, mentions, resolution metadata and last position.

`GET /api/documents/:id/comments` returns only participants of the authorized document. Owner/editor grants are authoritative. A signed-in viewer becomes discoverable after a verified share read; the private registry retains only their user ID and the verified share hash. The viewer disappears from eligibility when that hash is revoked. Anonymous readers receive no participant directory. The writer revalidates every mention against current eligibility, stores ID/name pairs, and derives the author from the active session. `PATCH /api/documents/:id/comments/threads/:threadId` rechecks the role and thread creator in Postgres. Caller-supplied authors and resolution metadata are rejected by the HTTP boundary; database functions do not accept them.

## Executed evidence

- Red: `review.spec.ts` failed against the existing service because the participant directory was missing (`listing.participants` undefined).
- Green: the real-service authorization test passed, including private-user mention rejection, forged author rejection, role restrictions, cross-document rejection, resolution timestamps, reopen, and revoked participant filtering.
- Formal UI: the independent owner/viewer/anonymous browser journey passed with mention identity, resolve/reopen propagation, replies and reload persistence (2 tests including the authorization contract, 24.9s).
- TypeScript and targeted Biome lint passed. Next.js 16.4.5 Webpack production build passed.
- Production regression: **5 passed (5.8m)**, including the five-minute load. All 1,500 canvas operations and 150 comments converged without errors. Canvas max 981.7ms, p95 148.7ms; comment write plus peer read max 1008.0ms. Conditions and complete results: [load JSON](s4-13-load.json). No cadence misses were recorded.

Reproduce with local Supabase running and all migrations applied:

```sh
pnpm exec playwright test --config playwright.s4-comments.config.ts
NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789 pnpm exec next build --webpack
S4_PRODUCTION=1 S4_LOAD=1 pnpm exec playwright test --config playwright.s4-comments.config.ts
```

The load uses five independent authenticated contexts, 300 nodes, 100 connections and 100 strokes for five minutes. Canvas actions use the formal UI. Each context submits one comment per ten seconds through its authenticated public HTTP interface and checks the next session's protected read. This isolates persistence/authorization latency; the separate browser journey verifies notification-driven UI rendering. Do not describe the load's read latency as measured Broadcast-to-UI latency.

## Release evidence and limitations

The migration bundle, server-only Production `SUPABASE_JWT_SECRET`, Ready deployment, and hosted persistence/mention/resolve/reopen smoke are recorded in [S4 remote verification](s4-remote.md). The later heartbeat correction and post-heartbeat Broadcast/revocation recheck on exact Production commit `16aa2fe` are also recorded there. The pre-existing unrelated change in `app/documents/page.tsx` still makes full-repo lint report an unreachable return; it is excluded from task changes. This issue covers its S4 portion of AC-15; it does not claim the entirety of AC-15/AC-19.
