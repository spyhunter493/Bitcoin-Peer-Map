#!/usr/bin/env sh
set -eu

port="${BPM_LAYOUT_TEST_PORT:-58991}"
container_name="bpm-layout-test-$$"
base_url="http://127.0.0.1:${port}"

cleanup() {
    docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm \
    --name "${container_name}" \
    -p "127.0.0.1:${port}:${port}" \
    -v "${PWD}:/app:ro" \
    -w /app \
    -e BPM_LAYOUT_TEST_HOST=0.0.0.0 \
    -e BPM_LAYOUT_TEST_PORT="${port}" \
    node:26-alpine \
    node tests/layout_server.ts &
server_pid="$!"

i=0
while [ "${i}" -lt 120 ]; do
    if curl -fsS "${base_url}/healthz" >/dev/null 2>&1; then
        BPM_LAYOUT_TEST_BASE_URL="${base_url}" npm run test:layout
        exit $?
    fi
    if ! kill -0 "${server_pid}" 2>/dev/null; then
        wait "${server_pid}"
        exit 1
    fi
    i=$((i + 1))
    sleep 1
done

echo "Timed out waiting for ${base_url}/healthz" >&2
exit 1
