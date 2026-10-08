# Configuration

[README](../README.md) · [Operations](operations.md) · [Development](development.md)

Docker Compose reads the local `.env` file and passes the supported settings to
the container. Start with [`.env.example`](../.env.example) and set your Bitcoin
Knots node's RPC address, username, and password.

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

## Environment variables

Defaults below apply to the standard [Compose deployment](../compose.yaml).
Set the RPC host and credentials. Configure an admin token to enable management.

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
| `BPM_TRUSTED_PROXIES` | Empty (trust none) | Comma-separated literal IP addresses or CIDRs allowed to supply client addresses for anonymous authentication throttling |
| `BPM_LOG_LEVEL` | `info` | Minimum server log level: `debug`, `info`, `warn`, or `error` |
| `BPM_IMAGE` | `ghcr.io/spyhunter493/bitcoin-peer-map:latest` | Published image reference; use a tag or digest to pin a build |
| `BPM_HOST_BIND` | `0.0.0.0` | Host interface to publish on; use `127.0.0.1` for access through a local reverse proxy |
| `BPM_HOST_PORT` | `58333` | Dashboard port published on the Docker host |
| `BPM_LISTEN_PORT` | `58333` | Dashboard port inside the container |
| `BPM_DATA_VOLUME` | `bitcoin-peer-map-data` | Named data volume; use a different name for a separate instance |
| `BPM_GEOIP_ENABLED` | `true` | Enable the persistent GeoIP database |
| `BPM_GEOIP_AUTO_UPDATE` | Saved preference; enabled on new installs | Override automatic GeoIP dataset updates |

Use `BITCOIN_RPC_PASSWORD` for the normal `.env` setup. Set only one password
source: the application rejects configurations that supply both a password and
a password file.

The standard Compose service listens on `0.0.0.0` inside the container and stores
data at `/var/lib/bitcoin-peer-map`. For a local Node.js process, see
[running the server](development.md#run-the-server-locally).

`BPM_IMAGE`, `BPM_HOST_BIND`, `BPM_HOST_PORT`, and `BPM_DATA_VOLUME` configure
Compose itself. They are not application environment variables. RPC startup
requests and retry delays share the `BPM_RPC_STARTUP_TIMEOUT` deadline.

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
`/api/info` exposes `bitcoin_network.chain` and `bitcoin_network.default_peer_port`
for the dashboard's connection examples. Without metadata, examples omit the
port and explain that the server chooses it. Block explorer links are available
for mainnet, signet, and testnet4; other networks display hashes without links.

`BITCOIN_RPC_PORT` remains independently configured and defaults to `8332` on
all networks. Set it to the node's actual RPC port for non-mainnet deployments.
These network defaults apply to peer connections only.

### Host access and multiple instances

The dashboard is readable without authentication. Management actions require the
admin token described below. If peer addresses, ban lists, and node configuration
should also be private, use an authenticated reverse proxy for the entire site.
Use HTTPS for access outside a trusted network. For a reverse proxy on the same
host, set `BPM_HOST_BIND=127.0.0.1`; the application still listens on `0.0.0.0`
inside its container. A proxy in another container can reach the service over a
shared Docker network instead.

Browser management requests are rejected with HTTP 403 when their `Origin` host
does not match the request's `Host`. Reverse proxies should preserve the external
`Host` header. HTTP and HTTPS origins on that host are accepted for TLS termination.
Command-line clients without `Origin` remain supported, but must supply the admin
token for management requests. Origin checking remains separate from token authentication.

To run another instance, use a distinct Compose project name (`docker compose -p
bpm-second ...`), `BPM_HOST_PORT`, and `BPM_DATA_VOLUME`. Changing the volume name
selects different saved data, so keep its existing value during normal upgrades.

### Admin token and read-only mode

With `BPM_ADMIN_TOKEN` unset or empty, all management API requests are rejected
with HTTP 403 and the dashboard remains available for viewing. This applies even
on a trusted network or behind an authenticated proxy.

Set `BPM_ADMIN_TOKEN` in your local `.env` to the token you want to use, for example:

```env
BPM_ADMIN_TOKEN=admin
```

There is no minimum length. Tokens can contain up to 256 bearer-token characters
(letters, digits, `-`, `.`, `_`, `~`, `+`, `/`, and up to two trailing `=` characters).
Whitespace is rejected during startup. Keep this token separate from the Bitcoin RPC password.

A long random token is recommended but optional. To generate one:

```bash
openssl rand -hex 32
```

Protect your `.env` with `chmod 600 .env` and recreate the service with
`docker compose up -d bpm` after changing the token.

The first management action opens an **Unlock management** dialog. The token is
verified before that action runs, then held only in the current tab's memory.
Reloading, leaving the page, or clicking **Lock** clears it. Cancelling the dialog
does not execute the pending action. Peer connect/disconnect/ban/unban, clearing
bans, GeoIP changes/updates, and the server's connectivity acknowledgement all
require authentication. Merely viewing a connectivity notice is handled locally.

API clients send `Authorization: Bearer <token>` on each management request.
GeoIP preferences use `POST /api/geodb/db-only` and
`POST /api/geodb/auto-update`, each with a JSON `{ "enabled": boolean }` body.
Database-only `enabled: true` disables external peer location lookups. Repeated
values succeed without rewriting preferences. The old `/api/geodb/toggle-db-only`
and `/api/geodb/toggle-auto-update` endpoints return authenticated HTTP 410 with
a replacement endpoint and reload instruction; they perform no mutation.
Missing or incorrect tokens return HTTP 401 before any action executes. After ten
failed attempts within 60 seconds of the first failure from a client address,
further invalid credentials return HTTP 429 with `Retry-After` until that fixed
window expires. Blocked requests do not extend it. Correct tokens remain usable
during a cooldown and do not clear another visitor's anonymous failure history.
At most 1,024 address windows are tracked; while full, invalid credentials from
new addresses receive HTTP 429 until a window expires. Active windows are never
evicted, and valid credentials remain usable even when storage is full.

For a user-initiated action without a stored token, an authentication cooldown can
still open **Unlock management**. The dialog shows the remaining cooldown and
allows manual verification of a changed token before expiry; it disables the same
rejected token and submissions already in flight. Successful verification executes
the pending action once. Cancellation remains available. Unrelated HTTP 429
responses do not open authentication prompts or clear the tab's existing token,
and the browser never automatically retries a throttled request.

Credentials are checked before anonymous throttling to prevent visitors sharing
an address from locking out administrators. This response throttle therefore
does not impose a hard limit on token guesses. Use a long random token and
separate request limits at the reverse proxy for public deployments.

### Trusted proxy addresses

By default, anonymous limits use the socket address and ignore forwarding
headers. Visitors behind one proxy share that limit. Configure only the proxy
addresses you control to give visitors independent failure windows, for example:

```env
BPM_TRUSTED_PROXIES=127.0.0.1,::1,172.20.0.5/32
```

Entries must be literal IPv4/IPv6 addresses or CIDRs. Hostnames, wildcards,
malformed or blank list entries, and `/0` trust-all ranges fail startup. There is
no automatic trust for loopback or private networks. Restrict backend access to
these proxies, and configure each proxy to overwrite incoming `X-Forwarded-For`
or append the address of its verified connection peer. Keep the trusted ranges
as narrow as possible.

Only a trusted socket peer enables `X-Forwarded-For`. The application combines
all its fields in wire order, walks from right to left over trusted proxy hops,
and uses the first untrusted IP as the limiter identity. Equivalent IPv6 spellings
and IPv4-mapped addresses share an identity. Missing, malformed, all-trusted,
or excessive chains fall back to the socket address. Parsing is bounded to 4 KiB
and 32 forwarded addresses. Other forwarding headers do not affect this feature.
See [MDN's trusted-proxy traversal guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#selecting_an_ip_address).
Proxy trust does not authenticate administrators or relax the Host/Origin guard.

Use HTTPS when sending this token over an untrusted network, including browser
access. A TLS proxy does not need to implement login if public viewing is intended;
bind the backend to loopback or a private Docker network so clients cannot bypass
TLS. The token is never included in dashboard HTML, configuration responses, or
browser storage. Changing it and recreating the service revokes the previous token;
open tabs are prompted again on their next management action. This is one shared
administrator credential, with no individual accounts or per-user permissions.

### Inspect the effective configuration

The configuration endpoint reports settings without exposing RPC credentials:

```bash
curl http://HOST_IP:58333/api/config
```

Replace `HOST_IP` and the port with your deployment's address. The response
includes the RPC endpoint, server settings, GeoIP settings, and installed build.

## Compose secrets

Use a password file when your deployment supplies secrets as mounted files.
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
