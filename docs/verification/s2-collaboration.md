# S2 two-person node collaboration (#25)

This slice extends the owner canvas with authenticated tldraw user identities and live collaborator presence. The user ID comes from Supabase Auth, with a bounded display name and a stable, non-secret fallback; presence and cursors are session-scoped. The same tldraw sync authority and checkpoint confirmation contract remain in use. This covers node collaboration only, not the full #5 or cross-slice acceptance criteria.

## Evidence

The agreed seams are the formal document UI in independent browser contexts and public service contracts. The first real-service tracer failed because the collaborator indicator did not exist (`/private/tmp/s2-25-red.log`); after wiring the Auth identity into `useSync` and presenting visible collaborators it passed (`/private/tmp/s2-25-green.log`). The completed journey uses two real Supabase identities (owner and granted editor), the real local Worker, Durable Object and SQLite. It checks presence and cursor, node creation and rename and movement in both directions within two seconds, simultaneous movement convergence within five seconds with one node, local selection and viewport, remote deletion, confirmation, disconnect, and reopening after an actual Worker runtime restart. No SDK private state or mocked synchronization is used. The test runs serially with no retries.

Environment: local loopback services on one Apple Silicon machine, Chrome 156.0.8078.80, Node 24.18.0, tldraw/sync 5.5.2. The timing assertions are controlled-environment acceptance targets, not a public SLA. The canvas screenshot `/private/tmp/editor-s2-collaboration.png` was visually inspected. Local commands and service setup are in `docs/verification/s2-owner.md`; use the production build and `S2_PRODUCTION=1` for the Playwright suite.

Remote deployment smoke remains unverified: no verified Cloudflare deployment target is configured. Local restart is not evidence of remote recovery. Next.js emitted its security upgrade recommendation and stopped the first build; the immediate retry passed. Standalone output and deployed tldraw license remain deployment gates described in the owner evidence.

Final local run: **5 passed (42.4s)** on the production runtime; app and Worker TypeScript, whole-repository ESLint, `git diff --check`, and production Webpack build passed. The cursor test explicitly aligns both visible canvases after an earlier run exposed differing browser scroll positions; the earlier failure is retained in `/private/tmp/s2-25-suite-final.log` rather than counted as a pass.
