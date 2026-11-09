# Plan: optional inbound listener cleanup

Status: implementation in draft review. The policy remains Off by default and
requires an explicit management activation. Validation uses synthetic RPC data;
no live node trial or automatic peer removal has been performed for this PR.

## Problem and intended result

Long-lived inbound connections can occupy slots while only listening to this
node's announcements and answering keepalives. The operator wants to reclaim
those slots, including when the node has spare capacity. Saving bandwidth is a
secondary concern.

Add an optional **Inbound policy** panel to Bitcoin Peer Map. It explains which
connections meet a narrow listener heuristic and can, after explicit activation,
disconnect qualifying connections gradually. Off, Preview, and Automatic modes
make the difference between observing and changing the node visible.

RPC telemetry cannot establish that a peer is tracking the node. Legitimate
lightweight wallets can resemble passive listeners; self-reported software and
service flags are not verified identities. This feature limits the residence of
certain inbound connections. It does not prevent observation of a publicly
reachable node, identification through other peers, or reconnection.

## Evidence and scope

The motivating read-only inspection found several inbound connections advertising
no services, exchanging only handshake/address/keepalive messages, and receiving
announcements without supplying blocks or transactions. Two had remained for
roughly 65 hours while costing little bandwidth or CPU. Another had stopped
answering pings. These were point-in-time examples, not evidence of malicious
intent or permanent identities.

Do not include real peer addresses, RPC endpoints, credentials, raw snapshots, or
operator allowlists in this public plan, fixtures, or PR description. Later tests
use synthetic sessions. No live node calls are needed to review this proposal.

Knots already provides a 20-minute ping timeout and capacity-driven inbound
eviction. The proposed feature complements those mechanisms with an explicitly
chosen listener policy; it does not change their timers or replace their network
diversity protections.

## Proposed controls and defaults

All values below are proposed product defaults, not Bitcoin protocol requirements.

| Control | Proposed behavior |
| --- | --- |
| Mode | **Off** on first install; enabling starts **Preview** |
| Preview | Collect evidence and show proposed decisions; never send mutations |
| Automatic | Separate authenticated selection after a fresh 30-minute Preview trial |
| Evaluation | At most once per minute, using canonical peer observations |
| Connection grace | At least 60 minutes since connection establishment |
| Observation window | At least 30 uninterrupted minutes of complete, fresh local evidence |
| Listener allowance | Keep 0 qualifying listeners by default; configurable 0–20 |
| Trigger | Qualifying count exceeds allowance, even below the node's connection limit |
| Removal rate | At most 1 attempt per 5 minutes and 6 attempts per rolling hour |
| Address cooldown | At least 30 minutes between automatic attempts for the same normalized remote address |
| Connectivity floor | Pause at 12 or fewer total peers, or fewer than 4 outbound block-serving peers |
| History | At most 200 events, retained for at most 7 days |

The UI explains that selecting Automatic authorizes a server policy that continues
while the browser is closed or its management session expires. Off cancels pending
work. It cannot retract an RPC already dispatched. Returning to Preview stops new
mutations while continuing observation. Editing eligibility settings invalidates
affected evidence and cancels queued decisions before the new revision applies.

The 30-minute Preview trial is per node/runtime observation epoch. A restart
restores the saved requested mode but pauses Automatic for a new observation
window and trial; both may accrue together. Connection age alone never bypasses
local observation. Off does not collect session histories. Choosing Preview or
Automatic requires a configured administrator credential; ordinary viewers cannot
grant automation authority.

The allowance is a limit on this heuristic's candidates, not a reservation of
native inbound slots or an estimate of Knots' maximum connections. Current RPC
responses do not expose the configured inbound capacity. Do not infer it from a
protocol default or claim that removing one peer guarantees a better replacement.

## First policy: narrow, explainable listener candidates

A session qualifies only when **all** the following are known:

1. It is explicitly an inbound connection. Missing or contradictory direction or
   connection-type data makes it ineligible.
2. Both grace periods have elapsed, with a continuous observation window.
3. Its validated service bits contain neither `NODE_NETWORK` nor
   `NODE_NETWORK_LIMITED`. Pruned block-serving nodes remain protected.
4. Throughout the window, there is no new accepted-transaction, received-block, or
   first-block-announcement signal from it, and no advancing incoming chain data.
5. Traffic is compatible with a listener: handshake, keepalive, address exchange,
   and passive transaction/block announcements. There is no evidence of useful
   chain/filter downloads, synchronization work, or an ambiguous transfer.
6. It passes every exemption, health gate, allowance, and action limit below.

Use validated per-message counter deltas and contribution timestamps together.
Advance a window's activity boundary when useful activity appears; never treat
missing timestamps or counters as zero. A timestamp change counts as activity
without assuming synchronized local and node wall clocks. Impossible timestamps,
counter regressions, or malformed data invalidate the affected evidence.

Receiving our `inv` announcements does not exempt a peer: that is the behavior
this policy addresses. Requests for and transfers of headers, blocks, compact
blocks, block transactions, Merkle blocks, or compact filters do exempt it and
restart the observation window. Unknown message types or data that cannot be
classified conservatively make it ineligible. Transaction payload transfers or
`getdata` requests whose purpose cannot be established from RPC counters are also
treated as ambiguous and protect the peer. A tracker can therefore evade the
heuristic by requesting data; avoiding false certainty takes precedence.

Some quiet wallets will still qualify. State this before activation and provide
an explicit Keep exception. Do not offer a claim of complete wallet protection or
a configurable blacklist of software strings in this first version.

Do not use user agent, geography, ASN, high ping, upload/download ratio, old
`startingheight`, `synced_headers = -1`, `presynced_headers = -1`, deprecated
`misbehavior_score`, or one absent contribution as an independent removal reason.
Full-node service flags can be spoofed; a service-bearing observer is outside this
first heuristic rather than positively identified as useful.

## Exemptions, health gates, and ordering

- Exempt every outbound role, manual connection, permissioned peer, and operator
  Keep exception. Unknown permission data is protective.
- Protect active synchronization, chain/filter serving, and in-flight block work.
- Preserve at least one existing connection on each transport network. Where
  validated AS mapping exists, preserve at least `min(2, current known AS count)`
  distinct AS groups after removal; do not protect every unique listener AS.
  Missing optional AS mapping leaves this rule unavailable, with transport and
  connectivity floors still enforced. Do not invent groups or call an external
  GeoIP service. Show whether AS diversity was assessed in the decision evidence.
- Pause mutations while local initial block download is true or unknown, the
  network is inactive or unknown, or the configured chain/node scope has changed.
- Require validated chain/network health no older than 60 seconds and the newest
  successful peer observation no older than 30 seconds. Apply connectivity floors
  against the fresh pre-action set, allowing for the proposed removal.
- RPC failures, saturation, stale snapshots, gaps longer than 30 seconds, clock
  anomalies, or persistence failures pause actions. Lost observation continuity
  resets the affected windows; it is not a penalty against a peer.

Define outbound block-serving peers by validated outbound direction and
`NODE_NETWORK` or `NODE_NETWORK_LIMITED` service bits; manual outbound peers may
count toward the floor but remain exempt from removal. Zero observed useful work
is never used to erase those protections.

After exemptions, retain the configured listener allowance. Select one eligible
session at a time, longest connected first with a stable session-key tie-breaker.
Recompute exemptions and floors after each attempt. Expose the blocking reason
when the allowance cannot be reached. Safety gates may deliberately leave more
listeners than requested.

## Connection identity, reconnection, and dispatch

Evidence belongs to a connection, keyed by a runtime/node epoch plus peer ID,
remote address, connection time, and v2 session ID where available. It never
belongs to a peer ID alone. Reconnection starts fresh evidence; a node restart,
changed endpoint/network, disappearing session, or changed identity invalidates
the old window. Do not infer departures from failed polls.

An address cooldown normalizes the host without its ephemeral source port. It
only suppresses repeated actions; it never accuses a reconnecting peer or another
peer behind the same NAT. Keep exceptions are explicit operator address entries
with that shared-address consequence disclosed; support exact normalized IPv4,
IPv6, onion, and I2P addresses without DNS lookups or subnet bans in version one.

Use the existing disconnect RPC path, with a guarded internal dispatcher:

1. Serialize automated work; capture policy revision and session identity.
2. Re-read and validate peers through the canonical serialized refresh immediately
   before dispatch. Recheck identity, evidence, health, exceptions, floors, mode,
   and budget. A policy change or new activity cancels the decision.
3. Persist an attempt reservation with its reason, revision, and limits before
   sending `disconnectnode` by the numeric peer ID, after validating the complete
   connection identity. The v2 `session_id` is evidence, not an RPC target. A failed
   write cancels dispatch.
4. Record RPC success, definite failure, or uncertain outcome separately. Timeouts
   can mean the node acted; never retry blindly or release the reserved budget.
5. On a later successful observation, record whether that session disappeared.
   Say "departure observed after request", not that the RPC proved its cause.

One already transmitted RPC can complete after mode cancellation. A disconnect
does not ban an address or prevent a new session. A reconnect gets fresh grace,
so this feature limits occupied slots without promising persistent exclusion.
The RPC has no atomic compare-identity-and-disconnect operation: a node restart
between revalidation and dispatch leaves a residual ID-reuse race. Detect observed
restarts and reset evidence; do not describe this best-effort check as atomic.
Repeated reconnections appear in bounded recent decisions, not an IP reputation
score. Automatic bans, firewall changes, and temporary exclusion lists require a
separate future design and are outside this PR.

## UI preview

Add **Inbound policy** beside the existing peer-management toolbar controls,
near **Banned Peers**. Keep the table gear focused on display settings. Opening
the panel requires management access; no policy data is added to public tables,
exports, aggregate views, or ordinary peer APIs by default.

```text
Inbound policy                                      [Close]

Mode: [Off] [Preview selected] [Automatic]
Reclaim slots from persistent inbound listeners.

Inbound: 33    Qualifying: 3    Exempt: 2
Listener allowance: [0]        Grace: 60 min
Observation: 30 min            At most 1 / 5 min, 6 / hour

Preview: no changes to your node.
Automatic available after 18 more minutes of fresh Preview.

Connection A                 Would disconnect       [Keep]
Inbound for 2 days; no block-serving services;
only keepalive/address traffic observed for 30 minutes.

Connection B                 Protected
Serving historical blocks; observation window restarted.

Recent decisions
12:04  Connection C  Skipped: connection changed
12:01  Connection A  Would disconnect: allowance exceeded
```

Counts and examples above are illustrative, not current node telemetry. In
Automatic mode the panel shows the effective state (running, observing, paused,
or disabled), exact pause reason, next permitted action, and recent outcomes.
The enable dialog states the wallet tradeoff, reconnection/privacy limitations,
and browser-independent operation. Off remains immediately accessible. Keep and
Remove exception controls are explicit; there is no bulk-ban action.

Use neutral labels such as "listener candidate" and evidence-based reasons.
Avoid "tracker detected", "spy", and unexplained quality scores. Reuse existing
modal focus handling, keyboard controls, responsive layout, pending-state and
management authentication feedback. Close/logout cancels UI requests and removes
sensitive panel content; it does not silently change a saved server policy.

## Fit with the current application

The repository baseline for this plan is `df260a7` on `main`.

| Existing surface | Proposed implementation work |
| --- | --- |
| `src/server/services/peers.ts` | Observe canonical successful and failed `getpeerinfo` refreshes; current polling is every 10 seconds. No evidence collection from page reads or GeoIP enrichment. |
| `src/server/services/peer-rates.ts` | Follow its session identity, monotonic observation clock, stale cutoff, and reset patterns; leave bandwidth calculation independent. |
| `src/server/rpc-types.ts` | Validate required per-message maps, contribution/activity fields, permissions, service bits, direction, connection time, health fields such as `networkactive`, and optional session fields with bounded inputs. Preserve unknown values. |
| `src/server/runtime.ts` | Own a policy coordinator, observation lifecycle, single evaluator, health reads, and cancellation on shutdown. |
| `src/server/services/node.ts` | Factor a guarded internal disconnect dispatcher; retain current explicit manual-disconnect behavior and feedback. |
| `src/server/wallet-preferences.ts` | Follow its structured, atomic persistence approach for a separate versioned policy store. Existing `settings.json` accepts boolean preferences and should not acquire an incompatible nested schema. |
| `src/server/app.ts` | Explicit administrator checks for proposed policy GET and POST routes, plus existing origin protection for writes. Current public viewing mode must not expose policy history. |
| `src/server/openapi.json` and generated types | Define proposed policy config/status/decision contracts through the existing generation workflow. |
| `src/templates/index.html`, `src/static/js/peers/actions.js`, new scoped panel module | Add toolbar entry and lifecycle-managed dialog with the existing API/authentication components. |

Proposed contracts: administrator-only `GET /api/peer-policy` returns effective
state, evidence, exemptions, and bounded recent decisions; `POST /api/peer-policy`
applies a validated full settings document with an expected revision. Keep
exceptions are part of that revisioned document. Reject stale revisions so a
second browser cannot silently re-enable an older policy. These paths are
proposals, not endpoints added by this planning PR.
Policy reads and errors require private, no-store responses; protected HEAD
requests must follow the same access rules as GET.

Automatic operation uses only the configured node RPC and local state. It must
work with the browser closed and optional external requests disabled. Obtain
chain/network health through bounded, coalesced internal reads at most once per
minute while enabled, sharing existing service caches where suitable; do not
depend on someone opening the Node dashboard. Off adds no health-polling work.

## Persistence and sensitive data

Use a dedicated versioned `peer-policy.json` for settings, revision, normalized
Keep entries, non-secret node/network scope, and bounded policy state for attempt
reservations, cooldowns, and history. The implementation commits these together
in one atomic document so configuration changes cannot lose an attempt budget.
Retain action budgets across restart. Store the file under the configured
application data directory with atomic replacement and owner-only permissions.
A node-scope fingerprint must exclude
credentials and wallet paths; endpoint/network change requires fresh Preview.

Do not persist raw peer snapshots, transaction contents, or arbitrary RPC errors.
Record only the minimum identifiers and safe reason/outcome fields needed for
review. Limit observer/cooldown maps to 2,000 entries each; reaching a limit pauses
enforcement instead of evicting evidence or budget reservations. Prune expired
cooldowns and events, and cap each serialized policy file at 1 MiB. Bounds and
validation are
checked before allocating from RPC or saved input.

Configuration, budget, or audit write failure disables new automatic actions and
shows a management-visible error. Corrupt state must never silently restore
Automatic or clear active limits. A deliberate history-clear action cannot clear
unexpired action budgets. Credentials and raw addresses are excluded from generic
application logs and public responses; detailed history remains administrator-only.

## Implementation sequence and review gates

1. Add validated observations, pure eligibility rules, bounded session state, and
   synthetic fixtures. Verify every protective/unknown branch before any dispatch.
2. Add Preview persistence, explicit administrator-only contracts, and the panel.
   Exercise a fresh observation-only trial against an operator-approved node;
   previous snapshots do not count. Inspect candidates and wallet exceptions.
3. Add serialized, cancellable automatic dispatch, persisted budgets, outcome
   reconciliation, health gates, and mode/revision checks. Keep Off as default.
4. Complete API generation, operational documentation, browser validation, and a
   mock-RPC end-to-end trial. Any trial that disconnects live peers requires its
   own explicit operator activation; this planning PR authorizes no node changes.

Proposed future acceptance checks:

- Listener-only synthetic sessions qualify after both windows, including when
  native connection capacity is not reached; allowance and grace are honored.
- Quiet legitimate wallets can be explained and kept explicitly. Historical
  downloads, compact-filter/header serving, in-flight work, pruned nodes, outbound
  roles, manual/permissioned peers, and diversity/floor exceptions stay protected.
- A sole-AS listener remains eligible when its removal preserves the configured
  diversity floor. Nodes without AS mapping can still reclaim listeners while
  enforcing transport and connectivity protections.
- Missing versus zero fields, malformed/oversized maps, unknown messages, unusual
  service masks, counter resets, cached snapshots, clock jumps, and RPC gaps cannot
  create false eligible sessions. Page reads never advance observation.
- Reconnects, reused IDs, node restart, endpoint/chain changes, concurrent policy
  edits, and new activity between selection and dispatch invalidate old decisions.
- Fake-clock and concurrent-evaluator tests enforce cooldowns, rolling budgets,
  restart retention, cancellation, and single dispatch. Ambiguous RPC results do
  not trigger duplicate retries; failed persistence prevents new calls.
- Public and viewer clients cannot read or mutate policy details; administrator
  access, write-origin checks, expired sessions, revision conflicts, and input
  validation follow existing authentication contracts.
- Browser tests cover Preview/Automatic/Off, enable disclosure, Keep exceptions,
  evidence and pause reasons, refresh persistence, logout cleanup, keyboard/focus,
  narrow screens, and no leaked timers or duplicate handlers.
- Mock-RPC tests demonstrate operation with the browser closed, Off doing no
  policy work, external requests disabled, and clean shutdown during an action.

Use Node 26 and the repository's relevant server/unit tests, API-generation check,
JavaScript/type checks, and scoped browser/layout tests when implementation exists.
Container/compose validation becomes relevant if persistence or deployment contracts
change. The original planning commit contained only this document. The
implementation draft must pass those checks against the actual policy and UI;
an operator-approved observation-only live trial remains a separate review step.

## Primary references

- [Knots 29.4.3 RPC peer-field definitions](https://github.com/bitcoinknots/bitcoin/blob/v29.4.3.knots20260508/src/rpc/net.cpp)
- [Native ping timeout](https://github.com/bitcoinknots/bitcoin/blob/v29.4.3.knots20260508/src/net.h#L57-L58)
- [Capacity-triggered inbound eviction](https://github.com/bitcoinknots/bitcoin/blob/v29.4.3.knots20260508/src/net.cpp#L1872-L1883)
- [Eviction protections and network diversity](https://github.com/bitcoinknots/bitcoin/blob/v29.4.3.knots20260508/src/node/eviction.cpp#L88-L215)

These immutable version references explain the inspected node's behavior. Feature
implementation must negotiate the actual connected RPC capabilities and pause
automatic actions where required evidence is unavailable.
