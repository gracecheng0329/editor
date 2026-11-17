# S4 Realtime authorization gate

Verified: 2026-11-16. This is an entry-gate protocol check for comment subscriptions, not the S4 comment composer or product API implementation.

## Decision

Use a private Supabase Broadcast channel for comment-change notifications. Broadcast payloads contain only `{ id, revision }`; clients fetch the comment body through an authenticated content endpoint that rechecks the current document access on every request. Owners and editors receive tickets from their active document session. Anyone with a valid public share link can receive a viewer ticket, whether anonymous or signed in; being signed in alone grants no access.

Viewer tickets have a maximum 45-second lifetime. Realtime closes a joined channel when its JWT expires, so a viewer subscription without token refresh ends within the required 60 seconds. Revoking the share immediately blocks new tickets and content reads; the short ticket lifetime bounds the lifetime of an already-authorized Broadcast subscription. Owners and editors remain authorized.

This uses Broadcast's private-channel authorization at join time and its JWT expiry behavior. The local test does not claim that deleting a share row alone immediately invalidates an already-joined channel. That behavior is explicitly bounded by the short viewer ticket lifetime. Postgres Changes is the alternative: Supabase documents per-event RLS authorization, with additional per-subscriber database work; `DELETE` events are not protected by row RLS. That makes it a valid option for future evaluation, but it does not provide a documented revocation-time SLA. See [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [Broadcast](https://supabase.com/docs/guides/realtime/broadcast), and [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## Integration evidence

`tests/s4/realtime-subscription.spec.ts` runs against the actual local Supabase Realtime service (`supabase/realtime:v2.148.3`, SDK `@supabase/supabase-js` 2.118.0), not a mocked channel. The final test run passed: **1 test, 50.3 seconds**.

It verified:

- Owner and editor sessions, anonymous share-link holders, and signed-in share-link holders can join the private document topic.
- A signed-in non-member without a share link is denied a ticket; a fake document/share pairing is denied.
- A valid ticket cannot subscribe to another document's topic; an expired ticket cannot join.
- A real private Broadcast arrives with exactly `{ id, revision }`. Comment content is returned only through the controlled read endpoint, which checks access again.
- Revocation blocks new viewer tickets and reads immediately. Owner and editor reads remain allowed.
- Existing anonymous and signed-in viewer channels close after the no-refresh 45-second ticket expires, within 60 seconds of revocation. A later event reaches the owner and editor but not either viewer.

The repeatable test environment is `playwright.s4.config.ts` plus `scripts/s4-realtime-harness.mjs`. The harness creates a temporary probe table, function, and Realtime RLS policy; the test's `finally` block removes them, with a process-shutdown cleanup fallback. After the final run, PostgreSQL confirmed the table, functions, and policy were all absent. Run it after starting local Supabase and applying the project migrations:

```sh
S1_CREDENTIALS_FILE="$PWD/.local-supabase/credentials.json" node node_modules/@playwright/test/cli.js test --config playwright.s4.config.ts
```

## Limits

This validates the chosen protocol on the pinned local Realtime service. It does not verify the hosted project's Realtime version, configuration, latency, or service guarantee. Supabase's general Auth guidance discourages very short login-token lifetimes; these are short-lived, document-scoped Realtime tickets and must remain separate from normal Auth session tokens. The full comments UI, persistent comment storage, and production ticket/read endpoints are still outside this entry-gate issue.

Protocol comparison and source notes are recorded in [S4 Realtime research](s4-realtime-research.md).
