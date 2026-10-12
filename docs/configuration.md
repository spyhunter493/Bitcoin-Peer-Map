# Configuration

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

Start with [the quick start](../README.md#quick-start) and
[`.env.example`](../.env.example). This guide covers connecting your node, choosing
dashboard access, and configuring a deployment. Docker Compose reads `.env` and
passes the supported application settings to the container.

## Bitcoin RPC

Bitcoin Peer Map supports Bitcoin Knots nodes and connects to their JSON-RPC
interface over HTTP or HTTPS. Bitcoin Core is no longer supported. Provide the
RPC endpoint and dedicated credentials in `.env`.

An example Bitcoin Knots configuration for a dedicated RPC account on a local
network:

```ini
server=1
rpcbind=0.0.0.0
rpcallowip=192.168.1.0/24
rpcuser=bpm
rpcpassword=replace-with-a-long-random-password
```

Match the username and password in the dashboard's `.env`. Restrict `rpcbind` and
`rpcallowip` to the interface and subnet that need access, and keep Bitcoin RPC
off the public internet. Prefer `rpcauth` over plaintext `rpcuser` and
`rpcpassword` where practical.

### Limit the BPM account's RPC methods

Knots supports a per-user [`rpcwhitelist`](https://github.com/bitcoinknots/bitcoin/blob/29.x-knots/src/init.cpp).
For the complete read-only dashboard, add this to the node's configuration and
leave `BPM_ADMIN_TOKEN` unset:

```ini
rpcwhitelistdefault=0
rpcwhitelist=bpm:getbestblockhash,getblock,getblockchaininfo,getblockheader,getchaintips,getindexinfo,getmempoolinfo,getnettotals,getnetworkinfo,getnodeaddresses,getpeerinfo,listbanned,uptime
```

For peer management, configure `BPM_ADMIN_TOKEN` and **replace** that whitelist
line with the complete list below. It adds only `addnode`, `clearbanned`,
`disconnectnode`, and `setban`:

```ini
rpcwhitelistdefault=0
rpcwhitelist=bpm:addnode,clearbanned,disconnectnode,getbestblockhash,getblock,getblockchaininfo,getblockheader,getchaintips,getindexinfo,getmempoolinfo,getnettotals,getnetworkinfo,getnodeaddresses,getpeerinfo,listbanned,setban,uptime
```

Use the username from `BITCOIN_RPC_USER` in place of `bpm`, and restart Knots
after changing its configuration. Repeated whitelist lines for the same user
are intersected, so a second line containing only the management methods would
remove the read methods. `rpcwhitelistdefault=0` keeps other RPC accounts,
including the cookie account, working as before while restricting BPM. Use
`rpcwhitelistdefault=1` only when every account that needs access has an explicit
whitelist; adding a whitelist without setting the default also denies unlisted
accounts.

The whitelist grants methods, not particular arguments: for example, `setban`
permits adding and removing bans. It does not authenticate dashboard users or
replace the BPM admin token. No wallet or node shutdown methods are required.
After restarting, check `getnetworkinfo` using the BPM credentials and verify
that an unlisted method such as `getrpcinfo` returns HTTP 403. Knots also returns
403 for a required method omitted from the whitelist; BPM currently reports
that as an RPC authentication failure, so check the whitelist as well as the
credentials when troubleshooting.

### Another Compose project

Attach both projects to the same external Docker network. For an existing
network named `bitcoin-rpc`, add this to the dashboard's `compose.override.yaml`:

```yaml
networks:
  default:
    external: true
    name: bitcoin-rpc
```

The Bitcoin Knots service must also be attached to that network. Set
`BITCOIN_RPC_HOST` to its service or container hostname.

## Choose dashboard access

### Viewing access

`BPM_VIEW_MODE` controls what visitors can see:

| Mode | Anonymous access | Credential needed at startup |
| --- | --- | --- |
| `authenticated` (default) | Login screen and public assets/docs/health endpoint | Viewing or administrator token |
| `redacted` | Availability and coarse peer-count ranges | Viewing or administrator token |
| `public` | Full monitoring view | None for viewing |

Set `BPM_VIEW_TOKEN` for monitoring, or use `BPM_ADMIN_TOKEN` to permit both
viewing and management. If both are configured, they must differ. Mounted token
files are also supported. A viewing token never permits management actions.
Redacted counts can still reveal changes over time; see the
[access policy](access-control.md#viewing-policy) for the data it exposes.

Successful browser logins are remembered for 30 days, including after closing
and reopening the dashboard. **Lock view** ends that browser's viewing and
management sessions and clears private data. Restarting the service ends all
remembered sessions. Use HTTPS when sending credentials.

When upgrading a deployment that previously allowed public access implicitly,
set a viewing/admin token before recreating the service, or explicitly select
`BPM_VIEW_MODE=public`. An unset viewing mode now defaults to authenticated.
Missing optional-outbound preferences also default to disabled.

### Admin token and read-only mode

Leave `BPM_ADMIN_TOKEN` and `BPM_ADMIN_TOKEN_FILE` empty to disable management.
Configure a separate viewing token for a private monitoring-only deployment.
An authenticated reverse proxy does not enable management by itself.

To enable management, set `BPM_ADMIN_TOKEN` to your chosen token in `.env`.
Keep it separate from your Bitcoin RPC password. A long random token is
recommended; generate one with:

```bash
openssl rand -hex 32
```

Protect `.env` with `chmod 600 .env`, then apply token changes with
`docker compose up -d --force-recreate bpm`. Recreate the service after changing
a mounted token file too; it is read only at startup. This revokes the previous
token and all remembered sessions.

The first management action opens **Unlock management** and verifies the admin
token before running the action. Management is remembered separately for 30 days.
**Lock** ends management for that browser while preserving a separate viewing
session. Unlocking viewing alone does not grant management, even when you use an
admin token. Cancelling the dialog leaves the pending action unexecuted.

Management covers peer connect/disconnect/ban/unban, clearing bans, GeoIP and
outbound settings, dataset updates, and the server's connectivity acknowledgement.
See [access control](access-control.md) for session, token, and API details.

## Network and deployment

### Bitcoin networks and peer ports

`BITCOIN_NETWORK` must match the node's RPC-reported chain at startup. The
supported names are `main`, `test` (legacy testnet), `testnet4`, `signet`, and
`regtest`; aliases such as `testnet` are not accepted. Peer connections without
an explicit port use these [Bitcoin Knots defaults](https://github.com/bitcoinknots/bitcoin/blob/29.x-knots/src/kernel/chainparams.cpp):

| Chain | Default peer port |
| --- | ---: |
| `main` | 8333 |
| `test` | 18333 |
| `testnet4` | 48333 |
| `signet` | 38333 |
| `regtest` | 18444 |

For example, with `BITCOIN_NETWORK=testnet4`, connecting to `1.2.3.4` or
`[2001:db8::1]` selects port `48333`. Explicit ports are retained. Tor and CJDNS
use the same default; I2P addresses must explicitly end in `:0`.
Block explorer links are available for mainnet, signet, and testnet4; other
networks display hashes without links.

`BITCOIN_RPC_PORT` remains independently configured and defaults to `8332` on
all networks. Set it to the node's actual RPC port for non-mainnet deployments.
These network defaults apply to peer connections only.

### Host access and multiple instances

For a reverse proxy on the same host, set `BPM_HOST_BIND=127.0.0.1`; the
application still listens on `0.0.0.0` inside its container. A proxy in another
container can reach it over a shared Docker network instead. Configure HTTPS at
the proxy and restrict direct backend access so clients cannot bypass it.

Preserve the external `Host` header. Browser POSTs require a matching Origin host;
cookie-authenticated POSTs, remembered login, and logout also require an explicit
Origin. The server accepts HTTP and HTTPS origins on that host for TLS termination.
See [request protection](access-control.md#origin-and-host-checks).

To run another instance, use a distinct Compose project name (`docker compose -p
bpm-second ...`), `BPM_HOST_PORT`, and `BPM_DATA_VOLUME`. Keep the existing volume
name during normal upgrades to retain saved data and preferences.

### Trusted proxy addresses

Authentication failure limits use the socket address by default and ignore
forwarding headers. Visitors behind one proxy share that limit. To distinguish
visitors, configure only the proxy IPs or CIDRs you control, for example:

```env
BPM_TRUSTED_PROXIES=127.0.0.1,::1,172.20.0.5/32
```

Hostnames, wildcards, malformed or blank list entries, and `/0` ranges fail
startup. Loopback and private networks are not trusted automatically. Restrict
backend access to your proxies and have them overwrite incoming `X-Forwarded-For`
or append the verified connection peer. Use narrow ranges. Proxy trust does not
authenticate users or relax the Host/Origin checks. See
[proxy identity rules](access-control.md#proxy-identity).

### Inspect the effective configuration

`/api/config` reports the RPC endpoint, server and GeoIP settings, and installed
build without exposing credentials:

```bash
curl -H 'Authorization: Bearer YOUR_VIEW_TOKEN' https://YOUR_DASHBOARD_HOST/api/config
```

Replace the URL with your dashboard's address. For a local HTTP deployment, use
`http://127.0.0.1:58333/api/config`. `/api/config/outbound` reports saved preferences
and the effective optional-request policy, including deployment restrictions.
See [GeoIP and outbound controls](operations.md#geoip-updates-and-privacy).

## Environment variables

Defaults below apply to the standard [Compose deployment](../compose.yaml).
Set the RPC host and credentials, then choose a viewing or administrator token
for the default private view.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BITCOIN_RPC_HOST` | `bitcoin` | Node hostname or IP address; set this to your node |
| `BITCOIN_RPC_USER` | Required | Dedicated RPC username |
| `BITCOIN_RPC_PASSWORD` | Required unless a password file is used | RPC password |
| `BITCOIN_RPC_PASSWORD_FILE` | Unset | Path to a mounted file containing the RPC password |
| `BITCOIN_RPC_SCHEME` | `http` | RPC transport: `http` or `https` |
| `BITCOIN_RPC_PORT` | `8332` | Node RPC port |
| `BITCOIN_RPC_VERIFY_TLS` | `true` | Verify the certificate when using HTTPS |
| `BITCOIN_RPC_TIMEOUT` | `30` | RPC request timeout, in seconds |
| `BITCOIN_NETWORK` | `main` | Node network: `main`, `test`, `testnet4`, `signet`, or `regtest` |
| `BPM_RPC_STARTUP_TIMEOUT` | `30` | Time to wait for RPC during startup, in seconds |
| `BPM_ADMIN_TOKEN` | Unset (read-only) | Shared secret required for peer management and server settings changes |
| `BPM_ADMIN_TOKEN_FILE` | Unset | Mounted administrator-token file; use instead of the direct token |
| `BPM_VIEW_MODE` | `authenticated` | `authenticated` requires a viewing/admin credential; `redacted` allows coarse anonymous aggregates; `public` allows anonymous detailed monitoring |
| `BPM_VIEW_TOKEN` | Unset | Shared credential for detailed monitoring, with no management permission |
| `BPM_VIEW_TOKEN_FILE` | Unset | Mounted viewing-token file; use instead of the direct token |
| `BPM_OUTBOUND_ENABLED` | Unset | `false` prohibits optional internet requests; unset uses saved preferences with optional requests disabled by default; `true` seeds opt-in only if that preference is absent |
| `BPM_TRUSTED_PROXIES` | Empty (trust none) | Comma-separated literal IP addresses or CIDRs allowed to supply client addresses for anonymous authentication throttling |
| `BPM_LOG_LEVEL` | `info` | Minimum server log level: `debug`, `info`, `warn`, or `error` |
| `BPM_IMAGE` | `ghcr.io/spyhunter493/bitcoin-peer-map:latest` | Published image reference; use a tag or digest to pin a build |
| `BPM_HOST_BIND` | `0.0.0.0` | Host interface to publish on; use `127.0.0.1` for access through a local reverse proxy |
| `BPM_HOST_PORT` | `58333` | Dashboard port published on the Docker host |
| `BPM_LISTEN_PORT` | `58333` | Dashboard port inside the container |
| `BPM_DATA_VOLUME` | `bitcoin-peer-map-data` | Named data volume; use a different name for a separate instance |
| `BPM_GEOIP_ENABLED` | `true` | Enable the persistent GeoIP database |
| `BPM_GEOIP_AUTO_UPDATE` | Unset; saved preference starts enabled | Override automatic scheduling; downloads wait for optional outbound opt-in |

Use `BITCOIN_RPC_PASSWORD` for the normal `.env` setup. Set only one password
source: the application rejects configurations that supply both a password and
a password file.

The standard Compose service listens on `0.0.0.0` inside the container and stores
data at `/var/lib/bitcoin-peer-map`. For a local Node.js process, see
[running the server](development.md#run-the-server-locally).

`BPM_IMAGE`, `BPM_HOST_BIND`, `BPM_HOST_PORT`, and `BPM_DATA_VOLUME` configure
Compose itself. They are not application environment variables. RPC startup
requests and retry delays share the `BPM_RPC_STARTUP_TIMEOUT` deadline.

## Compose secrets

Use mounted files instead of direct `.env` values when your deployment supplies
secrets that way. Set only one direct/file source for each password or token.
Viewing and administrator token files use the same readability requirements as
the RPC password below. They must contain one non-empty bearer token, optionally
followed by a final newline. Tokens and secret-file paths are omitted from
monitoring APIs; see [token requirements](access-control.md#credentials).

The production image runs as UID/GID **10001:10001**. On rootful Linux without
user-namespace remapping, a file owned by your login user with mode `0600` is
usually unreadable to that container identity.

Create `secrets/bitcoin_rpc_password` using your editor or secret manager. Choose
one of these host-file permission patterns:

```bash
# Container identity owns the file; only that owner can read it.
sudo chmod 0600 secrets/bitcoin_rpc_password
sudo chown 10001:10001 secrets/bitcoin_rpc_password

# Alternatively, keep your login user as owner and grant the container group read access.
sudo chmod 0640 secrets/bitcoin_rpc_password
sudo chown "$(id -u):10001" secrets/bitcoin_rpc_password
```

The second pattern lets your login user update the file; keep membership of host
group 10001 restricted. Add this to `compose.override.yaml`:

```yaml
services:
  bpm:
    environment:
      BITCOIN_RPC_PASSWORD: ""
      BITCOIN_RPC_PASSWORD_FILE: /run/secrets/bitcoin_rpc_password
    secrets:
      - bitcoin_rpc_password

secrets:
  bitcoin_rpc_password:
    file: ./secrets/bitcoin_rpc_password
```

Keep `BITCOIN_RPC_PASSWORD` empty when using `BITCOIN_RPC_PASSWORD_FILE`; supplying
both sources causes a configuration error. Compose mounts file-backed secrets
using bind mounts that preserve host permissions. The secret's `uid`, `gid`, and
`mode` settings do not change permissions for this file-backed mount. See the
[Docker Compose secrets reference](https://docs.docker.com/reference/compose-file/services/#secrets).

Before starting the application, check the effective container identity and file
readability with the same Compose configuration. This probe prints no password:

```bash
docker compose run --rm --no-deps bpm sh -c '
  id &&
  test -z "$BITCOIN_RPC_PASSWORD" &&
  test -n "$BITCOIN_RPC_PASSWORD_FILE" &&
  test -f "$BITCOIN_RPC_PASSWORD_FILE" &&
  test -r "$BITCOIN_RPC_PASSWORD_FILE" &&
  printf "Mounted RPC password is readable\n"
'
```

A nonzero exit means the password source or permissions need correcting before
startup. With rootless Docker or user-namespace remapping, container UID/GID 10001
maps to different host IDs. Set ownership for your daemon's actual mapping and
repeat the probe instead of assuming host IDs 10001. Docker's
[user namespace guide](https://docs.docker.com/engine/security/userns-remap/)
describes the mapping and bind-mount ownership requirements.

The application reads `/run/secrets/bitcoin_rpc_password` during startup. The
`secrets/` directory, `.env`, and local Compose overrides are excluded from Git
and the Docker build context.
