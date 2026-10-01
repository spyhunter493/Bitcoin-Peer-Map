# syntax=docker/dockerfile:1

FROM alpine:3.22 AS build-revision

ARG BPM_BUILD_REVISION=unknown

WORKDIR /source

RUN --mount=target=. <<'EOF'
set -eu

revision="$(printf '%s' "${BPM_BUILD_REVISION}" | tr '[:upper:]' '[:lower:]')"
if [ "${revision}" = "" ] || [ "${revision}" = "unknown" ]; then
    if [ -e .git ]; then
        apk add --no-cache git >/dev/null
        revision="$(git rev-parse HEAD 2>/dev/null || true)"
    fi
    revision="$(printf '%s' "${revision}" | tr '[:upper:]' '[:lower:]')"
fi

if ! printf '%s' "${revision}" | grep -Eq '^(unknown|[0-9a-f]{7,40})$'; then
    revision="unknown"
fi

printf '%s\n' "${revision:-unknown}" > /build-revision
EOF

FROM node:24-alpine

ARG BPM_BUILD_REVISION=unknown

LABEL org.opencontainers.image.title="Bitcoin Peer Map" \
      org.opencontainers.image.source="https://github.com/spyhunter493/bitcoin-peer-map" \
      org.opencontainers.image.revision="${BPM_BUILD_REVISION}"

ENV NODE_ENV=production \
    BPM_DATA_DIR=/var/lib/bitcoin-peer-map \
    BPM_BUILD_REVISION=${BPM_BUILD_REVISION} \
    BPM_BUILD_REVISION_FILE=/app/build-revision

RUN addgroup -S -g 10001 bpm \
    && adduser -S -D -H -u 10001 -h /app -G bpm bpm

WORKDIR /app

RUN mkdir -p /var/lib/bitcoin-peer-map \
    && chown -R bpm:bpm /var/lib/bitcoin-peer-map

COPY --chown=bpm:bpm src ./src
COPY --chown=bpm:bpm package.json ./
COPY --from=build-revision --chown=bpm:bpm /build-revision ./build-revision

USER bpm

EXPOSE 58333
VOLUME ["/var/lib/bitcoin-peer-map"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.BPM_LISTEN_PORT || '58333') + '/healthz', {signal: AbortSignal.timeout(3000)}).then(r => {if (!r.ok) process.exitCode = 1}).catch(() => {process.exitCode = 1})"

CMD ["node", "src/server/main.ts"]
