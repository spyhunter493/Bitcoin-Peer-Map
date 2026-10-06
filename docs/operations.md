# Operations

[README](../README.md) · [Configuration](configuration.md) · [Development](development.md)

Run these commands from the directory containing `compose.yaml`. The examples
use the default dashboard port, `58333`.

## Update the application

```bash
docker compose pull bpm
docker compose up -d bpm
```

The `latest` image follows successfully tested stable GitHub Releases in
increasing semantic-version order. Older maintenance releases do not move it
backward. Release images are built once and smoke-tested on AMD64 and ARM64
before upload; version and SHA tags identify the tested multi-platform index.
Registry failures stop `latest` promotion. Merges into `main`
do not publish images. Published images support Linux AMD64 and ARM64. Keep the
existing data volume when recreating the service.

### Pin a build

Each release has a version tag and a `sha-<full-commit>` tag. To stay on a specific
release, set `BPM_IMAGE` in `.env`:

```env
BPM_IMAGE=ghcr.io/spyhunter493/bitcoin-peer-map:v1.3.0
```

Alternatively, pin the release's exact source commit:

```env
BPM_IMAGE=ghcr.io/spyhunter493/bitcoin-peer-map:sha-<full-commit>
```

An image digest (`ghcr.io/spyhunter493/bitcoin-peer-map@sha256:<digest>`) is also
accepted. Use the normal pull and recreate commands after changing the reference.

### Version and update notices

The header shows the installed release version. An arrow appears when the latest
published stable GitHub Release has a higher semantic version; clicking it opens
that release's notes. Unreleased commits on `main` never cause a notice. The
version comes from `BPM_BUILD_VERSION`; `BPM_BUILD_REVISION` remains internal
source metadata.

The server checks at startup if no recent result exists, then once every
**24 hours**, even without an open dashboard. The cache survives restarts and is
refreshed when the installed release version changes. Old commit-comparison
caches are discarded. Dashboard requests only read the cache.

A failed check waits 24 hours before retrying and retains any previously known
update. Development builds (`dev`) skip checks even when their revision is known.
Equal/older releases and a repository with no published release do not show an
update arrow. GitHub drafts and prereleases are excluded. Wait for the release
workflow to succeed before pulling; publishing release notes precedes the image
build.

## Status, health, and logs

Check the service and its container health:

```bash
docker compose ps
docker inspect bitcoin-peer-map-bpm-1 --format '{{.State.Health.Status}}'
```

The health endpoint is also available at:

```bash
curl http://HOST_IP:58333/healthz
```

Follow the application logs:

```bash
docker compose logs -f --tail=100 bpm
```

Application messages include a UTC timestamp, severity, and component:

```text
2026-10-05T20:48:20.123Z INFO [startup] Bitcoin RPC is available
2026-10-05T20:48:25.456Z WARN [peers] Peer refresh failed: connection refused
```

`BPM_LOG_LEVEL=info` is the default and includes info, warnings, and errors.
Set it to `debug` in `.env` and recreate the service with `docker compose up -d bpm`
for RPC method names, response timings, and retry details. `warn` includes warnings
and errors; `error` includes only errors. Values are case-insensitive. Restore
`info` after troubleshooting to keep routine polling quiet.

Recurring background failures are reported immediately, then at most once per
minute per operation. A successful retry produces one info message announcing
recovery. Debug mode also shows the intervening failed attempts. This throttling
does not change polling or retry schedules. Startup failures are reported on each
container restart, and unexpected HTTP errors are reported for each failed request.
Credentials and authorization headers are redacted from application messages.
RPC diagnostics include method names and timings; full RPC responses, RPC
parameters, and HTTP request bodies are omitted.

Logs remain on standard output/error. Compose retains its existing rotation of
three files of up to `10m` each. `/api/config` reports the configured log level
under `server.log_level`.

For RPC endpoints and effective settings, see
[configuration inspection](configuration.md#inspect-the-effective-configuration).

`/api/connectivity` reports reachability-probe status and `providers.geoip` health;
`/api/info` also includes the same provider health for dashboard polling.
GeoIP reports its state, consecutive failures, last error, success/failure
timestamps, and retry deadline. The `api_available` and `api_consecutive_failures`
fields refer to GeoIP.

Provider failures do not change probe status, and failed Google probes do not
suppress GeoIP lookups or provider notices.
A separate HEAD request to Google runs at startup and every 30 seconds while
online, with two-second retries while offline. Any HTTP response proves
reachability. Failed probes turn the status yellow, then red after ten seconds;
four successful probes restore green.

GeoIP honors `Retry-After` seconds or HTTP dates, plus `X-Rl: 0` and `X-Ttl`, including on
successful responses, as described by [ip-api](https://ip-api.com/docs/api:json#usage_limits).
HTTP 429 defaults to a 60-second cooldown when no valid retry header is supplied.
After five consecutive provider failures, outage retries wait 30, 60, 120, 240,
then at most 300 seconds. A successful recovery clears outage backoff while
preserving any active quota deadline. Recovery attempts resume when deadlines expire.

To stop the dashboard while retaining its data volume:

```bash
docker compose down
```

The header and **Node Info** show **Synced** only when the node explicitly reports
that initial block download is complete, **Syncing (IBD)** while it is active,
and **Unknown** when that status is unavailable. Failed node-info refreshes show
**Stale** and retain useful cached details; Node Info identifies the last
successful refresh time. Traffic values clear until a successful refresh.
Requests time out after 35 seconds, allowing later polls to recover.

## Saved data

The named volume `bitcoin-peer-map-data` is mounted at
`/var/lib/bitcoin-peer-map`.

| File or directory | Contents |
| --- | --- |
| `geo.db` | Cached peer locations in SQLite |
| `settings.json` | Server preferences for GeoIP lookups and automatic dataset updates |
| `update-check.json` | Application update status and last check time |
| `tmp/` | Temporary files used during GeoIP dataset updates |

RPC credentials are never written to this volume. Display preferences, such as
themes and visible statistics, are stored in your browser under `bpm.*` keys.

Existing GeoIP databases and server preferences from earlier releases can be
reused. Keep the volume when upgrading to preserve them.

### Repair saved preferences

A missing `settings.json` starts a first installation with defaults. An existing
file that cannot be read, is malformed JSON, is not an object, or supplies a
non-boolean preference stops startup before RPC checks, workers, HTTP listening,
or preference writes. The error identifies its path without logging its contents;
the file remains untouched. Environment overrides do not bypass validation.

Stop the service, back up the file, and repair its JSON or ownership/read
permissions in the data volume. Keep your previous privacy choices. For example,
this valid file disables both external API lookups and automatic dataset downloads:

```json
{
  "geoip_auto_update": false,
  "geoip_db_only": true
}
```

Use JSON `true`/`false`, without quotes. Legacy files may omit fields:
`geoip_auto_update` defaults to `true` and `geoip_db_only` to `false` when absent.
Deleting the file restores those first-install defaults; repair it instead when
you want to retain privacy restrictions. Ensure the container user can read it,
then restart the service. `BPM_GEOIP_AUTO_UPDATE` applies only after the saved
file has passed validation.

### Peer management results

**Disconnect + Ban 24h** sends the ban request. Bitcoin Knots requests the peer's
disconnection as part of [`setban`](https://github.com/bitcoinknots/bitcoin/blob/29.x-knots/src/rpc/net.cpp#L794-L817),
so the dashboard reports a successful ban and refreshes peers after one second.
**Disconnect Only** remains a separate action. Failed or malformed ban-list
responses display an error; **No banned IPs** appears only after a successful
empty list.

## Distribution coverage

Provider percentages and the HHI distribution score describe public peers with
known AS information. The displayed X/Y coverage counts show how many public
peers are identified, with inbound and outbound counts beside the combined view.
Overview charts use the full connected-peer snapshot independently of table or
map filters. A small identified sample does not establish the distribution of
the whole node; a zero-sized sample has an unavailable score.

Country coverage is independent of provider coverage. Summary categories include
unidentified peers in their totals and show provider coverage for that category.
Unknown provider information is labelled Unknown in the hosting summary. Usable
stale records continue to count as known; peer details expose their freshness.

## GeoIP updates and privacy

Open **GEOIP-DB** in the dashboard to manage the local database:

| Control | Behavior |
| --- | --- |
| Auto-update | Downloads the GeoIP dataset at startup and hourly after each completed attempt |
| API Lookup | Looks up missing, stale, or unknown-age public peer IPs through ip-api.com |
| Manual update | Updates the dataset on demand, including when auto-update is disabled |

Auto-update and API Lookup are enabled on new installs. Both choices are saved
and restored before peer workers start, including after container recreation.
`BPM_GEOIP_AUTO_UPDATE` can override the saved auto-update preference.

Enabling auto-update starts a check immediately. Disabling it prevents future
checks; an update already running finishes normally. Dataset imports add new IPs
and replace records only when the downloaded `last_updated` timestamp is newer,
preserving newer local API results.
Peer details show the winning record's source, observation time, age, and
freshness. Locations become stale at 30 days; missing, zero, or future timestamps
have unknown age. Source is recorded as downloaded dataset or ip-api.com in a
local companion table, while older records with no provenance report unknown.
Imports retain their record timestamps rather than becoming fresh on download.

Cached locations remain visible while refreshing. An unsuccessful refresh with
usable cached data retries after one hour; missing locations retry after 60
seconds. Provider cooldowns also apply, and only active public peers are queried.
Optional Source, Geo age, and Freshness table columns expose the same metadata.
Invalid dataset rows are skipped and cannot replace local locations. The update
result reports how many rows were added, updated, and skipped; a dataset with no
valid rows is rejected without changes. Temporary SQLite writer contention is
retried without blocking HTTP requests. Failed API location saves remain available
for active peers and retry after 60 seconds without another provider lookup.

Settings use explicit desired values, so repeated saves and database-only recovery
are safe when the mode is already enabled. Older dashboard tabs using toggle
endpoints receive a reload message and cannot change settings until refreshed.

API Lookup sends the queried peer IP to ip-api.com over unencrypted HTTP; the
provider's [free endpoint does not support HTTPS](https://ip-api.com/docs/api:json).
Turn it off for database-only peer lookups. Valid coordinates map to their real
location even when no city is supplied. Labels use city and country, then region
and country, then country alone; unresolved locations retain their pending or
unavailable states. Dataset downloads, application update
checks, and internet reachability probes operate separately and still use the
network.
`BPM_GEOIP_ENABLED=false` disables the persistent database, rather than disabling
external peer lookups.

## Dashboard controls

**Peer data** reports the connection to your Bitcoin node. If RPC fails, the
dashboard retains the last successful peer snapshot and identifies the outage.
Its tooltip shows the last successful snapshot time. The top-right countdown
shows when the next refresh is due.

**Node Info** includes a Services block explaining the P2P services advertised by
your node. An empty list means no services are advertised; unavailable service
information is shown separately.
The transaction index shows **Disabled**, **Syncing**, **Ready**, or **Unknown**,
with the indexed block height in its tooltip when available. An older server
reporting only index presence shows **Enabled** without claiming readiness.
Chain-tip age lookup timeouts preserve the tip list and identify unavailable ages.

Missing ping measurements display **—** and do not affect averages or rankings.
Measured zero remains valid, and positive pings below 0.1 ms display **<0.1ms**.

**Blocks** and **Chain Tips** link recognized public-network block hashes to
[mempool.guide](https://mempool.guide/). Testnet3 and local regtest hashes remain
plain text: mempool.guide does not support Testnet3, and regtest data belongs to
your local chain.

**Node Metrics** shows Bitcoin Knots uptime and P2P traffic reported by node RPC.
Open it by clicking the peer count or a traffic row on the map. P2P rates are
averaged between RPC samples; totals count bytes since the node started. Rates
show as unavailable until two valid samples exist, including after an outage or
node restart. CPU, RAM, load, host uptime, and filesystem capacity are not collected.

The four P2P rate and total rows can be shown or hidden. These display choices are
saved in your browser, and existing traffic-row preferences remain supported.
Zoom controls stay below the visible statistics.

**Table Settings** (the peer-list gear) controls columns, transparency, and visible
rows. **Show in Antarctica** switches map placeholders for private networks and
peers without a location on or off; those peers remain in the table and network
totals. The choice is saved in your browser, and **Defaults** restores the markers.

## Container defaults

The supplied Compose configuration:

- Runs as the unprivileged `bpm` user, with UID/GID `10001`.
- Uses a read-only root filesystem.
- Drops all Linux capabilities and enables `no-new-privileges`.
- Limits writable paths to the data volume and a 64 MiB `/tmp` tmpfs.
- Disables execution and set-user-ID behavior on `/tmp`.
- Rotates JSON container logs at 10 MiB with up to three files.
- Uses `/healthz` for the container health check.

Source-built images allow 60 seconds for startup before health-check failures count.
The health endpoint reports HTTP server availability; RPC outages are reported by
`/api/peers?include_status=true` and the dashboard's Peer data indicator.
