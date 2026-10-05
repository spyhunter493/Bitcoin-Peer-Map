# Development

[README](../README.md) · [Configuration](configuration.md) · [Operations](operations.md)

Use **Node.js 24.18 or later in the 24.x release line** and npm. The server runs
TypeScript directly with Node.js built-in APIs. Only development tools, including
TypeScript and Playwright, require npm dependencies; Python is not required.

## Run the server locally

Create `.env` as described in the [quick start](../README.md#quick-start), then run:

```bash
BPM_DATA_DIR="$PWD/.local-data" node --env-file=.env src/server/main.ts
```

Alternatively, export the environment variables and use `npm start`. The server
listens on `0.0.0.0:58333` by default; `BPM_LISTEN_ADDRESS` and `BPM_LISTEN_PORT`
can change that for a local process. `BPM_DATA_DIR` sets its data directory.

System metrics target Linux, including the production container. Unavailable
platform metrics are omitted or returned as null.

## Build from source with Docker

```bash
./scripts/compose-local.sh up -d --build
```

The helper combines `compose.yaml` with `compose.build.yaml` and any local
`compose.override.yaml` or `compose.override.yml`. It supplies the commit from a
clean Git checkout automatically and can be invoked from another directory.
The build override uses `pull_policy: build`, so `up` builds the local source image.

Dirty worktrees, including untracked files, use `unknown` so changed static assets
receive a fresh content hash for browser caching. Direct Docker builds can pass
`BPM_BUILD_REVISION` explicitly; without it, the header displays `unknown` and skips
update checks.
Set `BPM_GITHUB_REPOSITORY=owner/repository` for local builds of a fork. Local
`.env` variants, Compose overrides, and `secrets/` are excluded from the Docker
build context.

## Tests and checks

Install the development dependencies:

```bash
npm ci
```

Choose checks that match the change:

| Command | Coverage |
| --- | --- |
| `npm run check:js` | JavaScript and TypeScript syntax |
| `npm run check:types` | Strict type checks for production code and backend tests |
| `npm run test:server` | Backend behavior using Node's test runner |
| `npm run test:js` | Frontend unit tests |
| `npm test` | Backend and frontend unit tests |
| `npm run test:layout` | Browser regressions using the local fixture server |
| `npm run test:layout:docker` | Browser regressions with the fixture server in Docker |
| `npm run test:container` | Production image smoke test |
| `npm run test:compose` | Published/local Compose merges, secrets, host binding, volume names, and build helper behavior |

Before running browser tests, install Chromium's headless shell:

```bash
npx playwright install --with-deps --only-shell chromium
```

CI runs syntax checks, type checks, backend tests, and frontend unit tests before
installing the browser. It then runs browser regressions, Compose checks, and
container validation. The Ubuntu VM runner supports both Chromium and Docker.
Tests use local fixtures and mock RPC servers, without a live Bitcoin node or
external GeoIP/price services.

`test:layout` starts its fixture server automatically and runs two independent
browser suites at a time, each in its own browser context. Node's test runner
reports suite names and timings, with a two-minute timeout per suite. Set
`BPM_LAYOUT_TEST_WORKERS=1 npm run test:layout` for serial execution, or choose
another worker count from 1 to 8. The Docker variant uses the same test runner and
also requires Docker and curl on the host.

### Validate the production container

```bash
BITCOIN_RPC_USER=test BITCOIN_RPC_PASSWORD=test \
  docker compose config --quiet
docker build --build-arg BPM_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t bitcoin-peer-map:test .
npm run test:container
```

The smoke test uses Linux host networking and a local mock RPC server. It checks
the entrypoint, health check, unprivileged read-only operation, persisted SQLite
data and preferences, and clean shutdown. It creates and removes its own test
container and volume.

### Profile the dashboard

```bash
npm run benchmark:dashboard
```

The benchmark profiles 14, 125, and 500 synthetic peers in Chromium. It reports
main-thread task time over three idle seconds, DOM size, JavaScript heap use, and
table mutations during an unchanged peer poll. Compare runs on the same machine
and browser; absolute timings vary by environment.

## Architecture

| Location | Responsibility |
| --- | --- |
| [`src/server/`](../src/server/) | HTTP routes, configuration, RPC, service lifecycle, and background workers |
| [`src/static/js/`](../src/static/js/) | Browser ES modules for map, peers, node, distribution, and settings |
| [`src/templates/`](../src/templates/) | Dashboard HTML |
| [`tests/server/`](../tests/server/) | Backend tests |
| [`tests/unit/`](../tests/unit/) | Frontend unit tests |
| [`tests/layout_server.ts`](../tests/layout_server.ts) | Local API fixtures for browser tests |

The backend uses built-in HTTP, SQLite, fetch, and worker-thread APIs, with no
production npm dependencies or compiled addons. The production image starts
`src/server/main.ts` directly. The runtime owns peer polling, GeoIP enrichment,
connectivity monitoring, metric sampling, and daily update checks, and stops
them on SIGTERM or SIGINT. GeoIP validation and SQLite merges run in a worker
thread to keep HTTP requests responsive.

The frontend uses native ES modules with one entrypoint,
[`src/static/js/app.js`](../src/static/js/app.js), and no bundler. Feature modules
share state, polling, HTTP, formatting, and modal
helpers from `core/`. Peer views read one current snapshot and resolve pinned
filters against it. Public and private peer details share popup interactions
and cleanup.

Modules are served under `/static/v/<asset_revision>/`, so a new revision
invalidates every relative dependency. Existing static URLs remain available.
`types.d.ts` defines shared API and controller interfaces; `tsconfig.json` checks
production JavaScript using JSDoc annotations. No production build step is needed.

### API behavior

Interactive API documentation is served at `/docs`, with the specification at
`/openapi.json`. Update [`src/server/openapi.json`](../src/server/openapi.json)
alongside API contract changes.

| Endpoint | Behavior |
| --- | --- |
| `/api/peers` | Returns the peer list |
| `/api/peers?include_status=true` | Includes RPC connection status and snapshot timestamps |
| `/api/info` | Node details, prices by default, and cached application update status |
| `/api/info?include_price=false` | Node details without fetching prices |
| `/api/price` | Currency-specific BTC price |
| `/api/config` | Effective configuration without RPC credentials, including `build.updates` |

Node details and currency-specific prices use independent five-second caches
shared across clients. Independent dashboard RPC reads run concurrently; the price
cache retains up to 64 recently used currencies. The dashboard requests node details
and prices separately.
The `services` field in `/api/info` comes from
[`getnetworkinfo.localservicesnames`](https://bitcoincore.org/en/doc/30.0.0/rpc/network/getnetworkinfo/):
an empty list means no services are advertised, while `null` means unavailable.

RPC failures retain the last successful peer snapshot; a successful empty
response clears it. RPC transport results are `unknown` until the parsers in
[`rpc-types.ts`](../src/server/rpc-types.ts) validate their fields. Peer validation
rejects malformed snapshots before they replace existing data. Network fields
are validated independently: unavailable fields remain `null` while valid
connection counts, services, and unrelated dashboard reads remain usable.
Application update status is read from the server cache, rather than triggering
a GitHub request.

### Rendering peer data

Keep peer-supplied strings raw in application state. Assign `textContent` or use
`BPMModal.escapeHtml` at HTML text and attribute boundaries. Helpers whose names
include `HtmlRow` accept locally constructed markup; ordinary row helpers escape
their text.

## Image publishing

The [CI workflow](../.github/workflows/ci.yml) publishes Linux AMD64 and ARM64
images to GHCR after all checks pass on `main`. It embeds the full Git commit and
repository during the Docker build, then publishes `latest` and
`sha-<full-commit>` tags. It authenticates with the built-in `GITHUB_TOKEN`.

For a new fork or registry package, make the package public after its first
successful publication to allow pulls without signing in. The project's
published package is already public. Normal deployment uses the image directly;
the Compose build override is for local source builds.
