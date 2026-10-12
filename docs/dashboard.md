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
