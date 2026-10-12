# Releasing

[README](../README.md) · [Dashboard](dashboard.md) · [Configuration](configuration.md) · [Operations](operations.md) · [Development](development.md)

Publishing a stable GitHub Release triggers the [release workflow](../.github/workflows/release.yml).
It builds one Linux AMD64/ARM64 image, smoke-tests both architectures, publishes
the tested image to GHCR, then considers promoting `latest`.
Merges, PRs and tag pushes alone do not publish images. Forks can run PR CI and
local builds; publication is restricted to the canonical repository.

## Publish a new version

1. Merge the intended changes into `main` after required PR checks pass.
2. Choose a new increasing tag in `vMAJOR.MINOR.PATCH` form, such as `v1.3.0`.
   Use major for breaking changes, minor for compatible features, patch for fixes.
   Use lowercase `v`, no leading zeros, prerelease suffixes or build metadata.
3. Open **Releases → Draft a new release → Choose a tag**. Create/select a tag
   at the reviewed `main` commit, and use the version as the title. Recheck the
   final tag/commit before publishing a saved draft.
4. Generate release notes, review the changes and previous release, leave
   **Set as a pre-release** unchecked, and set the release as latest when it is
   the new highest stable version.
5. Publish, then wait for **Release → Publish container image** to succeed before
   announcing or deploying the image. Release notes become visible before the
   image build completes, so dashboard update notices can precede availability.
6. Review the Actions summary for both tested architectures, the index digest,
   and whether `latest` was promoted or skipped.

`package.json` needs no version bump; the release tag supplies the image version.
A successful new highest version has these references to the same tested image:

```text
ghcr.io/spyhunter493/bitcoin-peer-map:v1.3.0
ghcr.io/spyhunter493/bitcoin-peer-map:sha-<full-release-commit>
ghcr.io/spyhunter493/bitcoin-peer-map:latest
```

## Recover a failed publication

If the failure can be resolved with the existing workflow, rerun its failed job
from Actions without moving the release tag. If the workflow needs a fix, merge
that fix and manually dispatch **Release** from `main` with the existing published
stable tag. Dispatch recovers a release; it does not create one.

Recovery checks out the original release source and keeps its version/revision.
If either version or SHA image tag already exists, it verifies and pulls the
original index by digest, repeats both architecture smoke tests, and completes
only missing tags or eligible `latest` promotion. It does not rebuild or replace
the existing release image. A successful release can also be rerun safely.

Older workflow reruns execute the code from that original release. Resume behavior
depends on the publisher included in that source commit; use guarded dispatch
from current `main` when recovery needs a newer workflow.

Never move/reuse a published version tag or repurpose a SHA tag. The workflow
rejects wrong version/revision metadata and different index digests between the
version and SHA tags. It also rejects missing releases, drafts, prereleases,
invalid tags and commits outside `main`, and verifies a recorded full source
SHA when available.

## Publication guarantees

The publisher uses a native ARM runner to avoid Node's TypeScript parser failure
under ARM64 emulation. AMD64 smoke tests run under emulation; both platforms run
the full production smoke suite.

When no verified release image exists, Docker Buildx/QEMU build one multi-platform
index and load it into the runner's containerd store. Tests check baked version
and revision before the same image is uploaded. Registry verification checks the
index digest, both architecture manifests and build metadata before attaching
SHA tags or promoting `latest`. GitHub Actions caches builds; authentication uses
`GITHUB_TOKEN`, and only the publish job has `packages: write`.

Publication uses the shared `release-publish` concurrency group with
`queue: max` and `cancel-in-progress: false`. It queues pending recovery/publication
runs without cancelling an active registry push. See GitHub's
[concurrency syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
for queue limits.

Immediately before promotion, the workflow compares the existing GHCR `latest`
stable version numerically. Only a higher version replaces it; equal/older
versions keep their immutable version and SHA tags. A confirmed missing manifest
permits initial promotion. Authentication, network and malformed registry metadata
failures stop promotion rather than treating the image as absent.
Pin a version or digest for deployments that must not follow `latest`.

## Build metadata

| Value | Release build | Local default | Purpose |
| --- | --- | --- | --- |
| `BPM_BUILD_VERSION` | Release tag | `dev` | Installed version and update comparison |
| `BPM_BUILD_REVISION` | Full release-commit SHA | `unknown` | Provenance, source links and static asset caching |

These Docker build arguments are baked into the image; deployment needs no
runtime overrides. The local Compose helper supplies a clean checkout's SHA;
`compose.build.yaml` accepts either argument explicitly. OCI labels record
`org.opencontainers.image.source`, `.revision` and `.version`.

The update checker uses the canonical repository's `releases/latest` API when
outbound policy permits. It compares stable versions and links to a newer
release; `dev`, equal and older versions produce no notice. `/api/config`
reports `build.version`; update status includes `latest_version`. The SHA
identifies source independently of update comparison.

## Validate workflow changes

Release orchestration and registry failures have local fixture coverage:

```bash
node --test tests/deployment/release.test.js
```

This is also included in `npm run test:compose` and never publishes images.
Verify the original release YAML has exactly `group: release-publish`,
`queue: max`, and `cancel-in-progress: false`.

Use actionlint for workflow syntax. If the installed version rejects GitHub's
`queue` key, filter only that known diagnostic for the release workflow:

```bash
actionlint -ignore '^unexpected key "queue" for "concurrency" section\. expected one of "cancel-in-progress", "group"$' .github/workflows/release.yml
actionlint .github/workflows/ci.yml
```

All other diagnostics must pass. Record the exception in PR validation and
remove the filter once your installed actionlint supports the setting.
