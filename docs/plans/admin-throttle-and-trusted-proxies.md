# Prevent administrator lockouts and handle trusted proxies

Status: planning only. Implementation has not started.

Priority: high for publicly accessible reverse-proxy deployments. Treat this independently of, and before, the existing three maintenance plans.

## Problem and success criteria

Authentication currently checks address cooldowns and the 1,024-entry storage limit before comparing bearer credentials. Anonymous requests sharing a proxy socket address can therefore cause even correct administrator tokens to receive HTTP 429.

A configured, valid token must remain usable during anonymous cooldowns and storage saturation, subject to the existing Origin guard and ordinary handler checks. Invalid credentials remain rejected and cannot execute management actions. The browser must allow an administrator to supply that valid token before a cooldown expires.

[OWASP's Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout) explicitly cautions that lockout mechanisms can be abused to deny access to other users.

## Authentication and anonymous throttling

- Keep management disabled with HTTP 403 when no administrator token is configured.
- Parse bearer credentials with the existing syntax and a maximum supplied-token length of 256, matching configuration. Treat missing, malformed, and oversized credentials as invalid, without truncation. Preserve the fixed-length SHA-256 digest and timingSafeEqual comparison.
- Compare credentials before consulting anonymous failure windows or their capacity. Valid credentials return immediately, regardless of cooldown or full storage, and do not clear another visitor's anonymous failure history.
- Only invalid credentials enter the failure limiter. Retain ten failures in a fixed 60-second window anchored to the first failure, at most 1,024 windows, expired-window pruning, and no eviction of active windows.
- Preserve initial HTTP 401 with WWW-Authenticate and admin_required; after the threshold, use HTTP 429 with admin_rate_limited and rounded Retry-After. Invalid requests from untracked identities receive HTTP 429 while storage is full. Blocked attempts do not extend the window.
- Retain no-store responses, authorization before management handlers, token rotation behavior, and existing Host/Origin enforcement.

Credential-first verification necessarily checks presented tokens during cooldowns. This anonymous response throttle does not enforce a hard limit on token guesses. Document the existing recommendation for high-entropy tokens and use separate reverse-proxy request limits for public deployments; do not impose a new token policy or promise protection from volumetric denial of service.

## Explicit trusted-proxy identity

- Add BPM_TRUSTED_PROXIES as an optional comma-separated list of literal IPv4/IPv6 addresses or CIDRs. Empty means trust none; reject malformed entries, hostnames, blank entries in a nonempty list, wildcard trust, and /0 trust-all ranges during startup.
- Pass parsed trust configuration explicitly into authentication. Use native Node networking primitives; add no production dependencies and no automatic trust for loopback or private networks.
- Resolve identity only for invalid credentials. Canonicalize socket IPs, equivalent IPv6 spellings, and IPv4-mapped IPv6 for both trust matching and limiter keys.
- Ignore all forwarding headers when the socket peer is untrusted. For a trusted socket, combine every X-Forwarded-For field in wire order, append the socket address, and walk right-to-left over configured trusted hops. The first untrusted address is the limiter identity.
- Accept only bare IP literals in forwarding chains. Bound parsing to 4KiB and 32 forwarded addresses. Missing, malformed, excessive, or entirely trusted chains fall back to the socket identity; do not pick attacker-supplied prefixes.
- Ignore Forwarded, X-Real-IP, X-Forwarded-Host, and X-Forwarded-Proto for this feature. Keep public configuration response shapes unchanged.
- Update settings, Compose environment forwarding, and environment/configuration examples. Require narrow proxy entries, backend access restricted to those proxies, and a proxy that overwrites incoming forwarding data or appends its verified peer address.

The trust-list traversal follows [Mozilla's X-Forwarded-For guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#selecting_an_ip_address). Proxy trust supplies request provenance; it does not authenticate an administrator or relax Origin checks.

## Browser unlock recovery

- For a user-initiated management request with no stored token, allow admin_rate_limited HTTP 429 to open the existing token prompt. Do not treat unrelated HTTP 429 responses as authentication challenges.
- Keep the cooldown informative. Disable repeated submission of the same rejected token, but enable manual verification of a changed nonempty token immediately. Disable submission while verification is in flight.
- Retain rejected-token comparison state only in the current dialog's memory and clear it on closure. Do not write credentials to browser storage or logs.
- After successful verification, replay the pending management action exactly once. Preserve cancellation and late-response protection; do not add automatic verification or HTTP 429 retry loops.
- Preserve stored tokens on unexpected HTTP 429 responses and preserve explicit locking, navigation cleanup, and reload revocation.

## Acceptance tests

- Fill one address window with ten invalid attempts; verify invalid requests remain HTTP 429 while a correct token succeeds on /api/admin/verify and every protected management route before expiry. Verify valid success does not reset anonymous counters.
- Repeat with all 1,024 windows occupied. Correct tokens must succeed from existing and new identities; invalid requests cannot evict active windows or invoke handlers.
- Verify fixed-window expiry, Retry-After rounding, management-disabled HTTP 403, invalid-token HTTP 401, token rotation, Origin checks, and retired-endpoint behavior.
- Through a trusted mock reverse proxy, visitors A and B receive independent anonymous counters; correct authentication succeeds despite A's cooldown. With trust omitted or an untrusted socket, spoofed headers cannot alter the socket identity.
- Cover injected left prefixes, multiple proxies, duplicate X-Forwarded-For fields, IPv6/mapped aliases, malformed/missing/excessive/all-trusted chains, and invalid startup configuration.
- Browser regression: a fresh tab under anonymous cooldown can open the prompt, submit a correct token before expiry, and execute the pending action once. A wrong token followed by a changed correct token also succeeds before expiry; repeated failed tokens remain locally disabled.
- Retain keyboard/focus containment, cancellation, stored-token behavior, and no-secret-persistence checks in Chromium, Firefox, and WebKit.

## Eventual implementation validation

Update authentication tests that currently require valid-token rejection and browser tests that require blanket submission disablement. Update the configuration guide and canonical OpenAPI cooldown descriptions, regenerate checked-in declarations, and verify unchanged response envelopes.

Run syntax, type, generated-contract, backend, browser/security, Compose deployment, and production-container checks. Preserve native Node 26 execution, zero production npm dependencies, and existing deployment safeguards. No migration or automatic release publication is required.

This planning PR adds only this document. No authentication, proxy, browser, configuration, or test implementation changes are included.
