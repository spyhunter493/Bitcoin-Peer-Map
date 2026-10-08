# Private viewing and optional outbound requests

Status: implementation approved on 2026-10-09. This PR implements viewing privacy and outbound controls. The local hydration implementation is in the preceding PR.

## Approved behavior

- Implicit deployments use authenticated viewing and local-only operation. Existing deployments without an explicit viewing mode must configure a viewing/admin credential or explicitly opt into public mode before upgrading. Missing new global outbound preferences deny optional traffic, including for older preference files.
- Public mode permits anonymous detailed monitoring. Authenticated mode permits only the public shell/assets/docs/schema, minimal access bootstrap, and liveness without a credential. Redacted mode additionally permits cached availability and fixed network/direction count ranges of five, with no exact total or individual data. Bucketing is not an anonymity guarantee.
- A separate viewing token permits detailed reads but cannot manage peers or settings. Administrator credentials may also view. Tokens use direct or mounted-file configuration, remain in browser memory, and are required on each protected read.
- GET, normalized HEAD, conditional/error paths, and the separate metrics stream share the access policy before sensitive work or headers. Protected responses are private/no-store and vary by Authorization.
- Detailed browser polling begins only after viewing authentication. Locking/authentication failure aborts reads, disposes the detailed dashboard, clears retained/private rendered data, and returns to fresh access bootstrap. Protected browser back/forward-cache navigation also clears access.
- Secrets are shared operator credentials, with restart-based rotation and no account/session expiry or live-revocation system. Restart closes active streams. A tab lock clears that tab; it does not revoke a server credential. Operators provide the dashboard HTTPS boundary.
- A saved global optional-outbound preference governs peer GeoIP calls, dataset downloads, release checks, and reachability probes. Each feature keeps its own control. Explicit BPM_OUTBOUND_ENABLED=false is a deployment-level prohibition that an administrator cannot override.
- Feature-owned cancellation prevents disabled requests, old completions, redirects, or retries from causing further optional traffic. It does not abort configured Bitcoin RPC, local hydration, local persistence, or an already downloaded validated dataset's local merge. Disabled features report disabled rather than healthy or failed connectivity.

## Provider decision

The user chose local-only defaults with the existing free HTTP ip-api provider available as an explicit opt-in. Its [official free JSON documentation](https://ip-api.com/docs/api:json) states that the free endpoint does not support HTTPS. Changing only the scheme would not make it usable over HTTPS.

This implementation does not add Pro, ipwho.is, a subscription, an API key, or a provider switch. The existing provider's public-IP exclusions, quota windows, timeout, pacing, response fields, and persisted ip_api provenance remain. Its HTTP transport and peer-address disclosure are identified before opt-in. HTTPS provider adapters and any required unknown-field/provenance migrations remain future separately approved work.

## Validation

Meaningful backend fixtures cover protected routes/HEAD/errors/streams, viewer/admin separation and throttling, aggregate allowlists and bucket boundaries, private startup defaults, mounted-secret loading, preference migration, scheduling/cancellation/re-enable races, and zero optional requests while denied.

Browser coverage checks credential memory, gating before login, private-data disposal, reload/back-forward navigation, redacted-only payloads, and authenticated management of optional requests. Generated API contracts, type/syntax/assets, existing backend/frontend/deployment suites, Chromium/Firefox/WebKit checks, and the production-container smoke test are required before merging.

The implementation preserves native Node 26 execution and zero production npm dependencies. No billable or live provider calls are needed for validation.
