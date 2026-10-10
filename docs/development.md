# Development

[README](../README.md) · [Configuration](configuration.md) · [Operations](operations.md)

Use **Node.js 26.x** and npm. The server runs
TypeScript directly with Node.js built-in APIs. Only development tools, including
TypeScript and Playwright, require npm dependencies; Python is not required.

The repository's `.nvmrc` selects Node.js 26, and CI reads that file for every
check, including the full backend suite. Production and the Docker browser-test
fixture use `node:26-alpine`.

## Run the server locally

Create `.env` as described in the [quick start](../README.md#quick-start), then run:

```bash
BPM_DATA_DIR="$PWD/.local-data" node --env-file=.env src/server/main.ts
```

Alternatively, export the environment variables and use `npm start`. The server
listens on `0.0.0.0:58333` by default; `BPM_LISTEN_ADDRESS` and `BPM_LISTEN_PORT`
can change that for a local process. `BPM_DATA_DIR` sets its data directory.

Node metrics come only from Bitcoin Knots RPC: `uptime` and `getnettotals`.
Dashboard and legacy metrics endpoints share reads cached for five seconds. P2P
rates are averaged between valid samples and reset after outages or node restarts;
unavailable values are null. No dashboard host or container metrics are collected.

Management is read-only unless `BPM_ADMIN_TOKEN` is configured. Every management
POST API route checks its bearer token or management session before
invoking the handler. Session logout is separately guarded by an explicit matching
Origin. Cookie-authenticated POSTs also require that Origin. The browser's
shared API helper handles authentication challenges through the admin token dialog;
all management callers should use `postJson`. See
[admin authentication](configuration.md#admin-token-and-read-only-mode) for token
generation, HTTPS deployment, revocation, and API responses. Detailed viewing uses
the separate [viewing access policy](configuration.md#viewing-access). Browser
verification opts into 30-day HttpOnly session cookies with `X-BPM-Remember: 1`;
`/api/access` reports viewing and management session state before detailed polling.
Page lifecycle cleanup preserves sessions, while explicit Lock revokes them on the
server. Session records are held in memory and expire on service restart.

Dashboard dialogs use `core/modal.js` for accessible naming, focus containment,
stacking, Escape/backdrop dismissal, and focus restoration. Pass the dialog's
abort signal to requests and check `isOpen()` before applying asynchronous
results. Keep persistent controls mounted when refreshing dialog values. Peer
details, settings panels, tooltips, and pinned lists remain nonmodal popovers.

Peer actions own an abort signal and `dispose()` for their requests, dialogs,
notifications, listeners, and delayed refreshes. Confirmed ban/disconnect actions
use that owner signal because their confirmation dialog closes before dispatch;
ban-list operations also use the list dialog's signal. `postJson` rejects cancelled
results before returning data or handling an authentication challenge, even when
a transport completes after cancellation. Every UI continuation also checks its
owner remains active. Locking protected viewing disposes the dashboard and wipes
private content before navigation; public BFCache suspension retains its view.
Cancelling browser work cannot undo a node mutation already accepted by RPC. A
later authorized read establishes its outcome; cancellation never retries it.

## Frontend component ownership

The private-network and node-dashboard factory modules compose three distinct
responsibilities. `private-data.js` and `dashboard-data.js` derive network totals,
groups, averages, insights and display decisions from explicit snapshots and
observation times without reading the DOM or singleton dashboard. View modules
own markup, DOM painting and animations; control modules own navigation, event
handlers, dialogs and nonmodal popovers. The existing factory method and action
interfaces remain the integration boundary for the map.

Pass each factory its dashboard state and, when embedding or testing, its
document, clock and observation-time function. Private donuts count alive map
nodes; private panels aggregate the current peer snapshot. Keep those populations
separate. The node factory retains polling coordination and RPC response state;
refreshes update metric values without rebuilding persistent display controls.

`core/lifecycle.js` owns component listeners, timers, animation frames and named
render scopes. Replace a render scope before binding rebuilt controls, and call
`dispose()` to cancel feature-owned work. Factories initialize once on creation;
explicit `init()` is idempotent and permits a fresh lifecycle after disposal.
Node reinitialization creates a fresh poller while preserving its public handle,
and generation checks prevent obsolete responses from painting the new view.
The map disposes these features on page exit; BFCache suspension retains them.
Modal stacks and focus restoration belong to the owning document.

## Build from source with Docker

```bash
./scripts/compose-local.sh up -d --build
```

The helper combines `compose.yaml` with `compose.build.yaml` and any local
`compose.override.yaml` or `compose.override.yml`. It supplies the commit from a
clean Git checkout automatically and can be invoked from another directory.
The build override uses `pull_policy: build`, so `up` builds the local source image.

Dirty worktrees, including untracked files, use `unknown` so changed static assets
receive a fresh content hash for browser caching. Direct Docker builds can pass
`BPM_BUILD_REVISION` explicitly; without it, the commit is `unknown`.
Local builds use `BPM_BUILD_VERSION=dev` and skip release checks even when the
revision is known. The header displays the version; the commit remains available
in build metadata and the configuration API for source tracing and asset caching.
The canonical source repository is an internal constant. Local `.env` variants,
Compose overrides, and `secrets/` are excluded from the Docker build context.

## Tests and checks

Install the development dependencies:

```bash
npm ci
```

Choose checks that match the change:

| Command | Coverage |
| --- | --- |
| `npm run check:js` | JavaScript and TypeScript syntax |
| `npm run check:api` | OpenAPI declarations match the checked-in generated types |
| `npm run check:assets` | Vendored browser assets match their pinned development packages |
| `npm run sync:assets` | Copy pinned browser assets, licenses, and checksum manifest |
| `npm run check:types` | Strict type checks for production code and backend tests |
| `npm run test:server` | Backend behavior using Node's test runner |
| `npm run test:js` | Frontend unit tests |
| `npm test` | Backend and frontend unit tests |
| `npm run test:layout` | Browser regressions using the local fixture server |
| `npm run test:browser-security` | Dialogs, local assets, CSP, Swagger, and frame protection in Chromium, Firefox, and WebKit |
| `npm run test:layout:docker` | Browser regressions with the fixture server in Docker |
| `npm run test:container` | Production image smoke test |
| `npm run test:compose` | Published/local Compose merges, secrets, host binding, volume names, and build helper behavior |

Before running browser tests, install the three browser engines:

```bash
npx playwright install --with-deps chromium firefox webkit
```

CI runs code checks and unit tests, two shards of Chromium layout regressions,
security tests for each of Chromium, Firefox and WebKit, and Compose/container
validation on separate Ubuntu runners in parallel. Browser jobs use the official
Playwright image with browsers, libraries and fonts preinstalled, while
`setup-node` still selects Node.js 26. CI checks that the installed Playwright
package matches the image version; update both browser-job image references when
updating that dependency. The container job uses Node.js built-ins without
installing npm dependencies.
Container validation verifies that the image and test runner use the same
Node.js major version. The required `test` check succeeds only when every job
succeeds; failures, cancellations and skipped jobs cannot satisfy it. Draft PRs
skip all jobs, and moving a PR back to draft cancels its previous run.
Tests use local fixtures and mock RPC servers, without a live Bitcoin node or
external GeoIP services.

See [browser security](browser-security.md) for the enforced response policy and
the workflow for reproducing or updating Swagger and font assets. Checked-in
declarations and assets ship with the source; production startup needs neither
package installation nor generation.

`test:layout` starts its fixture server automatically and runs two independent
browser suites at a time, each in its own browser context. Node's test runner
reports suite names and timings, with a two-minute timeout per suite. Set
`BPM_LAYOUT_TEST_WORKERS=1 npm run test:layout` for serial execution, or choose
another worker count from 1 to 8. For a focused regression run, set
`BPM_LAYOUT_TEST_FILTER="peer table DOM updates" npm run test:layout`; the filter
matches suite names and fails if no suite matches. The keyboard and large-table
journeys exercise real Tab/Shift+Tab traversal beyond mounted rows while checking
that the DOM stays bounded. The Docker variant uses the same test runner and
also requires Docker and curl on the host.

CI distributes the layout suites between two independent runners, keeping two
workers on each. Set `BPM_LAYOUT_TEST_SHARD=1/2 npm run test:layout` to reproduce
the first shard, or `2/2` for the second. The default `1/1` runs every suite.
Shard indices and totals must be integers from 1 to 8, with the index at most the
total; invalid or empty selections fail. Shards assign suites by position before
applying `BPM_LAYOUT_TEST_FILTER`. Browser security tests also run two independent
cases at a time for each engine, with the longest case starting first. CI gives
WebKit's longer policy/dialog case a separate runner from its viewing and
outbound-control cases, so they do not compete for the same runner's CPU.
Each security job also verifies its completed test count, including the parent
suite. Update the expected counts in CI when adding or regrouping security cases.

### Validate the production container

`test:container` also runs an isolated Compose project with real file-backed RPC
secrets on rootful Linux without user-namespace remapping. It verifies both
documented readable ownership patterns and rejects an unreadable owner-only file
before RPC calls. Tests retain UID/GID 10001, the read-only root filesystem, dropped
capabilities, and no-new-privileges; fixtures and named volumes are removed afterward.
Rootless, remapped, and non-Linux daemons skip only these host-permission cases.


```bash
BITCOIN_RPC_USER=test BITCOIN_RPC_PASSWORD=test \
  docker compose config --quiet
docker build --build-arg BPM_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t bitcoin-peer-map:test .
npm run test:container
```

The smoke test uses Linux host networking and a local mock RPC server. It checks
the entrypoint, baked build metadata, health check, unprivileged read-only
operation, persisted SQLite data and preferences, and clean shutdown. It creates
and removes its own test container and volume. Set `BPM_TEST_IMAGE` to select an
already-built image and `BPM_TEST_PLATFORM` to `linux/amd64` or `linux/arm64` to
test a specific architecture. `BPM_TEST_EXPECT_VERSION` and
`BPM_TEST_EXPECT_REVISION` verify the release tag and full commit SHA. These
checks use the image's baked metadata without runtime overrides. Stable builds
receive a recent update-check cache in the test volume to avoid external GitHub
requests.

Release orchestration and registry error handling are covered by
`node --test tests/deployment/release.test.js`, also included in
`npm run test:compose`. These tests inject command and registry fixtures and
never publish images.

### Profile the dashboard

```bash
npm run benchmark:dashboard
```

The benchmark profiles 14, 125, and 500 synthetic peers in Chromium with normal
and reduced motion. It reports main-thread task time over three idle seconds,
DOM size, mounted table rows, JavaScript heap use, peer-canvas redraws, and table
mutations during an unchanged peer poll. Compare runs on the same machine and
browser; absolute timings vary by environment.

## Architecture

| Location | Responsibility |
| --- | --- |
| [`src/server/`](../src/server/) | HTTP routes, configuration, RPC, service lifecycle, and background workers |
| [`src/static/js/`](../src/static/js/) | Browser ES modules for map, peers, node, distribution, and settings |
| [`src/templates/`](../src/templates/) | Dashboard HTML |
| [`tests/server/`](../tests/server/) | Backend tests |
| [`tests/unit/`](../tests/unit/) | Frontend unit tests |
| [`tests/layout_server.ts`](../tests/layout_server.ts) | Local API fixtures for browser tests |

The backend uses built-in HTTP, SQLite, fetch, and worker-thread APIs, with no
production npm dependencies or compiled addons. The production image starts
`src/server/main.ts` directly. The runtime owns peer polling, GeoIP enrichment,
connectivity monitoring, metric sampling, and daily update checks, and stops
them on SIGTERM or SIGINT. GeoIP validation and SQLite merges run in a worker
thread to keep HTTP requests responsive.

The frontend uses native ES modules with one entrypoint,
[`src/static/js/app.js`](../src/static/js/app.js), and no bundler. Feature modules
share state, polling, HTTP, formatting, and modal
helpers from `core/`. Peer views read one current snapshot and resolve pinned
filters against it. Public and private peer details share popup interactions
and cleanup.

Distribution and map navigation modules own selection, filter transitions, and
restoration. Tooltip modules own their DOM, pinning, and refresh presentation;
summary and insight modules bind distribution interactions through explicit
callbacks. Controllers supply current-data getters and connect presentation and
navigation effects. Snapshot reconciliation preserves active filters, tooltip
geometry, focus, and scroll without applying user-navigation cleanup.

`distribution/controller.js` exports `create({ dashboard, hooks?, document? })`.
The map creates one instance and passes it into preferences, private-network
views, and the renderer. Navigation state comes from the supplied dashboard;
derived data, snapshot deduplication, integration hooks, cached elements, and
child controllers belong to that instance. Replacing hooks updates the same
object used by navigation and removes callbacks omitted from the replacement.

`distribution/model.js` owns provider and country aggregates, scores, active-lens
selectors, and summary data. Its peer snapshot, palette, segment limit, connection
labels, and optional clock are explicit inputs. `presentation.js` renders centers,
panels, lens chrome, highlights, and connection origins through model getters and
lazy navigation callbacks. `controls.js` owns persistent DOM listeners and its
observer. Initialization is idempotent; controller disposal is terminal and removes
listeners, closes active exploration, and cancels timers and animation callbacks.

The map controller connects polling, peer snapshots, settings, and navigation.
`map/renderer.js` coordinates the camera and canvas surfaces; `basemap.js` owns
geography loading and cached paths, `peer-renderer.js` owns peer animation and
hit testing, and `connection-renderer.js` draws lines from distribution and
private-network views. `input.js` binds pointer, touch, table, and badge input;
`controls.js` binds dashboard buttons.

`map/camera.js` contains pure peer framing, bounds, interpolation, drag, and
cursor-anchored zoom calculations. `map/world-wrap.js` calculates visible world
copies and distances across the longitude seam. These helpers take dimensions,
camera values, and configuration as arguments and return values without reading
DOM or mutating application state. The renderer, navigation, and input modules
apply the results; existing geometry and navigation exports remain available.

Geography and static connections have separate cached canvas layers. Peer
animations continue at the existing frame rate; reduced-motion scenes redraw on
state changes and once per second while connection-age brightness is changing.
Large settled peer sets reuse a bounded cache of glow sprites.

`peers/table-window.js` mounts the viewport plus six buffer rows on each side for
tables above 80 peers. Smaller tables retain every row. Sorting and filtering use
the full snapshot, while scroll and resize update only the mounted window.
Spacer rows preserve the full scroll height, and cross-highlighting can reveal
an unmounted peer. Logical row indices and counts describe the full table to
assistive technology.

`distribution/navigation.js` composes the existing navigation API from
`selection.js` (selection transitions), `selection-filters.js` (persistent filters
and snapshot reconciliation), `navigation-view.js` (navigation visuals and
temporary previews), and the donut, panel, and insight input modules. Each module
declares the options and transition methods it uses in JSDoc. Transition getters
resolve handlers after composition, so the modules do not import each other.

Modules are served under `/static/v/<asset_revision>/`, so a new revision
invalidates every relative dependency. Existing static URLs remain available.
`types.d.ts` re-exports generated API types and defines browser view/controller
interfaces; `tsconfig.json` checks production JavaScript using JSDoc annotations.
No production build step is needed.

### API behavior

Interactive API documentation is served at `/docs`, with the specification at
`/openapi.json`. [`src/server/openapi.json`](../src/server/openapi.json) is the
canonical HTTP contract. After changing a request, serialized response, or stream
payload, update its schema and run `npm run generate:api`. Commit the resulting
[`src/shared/api.generated.d.ts`](../src/shared/api.generated.d.ts) together with
the producer change. `npm run check:api` checks freshness without rewriting files,
and CI also checks server/browser types and validates actual HTTP responses and
browser fixtures against the schemas. Generated declarations are not edited by hand.

Peers expose `addrman_status` as `present`, `not_returned`, or `unavailable`.
Membership matches a normalized host and explicit port against the latest valid
`getnodeaddresses` inventory; failed refreshes suppress claims from retained
metadata. That RPC filters its inventory, so an omitted endpoint does not prove
absence from Addrman. The compatibility `in_addrman` boolean is true only for
`present`. The table, peer details, and map tooltip display **Yes**, **Not returned**,
or **Unavailable**, with the private-map dash preserved.

Coordinate display and sorting share finite numeric values. Located peers and
older snapshots without a location status retain genuine zero coordinates;
pending, private, or unavailable placeholders display an em dash. Numeric sorts
keep missing coordinates last in both directions and preserve equal-value order.

The server and browser re-export these declarations under their existing type
names. RPC input parsers, controller state, and display projections remain separate:
OpenAPI describes what crosses HTTP, while a browser projection guards raw provider
metadata and RPC extensions before rendering. Preserve nullable results, omitted
optional values, string peer ports (including an empty string), numeric-string peer
IDs, and passthrough extension fields when updating a contract. The legacy stream's
`message` and `system` payloads are described by its `x-events` schemas.

Generation uses the private development tool in `scripts/api-codegen`, with
`openapi-typescript` 7.13.0 and its required TypeScript 5.9.3 AST API. The application
continues to use TypeScript 7 for checks and native Node 26 execution. Ajv is used
only in tests; production has no new runtime dependencies, schema validation, or
build step. `npm ci` installs both toolchains without overriding peer dependencies.

| Endpoint | Behavior |
| --- | --- |
| `/api/peers` | Returns the peer list |
| `/api/peers?include_status=true` | Includes RPC connection status and snapshot timestamps |
| `/api/info` | Node details, RPC metrics, and cached application update status |
| `/api/config` | Effective configuration without RPC credentials, including `build.updates` |
| `POST /api/geodb/db-only` | Sets database-only mode with `{ "enabled": boolean }`; true disables external peer lookups |
| `POST /api/geodb/auto-update` | Sets automatic dataset updates with `{ "enabled": boolean }` |

RPC dispatch is bounded to eight active and 32 FIFO queued calls. Queue time
counts toward each call's deadline; cancelled or expired queued calls never
dispatch. Overflow returns HTTP 503 with `code: "rpc_busy"` and `Retry-After: 1`.
Mutations are never retried automatically. Shared blockchain, mempool, ban,
chain-tip, and index reads cache successes for five seconds from load start and
failures for one second from completion. Failed refreshes replace earlier
successful cache entries. Mutations invalidate affected caches, including reads
that are still in flight, and each consumer receives an independent copy.

Chain-tip responses have a 15-second overall deadline. Required tips and optional
blockchain metadata load concurrently, with ten- and five-second budgets.
Four workers enrich at most 100 tip ages for up to five seconds within the overall
deadline. Optional timeouts return valid tips with unavailable ages and
`summary.age_lookup_timed_out: true`; `age_lookup_limited` still describes the
100-tip cap. Completed results, including partial results, are cached for five
seconds from completion, with ages and generation timestamps refreshed on return.
Shared reads own their cancellation controllers; closing one response detaches
its subscriber, and losing the last subscriber cancels the work. A header still
needed by the dashboard survives closure of the chain-tip dialog.

Node details and RPC metrics also use five-second caches shared across clients.
The dashboard uses one node-info poll with a 35-second browser abort deadline.
All completion paths release the pending request so polling can resume.
Failed browser refreshes retain cached
node details, mark the header and Node Info as **Stale**, and show the last
successful refresh time. Traffic values are cleared. A successful refresh
restores normal presentation: **Synced** requires explicit `blockchain.ibd:false`,
**Syncing (IBD)** requires `true`, and unavailable blockchain or IBD data shows
**Unknown**.
Transaction indexes report `blockchain.txindex_status` as **Disabled**,
**Syncing**, **Ready**, or **Unknown**, plus `txindex_height` when available.
The legacy `indexed` boolean remains true for valid syncing or ready indexes.
Older responses containing only that boolean identify an enabled index without
claiming readiness.
The `services` field in `/api/info` comes from
[`getnetworkinfo.localservicesnames`](https://bitcoincore.org/en/doc/30.0.0/rpc/network/getnetworkinfo/):
an empty list means no services are advertised, while `null` means unavailable.

RPC failures retain the last successful peer snapshot; a successful empty
response clears it. RPC transport results are `unknown` until the parsers in
[`rpc-types.ts`](../src/server/rpc-types.ts) validate their fields. Peer validation
rejects malformed snapshots before they replace existing data. Network fields
are validated independently: unavailable fields remain `null` while valid
connection counts, services, and unrelated dashboard reads remain usable.
Application update status is read from the server cache, rather than triggering
a GitHub request.

GeoIP setters persist before changing live state. Repeating a desired value does
not write preferences or reset timers. The old toggle endpoints require admin
authentication and return HTTP 410 without mutation; clients must reload or move
to the setters. Dataset validation streams rows inside the merge worker, skips
invalid records, and reports `added_rows`, `updated_rows`, and `skipped_rows`.
An import with no valid records fails without changes.

GeoIP lookups accept at most 65,536 decoded response bytes, counted while reading
the stream before JSON parsing; compressed and chunked responses use the same
limit. Each top-level string may contain at most 4,096 UTF-8 bytes, checked before
trimming or coordinate conversion. Both lookup paths, API saves, cache hydration,
and dataset imports apply these bounds. Oversized responses are cancelled and
reported through the existing sanitized provider failure/backoff path; a failed
lookup retains a previously valid cached location.

An oversized stored record is rejected as a whole before its large fields enter
JavaScript. Its location is unavailable until a valid bounded replacement arrives,
and replacement lookup still follows the saved privacy settings. Rejected records
stay on disk until replacement; there is no bulk deletion or schema migration.
Both API saves and dataset imports can replace a size-rejected stored row despite
its timestamp, updating provenance in the same transaction. Imports skip oversized
incoming rows and report them in `skipped_rows`.

API location saves return explicit saved, superseded, disabled, cancelled, or
failed outcomes. SQLite writer contention retries asynchronously from 50 ms to
500 ms for at most 65 seconds; individual synchronous attempts have zero busy
timeout. Observation timestamps are captured once; valid bounded stored records
with newer or equal timestamps win. Other corrupt-record handling is unchanged.
Failed payloads remain in the active-peer cache and retry after
60 seconds through the existing serial resolver, without another provider call.
Dataset generation changes preserve those payloads. Shutdown cancels retry waits
and drains the resolver before closing SQLite; pending memory-only payloads are
abandoned, with no persistent retry queue or schema migration.

### Rendering peer data

Keep peer-supplied strings raw in application state. Assign `textContent` or use
`BPMModal.escapeHtml` at HTML text and attribute boundaries. Helpers whose names
include `HtmlRow` accept locally constructed markup; ordinary row helpers escape
their text.

`core/ping.js` shares measurement and display rules across peer views. `ping_ms`
is a fractional millisecond value or null; measured zero is valid. Unknown values
display `—`, sort last in both directions, and are excluded from averages and
rankings. Positive measurements below 0.1 ms display `<0.1ms`.

Map world copies are derived from camera position, zoom, viewport width, and
drawing margin, while horizontal camera position remains continuous. Geography,
peers, hit testing, connections, and private-network lettering use the same
offsets. Table auto-fit coalesces container-width changes through one animation
frame, reuses measured natural widths on resize, and updates columns only when
their final widths change; manual sizing and virtualized row identity are retained.

## Development flow

```text
feature branch → pull request → CI/tests → merge to main
```

The [CI workflow](../.github/workflows/ci.yml) runs when a pull request is opened
or marked ready for review, and on new commits or reopening while it is ready.
Draft pull requests skip the test job until they are marked ready for review.
Returning a PR to draft cancels any active CI run for that PR.
CI retains all syntax/type, backend, JavaScript, browser/layout, Compose, Docker
build, and container checks. It has a read-only token and no registry login or
publish job.
Merging integrates changes into `main`; it neither repeats the full CI suite on
the push nor publishes a production image. Pushing a tag alone also does not
publish an image.

### Dependency updates

[Dependabot](../.github/dependabot.yml) checks npm development dependencies,
Docker images, and GitHub Actions weekly on Monday at 09:00 in `UTC`.
Minor and patch updates are grouped separately for npm and GitHub Actions;
major upgrades and Docker updates get individual pull requests. Update PRs
target the default branch and run the existing CI workflow. Review the changes
and passing checks before merging, especially for major upgrades that may need
related runtime, type, or documentation changes.

### Protect main

At implementation time, GitHub reported `main` as unprotected and the repository
ruleset list was empty. The connected GitHub app cannot read the administration
endpoint for detailed branch protection. Configure a rule for `main` under
**Settings → Rules → Rulesets**, or use a classic branch protection rule:

- Require a pull request before merging, including for maintainer changes.
- Require the `test` status check from the `CI` workflow. Keep its job name stable.
- Require the PR branch to be up to date before merging, so CI tests the current
  integration result. Update the PR branch when `main` changes; this can rerun
  PR checks, but does not add duplicate CI after merge.
- Block force pushes and deletion, and limit bypasses/direct pushes where practical.

A solo-maintainer project can leave mandatory review approvals at zero; extra
reviewers and a merge queue are not required for this flow. PR-only CI relies on
these required checks: an unprotected direct push would not be tested.

## Release flow

```text
ready main → publish GitHub Release/tag → build once → smoke both architectures → publish exact GHCR image → conditionally promote latest
```

The [release workflow](../.github/workflows/release.yml) uses
[`release: published`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
This supports publishing a reviewed draft in the GitHub UI. Only published stable
releases in the canonical repository can publish; drafts and prereleases are
excluded. There is no push, PR, or tag-push publish trigger. A guarded manual
dispatch can recover an existing published stable release; it does not create a
release. Dispatch **Release** from `main` with its existing tag. The workflow
rejects missing releases, drafts, prereleases, invalid tags, and commits outside
`main`, and verifies a recorded full source SHA when one is available.

The publisher runs on a native ARM runner because Node's TypeScript parser can
crash under ARM64 emulation on x86 runners. It still builds one multi-platform
index and runs the full smoke tests for both architectures; AMD64 runs under
emulation. No architecture checks are skipped.

1. Ensure the intended changes are merged into `main` with passing required PR
   checks. Merge this workflow implementation before using the release process.
2. Choose a new, increasing version such as `v1.3.0`. Use **MAJOR.MINOR.PATCH**:
   MAJOR for incompatible/breaking changes, MINOR for backward-compatible
   functionality/features, and PATCH for backward-compatible bug fixes. Always
   include the lowercase `v` prefix, without leading zeros, prerelease suffixes,
   or build metadata.
3. Open **Releases → Draft a new release → Choose a tag**. Create the new version
   tag targeting the reviewed `main` commit, or select an existing tag at that
   commit. If saving a draft for later, verify the final tag/commit again before
   publication. Use the version as the release title.
4. Choose **Generate release notes**, review/edit the notes and previous release,
   and save a draft if further review is needed. Leave **Set as a pre-release**
   unchecked and select **Set as the latest release**.
5. Publish the release. The workflow validates the tag, checks out the release
   event's exact commit, verifies the tag still resolves to that commit and the
   commit is part of `main`, then checks the version and SHA image tags for an
   existing verified release. When neither exists, it builds a Linux AMD64/ARM64
   image once with QEMU and Docker Buildx. It loads the multi-platform index into
   the runner's containerd image store, runs the production smoke test on both
   architectures with the baked release version and revision, and uploads that same image
   only after both pass. There is no rebuild between testing and publication.
   It verifies the registry index digest, both architecture manifests, and their
   build metadata before attaching the SHA tag or promoting `latest`. It uses
   GitHub Actions build caching and authenticates to GHCR with `GITHUB_TOKEN`;
   only the publish job has `packages: write`.
6. Wait for **Release → Publish container image** to succeed before announcing
   the image or deploying it. If a build fails, fix the cause and rerun the failed
   workflow from Actions without moving the published tag. If the original
   workflow itself needs a fix, merge the fix and manually dispatch the current
   **Release** workflow from `main` with the same published tag. It checks out the
   original release source and retains its image version/revision. If publication stopped
   after either immutable image tag was written, the rerun skips rebuilding and
   pulls the original index by digest for both architectures. It verifies the
   release metadata and runs both smoke tests again before completing missing
   tags or promoting `latest`.

Resume behavior applies to releases whose source commit includes this publisher.
Rerunning an older release workflow executes the code from that original release.

For a new highest version `v1.3.0`, all three tags identify the same tested
multi-architecture image:

```text
ghcr.io/spyhunter493/bitcoin-peer-map:v1.3.0
ghcr.io/spyhunter493/bitcoin-peer-map:latest
ghcr.io/spyhunter493/bitcoin-peer-map:sha-<full-release-commit>
```

Publication is serialized without cancelling an active registry push. Its shared
`release-publish` concurrency group uses `queue: max` and
`cancel-in-progress: false`, retaining up to 100 pending publication or recovery
runs instead of replacing the previous pending run. Additional runs beyond that
limit are cancelled by GitHub, as described in the
[GitHub concurrency documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).
Immediately before promotion, the workflow reads the existing GHCR `latest`
version and compares stable semantic versions. It updates `latest` only for a
higher version; an older maintenance release still receives its version and SHA
tags, and equal versions leave `latest` unchanged. A confirmed missing manifest permits initial
promotion. Authentication, network, malformed metadata, and other registry
failures stop promotion rather than treating the current image as absent. The
Actions summary records both tested architectures, the index digest, and why
`latest` was promoted or skipped.

For local workflow validation, parse the original release YAML and verify its
concurrency mapping is exactly `group: release-publish`, `queue: max`, and
`cancel-in-progress: false`. Actionlint 1.7.12 does not yet recognize `queue`;
[upstream support](https://github.com/rhysd/actionlint/pull/654) is pending.
Run it against the original release workflow, filtering only this diagnostic:

```sh
-ignore '^unexpected key "queue" for "concurrency" section\. expected one of "cancel-in-progress", "group"$'
```

All other diagnostics must still pass. Lint the CI workflow without that filter,
and record the exception in PR validation. Remove the filter once the installed
actionlint supports this GitHub setting.

Never move/reuse published version tags or repurpose SHA tags. The workflow
rejects existing tags with the wrong release version or source commit, or version
and SHA tags identifying different index digests. Reruns preserve the original
verified digest and write only missing immutable tags; a successful release can
be rerun without replacing its image.
Pin a version or image digest for deployments that must not follow `latest`.
The GitHub Release becomes visible before the image build completes, so a notice
can briefly precede image availability.

### Build metadata

| Value | Release build | Local default | Purpose |
| --- | --- | --- | --- |
| `BPM_BUILD_VERSION` | Release tag, e.g. `v1.3.0` | `dev` | Human-facing version and release update comparison |
| `BPM_BUILD_REVISION` | Full SHA of the release tag's commit | `unknown` | Provenance, source links, and static asset cache identity |

These values are Docker build arguments baked into the image; deployment does
not need to set them. The local Compose helper supplies a clean checkout's SHA,
while `compose.build.yaml` accepts either build argument explicitly. The image
contains OCI labels `org.opencontainers.image.source` (the canonical repository
URL), `org.opencontainers.image.revision` (the exact SHA), and
`org.opencontainers.image.version` (the release tag). Version selection comes
from the release tag, so `package.json` does not need a separate version bump.

The update checker calls the canonical repository's
[`releases/latest` API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release),
compares stable versions numerically, and links to the newer GitHub Release.
Equal or older versions do not produce notices; `dev` builds skip checks. A
known SHA is independent of release comparison and continues to identify source.
The API exposes the version at `/api/config` as `build.version`, and update
status contains `latest_version` in place of the former `commits_behind` field.

Normal deployment uses the public published image directly; the Compose build
override is for local source builds. Forks can run PR CI and local builds, but
the release publisher is deliberately restricted to the canonical repository.
