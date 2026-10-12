# Access control reference

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

For setup and everyday login/lock behavior, see
[viewing access](configuration.md#viewing-access) and
[management access](configuration.md#admin-token-and-read-only-mode). This reference
covers authentication, remembered sessions, request protection, and failure limits.

## Viewing policy

`BPM_VIEW_MODE=authenticated` is the default. Anonymous visitors can load the page
shell, local assets, API documentation/schema, minimal `/api/access` bootstrap,
and `/healthz`. Detailed GETs, HEAD requests, and the metrics stream require a valid
viewing or administrator bearer token or remembered session. Authentication runs
before query parsing, detailed work, or streaming; HEAD uses the same policy as GET.
The browser waits for viewing authentication before starting detailed polling.

`BPM_VIEW_MODE=redacted` additionally exposes `/api/view/aggregate` and the coarse
dashboard anonymously. They contain cached availability and network/direction count
ranges of five, including 0–4. They omit exact totals, individual peers, locations,
providers, paths, credentials, timestamps, and raw errors. Changes in these ranges
can still reveal activity over time. `BPM_VIEW_MODE=public` explicitly allows the
complete anonymous monitoring view.

Authenticated and redacted deployments refuse startup without a viewing or
administrator credential. Viewing credentials grant no management permission.
Administrator credentials can authenticate both roles, but a browser viewing login
creates only a viewing session. Management requires a separate unlock.

## Credentials

Configure `BPM_VIEW_TOKEN` and/or `BPM_ADMIN_TOKEN`, or their corresponding `_FILE`
settings. Set only one direct/file source for each token. When both roles have
tokens, their values must differ. With no administrator token, management is
disabled and returns HTTP 403, regardless of network or reverse-proxy authentication.

Tokens accept 1–256 bearer-token characters: letters, digits, `-`, `.`, `_`, `~`,
`+`, `/`, and up to two trailing `=` characters. There is no additional minimum
length; whitespace is rejected at startup. Token files must contain a non-empty
token and may end with a newline. Mounted files are read at startup; see
[Compose secrets](configuration.md#compose-secrets) for permissions.

These are shared operator credentials, with no individual accounts, per-user
permissions, or token expiry. A long random token is recommended. Configured
tokens are omitted from dashboard HTML, monitoring responses, and browser storage.
The browser keeps independent session identifiers in cookies. Change the configured
token or mounted file, then recreate the service to revoke the old token.

## Remembered browser sessions

The browser opts into remembered login with `X-BPM-Remember: 1` on
`POST /api/view/verify` or `POST /api/admin/verify`, along with a valid bearer token
and an explicit matching Origin. Without that opt-in, bearer-token verification
creates no cookie. For authenticated requests, explicit bearer credentials take
precedence over cookies; an incorrect bearer token cannot fall back to a session.

Viewing and management use separate cookies. Cookies are host-only, scoped to
`/api`, `HttpOnly`, and `SameSite=Strict`; HTTPS login also sets `Secure`. JavaScript
cannot read them. The server stores hashes of the session identifiers in memory.
Sessions expire after an absolute 30 days; polling does not extend their lifetime.
Up to 1,024 sessions are retained across both roles. At capacity, new remembered
logins return HTTP 503 with `session_capacity`; existing sessions remain valid.

Closing a tab or browser preserves its remembered sessions while clearing its
private document and requests. Protected back/forward-cache navigation reloads
and verifies the session before rendering private data.

| Action | Result |
| --- | --- |
| **Lock view** / `POST /api/view/logout` | Revokes that browser's viewing and management sessions; the dashboard also cancels reads, clears private data, and returns to the access screen |
| **Lock** / `POST /api/admin/logout` | Revokes management while preserving a separate viewing session |
| Restart/recreate the service | Invalidates all remembered sessions and closes existing streams |
| Change token and recreate | Also revokes the previous shared credential |

Locking affects the browser's sessions; the operator's shared token remains valid.
Protected and credential-bearing responses use `Cache-Control: private, no-store`
and vary by `Authorization` and `Cookie`. Cookie-protected streams close when
their viewing session expires or is revoked.

## Origin and Host checks

Browser API POSTs must have an HTTP or HTTPS Origin whose host, including port,
matches the request's `Host`. Reverse proxies must preserve the external Host.
Both HTTP and HTTPS origins are accepted on that host for TLS termination.
Cross-host or malformed origins return HTTP 403.

Cookie-authenticated POSTs, remembered session creation, and logout require an
explicit matching Origin. Bearer-token command-line requests can omit Origin.
Origin checking is separate from authentication; command-line management requests
still need an administrator token.

Use HTTPS when sending credentials and restrict direct access to the backend so
clients cannot bypass the proxy's transport boundary. A TLS proxy does not need
its own login when anonymous public viewing is intended.

## Authentication failure limits

Viewing and management maintain separate anonymous failure windows. Missing or
incorrect credentials return HTTP 401 before protected work executes. After ten
failures within 60 seconds of the first failure from a client address, further
invalid credentials return HTTP 429 with `Retry-After` until that fixed window
expires. Blocked requests do not extend it.

Valid credentials are checked first and remain usable during a cooldown. They
do not clear another visitor's failure history. Each limiter tracks at most
1,024 address windows. Active windows are never evicted; when full, invalid
credentials from new addresses receive HTTP 429 until a window expires. Valid
credentials remain usable at capacity.

For a user-initiated management action, a cooldown can still open **Unlock
management**. The dialog shows the remaining wait and permits manual verification
of a changed token. It disables the same rejected token and submissions already
in flight. Successful verification executes the pending action once; cancellation
leaves it unexecuted. Unrelated HTTP 429 responses do not open authentication
prompts or clear the tab's authorization. The browser does not automatically
retry throttled requests.

Checking valid credentials first prevents people sharing an address from locking
out an administrator. The response throttle consequently does not impose a hard
limit on token guesses. Use a long random token and separate reverse-proxy request
limits for public deployments.

## Proxy identity

`BPM_TRUSTED_PROXIES` lists literal IP addresses or CIDRs trusted to supply
`X-Forwarded-For` for authentication failure limits. Empty trusts none; there is
no automatic trust for loopback or private networks. Hostnames, wildcards,
malformed/blank list entries, and `/0` ranges fail startup. See
[proxy configuration](configuration.md#trusted-proxy-addresses).

Only a trusted socket peer enables forwarding-header parsing. BPM combines all
`X-Forwarded-For` fields in wire order, walks right to left across trusted proxy
hops, and uses the first untrusted IP as the limiter identity. Equivalent IPv6
spellings and IPv4-mapped addresses share an identity. Missing, malformed,
all-trusted, or excessive chains fall back to the socket address. Parsing is
bounded to 4 KiB and 32 forwarded addresses; other forwarding headers have no
effect. See [MDN's trusted-proxy traversal guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#selecting_an_ip_address).

Restrict backend access to the configured proxies and have each overwrite incoming
forwarding headers or append its verified connection peer. Proxy trust does not
authenticate users or relax the Host/Origin checks.

## Management API compatibility

Management API clients send `Authorization: Bearer <admin-token>` on each request.
Peer actions, clearing bans, GeoIP/outbound preferences, dataset updates, and the
server's connectivity acknowledgement require management authorization. Viewing
a connectivity notice is handled locally.

GeoIP settings accept explicit desired values: `POST /api/geodb/db-only` and
`POST /api/geodb/auto-update` use `{ "enabled": boolean }`. Database-only
`enabled: true` disables external peer lookups. Repeated values succeed without
rewriting preferences. The old `/api/geodb/toggle-db-only` and
`/api/geodb/toggle-auto-update` routes return authenticated HTTP 410 with a
replacement endpoint and reload instruction, and perform no mutation.

See [the API reference](api.md) for routes and the interactive schema. Browser
asset policy and vendor maintenance are documented in
[browser security](browser-security.md).
