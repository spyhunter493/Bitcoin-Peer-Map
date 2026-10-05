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

Node metrics come only from Bitcoin Knots RPC: `uptime` and `getnettotals`.
Dashboard and legacy metrics endpoints share reads cached for five seconds. P2P
rates are averaged between valid samples and reset after outages or node restarts;
unavailable values are null. No dashboard host or container metrics are collected.

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
`BPM_BUILD_REVISION` explicitly; without it, the commit is `unknown`.
Local builds use `BPM_BUILD_VERSION=dev` and skip release checks even when the
revision is known. The version and commit appear separately in the header.
The canonical source repository is an internal constant. Local `.env` variants,
Compose overrides, and `secrets/` are excluded from the Docker build context.

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
external GeoIP services.

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

Distribution and map navigation modules own selection, filter transitions, and
restoration. Tooltip modules own their DOM, pinning, and refresh presentation;
summary and insight modules bind distribution interactions through explicit
callbacks. Controllers supply current-data getters and connect presentation and
navigation effects. Snapshot reconciliation preserves active filters, tooltip
geometry, focus, and scroll without applying user-navigation cleanup.

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
| `/api/info` | Node details, RPC metrics, and cached application update status |
| `/api/config` | Effective configuration without RPC credentials, including `build.updates` |

Node details and RPC metrics use five-second caches shared across clients.
Independent dashboard RPC reads run concurrently. The dashboard uses one node-info
poll for node details and metrics.
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

## Development flow

```text
feature branch → pull request → CI/tests → merge to main
```

The [CI workflow](../.github/workflows/ci.yml) runs on pull requests and retains
all syntax/type, backend, JavaScript, browser/layout, Compose, Docker build, and
container checks. It has a read-only token and no registry login or publish job.
Merging integrates changes into `main`; it neither repeats the full CI suite on
the push nor publishes a production image. Pushing a tag alone also does not
publish an image.

### Dependency updates

[Dependabot](../.github/dependabot.yml) checks npm development dependencies,
Docker images, and GitHub Actions weekly on Monday at 09:00 in `UTC`.
Minor and patch updates are grouped separately for npm and GitHub Actions;
major upgrades and Docker updates get individual pull requests. Update PRs
target the default branch and run the existing CI workflow. Review the changes
and passing checks before merging, especially for major upgrades that may need
related runtime, type, or documentation changes.

### Protect main

At implementation time, GitHub reported `main` as unprotected and the repository
ruleset list was empty. The connected GitHub app cannot read the administration
endpoint for detailed branch protection. Configure a rule for `main` under
**Settings → Rules → Rulesets**, or use a classic branch protection rule:

- Require a pull request before merging, including for maintainer changes.
- Require the `test` status check from the `CI` workflow. Keep its job name stable.
- Require the PR branch to be up to date before merging, so CI tests the current
  integration result. Update the PR branch when `main` changes; this can rerun
  PR checks, but does not add duplicate CI after merge.
- Block force pushes and deletion, and limit bypasses/direct pushes where practical.

A solo-maintainer project can leave mandatory review approvals at zero; extra
reviewers and a merge queue are not required for this flow. PR-only CI relies on
these required checks: an unprotected direct push would not be tested.

## Release flow

```text
ready main → publish GitHub Release/tag → build → publish multi-arch GHCR image
```

The [release workflow](../.github/workflows/release.yml) uses
[`release: published`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
This supports publishing a reviewed draft in the GitHub UI. Only published stable
releases in the canonical repository can publish; drafts and prereleases are
excluded. There is no push, PR, tag-push, or manual-dispatch publish trigger.

1. Ensure the intended changes are merged into `main` with passing required PR
   checks. Merge this workflow implementation before using the release process.
2. Choose a new, increasing version such as `v1.3.0`. Use **MAJOR.MINOR.PATCH**:
   MAJOR for incompatible/breaking changes, MINOR for backward-compatible
   functionality/features, and PATCH for backward-compatible bug fixes. Always
   include the lowercase `v` prefix, without leading zeros, prerelease suffixes,
   or build metadata.
3. Open **Releases → Draft a new release → Choose a tag**. Create the new version
   tag targeting the reviewed `main` commit, or select an existing tag at that
   commit. If saving a draft for later, verify the final tag/commit again before
   publication. Use the version as the release title.
4. Choose **Generate release notes**, review/edit the notes and previous release,
   and save a draft if further review is needed. Leave **Set as a pre-release**
   unchecked and select **Set as the latest release**.
5. Publish the release. The workflow validates the tag, checks out the release
   event's exact commit, verifies the tag still resolves to that commit and the
   commit is part of `main`, then builds Linux AMD64 and ARM64 images with QEMU
   and Docker Buildx. It uses GitHub Actions build caching and authenticates to
   GHCR with `GITHUB_TOKEN`; only the publish job has `packages: write`.
6. Wait for **Release → Publish container image** to succeed before announcing
   the image or deploying it. If a build fails, fix the cause and rerun the failed
   workflow from Actions without moving the published tag.

For `v1.3.0`, all three tags identify the same multi-architecture image:

```text
ghcr.io/spyhunter493/bitcoin-peer-map:v1.3.0
ghcr.io/spyhunter493/bitcoin-peer-map:latest
ghcr.io/spyhunter493/bitcoin-peer-map:sha-<full-release-commit>
```

Publish releases in increasing version order and wait for each publication to
finish before starting another. Each successful publication updates `latest`;
do not rerun an older successful release or publish older maintenance versions
as the latest release. Never move/reuse published version tags or repurpose SHA
tags. Pin a version or image digest for deployments that must not follow `latest`.
The GitHub Release becomes visible before the image build completes, so a notice
can briefly precede image availability.

### Build metadata

| Value | Release build | Local default | Purpose |
| --- | --- | --- | --- |
| `BPM_BUILD_VERSION` | Release tag, e.g. `v1.3.0` | `dev` | Human-facing version and release update comparison |
| `BPM_BUILD_REVISION` | Full SHA of the release tag's commit | `unknown` | Provenance, source links, and static asset cache identity |

These values are Docker build arguments baked into the image; deployment does
not need to set them. The local Compose helper supplies a clean checkout's SHA,
while `compose.build.yaml` accepts either build argument explicitly. The image
contains OCI labels `org.opencontainers.image.source` (the canonical repository
URL), `org.opencontainers.image.revision` (the exact SHA), and
`org.opencontainers.image.version` (the release tag). Version selection comes
from the release tag, so `package.json` does not need a separate version bump.

The update checker calls the canonical repository's
[`releases/latest` API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release),
compares stable versions numerically, and links to the newer GitHub Release.
Equal or older versions do not produce notices; `dev` builds skip checks. A
known SHA is independent of release comparison and continues to identify source.
The API exposes the version at `/api/config` as `build.version`, and update
status contains `latest_version` in place of the former `commits_behind` field.

Normal deployment uses the public published image directly; the Compose build
override is for local source builds. Forks can run PR CI and local builds, but
the release publisher is deliberately restricted to the canonical repository.
