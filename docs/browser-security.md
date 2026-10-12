# Browser security and assets

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

This page covers browser response policy and vendored asset maintenance.
Deployment credentials, viewing modes and HTTPS are described in
[Access control](access-control.md).

## Response policy

The dashboard and interactive API documentation load scripts, stylesheets and
Cinzel fonts from BPM. `/docs` and `/redoc` use the same local Swagger UI and
`/openapi.json`. Documentation disables the external validator, query-based
configuration and persisted authorization; entered tokens clear on reload.

All application responses enforce Content Security Policy,
`X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`. Frames, inline
scripts and evaluated code are blocked. Scripts, stylesheet elements, fonts,
API requests and map geometry are restricted to this origin. Inline style
attributes remain allowed for generated views/positioning, and embedded image
data is allowed for Swagger's bundled CSS icons.

Server GeoIP, release and connectivity requests follow a separate
[optional outbound policy](operations.md). TLS is configured by the deployment
or reverse proxy; the browser policy also works for HTTP deployments.

## Verify checked-in assets

Use Node 26 and install development dependencies without upstream installer
scripts:

```bash
npm ci --ignore-scripts
npm run check:assets
```

| Pinned package | License |
| --- | --- |
| `swagger-ui-dist@5.33.1` | Apache-2.0 |
| `@fontsource-variable/cinzel@5.3.0` | OFL-1.1 |

Original files, licenses, Swagger NOTICE and third-party notices are checked into
`src/static/vendor`. Its `manifest.json` records package archive integrity and
per-file SHA-256 hashes. The container copies these files from source and needs
no runtime npm dependencies or asset downloads. `check:assets` writes nothing
and rejects modified, missing or unexpected vendor files.

Cinzel retains its `Cinzel Variable` CSS family, normal weights 400–900, and
Latin/Latin-ext subsets. Versioned stylesheets also version their relative font
URLs for immutable caching.

## Update vendored assets

Review the package release and license. Update its exact development dependency,
lockfile and matching definition in `scripts/vendor-assets.js`; reinstall with
`npm ci --ignore-scripts`, then run:

```bash
npm run sync:assets
npm run check:assets
npm run check:js
npm run check:types
npm test
npx playwright install --with-deps chromium firefox webkit
npm run test:layout
npm run test:browser-security
```

Review the artifact and manifest diff. Synchronization reports unexpected old
files rather than removing them silently.

Browser security tests use local API fixtures in Chromium, Firefox and WebKit.
They cover local requests/fonts, rendering, authenticated dialogs, Swagger
execution and authorization clearing, blocked script/style injection, frame
rejection, and remembered viewing/management sessions across reloads, tab closes,
restored browser state, locks and service restarts. They need no Bitcoin node.
