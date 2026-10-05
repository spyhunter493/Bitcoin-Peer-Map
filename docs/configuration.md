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
Most installations only need to change the RPC host and credentials.

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
| `BITCOIN_NETWORK` | `main` | Node network: `main`, `test`, `signet`, or `regtest` |
| `BPM_RPC_STARTUP_TIMEOUT` | `30` | Time to wait for RPC during startup, in seconds |
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

### Host access and multiple instances

The dashboard can manage peers and has no built-in login. Publish it on a trusted
network, or use an authenticated reverse proxy. For a reverse proxy on the same
host, set `BPM_HOST_BIND=127.0.0.1`; the application still listens on `0.0.0.0`
inside its container. A proxy in another container can reach the service over a
shared Docker network instead.

Browser management requests are rejected with HTTP 403 when their `Origin` host
does not match the request's `Host`. Reverse proxies should preserve the external
`Host` header. HTTP and HTTPS origins on that host are accepted for TLS termination.
Command-line clients without `Origin` remain supported. This check does not provide
authentication.

To run another instance, use a distinct Compose project name (`docker compose -p
bpm-second ...`), `BPM_HOST_PORT`, and `BPM_DATA_VOLUME`. Changing the volume name
selects different saved data, so keep its existing value during normal upgrades.

### Inspect the effective configuration

The configuration endpoint reports settings without exposing RPC credentials:

```bash
curl http://HOST_IP:58333/api/config
```

Replace `HOST_IP` and the port with your deployment's address. The response
includes the RPC endpoint, server settings, GeoIP settings, and installed build.

## Compose secrets

Use a password file when your deployment supplies secrets as mounted files.
For Docker Compose, store the password in `secrets/bitcoin_rpc_password`, restrict
its file permissions, and add this to `compose.override.yaml`:

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

Compose mounts the file at `/run/secrets/bitcoin_rpc_password`; the application
reads it during startup. The `secrets/` directory, `.env`, and local Compose
overrides are excluded from Git.
