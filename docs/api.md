# API reference

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

Open `/docs` on your BPM instance for interactive endpoint documentation;
`/redoc` is an alias for the same local Swagger UI. `/openapi.json` serves the
specification. Detailed reads follow the configured viewing policy; management
requires an administrator credential. See [Access control](access-control.md)
for bearer tokens, browser sessions, HTTPS and errors.

## Common endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | HTTP server liveness; does not assert RPC readiness |
| `GET /api/access` | Viewing mode and remembered session state |
| `GET /api/view/aggregate` | Restricted aggregate view; anonymous access depends on viewing mode |
| `GET /api/peers` | Connected peer records |
| `GET /api/peers?include_status=true` | Records plus RPC status and snapshot timestamps |
| `GET /api/info` | Node details, RPC metrics, provider health and cached update status |
| `GET /api/config` | Effective settings and build information, without credentials |
| `GET /api/config/outbound` | Saved and effective optional-request policy |
| `POST /api/geodb/db-only` | Set database-only mode with `{ "enabled": boolean }` |
| `POST /api/geodb/auto-update` | Set automatic dataset scheduling with `{ "enabled": boolean }` |

For example, read a protected peer snapshot using your deployment's HTTPS address:

```bash
curl -H 'Authorization: Bearer YOUR_VIEW_TOKEN' \
  'https://YOUR_BPM_HOST/api/peers?include_status=true'
```

The interactive specification contains the complete route, parameter and response
reference; the sections below explain guarantees that matter to contributors. [Architecture](architecture.md) covers
browser ownership and lifecycle rules.

## Update the contract

[`src/server/openapi.json`](../src/server/openapi.json) is the canonical HTTP
contract. When changing a request, serialized response or stream payload:

1. Update its OpenAPI schema and the producing code.
2. Run `npm run generate:api`.
3. Commit [`src/shared/api.generated.d.ts`](../src/shared/api.generated.d.ts) with
   the producer change. Generated declarations are not edited by hand.
4. Run `npm run check:api`, `npm run check:types` and relevant tests.

CI validates real HTTP responses and browser fixtures against the schemas.
`check:api` checks freshness without writing files. OpenAPI describes HTTP data;
RPC parsers, controller state and browser projections remain separate. Preserve
nullable values, optional omissions, string peer ports (including empty strings),
numeric-string peer IDs and passthrough extensions. The legacy stream's `message`
and `system` events use its `x-events` schemas.

Generation uses the private tool in `scripts/api-codegen`, pinned to
`openapi-typescript` 7.13.0 and TypeScript 5.9.3 for its AST API. The application
uses TypeScript 7 and native Node 26. `npm ci --ignore-scripts` installs both
toolchains without peer-dependency overrides. Ajv is test-only; production needs
no generation step or runtime schema-validation dependency.

## RPC capacity, caching and cancellation

RPC allows eight active calls and 32 FIFO queued calls. Queue time counts toward
the deadline; cancelled or expired queued work never dispatches. Overflow returns
HTTP 503 with `code: "rpc_busy"` and `Retry-After: 1`. Mutations are never retried
automatically.

Shared blockchain, mempool, ban and index reads cache success for five seconds
from load start and failure for one second from completion. Failed refreshes
replace earlier successes. Mutations invalidate affected caches, including
in-flight reads, and consumers receive independent copies. Node details and
RPC metrics also share five-second caches. Metrics come from Bitcoin Knots
`uptime` and `getnettotals`; host/container CPU, memory and filesystem metrics
are not collected. P2P rates need valid samples and reset after outages/restarts;
unavailable measurements are null.

Chain-tip reads have a 15-second overall deadline. Tips and optional blockchain
metadata load concurrently with ten- and five-second budgets. Four workers enrich
up to 100 tip ages for up to five seconds inside the overall budget. Optional
timeouts retain valid tips with unavailable ages and
`summary.age_lookup_timed_out: true`; `age_lookup_limited` identifies the 100-tip
cap. Completed partial/full results cache for five seconds from completion;
returning them refreshes ages and generation timestamps.

Shared reads own their cancellation controller. Closing a response detaches its
subscriber; losing the last subscriber cancels the work. A block-header read
still needed by the dashboard survives closing a chain-tip dialog.

## Interpret peer and node fields

RPC results remain `unknown` until [RPC parsers](../src/server/rpc-types.ts)
validate them. Failed or malformed peer snapshots retain the last successful
snapshot; a successful empty result clears it. Network fields are validated
independently, so unavailable fields stay null while unrelated data remains usable.

| Field or state | Meaning |
| --- | --- |
| `addrman_status: present` | Normalized host and explicit port matched the latest valid `getnodeaddresses` inventory |
| `addrman_status: not_returned` | Omitted from the filtered inventory; does not establish absence from Addrman |
| `addrman_status: unavailable` | Inventory refresh or endpoint cannot support the comparison |
| `in_addrman` | Compatibility boolean; true only for `present` |
| `ping_ms` | Fractional milliseconds or null; measured zero is valid |
| `blockchain.ibd` | Explicit false means synced, true means initial block download, unavailable means unknown |
| `blockchain.txindex_status` | Disabled, syncing, ready or unknown; `txindex_height` is supplied when available |
| `services` | `getnetworkinfo.localservicesnames`; an empty list means none advertised, null means unavailable |

Missing ping/coordinates display `—` and sort last in both directions. Unknown
pings are excluded from averages/rankings; positive pings below 0.1 ms display
`<0.1ms`. Located peers retain genuine zero coordinates, including older snapshots
without location status. Pending/private/unavailable placeholders have no usable
coordinates, and equal-value coordinate sorts preserve order.

Failed inventory refreshes suppress Addrman claims from retained metadata.
The legacy `indexed` boolean is true for valid syncing or ready transaction
indexes; clients receiving only that boolean may claim enabled, not ready.

The dashboard has one node-info poll with a 35-second abort deadline. Every
completion path releases the pending request. Failed refreshes retain node details,
mark them stale with their last successful time, and clear traffic values. Update
status is read from the server cache rather than triggering a GitHub request.
See the [dashboard guide](dashboard.md) for display controls.

## GeoIP settings and persistence

GeoIP setters persist before changing live state. Repeating a desired value
performs no preference write or timer reset. Retired toggle endpoints require
admin authentication and return HTTP 410 without mutation; clients must reload
or use setters. Outbound policy and privacy controls are covered in
[Operations](operations.md).

Dataset validation streams inside the merge worker. Invalid rows are skipped;
results report `added_rows`, `updated_rows` and `skipped_rows`. A dataset containing
no valid rows fails without changes.

Both lookup paths, saves, hydration and imports enforce bounded GeoIP data:
lookups accept at most 65,536 decoded response bytes while streaming before JSON
parsing, including compressed/chunked responses. Top-level strings have a
4,096-byte UTF-8 limit checked before trimming or coordinate conversion. Oversized
responses are cancelled and use sanitized provider failure/backoff reporting;
failed lookups retain previously valid cached locations.

Oversized stored rows are rejected before their large fields enter JavaScript.
They stay on disk until a bounded replacement arrives under the saved privacy
policy. API saves and imports may replace size-rejected rows despite timestamps,
updating provenance atomically; oversized incoming dataset rows count as skipped.

API saves report saved, superseded, disabled, cancelled or failed outcomes.
Valid stored records with newer/equal observation timestamps win. SQLite writer
contention retries asynchronously from 50 to 500 ms for at most 65 seconds,
with zero synchronous busy timeout. Timestamps are captured once. Failed payloads
stay in the active-peer cache and retry after 60 seconds without another provider
lookup; dataset generation changes preserve them. Shutdown cancels waits and
drains the resolver before SQLite closes. Pending memory-only payloads have no
persistent retry queue and are abandoned on shutdown.

## Provider health and refresh retries

`/api/connectivity` and `/api/info` expose `providers.geoip` health: state,
consecutive failures, last error, success/failure times and retry deadline.
`api_available` and `api_consecutive_failures` describe GeoIP, independently of
reachability. Policy-disabled work reports `disabled` and does not cause outage
prompts. Provider failures do not change probe state; failed probes do not block
GeoIP lookups or provider notices.

When enabled, a HEAD request to Google runs at startup, then every 30 seconds
while green and every two seconds during recovery, with a two-second request
timeout. Any HTTP response proves reachability. Failed probes show yellow,
then red after ten seconds; four successful probes restore green. Yellow/green
transitions log at debug, entering red logs one warning, and recovery from red
logs one info message.

GeoIP honors `Retry-After` seconds/HTTP dates and quota headers `X-Rl: 0` with
`X-Ttl`, including successful responses. HTTP 429 falls back to a 60-second
cooldown. From five consecutive failures, outage backoff is 30, 60, 120, 240,
then at most 300 seconds. Successful recovery clears outage backoff while
preserving an active quota deadline; lookups resume after applicable deadlines.

Location records become stale after 30 days. Missing, zero or future timestamps
have unknown age. Dataset imports preserve their observation timestamps and
replace usable local records only when newer; provenance records dataset or
ip-api origin, while legacy records can have unknown source. Cached locations
remain visible during refresh. Failed refreshes with usable cached data retry
after one hour; missing locations retry after 60 seconds. Provider cooldowns
also apply, and only active public peers are queried.
