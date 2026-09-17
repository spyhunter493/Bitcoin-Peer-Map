# Lean dashboard refactor

## Objective and constraints

Implement all five findings from the review of `9e4a456`, preserving features,
appearance, interactions, API defaults, Docker deployment, database schema, and
saved preferences. Use native JavaScript modules: no framework, bundler, production
build step, scheduler, or cache dependency. Prefer shared readable implementations
over wrappers, duplication, or compressed syntax.

## Implementation checklist

- [x] Baseline: regression coverage for stale public peer details, private popup
  listener retention, and permanent failed GeoIP lookups; three dashboard benchmark
  runs for 14/125/500 peers.
- [x] Stage 1 — GeoIP recovery: SQLite authoritative, active-peer memory cache,
  60-second monotonic failed-lookup expiry, deduplicated/rate-limited work, no
  separate deferred list, database checks even with external lookups disabled,
  dataset generation invalidation including in-flight work, disconnected-host
  pruning. Preserve existing merge policy and response fields.
- [x] Stage 2 — Shared peer detail: one public/private controller with `openPeer`,
  `openGroup`, `update`, `close`, and `dispose`; select by ID, preserve per-network
  content, group navigation, actions, geometry, and focus; clean up listeners and
  timers, including replacement during drag/resize. Share identical byte/duration,
  connection-label, and service rendering helpers.
- [ ] Stage 3 — State ownership: one authoritative peer snapshot/index, canvas-only
  animation/projection state, one interaction owner for modes/lenses/selections/
  history/filter descriptors/previews. Recompute membership from stable semantic
  keys, preserve empty filters and outage snapshots, reconcile departing peers,
  and refresh open/pinned views without losing geometry, focus, or scroll. Remove
  the 38-action summary callback interface and writable parent getters. Move map,
  private-network, node/price, and settings behavior out of the bootstrap.
- [ ] Stage 4 — Backend polling: five-second demand-driven node cache shared across
  clients/currencies, per-currency price caches with last-success/error isolation,
  one concurrent refresh per key, expiry measured from refresh start. Reuse tip
  hash/height from blockchain info and cache header metadata by hash. Cache GeoIP
  statistics until writes/merges; calculate ages at response time. Add `/api/price`
  and default-compatible `/api/info?include_price=false`; poll price independently,
  reject late responses for a previous currency, preserve partial RPC failures.
- [ ] Stage 5 — Native modules: group code into core/map/peers/distribution/node/
  settings, small entrypoint, explicit imports, no BPM runtime globals. Convert
  Node tooling/tests to ESM. Serve a revisioned module tree under
  `/static/v/<asset_revision>/...` while retaining existing static URLs. Update
  benchmark fixtures, automatically discover syntax/unit checks, use Node's test
  runner, retain npm command names, and strictly check all production JavaScript
  with JSDoc/shared types (no blanket any or ts-nocheck). Browser tests use UI
  interactions; unit tests import functions.
- [ ] Completion: full CI-equivalent verification, three final benchmark runs,
  investigate repeatable >10% idle-task/mutation regressions, report production
  line-count changes and removed duplication.

## Acceptance scenarios

- Peer arrivals/departures/changed details; public/private popup reconciliation;
  group changes, empty filters, nested pinned drill-downs, navigation, outages.
- Fifty popup open/close cycles without retained document listeners; replacement
  during drag/resize; focus restoration; all existing public/private fields.
- GeoIP failure/recovery, dataset invalidation, API-disabled mode, duplicates,
  disconnected queued peers, and dataset changes during an in-flight lookup.
- Concurrent node clients, exact cache expiry boundaries, currency isolation,
  delayed/failed prices, partial RPC failures, and statistics invalidation.
- Cold/warm module loads, revision changes, invalid versions, MIME types, and no
  runtime-global dependencies.
- Existing themes, persistence, layout, reduced motion, actions, tooltips, and
  untrusted peer-string rendering remain covered by browser tests.

Use deterministic clocks/fixtures for cache and lifecycle tests. Run relevant
checks at each stage and all CI checks at completion. Record each working stage's
commit and results below. No database migration is expected; rollback is the
previous working application revision.

## Progress and handoff

- Starting branch: `refactor/lean-dashboard`; starting worktree clean at `9e4a456`.
- Reviewed baseline: 52 Python tests, JavaScript suites, browser regressions,
  lint/format and configured type checks pass. JavaScript: 17,974 lines / 27 files;
  existing strict check covers four files / 227 lines.
- Stage 1 validation: 57 Python tests pass; Ruff check/format pass. Browser
  lifecycle regressions are authored and will be wired into the layout suite with
  the shared-popup fix in Stage 2.
- Baseline benchmark, three runs (task seconds / 3 seconds, 14/125/500 peers):
  `0.451/0.869/1.362`, `0.455/0.859/1.358`, `0.497/0.835/1.380`.
  Medians: `0.455/0.859/1.362`; DOM nodes `666/2775/9900`; unchanged-poll
  mutations are zero in every run.
- Stage 1 commit: `e400176`.
- Stage 2 validation: JavaScript unit suites/type check and full browser suite
  pass, including live public/private details, departure during dragging, geometry/
  scroll preservation, and 50 private-popup cycles without listener retention.
  Removed the private popup implementation and duplicate duration/byte/service
  rendering. The shared popup owns pending opening/closing timers and cleanup.
- Next step: semantic filter reconciliation and frontend ownership.

Resume by checking this checklist against the working tree and commit history,
preserving unrelated changes, then implement the first incomplete stage. Update
this document after each stage with its commit, validation, and remaining work.
