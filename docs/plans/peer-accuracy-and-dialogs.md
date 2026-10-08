# Accurate peers and responsive dialogs

Status: implemented. This document records endpoint identity, location display,
and dialog behavior covered by the regression tests in this PR.

This is the second of three ordered implementation plans. It addresses Addrman uncertainty, coordinate sorting, and the remaining disconnect/ban dialog minimum width.

## Addrman endpoint identity and uncertainty

- Continue the existing getnodeaddresses refresh cadence without adding hidden getrawaddrman RPC calls.
- Match a shared normalized host-plus-explicit-port key. Normalize hostname case and equivalent IPv6 spelling without DNS resolution; preserve numeric ports, including I2P port 0. Reject missing/invalid ports instead of inferring defaults.
- Validate ports in RPC address records and update incomplete test fixtures.
- Keep the existing required in_addrman boolean for compatibility. True means an exact endpoint was observed; false means not observed, never confirmed absence.
- Add required addrman_status with the values present, not_returned, and unavailable. A valid latest inventory yields present for exact matches and not_returned otherwise, including an empty inventory.
- Initial reads, failed/invalid refreshes, or an unusable peer endpoint yield unavailable. Retain the last validated inventory internally, but suppress membership claims while unavailable and recover on the next successful refresh.
- Use one formatter throughout the table, peer details, and map tooltip: Yes / Not returned / Unavailable. Treat absent or invalid status as Unavailable. Preserve the private-map dash and the existing column preference key; expose the complete status in cell and hover text.
- Update canonical OpenAPI and checked-in generated declarations. Cover both peer response forms; the existing metrics-only stream retains its response contract.

getnodeaddresses filters results for quality and recency, so omission cannot confirm absence. See the [Knots RPC implementation](https://github.com/bitcoinknots/bitcoin/blob/v29.4.1.knots20260508/src/rpc/net.cpp#L911-L961).

## Coordinate display and sorting

- Share one coordinate accessor between display and sorting. Accept finite numeric coordinates when location_status is ok, or absent in older data. An explicit other status means missing, regardless of placeholder numeric contents.
- Treat null, undefined, non-numeric, and nonfinite coordinates as missing. Keep genuine zero valid.
- Display valid coordinates with two decimals and missing coordinates as an em dash. Sort raw numbers and keep missing entries last in both directions; preserve stable ties and the existing sort cycle.
- Keep coordinate HTTP fields, map placement, saved columns, and unrelated comparators unchanged.

## Remaining dialog sizing

Connect and nested authentication already fit at 320px on the current baseline. Remove the remaining 320px minimum on disconnect/ban choice dialogs, retaining shared viewport sizing, 16px side gutters, and internal scrolling.

## Acceptance tests

- Addrman: exact matches, same host/different ports, equivalent IPv6, IPv4/CJDNS/onion/I2P, invalid or missing ports, empty inventories, initial and subsequent failures, recovery, consistent UI labels, and rejection of invalid API status values.
- Coordinates: negatives, zero, fractions, [2, 10, 30], equal and rounded-display ties, all/mixed missing values, both directions, stable ordering, and unchanged input arrays. Include actual pending/private/unavailable zero placeholders and pending-to-located refreshes.
- Browser table: enable both coordinate columns, cycle headers through ascending/descending/unsorted, and confirm numeric ordering, display formatting, and missing-last behavior across refreshed snapshots.
- Dialogs: open real Connect, nested authentication, disconnect/ban choices, and populated bans dialogs at 320px in Chromium, Firefox, and WebKit. Assert 16px side gutters, reachable controls, internal scrolling, and closing/focus behavior.

## Validation and boundaries

Validation uses syntax/type/API-generation checks, backend and frontend regressions,
browser layout tests, and the three-engine smoke suite. Authentication, polling
cadence, saved preferences, native Node 26 execution, and zero production npm
dependencies remain unchanged.

The implementation includes exact endpoint matching and explicit inventory
availability, shared coordinate and Addrman display helpers, and narrow choice
dialog sizing. Backend contracts and browser fixtures carry the additive status.
