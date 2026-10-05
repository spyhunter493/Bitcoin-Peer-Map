# Operations

[README](../README.md) · [Configuration](configuration.md) · [Development](development.md)

Run these commands from the directory containing `compose.yaml`. The examples
use the default dashboard port, `58333`.

## Update the application

```bash
docker compose pull bpm
docker compose up -d bpm
```

The `latest` image follows intentional stable GitHub Releases. Merges into `main`
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

The header shows the installed release version and the seven-character commit
linking to its exact source. An arrow appears when the latest published stable
GitHub Release has a higher semantic version; clicking it opens that release's
notes. Unreleased commits on `main` never cause a notice. The version comes from
`BPM_BUILD_VERSION`; `BPM_BUILD_REVISION` remains the source commit.

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

For RPC endpoints and effective settings, see
[configuration inspection](configuration.md#inspect-the-effective-configuration).

`/api/connectivity` reports internet reachability and `providers.geoip` health.
GeoIP reports its state, consecutive failures, last error, success/failure
timestamps, and retry deadline. The `api_available` and `api_consecutive_failures`
fields refer to GeoIP.

Provider failures do not change internet status or trigger reachability checks.
A separate HEAD request to Google runs at startup and every 30 seconds while
online, with two-second retries while offline. Any HTTP response proves
reachability. Failed probes turn the status yellow, then red after ten seconds;
four successful probes restore green.

Rate limits pause only the affected provider. Both providers honor `Retry-After`
seconds or HTTP dates. GeoIP also honors `X-Rl: 0` and `X-Ttl`, including on
successful responses, as described by [ip-api](https://ip-api.com/docs/api:json#usage_limits).
HTTP 429 defaults to a 60-second cooldown when no valid retry header is supplied.

To stop the dashboard while retaining its data volume:

```bash
docker compose down
```

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

## GeoIP updates and privacy

Open **GEOIP-DB** in the dashboard to manage the local database:

| Control | Behavior |
| --- | --- |
| Auto-update | Downloads the GeoIP dataset at startup and hourly after each completed attempt |
| API Lookup | Looks up public peer IPs missing from the local database through ip-api.com |
| Manual update | Updates the dataset on demand, including when auto-update is disabled |

Auto-update and API Lookup are enabled on new installs. Both choices are saved
and restored before peer workers start, including after container recreation.
`BPM_GEOIP_AUTO_UPDATE` can override the saved auto-update preference.

Enabling auto-update starts a check immediately. Disabling it prevents future
checks; an update already running finishes normally. Dataset imports add new IPs
and replace records only when the downloaded `last_updated` timestamp is newer,
preserving newer local API results.

API Lookup sends the queried peer IP to ip-api.com over unencrypted HTTP; the
provider's [free endpoint does not support HTTPS](https://ip-api.com/docs/api:json).
Turn it off for database-only peer lookups. Dataset downloads, application update
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

**Node Metrics** shows Bitcoin Knots uptime and P2P traffic reported by node RPC.
Open it by clicking the peer count or a traffic row on the map. P2P rates are
averaged between RPC samples; totals count bytes since the node started. Rates
show as unavailable until two valid samples exist, including after an outage or
node restart. CPU, RAM, load, host uptime, and filesystem capacity are not collected.

The four P2P rate and total rows can be shown or hidden. These display choices are
saved in your browser, and existing traffic-row preferences remain supported.
Zoom controls stay below the visible statistics.

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
