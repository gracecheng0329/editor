# Formal document workspace integration

## Scope and behavior

The formal `/documents/[id]` page now uses the same FigJam-inspired workspace as `/prototype`: floating document header, component library, drawing toolbar, collaboration controls, selection inspector and zoom controls. A document uses the complete viewport. Its title and permissions are still served by the existing document APIs; its canvas still has one authority, tldraw sync backed by the authenticated Worker and Durable Object.

The prototype's local data hooks live in the local-only wrapper. The formal wrapper never mounts them, never seeds the prototype diagram, and never loads its title, comment threads or milestones. Native node creation and editing through the component library and inspector operate directly on the synchronized editor. Connection and text tools are available in the primary toolbar. Detailed position, size, label and endpoint controls remain available under the top-right “物件與連線” panel, closed by default.

The share modal renders the real owner access settings, including existing invitation and share-link actions. Editors see their actual role and an explanation that access is managed by the owner. The file menu provides document-list navigation, the authenticated display name and logout. The connected workspace shows actual remote participants and the original connection/checkpoint status; its save check still requires exact equality with the flushed authoritative document snapshot. A disconnected workspace retains title editing and permission management while connection retry proceeds.

Unavailable capabilities are explicit: drawing/note/geometry shortcuts are not exposed as delivered formal tools, individual undo/redo controls indicate S3, and comments/versions show pending S4/S5 panels without local composers or local milestone creation. The local prototype retains its original tools and browser persistence.

## Deletion race uncovered during integration

The stronger concurrent-delete journey reproduced a latent endpoint divergence: both browsers could display the same detached arrow while its start coordinate differed from the authoritative checkpoint. Default arrow isolation re-baked the terminal while replaying a remote deletion against speculative local movement. That derived remote change was not a new user edit and was not published back to the room. The existing strict save indicator correctly remained unconfirmed.

The narrow `SyncedArrowBindingUtil` adapter captures the public store change source during binding-util construction, before the editor's deletion callbacks, and skips re-baking only when a shape is deleted by a remote transaction. Local deletion and copy/isolation retain the normal ArrowBindingUtil behavior. Authoritative remote transactions already contain the originator's baked endpoint. The adapter uses the same binding type, validators and migrations on the client; the service schema and save contract are unchanged. Handlers are removed when the editor is disposed. This lifecycle ordering is verified against pinned tldraw 5.5.2 and should be rechecked on SDK upgrades.

Evidence: `/private/tmp/workspace-race-debug.log` recorded five failures in five independent runs before the fix; `/private/tmp/workspace-race-fixed.log` recorded five passes after it. The diagnostic log compared public document serializations with the authenticated checkpoint; no SDK private state or wire format was asserted. All temporary diagnostic hooks and log statements were removed before the final build. No reload, tolerance adjustment, second merge engine, or false save indication masks the mismatch.

## Validation

Public seams are unchanged: formal pages in independent browser contexts, actual local Supabase identities, production Worker/DO/SQLite and authenticated API/checkpoint contracts. `/private/tmp/s2-workspace-red.log` first failed because the formal page lacked the shared drawing toolbar. The new workspace journeys then passed: native component-library editing reaches another identity; title changes survive reload; the real sharing modal loads; pending panels cannot create local substitute data; canvas-authentication failure preserves metadata/access operations and recovers on retry; and the prototype retains its local draft.

- Browser journeys: `tests/s2/workspace.spec.ts`.
- Existing S2 acceptance controls are reached by opening the real property panel; tests are not given hidden editor handles or a test-only canvas.
- Existing S1 title, logout and sharing journeys follow the new header/menu/modal navigation.
- Visual artifact: `/private/tmp/editor-formal-figjam.png`, inspected at 1280×720.
- Production build, TypeScript and Biome lint run against the final implementation. Full-suite outcomes are recorded below after completion.

No changes are deployed remotely by this work. Local visual and integration evidence does not replace deployed two-user smoke, remote restart or the remaining S3–S5 capabilities. The existing tldraw deployment license and standalone packaging checks remain deployment requirements.

## Final local evidence (2026-11-10)

- Before the final dialog-key guard, the production S2 suite passed **17 tests (6.8 minutes)**, including the five-session baseline and the dialog-connection transition regression (`/private/tmp/workspace-suite-final.log`).
- The baseline completed **1,500 moves in 300.001 seconds** with 300 nodes and 100 connections: **p95 145.3 ms**, **maximum 887.8 ms**, no cadence failures or browser errors, and convergence plus confirmed persistence in all five sessions. Environment: Apple M5, 10 cores, 24 GiB; Chrome 157.0.8103.39, Node 24.18.0, Next 16.4.5, tldraw/sync 5.5.2, real local Supabase and workerd/SQLite over loopback. This is the S2 workload subset, not the complete stroke/comment benchmark or a public SLA.
- The S1 document/logout and invitation/share/revocation journeys both passed (**2 tests, 25.0 seconds**, `/private/tmp/workspace-s1-final.log`). Their navigation now explicitly opens and closes the sharing modal between separate tasks.
- The share modal is owned by `DocumentShell` rather than the editor connection lifecycle. Its real `AccessSettings` instance and generated link remain mounted across canvas initialization. Both connected and disconnected headers invoke the same parent action; `ModalFrame` is shared with the prototype in `workspace-surfaces.tsx`.
- A final focused regression (`/private/tmp/workspace-dialog-red.log`) caught Delete on a dialog button deleting the selected background node. Workspace shortcuts now ignore targets inside dialogs, retaining input, Escape and focus-trap behavior. This guard does not change rendering or the load test's input/update path. The final functional suite checks this guard as well as the earlier canvas and UI journeys.
- The final production build, app/Worker TypeScript, whole-repository Biome lint and whitespace checks passed. Temporary diagnostic statements were removed. No remote deployment or GitHub issue completion is claimed.

The last shortcut regression identified both the custom workspace handler and tldraw's built-in body-level shortcuts. The shared UI now registers modal state with the public `editor.menus` interface as well as ignoring dialog targets in its own handler, and removes that menu registration on close/unmount. The final focused run passed **5/5 tests (22.8 seconds)**: Delete preserves the selected node, the formal workspace edits and reopens, metadata remains usable through authentication failure, the prototype retains its draft, and an open share modal survives connection initialization (`/private/tmp/workspace-dialog-green.log`). The immediately preceding full functional run passed its other 16 tests and exposed this specific shortcut defect; it is retained in `/private/tmp/workspace-regression-final.log`, not counted as an all-green run. The final menu guard changes only dialog interaction; the measured load path never opens a dialog.

After validation, the updated production frontend was restarted at `http://127.0.0.1:3000`, with the local Worker at port 8789 and Supabase at port 54321. Both frontend and Worker health returned HTTP 200. The local Worker uses `.local-supabase/canvas` for persistent SQLite state; the earlier orphaned IPv4 frontend process was replaced without deleting that data or stopping the separate IPv6 development server.
