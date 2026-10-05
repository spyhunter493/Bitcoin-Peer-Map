#!/usr/bin/env sh
set -eu

# Resolve the checkout before looking up its Git revision, .env, and overrides.
project_dir="$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)"
cd "$project_dir"

if [ "${BPM_BUILD_REVISION:-}" = "" ]; then
    if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [ -z "$(git status --porcelain --untracked-files=normal --ignore-submodules)" ]; then
            BPM_BUILD_REVISION="$(git rev-parse HEAD)"
        else
            BPM_BUILD_REVISION="unknown"
        fi
    else
        BPM_BUILD_REVISION="unknown"
    fi
    export BPM_BUILD_REVISION
fi

if [ -f compose.override.yaml ]; then
    set -- -f compose.override.yaml "$@"
elif [ -f compose.override.yml ]; then
    set -- -f compose.override.yml "$@"
fi

exec docker compose -f compose.yaml -f compose.build.yaml "$@"
