# Operations

[README](../README.md) · [Configuration](configuration.md) · [Development](development.md)

Run these commands from the directory containing `compose.yaml`. The examples
use the default dashboard port, `58333`.

## Update the application

```bash
docker compose pull bpm
docker compose up -d bpm
```

The `latest` image follows successful builds of `main`. Published images support
Linux AMD64 and ARM64. Keep the existing data volume when recreating the service.

### Pin a build

Each published build also has a `sha-<full-commit>` tag. To stay on a specific
build, set `BPM_IMAGE` in `.env` using the full Git commit:

```env
BPM_IMAGE=ghcr.io/spyhunter493/bitcoin-peer-map:sha-<full-commit>
```

An image digest (`ghcr.io/spyhunter493/bitcoin-peer-map@sha256:<digest>`) is also
accepted. Use the normal pull and recreate commands after changing the reference.

### Version and update notices

The seven-character commit beside the name links to the installed revision.
An arrow appears beside it when newer commits are available on `main`; clicking
the arrow opens the changes since the installed commit.

The server checks at startup if no recent result exists, then once every
**24 hours**, even without an open dashboard. The cache survives restarts and is
refreshed when the installed commit or repository changes. Dashboard requests
only read the cache.

A failed check waits 24 hours before retrying and retains any previously known
update. Unknown builds skip checks. Builds ahead of or diverged from `main` do
not show an update arrow.

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
Turn it off for database-only peer lookups. Dataset downloads, BTC price requests,
and application update checks operate separately and still use the network.
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

**System Info** lets you toggle CPU, RAM, NET, and P2P rows. Open it by clicking a
system or traffic row on the map. NET shows system transfer rates; P2P shows byte
totals reported by the Bitcoin node since it started. These display choices are
saved in your browser, and zoom controls stay below the visible statistics.

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
