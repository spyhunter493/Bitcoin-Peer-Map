# Development

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

Use **Node.js 26.x** and npm. The server runs TypeScript directly with Node's
built-in APIs; npm dependencies are development tools. Production startup needs
no package installation, code generation, or bundler. See [Architecture](architecture.md)
for implementation ownership, [API](api.md) for contract changes, and
[Releasing](releasing.md) for image publication.

## Set up your checkout

Clone the source repository, then run commands from its root. `.nvmrc` selects
the Node version used by CI; production and the Docker browser fixture use
`node:26-alpine`.

```bash
git clone https://github.com/spyhunter493/bitcoin-peer-map.git
cd bitcoin-peer-map
npm ci --ignore-scripts
cp .env.example .env
chmod 600 .env
```

Configure your Bitcoin Knots RPC endpoint and a viewing or administrator token
as described in the [quick start](../README.md#quick-start). Private viewing is
the default and requires a credential. See [access control](access-control.md)
for viewing modes and management permissions.

## Run the server locally

```bash
BPM_DATA_DIR="$PWD/.local-data" node --env-file=.env src/server/main.ts
```

The default listener is `0.0.0.0:58333`. Set `BPM_LISTEN_ADDRESS=127.0.0.1` in
`.env` for access only from this machine; `BPM_LISTEN_PORT` changes the port.
`BPM_DATA_DIR` selects writable local storage. If you export the environment
variables yourself, you can also use `npm start`.

## Build locally with Docker

```bash
./scripts/compose-local.sh up -d --build
```

The helper combines `compose.yaml`, `compose.build.yaml`, and any local
`compose.override.yaml` or `compose.override.yml`. It works from another
working directory and always builds the source image. A clean checkout supplies
its commit SHA; a dirty checkout, including untracked files, uses `unknown` so
asset caching follows the actual file content. Local builds use version `dev`
and skip release checks. `.env` variants, Compose overrides, and `secrets/` are
excluded from the build context. See [build metadata](releasing.md#build-metadata)
for explicit Docker build arguments.

## Choose checks for your change

Tests use local API fixtures and mock RPC servers, with no live node or external
GeoIP service. Install dependencies with the setup command above.

| Command | Use it for |
| --- | --- |
| `npm run check:js` | JavaScript and TypeScript syntax |
| `npm run check:types` | Production and backend-test type checks |
| `npm run check:api` | Generated declarations matching OpenAPI |
| `npm run check:assets` | Vendored assets matching their pinned packages |
| `npm test` | Backend and frontend unit tests |
| `npm run test:server` / `npm run test:js` | One unit-test suite |
| `npm run test:layout` | Dashboard browser regressions in Chromium |
| `npm run test:browser-security` | Assets, CSP, authentication and dialogs in Chromium, Firefox and WebKit |
| `npm run test:layout:docker` | Layout tests with the fixture server in Docker; requires Docker and curl |
| `npm run test:compose` | Compose, mounted secrets, build helper and release orchestration |
| `npm run test:container` | An already-built production image |

For API changes, follow [updating the contract](api.md#update-the-contract).
For Swagger or font changes, follow [updating browser assets](browser-security.md#update-vendored-assets).

### Run browser tests

Install browser engines and system dependencies once:

```bash
npx playwright install --with-deps chromium firefox webkit
npm run test:layout
npm run test:browser-security
```

Layout tests start their fixture server automatically. Suites use separate
browser contexts, run two at a time, and have a two-minute timeout each.
Use these controls for focused or reproducible runs:

| Variable | Behavior |
| --- | --- |
| `BPM_LAYOUT_TEST_FILTER="peer table DOM updates"` | Select suites whose names contain this text; no matches fails |
| `BPM_LAYOUT_TEST_WORKERS=1` | Run serially; accepted worker counts are 1–8 |
| `BPM_LAYOUT_TEST_SHARD=1/2` | Run the first of two shards; `2/2` runs the second, `1/1` runs all |

Prefix any variable above to `npm run test:layout`. Shard indices and totals must
be 1–8, with the index no greater than the total. Sharding happens before filtering;
an empty selection fails. Keyboard and large-table cases traverse unmounted rows
while checking that the DOM stays bounded.

CI uses two layout shards and separate security jobs for each browser; WebKit's
policy and control cases are split across runners. Browser jobs use the official
Playwright image and verify it matches the installed npm package. Update both
image references in [CI](../.github/workflows/ci.yml) when changing Playwright.
Security tests run two cases at a time and CI checks completed test counts;
update those counts when adding or regrouping cases.

### Validate a production image

On Linux with Docker:

```bash
BITCOIN_RPC_USER=test BITCOIN_RPC_PASSWORD=test \
  docker compose config --quiet
docker build --build-arg BPM_BUILD_REVISION="$(git rev-parse HEAD)" \
  -t bitcoin-peer-map:test .
npm run test:container
```

The smoke test uses Linux host networking and a mock RPC server. It checks build
metadata, the entrypoint, health, unprivileged operation with a read-only root
filesystem, saved SQLite data/preferences, and shutdown. It removes its test
container and volume afterward and checks that image and runner use the same
Node major version. Stable-image tests seed a recent update-check cache to avoid
external GitHub requests.

| Variable | Override |
| --- | --- |
| `BPM_TEST_IMAGE` | Image to test; defaults to `bitcoin-peer-map:test` |
| `BPM_TEST_PLATFORM` | `linux/amd64` or `linux/arm64` |
| `BPM_TEST_EXPECT_VERSION` | Expected baked release version |
| `BPM_TEST_EXPECT_REVISION` | Expected baked full commit SHA |

The container suite also exercises real file-backed RPC secrets in an isolated
Compose deployment, retaining UID/GID 10001, dropped capabilities, and `no-new-privileges`. These
host-permission cases require rootful Linux without user-namespace remapping;
rootless, remapped, and non-Linux daemons skip only those cases. Release
orchestration tests are part of `test:compose` and never publish images.

### Profile dashboard performance

```bash
npm run benchmark:dashboard
```

The Chromium benchmark uses 14, 125 and 500 synthetic peers with normal and
reduced motion. It reports main-thread time, DOM/table size, heap use, canvas
redraws and mutations during an unchanged poll. Compare runs on the same machine
and browser.

## Contribute through a pull request

Use a feature branch, open a PR, run relevant checks, then merge to `main` after
CI passes. Draft PRs skip CI; marking a PR ready starts it. Moving a PR back to
draft cancels its previous run. Ready PRs are checked when opened, updated or
reopened. Merging and tag pushes do not publish images; use the
[release process](releasing.md).

The required `test` check aggregates code/unit, layout, security and container
jobs. It succeeds only when every job succeeds, including no skipped or cancelled
work. CI has read-only repository permissions and does not log in to a registry.

Recommended `main` protection is a required PR, the `test` status check, an
up-to-date branch, and blocked force pushes/deletion. Keep the check name stable.
PR-only CI depends on enforcing these requirements; mandatory reviews or a merge
queue are optional maintainer choices.

[Dependabot](../.github/dependabot.yml) checks npm, Docker and GitHub Actions on
Mondays at 09:00 UTC. Routine version-update PRs are limited to major upgrades;
minor and patch releases are ignored. These SemVer ignore rules do not block
security-update PRs, including minor or patch fixes. Keep Dependabot security
updates enabled in the repository settings; the YAML configuration does not
enable them.

Dependabot's [security-update coverage](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
excludes Docker images. GitHub also does not generate Dependabot alerts for
[SHA-pinned Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems).
Review security fixes for those dependencies separately. Review passing checks
and related runtime, type or documentation changes before merging any update.
