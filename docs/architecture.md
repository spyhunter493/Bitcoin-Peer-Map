# Architecture

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

This reference describes ownership and lifecycle rules for contributors.
See [Development](development.md) for setup and checks, and the
[dashboard guide](dashboard.md) for user-facing behavior.

## Find the code

| Location | Responsibility |
| --- | --- |
| [`src/server/`](../src/server/) | HTTP routes, configuration, RPC and service lifecycle |
| [`src/static/js/`](../src/static/js/) | Browser modules for map, peers, node, distribution and settings |
| [`src/templates/`](../src/templates/) | Dashboard HTML |
| [`src/shared/api.generated.d.ts`](../src/shared/api.generated.d.ts) | Generated HTTP contract types |
| [`tests/server/`](../tests/server/) / [`tests/unit/`](../tests/unit/) | Backend / frontend unit tests |
| [`tests/layout_server.ts`](../tests/layout_server.ts) | API fixtures for browser tests |

## Server runtime

The backend uses Node's built-in HTTP, SQLite, fetch and worker-thread APIs, with
no production npm dependencies or compiled addons. The image starts
`src/server/main.ts` directly. The runtime owns peer polling, GeoIP enrichment,
connectivity checks, RPC metric sampling and daily release checks, subject to
outbound policy. SIGTERM/SIGINT stop those services. GeoIP validation and SQLite
merges run in a worker thread to keep HTTP requests responsive.

See [API behavior](api.md) for RPC queues, shared reads, validation and persistence
guarantees. [Access control](access-control.md) describes credentials and sessions;
[Operations](operations.md) covers saved data and optional outbound requests.

## Browser modules and state

The frontend uses native ES modules with one entrypoint,
[`app.js`](../src/static/js/app.js), and no bundler. Feature modules share state,
polling, HTTP, formatting and modal helpers from `core/`. Peer views read one
current snapshot and resolve pinned filters against it. Public and private peer
details share interactions and cleanup.

| Area | Ownership |
| --- | --- |
| Map controller | Polling, peer snapshots, settings and navigation integration |
| `map/renderer.js` | Camera and canvas surface coordination |
| `map/basemap.js` / `peer-renderer.js` / `connection-renderer.js` | Geography, peer animation/hit testing and connection lines |
| `map/input.js` / `controls.js` | Pointer, touch, table and badge input / dashboard buttons |
| `map/camera.js` / `world-wrap.js` | Pure camera geometry / longitude-seam world copies |
| `distribution/model.js` | Provider/country aggregates, scores, lens selectors and summaries |
| `distribution/presentation.js` / `controls.js` | Rendering / persistent listeners and observers |
| Tooltip modules | DOM, pinning and refresh presentation |
| Private/node data modules | Derived values from explicit snapshots and observation times |
| Private/node view and control modules | Markup/painting / navigation, events, dialogs and popovers |

Data modules read neither the DOM nor singleton dashboard state. Pass factories
their dashboard state and, for embedding/tests, document, clock and observation
time. Private donuts count alive map nodes; private panels aggregate the peer
snapshot. Keep these populations separate. Node factories coordinate polling
and RPC response state; refresh values without rebuilding persistent controls.

## Preserve navigation while polling

Selection and filter transitions belong to distribution/map navigation modules.
Controllers supply current-data getters and connect presentation through callbacks.
Snapshot reconciliation preserves filters, tooltip geometry, focus and scroll;
it must not apply cleanup intended for user navigation.

`distribution/controller.js` exports `create({ dashboard, hooks?, document? })`.
The map creates one instance and shares it with preferences, private views and
the renderer. Derived data, snapshot deduplication, integration hooks, cached
DOM elements and child controllers belong to that instance. Hook replacement
updates that instance and removes omitted callbacks.

The distribution model takes its snapshot, palette, segment limit, connection
labels and optional clock explicitly. Presentation uses model getters and lazy
navigation callbacks. `distribution/navigation.js` composes `selection.js`,
`selection-filters.js`, `navigation-view.js`, and donut/panel/insight input modules.
JSDoc declares their transition options; getters resolve handlers after composition
so the modules do not import one another.

## Own and dispose asynchronous work

`core/lifecycle.js` owns component listeners, timers, animation frames and named
render scopes. Replace a render scope before rebinding rebuilt controls. Factories
initialize once; `init()` is idempotent and can start a fresh lifecycle after
disposal. Node reinitialization keeps its public handle but creates a fresh
poller; generation checks reject obsolete responses. Distribution controller
disposal is terminal and removes listeners, exploration, timers and animations.

`core/modal.js` owns accessible naming, focus containment, stacking, Escape and
backdrop dismissal, and focus restoration in the owning document. Pass a dialog's
abort signal to requests and check `isOpen()` before applying results. Persistent
controls stay mounted during refreshes. Peer details, settings, tooltips and
pinned lists are nonmodal popovers.

Peer actions own requests, dialogs, notifications, listeners and delayed refreshes
through an abort signal and `dispose()`. Confirmed mutations use the action owner's
signal because the confirmation closes before dispatch; ban-list work also uses
the list dialog's signal. Use `postJson` for management calls: it handles token
challenges and rejects cancelled results before returning or prompting. Each UI
continuation must also check its owner remains active.

Protected viewing locks dispose the dashboard and wipe private content. Public
back/forward-cache suspension preserves its view and components. Page cleanup
preserves remembered sessions; explicit Lock revokes them. Cancelling browser
work cannot undo an RPC mutation already accepted by the node. A later authorized
read establishes its outcome; cancellation must not retry a mutation.

## Render peer data safely and efficiently

Keep peer-supplied strings raw in state. Use `textContent` or `BPMModal.escapeHtml`
at HTML text/attribute boundaries. Helpers named `HtmlRow` accept locally built
markup; ordinary row helpers escape text. [API field semantics](api.md#interpret-peer-and-node-fields)
cover null values, ping, coordinates and Addrman status.

`peers/table-window.js` mounts the viewport plus six buffer rows on each side
above 80 peers; smaller tables retain every row. Sorting, filtering and export
use the full snapshot. Spacer rows preserve scroll height, cross-highlighting
reveals unmounted peers, and logical row indices/counts describe the full table
to assistive technology. Table auto-fit coalesces width changes into one animation
frame, reuses natural-width measurements, and only changes final widths while
preserving manual sizing and row identity.

Camera helpers take dimensions and values explicitly, without reading the DOM
or mutating state. Horizontal position stays continuous; world-copy offsets
come from camera position, zoom, viewport width and drawing margin. Geography,
peers, hit testing, connections and private labels share those offsets.

Geography and static connections have separate cached canvas layers. Reduced
motion redraws on state changes and once per second while connection-age
brightness changes. Large settled peer sets reuse a bounded glow-sprite cache.

## Types and asset caching

`types.d.ts` re-exports generated API declarations and defines browser view/controller
interfaces. `tsconfig.json` checks production JavaScript through JSDoc.
Modules use `/static/v/<asset_revision>/`, so a new revision invalidates relative
dependencies; legacy static URLs remain available. Assets and declarations are
checked into source. See [Browser security](browser-security.md) for vendor assets,
fonts and response policy.
