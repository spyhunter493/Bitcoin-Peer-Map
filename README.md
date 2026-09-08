# Bitcoin Peer Map

Bitcoin Peer Map is a Docker-first dashboard for monitoring and managing peers connected to a Bitcoin Core or Bitcoin Knots node. It provides a real-time world map, peer and network statistics, mempool and blockchain information, GeoIP enrichment, connection controls, and ban management.

![Bitcoin Peer Map dashboard](docs/images/hero1.png)

## Requirements

- Docker Engine with Docker Compose
- A reachable Bitcoin Node JSON-RPC endpoint
- Dedicated RPC credentials for the dashboard

The Bitcoin node can run on another machine, in another Compose project, or elsewhere on the network. Bitcoin Peer Map does not need the node datadir, blockchain files, `bitcoin-cli`, Python, or a virtualenv on the Docker host.

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
│   ├── api/                 # FastAPI routers grouped by domain
│   ├── services/            # Peer, node, GeoIP, connectivity, and metric services
│   ├── static/              # Browser JavaScript, CSS, and map assets
│   ├── templates/           # Jinja templates
│   ├── app.py               # FastAPI application factory and lifespan
│   ├── runtime.py           # Service composition and worker lifecycle
│   ├── settings.py          # Typed environment configuration
│   ├── rpc.py               # Direct Bitcoin JSON-RPC client
│   └── main.py              # Container process entrypoint
├── tests/                   # Python and JavaScript tests
├── Dockerfile
├── compose.yaml
├── requirements.txt
└── pyproject.toml
```

The application uses FastAPI lifespan hooks to start and stop peer polling, GeoIP enrichment, connectivity monitoring, and container metric workers. API routers obtain services through the application runtime rather than module-level global state.

## Development and Tests

The production image installs dependencies directly into the container's Python installation and runs `src/main.py`. A virtualenv inside the image would duplicate isolation already provided by the container and is intentionally not used.

Run the same Python checks used by CI without installing Python dependencies or generated
package metadata on the host:

```bash
docker run --rm -v "$PWD:/source:ro" python:3.12-slim \
  sh -c 'cp -a /source /app && cd /app && pip install -r requirements-test.txt && \
  ruff format --check src tests && ruff check src tests && pytest -q'
```

Run the JavaScript checks:

```bash
npm ci
npm run check:js
npm run test:js
npm run test:layout:docker
```

Validate the deployment definition and image:

```bash
BITCOIN_RPC_USER=test BITCOIN_RPC_PASSWORD=test \
  docker compose config --quiet
docker build --build-arg BPM_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t bitcoin-peer-map:test .
```

## License

MIT License. See [LICENSE](LICENSE).

Inspired by [mbhillrn](https://github.com/mbhillrn), [Mirobit](https://github.com/Mirobit).
