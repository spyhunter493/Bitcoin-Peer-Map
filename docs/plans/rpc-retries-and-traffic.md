# Reliable RPC retries and traffic rates

Status: planning only. Implementation has not started.

This is the first of three ordered implementation plans. It addresses failed block/header retry caching and traffic-rate distortion caused by delayed uptime responses.

## Intended changes

- Share keyed-reader handling between block and header reads while retaining the existing successful immutable caches.
- Keep active reads separate from settled failures. Retain genuine RPC/parser failures for 1,000ms after completion, with at most 256 retained failures per reader kind.
- Prune expired failures on access and settlement; evict the oldest retained failure when full. Use lazy cleanup without timers, and never evict active reads.
- Expose read-only cached-failure expiry from the shared reader. Remove successful and cancelled readers immediately. Preserve subscriber cancellation and identity guards against late completion removing a replacement.
- Capture the monotonic timestamp when validated byte totals arrive, alongside those totals. Calculate and store traffic-rate baselines using that observation time independently of uptime completion.
- Preserve snapshot wall-clock timestamps, five-second shared polling, uptime formatting, restart detection, counter resets, null/error behavior, and recovery baselines.

## Acceptance tests

Use the existing mocked monotonic clock and deferred RPC fixtures rather than real-time sleeps.

- Twenty sequential failures and twenty concurrent failures share one RPC for the same block/header hash.
- A cached failure is reused at 999ms and retried at exactly 1,000ms after settlement; a slow failed RPC receives the full failure-cache interval.
- Recovery populates the successful cache. Different hashes remain independent. Capacity eviction and expired-entry cleanup work without evicting active reads.
- Cancelling one subscriber leaves another intact; cancelling the last subscriber cancels the underlying read. An old late result cannot remove or overwrite a replacement.
- With steady 1,000 B/s traffic, totals observed at 0ms, 5,000ms, and 15,000ms, and the second uptime response delayed until 10,000ms, both calculated rates remain 1,000 B/s.
- Cover uptime arriving first, delayed totals, uptime failure, malformed counters, resets, and outage recovery.

## Validation and boundaries

For the eventual implementation, run syntax/type checks and the backend suite, including shared-reader, service, and metrics regressions. Keep HTTP response shapes, authentication, native Node 26 execution, and zero production npm dependencies unchanged.

This planning PR adds only this document; it does not implement the fixes or claim implementation tests passed.
