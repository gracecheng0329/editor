# S3 live-page offline editing and reconnect (#9)

Date: 2026-11-13. This record covers a page that stays open while its sync connection is interrupted. It does not cover offline startup, reload recovery, or a cross-device queue.

## Service contract

| Operation | Authorization and result | Failure behavior |
| --- | --- | --- |
| `POST /documents/:id/session` | Revalidates the current Supabase identity and document membership, or the share token. The Worker reads the room's current generation and returns `{ ticket, generation, expiresAt }` with `Cache-Control: private, no-store`. | Invalid identity or access keeps the existing 401/404 behavior; origin rejection is 403; service or room lookup failure is retryable 503. |
| `POST /documents/:id/checkpoint` | Revalidates the caller and reads the current room generation before returning the authoritative checkpoint. | Viewer writes remain 403; invalid access and room failures are not reported as saved. |
| WebSocket `/documents/:id` | Uses the short-lived signed ticket. The Durable Object accepts only a ticket for its current generation and applies the existing editor/viewer write boundary. | A stale-generation ticket is rejected with 409; an expired or invalid ticket is rejected. |

Generation is taken from Durable Object state; the browser cannot choose it. Session renewal happens for each WebSocket connection attempt, including reconnection. The current role is therefore checked again before an offline edit can reach the authoritative room.

## Page behavior

- While the page is offline, its live tldraw store remains editable and the UI says `離線／待同步`. It does not claim cloud persistence.
- On same-generation reconnect, the page obtains a fresh identity, access result, and generation-bound ticket. The existing tldraw sync engine merges the real room and local operations. The page shows `已確認持久化` only after an authoritative checkpoint matches its document records.
- If access is lost and the local document differs from the last confirmed checkpoint, the page freezes editing and reconnect attempts. It keeps a full `TLStoreSnapshot` in the live page, shows why the content was not sent, and offers a JSON download. A valid share link can still reconnect an editor without pending local edits as a read-only viewer.
- If the room generation changed, the page never presents the old store to the new-generation sync connection. It freezes the page, retains the complete document snapshot, and offers a JSON download.
- Retryable network or service failures keep the pending state and retry through the sync adapter. The retained snapshot is page-memory only; closing or reloading before downloading it is outside this slice.

The local generation-advance endpoint is enabled only in the Miniflare test runtime by `TEST_CONTROL_SECRET`. It requires the owner's live Supabase token and is absent from the production Worker environment.

## Reproduce the demonstration

Configure local Supabase as described in [the local Supabase guide](local-supabase.md), then start it and apply local-only migrations:

```sh
node scripts/local-supabase.mjs up
node scripts/migrate-local-supabase.mjs
NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789 node node_modules/next/dist/bin/next build --webpack
S1_CREDENTIALS_FILE=.local-supabase/credentials.json S2_PRODUCTION=1 \
  node node_modules/@playwright/test/cli.js test --config playwright.s3.config.ts tests/s3/offline.spec.ts
```

The Playwright fixture creates separate real Auth identities and browser contexts, a private document, and an editor membership. The socket route forwards to the real Miniflare Worker except while that browser is offline; it does not mock tldraw's merge result.

The four cases demonstrate:

1. An editor adds a node and stroke while offline, the owner adds a different node online, and the editor reconnects within 10 seconds. Both pages converge within 5 seconds, and the editor's node and stroke survive reload.
2. The owner revokes an editor while that editor has offline node and stroke edits. Reconnection keeps those records visible in the retained page and its downloaded JSON; reloading the owner's page confirms neither edit reached the authoritative room.
3. An editor deletes a node offline while the owner moves it and edits its connected arrow online. Reconnection converges on both pages, keeps the arrow edit, and leaves no binding record to the deleted node.
4. The room generation advances while an editor has an offline edit. Reconnection retains the old document and does not replay its edit into the new generation.

## Verification evidence

- TDD red: the access-revocation case failed before the implementation because no retained-content UI appeared after reconnect.
- S3 production suite: **9 passed, 1 skipped** in 49.2 seconds. The skip is the separately opt-in five-minute AC-15 load baseline; its prior result is recorded in [the S3 stroke verification](s3-strokes.md).
- Existing S2 offline and revocation regressions: **3 passed** in 2.5 minutes, including the 60-second session-lease behavior.
- `pnpm exec tsc --noEmit`, `pnpm exec tsc -p sync/tsconfig.json --noEmit`, `pnpm lint`, `git diff --check`, and the Next.js 16.4.5 Webpack production build passed.
- The existing production Playwright launcher prints Next's warning that `next start` is unsupported with `output: standalone`; the build and all browser routes nevertheless ran in this local suite. The supported standalone server entry was not separately exercised.
- The verification uses local Supabase, Miniflare/SQLite, Chrome, and the production Next build. No remote deployment or remote Worker smoke test was run, so this is not deployment evidence.
