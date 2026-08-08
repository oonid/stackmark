#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd -P)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

cat >"$test_dir/docker" <<'SH'
#!/usr/bin/env sh
set -eu
printf '%s\n' "$*" >"$STACKMARK_DOCKER_ARGS"
printf '%s:%s\n' "$HOST_UID" "$HOST_GID" >"$STACKMARK_DOCKER_IDS"
SH
chmod +x "$test_dir/docker"

cat >"$test_dir/pnpm" <<'SH'
#!/usr/bin/env sh
set -eu
printf '%s\n' "$*" >"$STACKMARK_PNPM_ARGS"
SH
chmod +x "$test_dir/pnpm"

export STACKMARK_DOCKER_ARGS="$test_dir/docker.args"
export STACKMARK_DOCKER_IDS="$test_dir/docker.ids"
export STACKMARK_PNPM_ARGS="$test_dir/pnpm.args"

(
  cd "$repo_root/tests"
  PATH="$test_dir:$PATH" "$repo_root/dev" unit
)

expected_compose_args="compose --project-directory $repo_root -f $repo_root/compose.yaml run --rm js pnpm unit"
grep -Fx "$expected_compose_args" "$STACKMARK_DOCKER_ARGS"
grep -Fx "$(id -u):$(id -g)" "$STACKMARK_DOCKER_IDS"

(
  cd "$repo_root/tests"
  PATH="$test_dir:$PATH" "$repo_root/dev" e2e
)

expected_e2e_args="compose --project-directory $repo_root -f $repo_root/compose.yaml run --rm browser pnpm e2e"
grep -Fx "$expected_e2e_args" "$STACKMARK_DOCKER_ARGS"

(
  cd "$repo_root/tests"
  PATH="$test_dir:$PATH" "$repo_root/dev" desktop-build
)

expected_desktop_args="compose --project-directory $repo_root -f $repo_root/compose.yaml run --rm tauri-builder cargo tauri build --bundles deb"
grep -Fx "$expected_desktop_args" "$STACKMARK_DOCKER_ARGS"

(
  cd "$repo_root/tests"
  PATH="$test_dir:$PATH" STACKMARK_IN_BUILDER=1 PNPM_BIN="$test_dir/pnpm" \
    "$repo_root/dev" frontend-build
)

grep -Fx 'build' "$STACKMARK_PNPM_ARGS"

set +e
PATH="$test_dir:$PATH" "$repo_root/dev" unknown-command >"$test_dir/unknown.out" 2>"$test_dir/unknown.err"
status=$?
set -e

test "$status" -eq 64
grep -F 'usage: ./dev' "$test_dir/unknown.err"

grep -Fx 'FROM node:24.18.0-bookworm-slim' "$repo_root/docker/frontend.Dockerfile"
grep -Fx 'ENV COREPACK_HOME=/opt/stackmark-corepack' "$repo_root/docker/frontend.Dockerfile"
grep -F 'corepack prepare pnpm@11.20.0 --activate' "$repo_root/docker/frontend.Dockerfile"
grep -F 'node --version | grep -Fx' "$repo_root/docker/frontend.Dockerfile"
grep -F 'pnpm --version | grep -Fx' "$repo_root/docker/frontend.Dockerfile"
grep -F 'USER stackmark' "$repo_root/docker/frontend.Dockerfile"
grep -F 'mkdir -p /workspace/node_modules /pnpm/store' "$repo_root/docker/frontend.Dockerfile"
grep -F 'chown -R stackmark:stackmark /workspace /pnpm' "$repo_root/docker/frontend.Dockerfile"

grep -Fx 'FROM ubuntu:24.04' "$repo_root/docker/tauri-builder.Dockerfile"
grep -F 'ENV STACKMARK_IN_BUILDER=1' "$repo_root/docker/tauri-builder.Dockerfile"
grep -F -- '--default-toolchain 1.88.0' "$repo_root/docker/tauri-builder.Dockerfile"
grep -F 'tauri-cli@2.11.4' "$repo_root/docker/tauri-builder.Dockerfile"
grep -F 'corepack prepare pnpm@11.20.0 --activate' "$repo_root/docker/tauri-builder.Dockerfile"
grep -F 'libwebkit2gtk-4.1-dev' "$repo_root/docker/tauri-builder.Dockerfile"
grep -F 'node --version | grep -Fx' "$repo_root/docker/tauri-builder.Dockerfile"

grep -Fx '  tauri-builder:' "$repo_root/compose.yaml"
grep -Fx '      dockerfile: docker/tauri-builder.Dockerfile' "$repo_root/compose.yaml"

grep -Fx '      dockerfile: docker/frontend.Dockerfile' "$repo_root/compose.yaml"
grep -Fx '      - "127.0.0.1:1420:1420"' "$repo_root/compose.yaml"
grep -Fx '      - pnpm-store:/pnpm/store' "$repo_root/compose.yaml"
grep -Fx '      - node-modules:/workspace/node_modules' "$repo_root/compose.yaml"

grep -Fx 'store-dir=/pnpm/store' "$repo_root/.npmrc"
grep -Fx '.git' "$repo_root/.dockerignore"
grep -Fx 'node_modules' "$repo_root/.dockerignore"
grep -Fx '**/node_modules' "$repo_root/.dockerignore"
grep -Fx 'dist' "$repo_root/.dockerignore"
grep -Fx 'target' "$repo_root/.dockerignore"
grep -Fx '*.pdf' "$repo_root/.dockerignore"
grep -Fx '.engineering/' "$repo_root/.dockerignore"

grep -F '"name": "stackmark"' "$repo_root/package.json"
grep -F '"private": true' "$repo_root/package.json"
grep -F '"packageManager": "pnpm@11.20.0"' "$repo_root/package.json"
grep -F '"node": "24.18.0"' "$repo_root/package.json"
grep -F '"versions"' "$repo_root/package.json"
grep -F '"build"' "$repo_root/package.json"
grep -F '"unit"' "$repo_root/package.json"
grep -F '"e2e"' "$repo_root/package.json"
grep -F '"lint"' "$repo_root/package.json"
grep -Fx "  - 'apps/*'" "$repo_root/pnpm-workspace.yaml"
grep -Fx "  - 'packages/*'" "$repo_root/pnpm-workspace.yaml"
