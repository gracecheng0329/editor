# S2 connections, text and canvas operations (#6)

Scope: directed and labeled connections with node or world-coordinate endpoints; standalone text; selection, movement, resizing, pan and zoom; deletion isolation and convergence; confirmed recovery. tldraw sync remains the sole canvas authority. This is the connection/text portion of AC-03, AC-04, AC-12 and AC-17. Strokes and comments are excluded; this does not complete AC-15 or AC-17 as a whole.

## Implementation and public contract

The formal document canvas uses native arrow and text records, default arrow bindings, and the existing shared client/server schema. Binding `toId` references the stable node shape ID. Free endpoints use world coordinates converted to the arrow's local coordinates. Node deletion uses tldraw's isolation lifecycle to preserve the terminal's last position while removing its binding; the remaining connection and opposite endpoint survive. No duplicate synchronization engine, custom merge algorithm, or new persistence endpoint is introduced.

The tools expose node/world endpoint selection, a directional arrow, editable connection label and standalone text. Native select/arrow/text/hand tools support direct canvas interaction; the accessible inspector exposes position and dimensions, and zoom controls affect the local camera. New nodes are spaced on a grid instead of sharing the same position. The object lists expose names, positions, sizes and endpoint coordinates for keyboard operation and inspection. Endpoint descriptions subscribe to both shape and binding changes.

The existing automatic checkpoint equality check covers all document records, including arrows, text and bindings. Later edits invalidate earlier confirmation. Worker authorization and generation checks apply to every shape type; this slice does not change access policy or deliver #7 session revocation.

## Test seams and TDD

The pre-agreed boundaries from #1/#6 are the formal product UI in independent browser contexts and authenticated public service contracts. Tests use real Supabase users, the production Next UI, production Worker code, Durable Objects and SQLite. They do not inspect SDK private stores or messages, inject expected merge results, or mock synchronization.

- `/private/tmp/s2-6-red.log`: the real two-user journey failed because the formal canvas lacked the connection endpoint selector. Earlier startup failures and a fixture display-name mismatch were corrected before recording this behavior failure. The shared fixture now seeds display names directly, respecting the application's `full_name` precedence.
- `/private/tmp/s2-6-green.log`: the first connection/text journey passed, including synchronization, detachment, resizing and a genuine Worker runtime restart with different runtime IDs.
- `/private/tmp/s2-6-endpoints-red.log`: endpoint inspection was absent before its UI was added. The subsequent journey compares world coordinates before and after deletion, races deletion against a remote move, retains a connection label edit, checks convergence without duplicate connections and inspects the public authoritative checkpoint for dangling bindings.
- The additional free-endpoint journey checks known coordinates before and after translation, direction markers and the absence of bindings. The text journey checks position and width after restart.

Commands from the repository root (requires local Supabase; see [owner setup](s2-owner.md)):

```sh
NEXT_PUBLIC_SYNC_URL=http://127.0.0.1:8789 node node_modules/next/dist/bin/next build --webpack
S2_PRODUCTION=1 node node_modules/@playwright/test/cli.js test --config playwright.s2.config.ts
S2_PRODUCTION=1 S2_LOAD=1 node node_modules/@playwright/test/cli.js test --config playwright.s2.config.ts --grep 'S2 baseline'
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project sync/tsconfig.json
node node_modules/@biomejs/biome/bin/biome lint . --error-on-warnings
git diff --check
```

The load test is opt-in and runs without retries. It creates five different authenticated identities and browser contexts, seeds 300 nodes and 100 bound connections through the product, then schedules one move per session per second for five minutes. Each move must appear in a different session within two seconds; all five node and connection lists must converge within five seconds after activity, with confirmed persistence and no unhandled browser errors. The report records cadence failures rather than silently lowering the requested rate. This is the S2 node/connection subset of the eventual 500-object baseline: the 100 strokes and S4 comments remain outstanding. The local environment uses loopback, not a remote region or WAN; it does not establish a public SLA.

## Independent demonstration

Start local Supabase, the Worker and the formal Next frontend as documented in [the owner guide](s2-owner.md). Sign in as an owner, create a document and grant a second account editor access. Open the same document in two independent sessions.

1. Add two nodes, choose them in the connection start/end selectors, enter a label and add the connection. Move or resize a selected node; the other session sees the attached connection follow it.
2. Choose world coordinates for either endpoint, or use the connection tool to draw directly. Select the connection to edit its label or position; the arrow and endpoint summary indicate direction and world position.
3. Add standalone text and edit its contents, position and width. Use select to drag or resize, hand to pan, and the zoom buttons to adjust only your own view.
4. Delete an attached node. The connection remains at its last endpoint position; the summary changes to a world-coordinate endpoint. The other endpoint stays attached.
5. Wait for confirmed persistence, reopen, then restart the local test Worker and reopen again. Confirmed connections, text, positions, dimensions and deletion results remain.

## Deployment limits

Local acceptance does not deploy changes. A remote smoke must exercise this updated frontend against the deployed Worker with valid real identities, verify cross-session connection/text edits and rejection of unauthorized credentials, and recover confirmed records after an actual remote instance replacement. Existing remote configuration and identity requirements are documented in [S2 remote verification](s2-remote.md). Cached local setup currently has only an owner state, not the required second account state. No deployed #6 smoke or remote restart is claimed by the local results.

Next.js 16.4.5 emits a security upgrade recommendation and can stop development startup; startup interruptions were not counted as product failures or red evidence. The production tests use `next start` with local dependencies; the standalone deployment bundle still requires deployment validation.

## Verified local result (2026-11-10)

The final production-runtime suite completed with **13 passed (6.5 minutes), zero retries** (`/private/tmp/s2-6-suite-final.log`). The production build passed, as did app and Worker TypeScript, whole-repository Biome lint (101 files) and `git diff --check`. The final functional journeys cover arrows with two bound endpoints, a mixed bound/free connection, two free endpoints, direction markers, label edits, text edits/movement/width, node resize, exact endpoint preservation, deletion/movement races, zero dangling bindings in the public checkpoint, and recovery after an actual Worker restart. Existing collaboration, authorization, offline recovery and save-confirmation regression checks are included. The current canvas screenshot `/private/tmp/s2-6-canvas.png` was visually inspected; the navigation controls use two columns so connection controls take less scrolling.

Final five-session S2 baseline (`/private/tmp/s2-6-load.json`, `/private/tmp/s2-6-suite-final.log`): **passed**, with 300 nodes, 100 bound connections and **1,500 measured moves** during a **300.000-second** operation window. Remote visibility measured from the start of the UI action: **p95 140.5 ms**, **maximum 891.2 ms**; no missed one-second operation intervals, no unhandled browser errors, all five sessions converged and reached confirmed persistence. Total setup plus measurement took 318.3 seconds. This repeats the earlier successful run (p95 140.0 ms, max 793.9 ms) against the final production UI, rather than treating the earlier build as final evidence.

Environment: Apple M5, 10 CPU cores, 24 GiB RAM; Node 24.18.0; desktop Chrome 157.0.8103.39; tldraw/sync 5.5.2; Next 16.4.5; real local workerd/SQLite and Supabase on loopback, with no simulated WAN latency. This covers the S2 node/connection workload only; no strokes or comments are counted. No deployed #6 smoke, remote-region timing, remote restart, or public SLA is claimed.

## Shared interface follow-up

The formal canvas now uses the prototype's FigJam-inspired workspace rather than displaying the original validation panel by default. Detailed object and connection controls are opened from “物件與連線”. The integration also corrected remote deletion replay so that detached endpoints match the authoritative checkpoint. Updated UI, lifecycle, race, shortcut and performance evidence is in [the formal workspace verification](formal-workspace.md).
