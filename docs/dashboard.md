# Dashboard guide

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

Use the dashboard to explore connected peers, inspect your Bitcoin Knots node,
and manage connections. Server setup belongs in [Configuration](configuration.md);
upgrades, backups, and GeoIP policy belong in [Operations](operations.md).

## Unlock the dashboard

Viewing is private by default. Enter a viewing or administrator token on the
access screen. The browser remembers access for 30 days, including after closing
and reopening a tab, unless you lock it or restart the service.

**Lock view** revokes that browser's viewing and management sessions, clears
private displayed data, and returns to the access screen. Management has a
separate unlock: the first action asks for an administrator token, and **Lock**
signs out of management while preserving a separate viewing session. Unlocking
the view with an administrator token does not automatically unlock management.
See [access control](access-control.md) for public/redacted modes and deployment
requirements.

## Watch-only wallet balances

The wallet control sits between the refresh countdown and map/sync indicators.
Click it to open **Wallets**, an anchored options panel. While locked, clicking
the generic wallet control opens **Unlock management**. Wallet access requires
`BPM_ADMIN_TOKEN` and the optional [wallet RPC permissions](configuration.md#optional-watch-only-wallet-ticker).

Tick the wallets to display. New wallets start unchecked, and shared selections
and display settings survive service restarts. Each available selected wallet
shows its amount and unit in turn; names appear inside the options panel. The
panel highlights the current wallet and shows its **Balance**, **Pending incoming**,
and availability. **Balance** is the node-reported trusted amount, including
qualifying unconfirmed own change; it is not a strictly confirmed-output total.
Wallets are shown individually, so overlapping watch-only wallets are not summed.

Choose BTC or sats, a 5/8/15/30-second rotation interval, or **Pause rotation**.
Pausing rotation does not stop balance refreshes. Rotation also pauses while the
panel is open, while hovering or focusing the control, and when the tab is hidden.
Reduced motion keeps the active amount still; use the panel's previous/next
controls to move through selected wallets. The active entry stays stable during
ordinary refreshes.

Settings and balances refresh every thirty seconds while management is unlocked
and the tab is visible. Wallet RPC reads start only while wallets are selected or
options are open. **—** means no currently available selected balance, not zero.
Scanning, unloaded, ineligible, and failed wallets show their state in options and
do not rotate. Saved unavailable selections remain available to uncheck or resume
after the wallet recovers. Checkboxes affect display choices; they do not load or
unload node wallets.

On narrow headers the control compacts to a wallet button; its panel still shows
the complete list. Escape or clicking outside closes the panel and restores
focus. **Lock**, **Lock view**, and session expiry clear its contents immediately.
Wallet names and balances are kept out of browser storage and public dashboard
responses. Without administrator access configured, the wallet control is hidden.

## Find and export peers

Search beside **Connect Peer** matches every word, ignoring case, across peer
IDs, addresses, software, locations, providers, networks, connection types, and
inbound/outbound direction. For example, `outbound tor` finds outbound Tor peers
within the current filters. Search remains in place as peer data refreshes.

Network, distribution, provider, country, and private-view selections combine
with search. The matching count shows the result against the full peer total;
filter chips show the active scope. Remove a chip to broaden that scope. Removing
**Private view** returns to the public world with **All** networks. **Clear filters**
clears search and every scope, including selections hidden by the private view.
The search clear button, or Escape in the search field, clears only the search.

Click a column heading to cycle ascending, descending, and unsorted order.
**Table Settings** (the peer-list gear) controls columns, transparency, and visible
rows. Choices are saved in your browser. Existing customized tables keep their
chosen columns after upgrades; enable new columns or choose **Defaults**.

**Export** downloads every matching peer in the current sort order, including
rows outside the visible table:

| Format | Contents |
| --- | --- |
| CSV | Visible columns and their display values |
| JSON | Complete peer records, counts, filters, sort, columns, and export time |

An empty result exports a CSV header or an empty JSON peer list.

## Explore the map and distributions

Map peers by location and select networks or groups to inspect their connections.
**Explore distribution** opens provider and country views, with category,
direction, provider, insight, and peer controls for further detail.
**Explore private peers** covers Tor, I2P, and CJDNS peers.

**Show in Antarctica** in Table Settings controls map placeholders for private
networks and peers without a location. These markers are placeholders; they do
not identify physical locations. Hiding them retains those peers in the table
and network totals. The browser remembers the choice; **Defaults** restores them.

Provider percentages and the HHI distribution score use public peers with known
AS information. Coverage details show X/Y counts of identified public peers,
including inbound and outbound coverage. Country coverage is separate. Overview
charts use the full connected-peer snapshot independently of table or map filters.
A small identified sample may poorly represent the node; no identified sample
means the score is unavailable.

Summary categories include unidentified peers in their totals and show provider
coverage for that category. Missing providers appear as **Unknown** in hosting
summaries. Usable stale locations still count as known; inspect their freshness
in peer details.

## Read peer details

Each row has **Details** and **Disconnect** controls. Details work for public and
private peers, including peers still awaiting a location.

| Field | How to read it |
| --- | --- |
| Ping | **—** means unmeasured and is excluded from averages/rankings. Zero is valid; positive values below 0.1 ms show **<0.1ms**. |
| Addrman | **Yes** means the exact host and port appeared in the last valid inventory. **Not returned** does not establish absence. **Unavailable** means a valid comparison cannot be made. |
| Coordinates | Known coordinates show two decimal places, including zero. Missing values show **—** and sort last in either direction. |
| Source, Geo age, Freshness | The location record's source, observation age, and freshness. These are also optional table columns. |

Locations become stale at 30 days. Missing, zero, or future observation timestamps
have unknown age; older records without provenance have an unknown source.
Downloading a dataset preserves record timestamps. Cached locations remain
usable during refreshes. Public peers with coordinates map to their location
even when no city is available; labels fall back to region/country or country.
See [GeoIP settings](operations.md#geoip-updates-and-privacy) to manage updates.

### Traffic and bandwidth

**Sent** and **Recv** are cumulative bytes for the peer connection. **Send rate**
and **Recv rate** are bytes per second averaged between successful RPC snapshots,
normally ten seconds apart. Sort the rates to find peers using the most bandwidth.
They also appear in public/private peer details and CSV exports; JSON uses
`tx_bps` and `rx_bps`.

Measured idle traffic shows `0 B/s`; unavailable rates show **—**. First
observations, reconnections, missing/reset counters, failed polls, or samples
more than 30 seconds apart need a new baseline. Stale/unavailable data clears
rates while retaining peer details and cumulative totals. Each direction can be
available independently.

## Check data and node status

**Peer data** reports the Bitcoin RPC connection. Failed refreshes retain the last
successful peer snapshot and mark the outage. Hover the indicator for the last
successful snapshot time; the top-right countdown shows the next refresh.
Peer counts during an outage describe that retained snapshot.

The header and **Node Info** show **Synced** only when initial block download is
explicitly complete, **Syncing (IBD)** while active, and **Unknown** when the status
is unavailable. Failed node-info refreshes show **Stale**, retain cached details,
and identify the last successful refresh. Traffic values clear until recovery.
Requests time out after 35 seconds, allowing subsequent polls to recover.

**Node Info** explains advertised P2P services. An empty list means no advertised
services; unavailable information appears separately. Transaction indexing shows
**Disabled**, **Syncing**, **Ready**, or **Unknown**, with indexed height in the
tooltip when available. An older response reporting only presence shows **Enabled**
without claiming readiness. Chain-tip age timeouts retain the tips and mark
unavailable ages.

**Blocks** and **Chain Tips** link recognized public-network block hashes to
[mempool.guide](https://mempool.guide/). Testnet3 and local regtest hashes remain
plain text.

### Node Metrics

Click the map's peer count or a traffic row to open **Node Metrics**. It shows
Bitcoin Knots uptime and P2P traffic from RPC. Totals count bytes since node
startup; rates average successive samples. Rates are unavailable until two valid
samples exist, including after an outage or node restart.

The dashboard does not collect CPU, RAM, load, host uptime, or filesystem
capacity. The four P2P rate/total map rows can be shown or hidden, with choices
saved in your browser. Zoom controls stay below visible statistics.

## Manage connections

An administrator token and the appropriate Bitcoin RPC permissions are required;
see [access control](access-control.md) and [RPC setup](configuration.md#bitcoin-rpc).
Canceling an unlock prompt leaves the pending action unexecuted.

- **Connect Peer** requests a connection to an entered peer endpoint.
- A peer's **Disconnect** button offers **Disconnect Only** and, when supported
  for its endpoint, **Disconnect + Ban 24h**.
- **Banned Peers** lists bans and offers **Unban** or **Clear All Bans**.

The ban action sends Bitcoin Knots a ban request, which also requests
disconnection; a successful result refreshes peers after one second. Failed or
malformed ban-list responses show an error. **No banned IPs** appears only after
a successful empty response.

## Inbound listener policy

**Inbound policy**, beside **Banned Peers**, requires a management unlock even on
a public dashboard. It starts **Off**. Opening the panel does not enable it.
While management is unlocked, the toolbar shows the requested mode and effective
state even with the panel closed. **Turn policy Off** stops new work without
opening the panel. A failed status read shows an unknown state rather than a
cached claim that automation is running or stopped.

- **Preview** collects evidence and shows candidate reasons without changing node
  connections. Complete a fresh 30-minute observation trial before Automatic.
  Its conditional proposal shows the removal order and earliest permitted times,
  listeners retained by the allowance, and connections blocked by evidence or
  safety protections. Later steps assume the observed set stays unchanged; each
  real action still requires fresh validation.
- **Automatic** requires an explicit enable acknowledgment. It runs on the server
  while the browser is closed or management is locked.
- **Off** stops new automatic actions and policy observation. An RPC already
  transmitted may still complete. Closing the panel only closes its display.

The listener allowance applies to qualifying candidates, including when native
connection slots remain free. Zero requests gradual removal of every eligible
candidate. **Keep address** adds an exception across sessions; other connections
sharing the same address are exempt too. Remove exceptions in the same panel.
Changes refresh the observation window where necessary.

A candidate must be inbound, at least an hour old, advertise no full or limited
block-serving services, and have 30 uninterrupted minutes of complete, quiet
evidence. Useful contributions, active or ambiguous transfers, missing metadata,
and synchronization protect it. Outbound, manually configured, permissioned,
pruned/full block-serving peers and Keep exceptions are exempt. The policy also
preserves connectivity and transport/AS diversity floors.

The panel shows connection age, observed quiet time, remaining grace, eligibility
or protection reasons, effective state, pause reason, next permitted action, and
recent outcomes. Search by address or reported software, filter by status or
transport network, and select **10**, **20**, **30**, **40**, **50**, or **All**
peers per page. The default is ten; Previous and Next reach every matching connection without rendering all
cards. Candidates appear first. Evidence and conditional proposal details are
available on each displayed connection.
Automatic attempts are limited to one per five minutes, six per rolling hour,
and one per address per 30 minutes. Failures and uncertain outcomes consume the
budget. The policy disconnects connections; it never automatically bans addresses.

Permission or unsupported-method failures from disconnect requests pause
Automatic immediately. Three other definite disconnect failures without an
accepted request also pause it. This pause survives
a BPM restart; explicitly select Preview to clear it and collect a fresh trial
before enabling Automatic again. Existing attempt budgets remain reserved.

The results summary covers retained attempts from the last seven days: accepted
requests, distinct attempted connections whose departure was observed, and those
followed by a newly observed same-address connection. Repeated requests against
one connection cannot inflate the departure or return counts.
An accepted RPC is not confirmation of departure, and a same-address return may
be another device behind the same address. These observations help assess churn;
they do not establish identity, causation, or a better replacement connection.

Failed/stale peer observations, node restart, clock anomalies, or changed node
scope require fresh evidence. A BPM restart restores the requested mode but
Automatic waits for a new trial. Missing required RPC fields leave peers
ineligible. Reasons appear in the panel instead of treating missing values as
zero. Clicking the app background, using the close button, or pressing Escape
closes the panel. Switching away from the browser or hiding the tab leaves it
open. When local management access is suspended, requests stop and private
evidence clears until access is revalidated; form drafts remain. Session expiry
and locking management also close the panel and clear its private contents.
None of those display changes revoke a saved server policy.

These rules identify listener-like behavior, not intent. Quiet wallets may qualify;
use Keep for known addresses. A tracker can request data, advertise services, or
reconnect to avoid the heuristic. Disconnecting cannot prevent observation of a
publicly reachable node. See [policy persistence](operations.md#inbound-policy-state)
and the [design](plans/inbound-listener-cleanup.md) for the precise protections.

## Keyboard controls and Support

Tab and Shift+Tab move through the complete sorted, filtered peer list, revealing
rows as needed. Enter or Space on a column heading changes sort order. Network
filter buttons announce their selected state. Polling retains the focused peer
and action, or moves to the nearest surviving row when that peer leaves.

Provider/Country tabs support Left/Right arrows, Home, and End. Pinned group
details allow nonmodal exploration: focus enters the dialog, Escape closes the
deepest open layer, and closing restores the invoking control. Hover previews
keep keyboard focus where it is. Private-peer exploration uses the same controls.
The Export menu supports Up/Down, Home/End, and Escape.

The header's **Support** button opens the project's Bitcoin address and QR code.
On narrower screens, use **Support with Bitcoin** in the **Map Settings** gear
instead. The dialog offers **Copy address** and **Open wallet**. If copying is
unavailable, the address is selected for manual copying. Opening the dialog loads
local assets and does not contact a payment service.
