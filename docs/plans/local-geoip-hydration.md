# Faster local GeoIP hydration

Status: planning only. Implementation has not started. Reviewed against main `b066ba7` on 2026-10-09.

## Problem and intended result

The current peer geolocation loop performs a synchronous local database read, then awaits an external provider request and persistence retries for one host before processing the next. A slow provider request can leave later peers pending even when their locations already exist in the local database. SQLite save retries can stall the same queue for up to 65 seconds.

A fresh read-only reproduction on this revision used the real peer worker with fixture RPC/database/provider objects in an isolated Node 26 container with networking disabled. While the first provider response was held open, the next host remained queued and its fresh local row had not been read; the serialized peer was still pending. This verifies the scheduling problem, not the proposed replacement architecture. Local locations should become available independently of provider and persistence latency.

## Current-code evidence

- `src/server/services/peers.ts`: `refreshOnce()` queues missing or changed-generation locations; `geoLoop()` awaits `resolveGeo()`, which also awaits `persistGeo()`. The existing 1.5-second delay applies after a provider attempt, rather than after every local-only job.
- `src/server/services/geoip.ts`: `get()` uses `DatabaseSync` and currently returns `null` for both a missing row and a read error. `save()` retains the original observation timestamp, retries busy/locked writes with a 65-second budget, and returns the stored winner.
- `src/server/services/geoip-merge.ts` and `geoip-schema.ts`: imports and provider saves replace a row only when their timestamp is strictly newer. Equal timestamps retain the existing row and provenance; missing/zero ages and future timestamps must retain the existing unknown-age treatment.
- `src/server/runtime.ts`: shutdown awaits peer tasks and the automatic dataset task before closing SQLite. Any new worker must join that shutdown barrier. Current per-host deduplication and active-host checks do not identify a departed host that later reconnects under the same address.

## Proposed implementation

- During each successful peer refresh, hydrate eligible local records for unique active public hosts before dispatching newly queued provider work. Read for cache misses, expired negative entries, and database-generation changes; do not repeat reads merely because the same host has multiple connections. Keep the private-address classification and exclusion path intact.
- Use small bounded batches with event-loop yields when a refresh contains many hosts. SQLite reads remain synchronous: separate queues remove awaits on network/save retries, but do not make SQLite itself nonblocking. Preserve retained locations through local read failures; internally distinguish a read failure from a confirmed miss without changing HTTP response shapes or reporting a provider outage.
- Keep valid retained locations visible, including stale and unknown-age records. Hydration must compare timestamps and provenance against current memory, including pending saves, instead of replacing a newer observation with missing or older local data. A genuinely newer imported winner may replace an older pending observation; do not lose the persistence job until its outcome has been reconciled.
- Separate one provider worker from one persistence worker. Deduplicate queued and in-flight work per host, retain at most one current provider job and one current save observation per active host, and prune queued work/cache on departure. Allow only the bounded outstanding provider/save operations while cancellation settles. Avoid unbounded Promise.all or concurrent provider fanout. One busy save may delay other saves; it must not delay local hydration or the provider worker.
- Keep provider requests at one in flight, with the existing 10-second timeout, at least 1.5 seconds after an actual provider attempt finishes before another begins, quota windows, and outage backoff. Count failed attempts as attempts. Local hydration and persistence do not reset or consume request spacing. Recheck host identity, pending saves, current local winner, database-only mode, freshness/cooldowns, and quota immediately before dispatch; a queued miss may have been filled by an import while waiting.
- Publish validated provider results immediately, then hand their data and original observedAt timestamp to the persistence queue without awaiting the save before processing subsequent provider work.
- Preserve the existing SQLite save retry budget and backoff. After an exhausted save, retain the result and retry persistence after 60 seconds without repeating the provider request.
- Preserve 30-day freshness, 60-second lookup-miss retries, one-hour stale-refresh retries, and unknown-age winner cooldowns.
- Continue local hydration in database-only mode. Never send private, reserved, onion, I2P, or CJDNS addresses to the provider.
- Preserve the strict-newer import/save arbitration, including equal timestamps and unknown-age winners. Re-read the database after unsuccessful provider lookup, because a dataset import may have supplied a location in the meantime. After save completion, reconcile the returned stored winner with the current cache and job identity; never blindly overwrite a newer cached observation or revive a cleared pending-save job. Unchanged import winners must preserve existing refresh deadlines.
- Give each host lifetime and queued/in-flight job an identity, including departure followed by reconnection to the same host. Cancellation and old job completion must not clear a replacement job's deduplication marker or reintroduce/overwrite its cache entry. A valid write that already committed may remain in SQLite; cancellation cannot promise to undo that transaction.
- Make concurrent startup idempotent before its first await, abort owned provider/save work on departure and shutdown, and await every worker before closing the database. Guard late RPC refresh completion as well as GeoIP results after shutdown. Intended cancellation must not count as a provider outage.

## Acceptance tests

Use deferred provider/save fixtures and mocked clocks instead of wall-clock delays.

- A later fresh local hit is serialized while an earlier provider request remains unresolved. Repeat with stale and unknown-age local records and generation changes.
- Local hydration and subsequent provider requests continue while an earlier persistence operation is busy. New provider locations appear before their writes complete.
- Duplicate connections share hydration and jobs. Queued state stays bounded by active hosts plus the bounded operations settling cancellation; departed queued work is removed. Large refreshes yield so HTTP handlers remain responsive.
- Request timeout, spacing, quota Retry-After/X-Rl/X-Ttl handling, outage backoff, and recovery remain correct.
- Failed saves retain known coordinates and observation timestamps; persistence retries do not make another provider request.
- Imports during queued/provider/save work adopt the correct timestamp winner, including older/equal/newer rows, unknown/future ages, a missing row, and read errors. A newly imported fresh row suppresses an obsolete queued provider request. Pending saves and replacement jobs cannot be overwritten or cleared by late results.
- Cover departure/reappearance of the same address, two concurrent starts, shutdown during RPC/provider/save work, and a save that committed just before cancellation. No late result may repopulate the active cache or schedule another request after shutdown.
- Database-only mode, a disabled/missing database, quota/outage windows, and private/reserved/onion/I2P/CJDNS/non-IP addresses cannot cause inappropriate provider calls. Keep existing known locations usable and distinguish local read failures from lookup misses.
- Independent service instances do not share queue state.

## Validation and boundaries

For the eventual implementation, run backend service, persistence, freshness, connectivity, and runtime tests; syntax/type/API-generation checks; browser GeoIP/stale-recovery coverage; and production-container checks.

Keep existing HTTP response shapes, provider choice, scoring, saved preferences, native Node 26 execution, and zero production npm dependencies. This scheduling change can be implemented independently of selecting an HTTPS provider. It must recheck the existing database-only preference before dispatch; the separate privacy and HTTPS planning draft owns additional outbound controls and cancellation on policy changes. Expose owned cancellation/job-identity hooks for that work without treating today's database-only setting as a general prohibition on all network traffic.

Review acceptance fixtures before implementation, especially the definition of an imported winner versus a newer pending observation. No provider selection, schema migration, or outbound-default decision is made here.

This draft adds only this document. It does not change the queue, database, network behavior, or tests.
