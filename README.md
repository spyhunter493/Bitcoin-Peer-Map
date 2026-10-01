# Bitcoin Peer Map

Bitcoin Peer Map is a Docker-first dashboard for monitoring and managing peers connected to a Bitcoin Core or Bitcoin Knots node. It provides a real-time world map, peer and network statistics, mempool and blockchain information, GeoIP enrichment, connection controls, and ban management.

![Bitcoin Peer Map dashboard](docs/images/hero1.png)

## Requirements

- Docker Engine with Docker Compose
- A reachable Bitcoin Node JSON-RPC endpoint
- Dedicated RPC credentials for the dashboard

The Bitcoin node can run on another machine, in another Compose project, or elsewhere on the network. Bitcoin Peer Map does not need the node datadir, blockchain files, or `bitcoin-cli`. The application and tests run on Node.js; Python is not required on the host, in the container, or for development.

## Quick Start

```bash
git clone https://github.com/spyhunter493/bitcoin-peer-map.git
cd bitcoin-peer-map
cp .env.example .env
```

Edit `.env` with the node's RPC address and credentials, then start the application:

```env
BITCOIN_RPC_HOST=192.168.1.10
BITCOIN_RPC_USER=bpm
BITCOIN_RPC_PASSWORD=replace-with-a-long-random-password
```

```bash
./scripts/compose-local.sh up -d --build
```

Open `http://HOST_IP:58333`.

To stop the application:

```bash
docker compose down
```

## Bitcoin RPC

Bitcoin Peer Map communicates directly with Bitcoin's JSON-RPC interface over HTTP or HTTPS. It does not execute `bitcoin-cli` or write credentials to a generated configuration file.

A minimal node configuration for a dedicated RPC account resembles:

```ini
server=1
rpcbind=0.0.0.0
rpcallowip=192.168.1.0/24
rpcuser=bpm
rpcpassword=replace-with-a-long-random-password
```

Restrict `rpcbind` and `rpcallowip` to the interface and subnet that actually need access. Do not expose Bitcoin RPC to the public internet. Prefer `rpcauth` over plaintext `rpcuser` and `rpcpassword` in the node configuration where practical.

### Another Compose Project

For a Bitcoin node in another Compose project, attach both projects to a shared external network. A Compose override for Bitcoin Peer Map can make its default network external:

```yaml
networks:
  default:
    external: true
    name: bitcoin-rpc
```

Set `BITCOIN_RPC_HOST` to the Bitcoin service or container hostname on that network.

## Configuration

Docker Compose automatically reads the local `.env` file and passes the configured values into
the container. Most deployments should set `BITCOIN_RPC_PASSWORD` directly in `.env` and leave
`BITCOIN_RPC_PASSWORD_FILE` unset.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BITCOIN_RPC_SCHEME` | No | `http` | RPC transport, `http` or `https` |
| `BITCOIN_RPC_HOST` | Yes | - | Bitcoin Node RPC hostname or address |
| `BITCOIN_RPC_PORT` | No | `8332` | RPC port |
| `BITCOIN_RPC_USER` | Yes | - | Dedicated RPC username |
| `BITCOIN_RPC_PASSWORD` | Yes* | - | RPC password; use this for the normal `.env` setup |
| `BITCOIN_RPC_PASSWORD_FILE` | No* | - | Optional path to a mounted secret containing the RPC password |
| `BITCOIN_RPC_VERIFY_TLS` | No | `true` | Verify the RPC HTTPS certificate |
| `BITCOIN_RPC_TIMEOUT` | No | `30` | Per-request timeout in seconds |
| `BITCOIN_NETWORK` | No | `main` | `main`, `test`, `signet`, or `regtest` |
| `BPM_RPC_STARTUP_TIMEOUT` | No | `30` | Time to wait for the node during startup |
| `BPM_HOST_PORT` | No | `58333` | Port published on the Docker host |
| `BPM_LISTEN_PORT` | No | `58333` | Port used inside the container |
| `BPM_GEOIP_ENABLED` | No | `true` | Enable the persistent GeoIP database |
| `BPM_GEOIP_AUTO_UPDATE` | No | saved setting | Override automatic GeoIP dataset updates |

*`BITCOIN_RPC_PASSWORD` is required unless `BITCOIN_RPC_PASSWORD_FILE` is used instead. Do not set
both variables; the application will reject the configuration.*

Inspect the effective runtime configuration without exposing RPC credentials:

```bash
curl http://HOST_IP:58333/api/config
```

### Optional Compose Secret

The standard `.env` setup does not require a password file. Use this alternative only when the
deployment supplies secrets as mounted files, such as Docker Compose secrets, Docker Swarm,
Kubernetes, or a container-management platform.

For a Compose secret, store the password in a protected local file and add an override similar to:

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

Compose mounts the secret at `/run/secrets/bitcoin_rpc_password`; the environment contains only
that path, and Bitcoin Peer Map reads the password from the mounted file during startup. The
`secrets/` directory is excluded from Git.

## Persistence

The named volume is mounted at `/var/lib/bitcoin-peer-map` and contains only mutable application data:

- `geo.db`: peer geolocation cache
- `settings.json`: dashboard preferences that must survive restarts
- `tmp/`: staging area for GeoIP database updates

RPC credentials are never written to the volume. Browser display preferences remain in browser local storage under `bpm.*` keys.

The Node.js backend uses the same SQLite schema and preference format as earlier
releases. Keep the existing data volume when upgrading; no database conversion or
preference reset is needed. The environment variables and dashboard API paths are
unchanged.

### GeoIP Updates and Privacy

With auto-update enabled, the backend downloads the GeoIP dataset at startup and
hourly after each completed attempt, even when no dashboard is open. Enabling
auto-update starts a check immediately; disabling it stops future checks. An update
already in progress finishes normally. Manual updates remain available in **GEOIP-DB**.
Dataset merges add new IPs and replace existing records only when the downloaded
`last_updated` timestamp is newer, preserving newer local API results.

**API Lookup** in **GEOIP-DB** controls external lookups for public peer IPs missing
from the local database. It is enabled by default. Turn it off for database-only
peer lookups; that choice is saved in `settings.json` and restored before peer
workers start, including after container recreation with the same data volume.
Both the auto-update preference and database-only preference survive restarts.

External peer lookups send the queried IP to ip-api.com over unencrypted HTTP.
The provider's [free endpoint does not support HTTPS](https://ip-api.com/docs/api:json).
Database-only mode prevents these peer-IP lookups; GeoIP dataset downloads and BTC
price requests are separate and still use the network. Disabling the persistent
database with `BPM_GEOIP_ENABLED=false` does not itself disable external lookups.

## Build Revision

The header displays the first seven characters of the Git commit embedded in the image and links to that exact commit on GitHub. Local builds can pass the full commit SHA explicitly:

```bash
./scripts/compose-local.sh build
```

The helper exports `BPM_BUILD_REVISION` from the current Git checkout before running Docker Compose.
For dirty worktrees, it uses `unknown` so locally changed static assets get a fresh content-hash
cache key. GitHub Actions passes `GITHUB_SHA` directly to the Docker build.

Remote Git builds can derive the revision from the cloned build context instead. For production
Compose files that use a GitHub URL as the build context, keep the Git metadata during the build:

```yaml
services:
  bpm:
    build:
      context: https://github.com/spyhunter493/Bitcoin-Peer-Map.git#main
      args:
        BUILDKIT_CONTEXT_KEEP_GIT_DIR: "1"
```

The image writes the detected commit to `/app/build-revision`, and the application uses that file
when `BPM_BUILD_REVISION` is not set. Images built without either `BPM_BUILD_REVISION` or preserved
Git metadata display `unknown` rather than an inaccurate revision.

## Container Security

The example deployment:

- runs as the unprivileged `bpm` user with UID/GID `10001`
- uses a read-only root filesystem
- drops all Linux capabilities
- enables `no-new-privileges`
- limits writable paths to the data volume and a 64 MiB `/tmp` tmpfs
- exposes a dedicated `/healthz` container health check

## Operations

Rebuild and recreate after pulling changes:

```bash
git pull
./scripts/compose-local.sh up -d --build
```

Inspect status and health:

```bash
docker compose ps
docker inspect bitcoin-peer-map-bpm-1 --format '{{.State.Health.Status}}'
```

View logs:

```bash
docker compose logs -f --tail=100 bpm
```

## Architecture

```text
bitcoin-peer-map/
├── src/
│   ├── server/              # TypeScript backend, executed directly by Node.js
│   │   ├── services/        # Peers, node, GeoIP, connectivity, and metrics
│   │   ├── app.ts           # HTTP routes, static assets, and metric streaming
│   │   ├── http.ts          # Request validation, response encoding, and HTTP errors
│   │   ├── runtime.ts       # Service composition and worker lifecycle
│   │   ├── settings.ts      # Validated environment configuration
│   │   ├── rpc.ts           # Direct Bitcoin JSON-RPC client
│   │   ├── openapi.json     # API specification served at /openapi.json
│   │   └── main.ts          # Container process entrypoint
│   ├── static/              # Browser JavaScript, CSS, and map assets
│   └── templates/           # Dashboard HTML
├── tests/
│   ├── server/              # Backend tests using node:test
│   ├── unit/                # Frontend unit tests using node:test
│   └── layout_server.ts     # Local API fixtures for browser regressions
├── Dockerfile
├── compose.yaml
├── package.json
└── tsconfig.server.json
```

Node.js 24 executes the TypeScript backend directly, using built-in HTTP, SQLite,
fetch, and worker-thread APIs. There are no production npm dependencies, compiled
addons, or application build step. The application runtime owns peer polling,
GeoIP enrichment, connectivity monitoring, and metric sampling and stops them on
SIGTERM or SIGINT. Dataset validation and SQLite merges run in a worker thread so
large imports do not block HTTP requests. Interactive API documentation is served
at `/docs`; update `src/server/openapi.json` alongside changes to API contracts.

Browser code uses native ES modules with one small `static/js/app.js` entrypoint and
no bundler or production build step. Features live in `map/`, `peers/`,
`distribution/`, `node/`, and `settings/`; `core/` contains shared state, polling,
HTTP, formatting, and modal helpers. Peer views read one current snapshot and
resolve pinned filters against it. Public and private peer details share one
controller that owns popup interactions and cleanup.

The entire module graph is served under `/static/v/<asset_revision>/`, so a new
revision invalidates every relative dependency. Existing static URLs remain
available. `npm run check:js` checks JavaScript and TypeScript syntax recursively.
`npm run check:types` checks all production modules in strict mode and flags unused
locals and parameters. `npm run test:js`
uses Node's built-in test discovery under `tests/unit/`. Browser regression tests
remain separate in `npm run test:layout`.

Node data and currency-specific prices use independent five-second caches shared
across browser clients. The dashboard polls `/api/info?include_price=false` and
`/api/price` separately; `/api/info` still includes prices by default.
The Node Info popup includes a Services block showing the node's advertised P2P
services with readable descriptions. `/api/info.services` comes from
[`getnetworkinfo.localservicesnames`](https://bitcoincore.org/en/doc/30.0.0/rpc/network/getnetworkinfo/);
an empty list means no services are advertised, while `null` means unavailable.

The map HUD and System Info show NET transfer rates and P2P byte totals as text.
NET measures system network activity; P2P totals come from the Bitcoin node and
reset when that node restarts. Click a system or traffic row to open System Info
and toggle CPU, RAM, NET, or P2P rows independently. These display preferences are
saved in your browser. Zoom and reset controls stay below the visible stats.

Run `npm run benchmark:dashboard` to profile 14, 125, and 500 synthetic peers in
Chromium. It reports main-thread task time over three idle seconds, DOM size,
JavaScript heap use, and table mutations during an unchanged peer poll. The
benchmark serves the checked-out frontend with local API fixtures; compare runs
on the same machine and browser because absolute timings vary by environment.

`types.d.ts` defines the shared peer API shape and controller interfaces. `tsconfig.json`
checks all production JavaScript modules, including DOM adapters, in strict mode using
JSDoc annotations. No production build step is required.

Completed refactor plans and benchmark measurements are kept in
[`docs/archive/`](docs/archive/refactor-plan.md); use this README for current setup
and architecture.

Peer-supplied strings stay raw in application state. Use `BPMModal.escapeHtml` at HTML text
and attribute boundaries, or assign `textContent`. Helpers whose names include `HtmlRow`
accept locally constructed markup; ordinary row helpers escape text.

The default `/api/peers` response remains a list. `/api/peers?include_status=true` includes
connection status and snapshot timestamps. RPC failures retain the last successful snapshot;
a successful empty response clears it. The Peer data status identifies outages and
shows the last successful snapshot time in its tooltip. The top-right countdown
shows when the next refresh is due.

## Development and Tests

Use **Node.js 24.18 or later in the 24.x release line** and npm for development.
The production image uses `node:24-alpine` and starts `src/server/main.ts` directly.
Only development tools (TypeScript, Node type definitions, and Playwright) require
`npm ci`; the server and backend tests use Node's built-in libraries.

Run the checks and tests used by CI:

```bash
npm ci
npm run check:js
npm run check:types
npm test
npx playwright install --with-deps chromium
npm run test:layout
```

`npm test` runs backend and frontend unit tests. `npm run test:layout` starts the
Node fixture server automatically. To run that server in a container instead,
use `npm run test:layout:docker` (Docker, curl, and the same local browser tools
are required). Tests use local fixtures and mock RPC servers, without a live
Bitcoin node or external GeoIP/price services.

To run the real server locally, create `.env` as in Quick Start and start it with:

```bash
BPM_DATA_DIR="$PWD/.local-data" node --env-file=.env src/server/main.ts
```

Alternatively, export the documented environment variables and run `npm start`.
CPU, memory, network, and disk metrics target Linux, including the Docker image;
unavailable platform metrics are omitted or returned as null.

Validate the deployment definition and image:

```bash
BITCOIN_RPC_USER=test BITCOIN_RPC_PASSWORD=test \
  docker compose config --quiet
docker build --build-arg BPM_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t bitcoin-peer-map:test .
npm run test:container
```

The container smoke test uses Linux host networking and a local mock RPC server.
It checks the production entrypoint, health check, unprivileged read-only
operation, persisted SQLite data and preferences, and clean shutdown. It creates
and removes its own test container and volume.

## License

MIT License. See [LICENSE](LICENSE).

Inspired by [mbhillrn](https://github.com/mbhillrn), [Mirobit](https://github.com/Mirobit).
