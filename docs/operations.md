# Operations

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

Use this guide to maintain a deployed instance. Run commands from the directory
containing `compose.yaml`; examples use the default port and data-volume name.
For first installation, follow the [quick start](../README.md#quick-start).

## Start, stop, and update

Start the service, or apply changes to `.env`:

```bash
docker compose up -d bpm
```

Pull the newest published image and recreate the service:

```bash
docker compose pull bpm
docker compose up -d bpm
```

Keep the data volume when upgrading. The `latest` image follows successfully
tested stable GitHub Releases in increasing version order; older maintenance
releases do not move it backward. Merging into `main` does not publish an image.
Wait for the release workflow to finish before pulling. Images support Linux
AMD64 and ARM64; see [release publishing](releasing.md) for build validation.

Stop the service while retaining its container and data:

```bash
docker compose stop bpm
```

`docker compose down` also retains the named volume. Adding `--volumes` deletes
that saved data.

### Pin a build

Set `BPM_IMAGE` in `.env` to a release tag, a full source-commit tag, or a digest:

```env
BPM_IMAGE=ghcr.io/spyhunter493/bitcoin-peer-map:v1.3.0
```

The other accepted forms are
`ghcr.io/spyhunter493/bitcoin-peer-map:sha-<full-commit>` and
`ghcr.io/spyhunter493/bitcoin-peer-map@sha256:<digest>`. Run the same pull and
recreate commands after changing the reference. Pin an earlier release the same
way when rolling back, keeping a backup of your current data first.

### Version and update notices

The dashboard header shows the installed version. When enabled, release checks
look for a newer stable GitHub Release at startup if needed, then every 24 hours.
An arrow opens that release's notes. Drafts, prereleases, equal or older versions,
and unreleased commits do not produce an update notice; `dev` builds skip checks.

Results are saved across restarts and refreshed when the installed version
changes. A failed check retains the last known update and waits 24 hours to
retry. Dashboard polling reads the cache. Enable release checks through
[GeoIP updates and privacy](#geoip-updates-and-privacy).

## Check status and logs

```bash
docker compose ps
docker inspect bitcoin-peer-map-bpm-1 --format '{{.State.Health.Status}}'
curl http://HOST_IP:58333/healthz
docker compose logs -f --tail=100 bpm
```

If you changed the Compose project name, use its container name for `inspect`.
`/healthz` confirms that the HTTP server is alive; it does not test current
Bitcoin RPC or GeoIP availability. The dashboard's **Peer data** indicator reports
the node connection and identifies retained snapshots after a failed refresh.
See [dashboard status](dashboard.md#check-data-and-node-status).

Logs include a UTC timestamp, severity, and component. `BPM_LOG_LEVEL=info` is
the default. Set it to `debug` in `.env` and recreate the service for RPC method
names, timings, and retry details. Restore `info` after troubleshooting. `warn`
and `error` restrict output to those severities and above; values ignore case.

Recurring background failures log immediately, then at most once per minute
per operation. Recovery produces one info message; debug mode includes intervening
attempts. Startup failures log on each restart, and unexpected HTTP errors log
per failed request. Credentials and authorization headers are redacted; full RPC
responses, parameters, and HTTP request bodies are omitted. Logs use standard
output/error, with Compose rotation of three files up to 10 MiB each.

For effective RPC endpoints and settings, see
[configuration inspection](configuration.md#inspect-the-effective-configuration).
The [API reference](api.md) explains `/api/connectivity` and the provider-health
fields also returned by `/api/info`. A disabled optional feature reports
`disabled` and does not produce outage prompts. Reachability-probe and GeoIP
provider health are independent.

## Keep and back up saved data

The default volume `bitcoin-peer-map-data` mounts at `/var/lib/bitcoin-peer-map`.
`BPM_DATA_VOLUME` selects another volume for a separate instance.

| File or directory | Contents |
| --- | --- |
| `geo.db` | Cached peer locations in SQLite |
| `settings.json` | Saved GeoIP and optional-outbound preferences |
| `update-check.json` | Application update status and last check time |
| `tmp/` | Temporary GeoIP dataset downloads |

RPC credentials are not written to this volume. Keep `.env`, Compose overrides,
and any mounted secret files separately. Browser display preferences live under
`bpm.*` keys in that browser. Remembered access sessions live in server memory
and are invalidated when the service restarts.

### Back up the volume

Stop the service to make a consistent SQLite backup. This uses the configured
BPM image and volume, so it also works with a custom `BPM_DATA_VOLUME`:

```bash
docker compose stop bpm
docker compose run --rm --no-deps -T --entrypoint tar bpm \
  -C /var/lib/bitcoin-peer-map -czf - . > bpm-data-backup.tar.gz
docker compose up -d bpm
```

Keep the archive somewhere separate from the deployment. To restore, stop BPM
and set `BPM_DATA_VOLUME` in `.env` to a new, unused volume name. Restore into
that empty volume so files left by another database cannot affect the backup:

```bash
docker compose stop bpm
docker compose run --rm --no-deps -T --entrypoint tar bpm \
  -C /var/lib/bitcoin-peer-map -xzf - < bpm-data-backup.tar.gz
docker compose up -d bpm
```

The previous volume remains available if you need to switch back. These commands
preserve the container user's file ownership; they do not restore `.env` or
browser preferences.

### Repair saved preferences

An unreadable or invalid `settings.json` stops startup before RPC checks,
background work, or HTTP listening. The error identifies the path without
printing its contents, and the file stays untouched. Environment overrides do
not bypass validation.

Stop BPM, back up the volume, and repair the JSON or its read permissions while
keeping your privacy choices. Preferences must be an object containing JSON
booleans, with no quotes around `true` or `false`. For example:

```json
{
  "geoip_auto_update": false,
  "geoip_db_only": true,
  "optional_outbound": false
}
```

Missing fields use defaults: auto-update is enabled, API Lookup is disabled
(`geoip_db_only=true`), and optional outbound is disabled. Dataset-download,
release-check, and reachability-check flags default to enabled but remain blocked
by the global outbound setting. `BPM_OUTBOUND_ENABLED=true` seeds a missing
global preference; it never replaces an explicitly saved `false`. Deleting the
file restores defaults, so repair it to preserve restrictions. Ensure UID/GID
`10001` can read it, then restart. `BPM_GEOIP_AUTO_UPDATE` applies after validation.

## GeoIP updates and privacy

Open **GEOIP-DB** to inspect the database and change server preferences.
Changes require [administrator access](access-control.md). Optional outbound
requests and **API Lookup** are disabled on new installs; saved choices are
restored before workers start, including after container recreation.

| Control | What it permits |
| --- | --- |
| Optional outbound | Global opt-in for optional server internet requests |
| Dataset downloads | Automatic and manual GeoIP dataset downloads |
| Release checks | Application update checks |
| Reachability checks | Internet reachability probes |
| Auto-update | Dataset checks at startup and hourly |
| API Lookup | Missing/stale public-peer lookups through free ip-api over HTTP |
| Manual update | A dataset update on demand |

All outbound controls depend on the global opt-in. For local dataset updates,
enable **Optional outbound** and **Dataset downloads**, then use **Manual update**
or **Auto-update**. Leave **API Lookup** off for database-only peer locations.

**API Lookup sends peer IPs to ip-api.com over unencrypted HTTP.** Both API Lookup
and global outbound must be enabled for those requests. Dataset downloads,
release checks, and reachability probes have separate switches. See the
[provider-health reference](api.md#provider-health-and-refresh-retries) for
statuses and retry rules.

`BPM_OUTBOUND_ENABLED=false` prohibits optional requests even if an administrator
changes the saved preference. `BPM_GEOIP_AUTO_UPDATE` can override automatic
scheduling. Turning on auto-update starts a check immediately when allowed.
Turning off a feature's outbound permission cancels its requests and prevents
later retries from scheduling traffic. A validated download may still finish
its local database merge.

Imports add new IPs and replace usable existing records only when their observation
timestamp is newer, preserving newer API results. Invalid rows are skipped; a
dataset with no valid rows is rejected. The update result counts added, updated,
and skipped rows. Cached locations stay visible during refreshes; peer details
show their source, age, and freshness.

The policy allows the configured Bitcoin RPC connection, including its DNS/TLS,
and local cache reads/writes. It does not control browser links or operating-system
traffic. `BPM_GEOIP_ENABLED=false` disables persistent GeoIP storage; use
outbound/API Lookup settings to control external peer lookups. If an older open
tab asks you to reload before changing settings, refresh it first.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Container restarts or never becomes healthy | Read startup logs. Check RPC host/port/credentials, `BITCOIN_NETWORK`, required viewing credentials, and saved-preference errors. |
| Healthy container, stale peers or Node Info | Check the dashboard's last successful refresh and RPC reachability. Health checks only test the HTTP service; cached peers do not confirm current connections. |
| Viewing or management login fails | Check the configured role/token, HTTPS/proxy setup, and any displayed cooldown. A restart requires signing in again. See [access control](access-control.md). |
| Management is unavailable | Configure an administrator token and the corresponding Bitcoin RPC methods; see [RPC setup](configuration.md#bitcoin-rpc). |
| Peer locations are missing | Inspect GEOIP-DB. A fresh install needs a dataset download or explicit API Lookup opt-in; private networks have no public-IP location. |
| GeoIP cannot update or reports a cooldown | Check global outbound and dataset/API permissions. Provider rate limits and outage backoff delay retries; internet-probe failures are separate. |
| No new image after a `main` merge | Images publish from stable GitHub Releases after the release workflow succeeds. Check whether `BPM_IMAGE` is pinned. |
| New table columns are missing | Existing browser column choices are preserved. Enable columns in **Table Settings**, or choose **Defaults**. |

## Container defaults

The supplied image and Compose configuration run as UID/GID `10001`, with a
read-only root filesystem, all Linux capabilities dropped, and
`no-new-privileges`. Writable paths are the data volume and a 64 MiB `/tmp` tmpfs
with `noexec` and `nosuid`. Logs rotate at 10 MiB across up to three files.

The image health check uses `/healthz`, allows 60 seconds for startup, then
checks every 30 seconds with a five-second timeout. Three consecutive failures
mark the container unhealthy. Compose publishes the default dashboard port on
all host interfaces; see [host access](configuration.md#host-access-and-multiple-instances)
to choose a binding and [access control](access-control.md) to protect deployment.
