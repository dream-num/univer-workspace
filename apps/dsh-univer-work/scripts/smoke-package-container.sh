#!/bin/sh
set -eu

dsh_repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
dsh_iid_file=$(mktemp "${TMPDIR:-/tmp}/dsh-univer-work-smoke-iid.XXXXXX")
dsh_container_id=
dsh_image_id=

dsh_cleanup() {
  if [ -n "$dsh_container_id" ]; then
    docker container rm --force "$dsh_container_id" >/dev/null 2>&1 || true
  fi
  if [ -n "$dsh_image_id" ] && docker image inspect "$dsh_image_id" >/dev/null 2>&1; then
    docker image rm "$dsh_image_id" >/dev/null
  fi
  rm -f "$dsh_iid_file"
}
trap dsh_cleanup EXIT INT TERM

docker build \
  --platform linux/arm64 \
  --file "$dsh_repo_root/apps/dsh-univer-work/Dockerfile.package-smoke" \
  --iidfile "$dsh_iid_file" \
  "$dsh_repo_root"

dsh_image_id=$(cat "$dsh_iid_file")
test "$(docker image inspect --format '{{.Architecture}}' "$dsh_image_id")" = arm64
dsh_container_id=$(docker container create \
  --platform linux/arm64 \
  --init \
  --network none \
  --read-only \
  --user 65532:65532 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --memory 6g \
  --cpus 4 \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=4g,mode=1777 \
  --tmpfs /dev/shm:rw,nosuid,nodev,size=256m,mode=1777 \
  --env HOME=/tmp/dsh-home \
  --env XDG_CACHE_HOME=/tmp/dsh-cache \
  --env PNPM_CONFIG_OFFLINE=true \
  --env PNPM_CONFIG_STORE_DIR=/tmp/pnpm-store \
  --env DSH_UNIVER_WORK_SMOKE_OFFLINE_PLATFORM=1 \
  --env UNIVER_RENDER_BROWSER=/usr/bin/chromium \
  "$dsh_image_id")

test "$(docker container inspect --format '{{.HostConfig.NetworkMode}}' "$dsh_container_id")" = none
test "$(docker container inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$dsh_container_id")" = true
test "$(docker container inspect --format '{{.Config.User}}' "$dsh_container_id")" = 65532:65532
test "$(docker container inspect --format '{{.HostConfig.SecurityOpt}}' "$dsh_container_id")" = '[no-new-privileges]'
test "$(docker container inspect --format '{{.HostConfig.CapDrop}}' "$dsh_container_id")" = '[ALL]'

docker container start --attach "$dsh_container_id"
