# Lean dashboard refactor validation

The benchmark serves local deterministic peer fixtures and measures main-thread
work during three idle seconds after arrival animations settle. It also counts
DOM nodes and table mutations during an unchanged poll. Each result below is one
run of `npm run benchmark:dashboard` on the same host, Node 24.18.1, and the same
installed Playwright 1.62.1 / Chrome for Testing 151.0.7922.34.
Final verification was completed on 2026-09-24. Browser regressions ran separately from profiling.

## Three-run comparison

Times are task seconds per three elapsed seconds, in 14 / 125 / 500-peer order.

| Revision | Run 1 | Run 2 | Run 3 | Median |
| --- | --- | --- | --- | --- |
| Original `9e4a456`, initial capture | 0.451 / 0.869 / 1.362 | 0.455 / 0.859 / 1.358 | 0.497 / 0.835 / 1.380 | 0.455 / 0.859 / 1.362 |
| Original `9e4a456`, verification-day repeat | 0.492 / 0.842 / 1.502 | 0.509 / 0.877 / 1.349 | 0.510 / 0.840 / 1.399 | 0.509 / 0.842 / 1.399 |
| Refactored dashboard | 0.527 / 0.845 / 1.401 | 0.488 / 0.856 / 1.542 | 0.511 / 0.900 / 1.376 | 0.511 / 0.856 / 1.401 |

The 14-peer median initially exceeded the historical baseline by 12.3%. That
triggered three additional runs of the original commit in an isolated checkout,
using the same installed dependencies and browser. The original commit's current
median also increased. Against that contemporary baseline, the refactor changes
median idle work by **+0.4% / +1.7% / +0.1%**. No repeatable regression above 10%
was observed. These are local synthetic measurements, not a guarantee of identical
performance on every device.

| Peers | Original DOM nodes | Refactored DOM nodes | Unchanged-poll mutations, original / refactored |
| --- | ---: | ---: | ---: |
| 14 | 666 | 639 | 0 / 0 |
| 125 | 2775 | 2748 | 0 / 0 |
| 500 | 9900 | 9873 | 0 / 0 |

Every unchanged-poll run reported zero table mutations. The dependency graph now
needs one module entrypoint instead of ordered script elements.

## Production source size

Counts include formatting, comments, and type declarations; tests and documentation
are excluded. The baseline is `9e4a456`.

| Source | Baseline lines | Refactored lines | Change |
| --- | ---: | ---: | ---: |
| Browser JavaScript | 17,974 | 19,929 | +1,955 |
| Shared TypeScript declarations | 280 | 756 | +476 |
| Python | 2,460 | 2,603 | +143 |

Raw line count increased: complete strict JSDoc coverage and expanded formatting
outweigh removed implementation lines, and the backend gained caching behavior.
Browser source bytes decreased by approximately 3.5%; an Acorn AST count of
statements and variable declarations decreased by approximately 5.7%. Raw line
count is therefore reported separately from implementation size.

Removed duplication includes the private peer-popup implementation, identical
formatting and service helpers, duplicate public/private map-group renderers,
eight repeated peer-membership loops, the 38-action summary callback interface,
parent-state getter adapters, global module registration, ordered script lists,
manually listed syntax/test files, and the deferred GeoIP retry list. Intentionally
different compact display formats remain separate.
