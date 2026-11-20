# S4 missed-notification recovery and revocation (#14)

Local verification: 2026-11-17. Postgres remains the authority; Broadcast notifications are only invalidation hints. The formal document/share pages use the same protected comment read, write and ticket endpoints.

## Behavior and public boundaries

`useCommentStream` owns a cancellable subscription lifecycle. It serializes reads and coalesces invalidations while a read is pending, so delayed responses cannot overwrite a later read. Repeated notifications trigger authoritative rereads rather than appending duplicate messages. Reads also run on subscription, browser reconnection/visibility recovery and every five seconds; transient connection failures retry after two seconds. Every request has a ten-second timeout. The panel exposes 重新連線留言 and distinguishes retrying from connected status.

Every role receives a document-scoped ticket with a maximum 45-second lifetime, renewed by rejoining after 20 seconds with a newly checked role. The server checks fresh membership/share access on every ticket and content request. An editor who loses their grant retains viewer access only when presenting a still-valid share token. An invalid token does not remove an owner's or still-valid editor's identity-derived access. The short lease applies even if a client ignores renewal/reconnection code; Realtime expires the existing joined channel.

A 401/403/404 content or ticket response stops the subscription and clears loaded discussion/participant data. In-flight reads from disposed or denied lifecycles cannot repopulate the panel. Transient network/503 failures preserve the previously loaded content with a retry message, rather than claiming new content was saved. Reconnection rereads Postgres and never treats a received event as a persistence acknowledgement.

## TDD and real-service evidence

The new tests first failed against #13's implementation:

- owner/editor ticket expiry was 300 seconds rather than at most 45 seconds;
- aborting the first ticket request left the formal page permanently disconnected.

After the minimal implementation, both tests passed (2 tests, 21.2s). Further real Realtime integration passed (3 tests, 1.2m), including anonymous viewer, authenticated viewer and revoked editor channels that receive a real event before revocation, then expire without client renewal within the 60-second limit. A newly authorized owner channel provides a real delivery barrier after expiry; revoked clients receive no further events. Direct public requests prove immediate read/ticket denial, token-based editor downgrade, and unaffected owner/editor access.

Additional regression scenarios cover the owner revoking a link through the formal 分享 dialog; a still-open viewer page recovering an outage with a missed thread/reply; and a deliberately held response containing an older real database snapshot followed by real writes and authoritative rereads. Network controls delay/abort transport only; no mocked sync merge or private SDK store/message assertions are used.

The complete development-service regression passed **8 tests (1.7m)**, with the explicit load test skipped in that run. TypeScript, task-scoped Biome lint and the fixed local Webpack production build passed. The final fixed production regression passed **9 tests (7.3m)**, including the full load and actual lease-expiry test. The five-minute load completed all 1,500 canvas operations and 150 comments with no cadence misses, consistency failures or browser errors. Canvas max 1041.5ms, p95 163.2ms; comment write plus peer read max 1430.0ms. Full conditions/results: [#14 load JSON](s4-14-load.json). Comment read latency measures the public HTTP persistence path; the separate formal browser tests verify notification-driven rendering. Run with local Supabase and migrations applied:

```sh
pnpm exec playwright test --config playwright.s4-comments.config.ts
NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789 pnpm exec next build --webpack
S4_PRODUCTION=1 S4_LOAD=1 pnpm exec playwright test --config playwright.s4-comments.config.ts
```

## Independent demonstration

1. Open a document as owner and open its enabled share link in a separate signed-in viewer context; open 留言討論 in both.
2. Set the viewer context offline while its page stays open. Create a thread and reply as owner. Restore the viewer's network: both persisted messages appear once. Click 重新連線留言 and confirm no duplicate.
3. From the owner's 分享 dialog select 撤銷觀看連結. The viewer loses read/composer access and its loaded comments are removed; the owner remains authorized.
4. For the server-enforced bound, run `recovery.spec.ts`'s production-ticket integration test: it uses actual public tickets and Realtime subscriptions and intentionally never renews them.

## Release evidence and limitations

These measurements use Chrome, Next 16.4.5, Supabase JS 2.118.0, local Postgres/Auth/PostgREST/Realtime v2.148.3 and the local Worker. Hosted migrations, Production JWT configuration, and deployment smoke are now verified in [S4 remote verification](s4-remote.md), including the exact heartbeat-fix deployment, post-heartbeat private Broadcast, persistence after reload, and share revocation. Full-repo lint has exactly the pre-existing unreachable return in the unrelated `app/documents/page.tsx` modification; task-scoped lint and TypeScript are checked separately. The former G0/S4 harness is a historical protocol experiment; its five-minute owner/editor ticket expectations do not describe the new production endpoint.
