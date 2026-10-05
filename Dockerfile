# syntax=docker/dockerfile:1

FROM node:26-alpine

ARG BPM_BUILD_REVISION=unknown
ARG BPM_BUILD_VERSION=dev

LABEL org.opencontainers.image.title="Bitcoin Peer Map" \
      org.opencontainers.image.source="https://github.com/spyhunter493/Bitcoin-Peer-Map" \
      org.opencontainers.image.revision="${BPM_BUILD_REVISION}" \
      org.opencontainers.image.version="${BPM_BUILD_VERSION}"

ENV NODE_ENV=production \
    BPM_DATA_DIR=/var/lib/bitcoin-peer-map \
    BPM_BUILD_REVISION=${BPM_BUILD_REVISION} \
    BPM_BUILD_VERSION=${BPM_BUILD_VERSION}

RUN addgroup -S -g 10001 bpm \
    && adduser -S -D -H -u 10001 -h /app -G bpm bpm

WORKDIR /app

RUN mkdir -p /var/lib/bitcoin-peer-map \
    && chown -R bpm:bpm /var/lib/bitcoin-peer-map

COPY --chown=bpm:bpm src ./src
COPY --chown=bpm:bpm package.json ./

USER bpm

EXPOSE 58333
VOLUME ["/var/lib/bitcoin-peer-map"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.BPM_LISTEN_PORT || '58333') + '/healthz', {signal: AbortSignal.timeout(3000)}).then(r => {if (!r.ok) process.exitCode = 1}).catch(() => {process.exitCode = 1})"

CMD ["node", "src/server/main.ts"]
