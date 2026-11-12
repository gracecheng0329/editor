# S2 existing-session revocation (#7)

## Public contract

The sync Worker resolves a share token through `resolve_document_share_room`, which compares the token hash and returns only the document and room identifiers. It never accepts a room identifier from the viewer. Share tickets carry the `viewer` role; the Durable Object serves them with read-only object access and rejects checkpoints with HTTP 403. Invalid or revoked share tokens cannot obtain another ticket.

Member and share tickets have a maximum 60-second lease. The Worker rechecks current Supabase authorization whenever it issues a ticket or checkpoint. Each open socket is closed at ticket expiry, so membership or share revocation takes effect for an existing connection within 60 seconds. A member whose access is revoked can reconnect with a still-valid share token and receives the viewer role; without a valid share token, the canvas leaves the save-status UI and shows the authorization loss state. Revoking sharing does not revoke owner or editor membership.

`SESSION_LEASE_MS` exists only to shorten leases in local acceptance tests; the Worker caps it at 60 seconds. Production `sync/wrangler.jsonc` does not set this binding.

## Local evidence

The service contract test uses local Supabase identities, the real Worker, and the real `/api/share/resolve` route. It verifies viewer ticket issuance, checkpoint denial, invalid-token denial, share revocation, owner ticket continuity, and rejection of an expired ticket.

```sh
S1_CREDENTIALS_FILE=/path/to/.local-supabase/credentials.json \
S2_TEST_SESSION_LEASE_MS=10000 S2_PRODUCTION=1 \
node node_modules/@playwright/test/cli.js test --config playwright.s2.config.ts \
  tests/s2/revocation-service.spec.ts
```

Initial short-lease result in this workspace: **1 passed (10.6s)**. The local Next production build, app and Worker TypeScript checks, whole-repository Biome lint, and `git diff --check` also passed during implementation.

Browser coverage is in `tests/s2/revocation.spec.ts` and `tests/s2/share-viewer.spec.ts`; it exercises live socket expiry, same-tab editor-to-viewer reconnect, and the read-only canvas. The browser run could not complete here because Chrome terminated with `SIGABRT` during Playwright launch, before the test bodies ran. The editor revocation cases also use the repository's trusted local GitHub identity fixture, which requires the local container service. No browser or remote deployment pass is claimed from this environment.

## Review corrections (2026-11-12)

- The service expiry assertion now waits until the issued `expiresAt`, plus a two-second polling allowance. Browser socket-close assertions allow 62 seconds for observation while still asserting revocation within 60 seconds. The default Worker lease remains 60 seconds; passing no longer requires a short-lease override.
- The read-only indicator locator is scoped to the share canvas header, where the text is unique. This nested header does not have an implicit `banner` role.
- Both viewer and revoked-editor-with-share cases use an independent browser probe to attempt a real write through the SDK's public store API. Playwright observes the attack marker leaving the browser without inspecting protocol fields, waits for the optimistic edit to be discarded, then the owner reloads the formal document and checks that the attempted node was not saved. The probe is bundled from `tests/s2/fixtures/sync-probe.tsx` and served only by Playwright request interception; it adds no deployed route or authorization bypass.

Executed without `S2_TEST_SESSION_LEASE_MS`:

```sh
S2_PRODUCTION=1 node node_modules/@playwright/test/cli.js test \
  --config playwright.s2.config.ts \
  tests/s2/revocation-service.spec.ts tests/s2/share-viewer.spec.ts tests/s2/revocation.spec.ts
```

Result: the service test **passed using the default 60-second lease** (about one minute). All three browser tests failed during Chrome launch (`SIGABRT`, `kill EPERM`), before their bodies ran. The browser probe and updated locator therefore still require runtime verification in an environment where Chromium can launch. These results do not constitute a full S2 pass or red-before-green browser evidence.

After the corrections, application and Worker TypeScript checks, whole-repository Biome lint (110 files), `git diff --check`, and the independent probe's browser bundle compilation passed. The product source was unchanged during this correction pass, so the earlier production build was not rerun.

Local Standards and Spec reviews used base `ca0185b761ea533ef7eafe23859d989d9c46bfc8` and included untracked source files. Both initially reported the three issues above; both rechecked the fixes and reported no remaining actionable findings. Offline pending-content preservation remains S3 scope. The pre-existing local origin change in `sync/wrangler.jsonc` is excluded from this task's commit.
