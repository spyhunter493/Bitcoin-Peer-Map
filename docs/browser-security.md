# Local browser assets and response policy

The dashboard and interactive documentation load their scripts, stylesheets, and
Cinzel fonts from this application. `/docs` and `/redoc` use the same local Swagger
UI and `/openapi.json`. Documentation disables the external validator, query-based
configuration, and persisted authorization. Tokens entered in the documentation
are cleared when the page reloads.

All application responses carry an enforced Content Security Policy,
`X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`. The application cannot
be embedded in frames. Scripts and stylesheet elements must come from the same
origin; inline scripts and evaluated code are disallowed. Inline style attributes
remain allowed because the dashboard uses them for generated views and positioning.
Embedded image data remains allowed for Swagger UI's bundled CSS icons. Browser
API requests, map geometry, and fonts remain restricted to this origin.

The server's GeoIP, update, and connectivity requests are separate from this browser
policy. Existing HTTP deployments continue to work; TLS configuration stays with
the deployment or reverse proxy.

## Reproduce and update vendor artifacts

Use Node 26 and install development dependencies without running upstream installer
scripts:

```sh
npm ci --ignore-scripts
npm run check:assets
```

The pinned development packages are `swagger-ui-dist@5.33.1` (Apache-2.0) and
`@fontsource-variable/cinzel@5.3.0` (OFL-1.1). Their original files, licenses, Swagger
NOTICE, and bundled third-party license notices are
checked into `src/static/vendor`, together with package archive integrity and per-file
SHA-256 hashes in `manifest.json`. The runtime container copies these files from
`src` and requires no npm dependencies or asset downloads.

To update a package, review its release and license, update its exact development
dependency and the matching definition in `scripts/vendor-assets.js`, then run:

```sh
npm run sync:assets
npm run check:assets
npm run check:js
npm run check:types
npm test
npx playwright install --with-deps chromium firefox webkit
npm run test:layout
npm run test:browser-security
```

Review the generated artifact and manifest diff. `check:assets` performs no writes
and rejects modified, missing, or unexpected vendor files. Synchronization reports
unexpected old files rather than removing them silently.

Cinzel uses the original variable-font CSS family `Cinzel Variable`, normal weights
400–900, and both Latin and Latin-ext subsets. Versioned stylesheet URLs also version
the relative font URLs, so font files receive the same immutable caching behavior.

The security browser suite runs captured API fixtures in Chromium, Firefox, and
WebKit. It checks local requests, font loading, dashboard rendering, authenticated
dialogs, Swagger authorization and execution, authorization clearing, blocked script
and stylesheet injection, and frame rejection without contacting a Bitcoin node.
It also checks remembered viewing and management sessions across reloads, tab closes,
restored browser state, explicit locks, and service restarts.
