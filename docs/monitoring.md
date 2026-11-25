# Monitoring, history, and shared views

[Dashboard](dashboard.md) · [Operations](operations.md) · [Access control](access-control.md)

**Monitoring** appears in the peer toolbar while management is unlocked. It
contains **History**, **Trends**, **Health**, and **Alerts**. These features and
**Saved views** require administrator access in every viewing mode, including a
public dashboard. Locking management clears their private contents and pending
requests. Historical peer addresses, Keep notes, and saved queries are not saved
in browser storage.

## Recording and history

History recording starts **off**. Enable it explicitly in Monitoring → History.
Once enabled, the server records while browsers are closed. Turning recording
off stops new connection and trend records; it does not erase existing history.
Existing records expire after thirty days. No records are invented for the time
before collection started.

The first successful peer observation establishes a baseline. Later successful
observations identify arrivals and departures. An RPC failure creates a monitoring
gap, rather than a list of disconnected peers. Recovery starts a new baseline:
peers may have connected or disconnected during the gap without being observed.
A dashboard restart or an ambiguous connection identity is not proof that a peer
disconnected. Reappearance of an address does not prove that it is the same
client, particularly behind a shared address.

Manual management requests and automatic policy decisions are recorded separately
from observations. RPC acceptance is not proof of a subsequent connection or
departure, and a departure after a request does not prove its cause. Shared
administrator credentials do not identify an individual operator.

History has source, event-kind, and address/reason filters and cursor-based pages.
Trends show peer counts, transport counts, and Bitcoin P2P traffic for one hour,
24 hours, seven days, or thirty days. Policy outcome reports use the same selected
period and show accepted requests, observed departures, and same-address returns.
Missing traffic samples break chart lines instead of displaying zero activity.

Every report includes actual collection coverage, gaps, and dropped records.
Thirty days is a retention limit, not a promise that thirty complete days have
been collected. The recorder also bounds event count, minute samples, database
size, and its pending write queue. High churn or storage faults can shorten the
available interval; reports make that loss visible. History queries and retention
work run in a worker rather than in the HTTP/RPC event loop.

## Health and diagnostics

Health combines cached peer-data freshness, bounded RPC timing/queue statistics,
GeoIP state, inbound policy health, recorder health, and installed build identity.
Opening or refreshing this panel does not send new RPC probes or run database
integrity scans. Disabled optional services are displayed as disabled.

**Copy diagnostics** creates a redacted report without credentials, RPC endpoint
URLs, filesystem paths, wallet data, or peer addresses. When clipboard access is
unavailable, the report is selected for manual copying. `/healthz` continues to
report HTTP liveness only; it does not assert Bitcoin RPC readiness.

## Alerts

Preset rules have individual on/off switches. Alerts are evaluated on the server
and appear in the inbox and the Monitoring badge after management is unlocked.
They do not use browser desktop notifications or external delivery services.

| Rule | Condition |
| --- | --- |
| Peer data | No successful observation for sixty seconds |
| Low outbound connectivity | Fewer than four outbound peers for two minutes, after a two-minute startup grace period; stale observations reset the low-peer timer |
| Policy failure | A definite RPC-failure guard or policy-storage fault while policy is enabled; ordinary Preview/startup/IBD pauses are excluded |
| Recording failure | Recording is enabled and storage fails or records are dropped |

There is one active incident per rule. Acknowledging it is shared across devices
and does not hide an ongoing condition. Thirty seconds of recovery resolves it.
Active incidents remain until resolved; resolved incident history is bounded to
thirty days and 1,000 records. If persistent storage fails, a bounded in-memory
inbox still displays active problems and identifies degraded persistence. Alerts
remain available when history recording is disabled and never change node policy
or take corrective actions.

## Shared saved views

Saved views belong to the configured node/network and are shared by administrators
across devices. They can be saved, applied, updated, renamed, and deleted. Applying
a view is explicit; opening the dashboard does not automatically apply one.

- **Peer list** views include search, enabled networks, semantic filters, columns
  and their order, and sorting.
- **Policy Connections** views include search, status/network filters, and page
  size. Applying one opens Connections without changing policy configuration.

Views match current peers, including new connections, rather than retaining old
peer-ID lists or snapshots. A filter that matches nothing stays empty. Removed
columns are reported and skipped; unsupported filters are not silently widened.
Views exclude wallet details, policy mode/allowance/Keep changes, pinned peers,
and camera or popup state. Concurrent edits require reloading the latest revision
before saving again. The collection is limited to fifty views and 256 KiB.

## Performance presets

Map Settings offers **Full visuals**, **Reduced effects**, and **Static map**.
Full preserves the current appearance. Reduced removes expensive effects and
limits canvas frame rates. Static removes decorative motion and camera easing,
while still updating for data, interaction, layout, and preference changes.

The choice is browser-local. It does not overwrite Advanced appearance values,
so returning to Full restores those customizations. Operating-system reduced
motion remains an upper limit. Presets do not stop polling, automatic policy
processing, or independently configured wallet rotation. Shared dialogs continue
to pause background rendering until the last dialog closes.
