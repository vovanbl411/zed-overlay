#!/usr/bin/env bash
# Experimental generation and validation; called only from the read-only check job.
set -euo pipefail

version="${1:?candidate version required}"
candidate="${2:?candidate ebuild required}"
patch="${3:?candidate patch required}"
overlay="${4:?disposable overlay required}"
work="${RUNNER_TEMP:?}/zed-independent"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
mkdir "$work"
mkdir "$work/dist" "$work/cache" "$work/logs"
tag="v${version}"
repo=https://github.com/zed-industries/zed.git
checkout="$work/checkout"
source_dir="$work/source/zed-${version}"
archive="$work/dist/zed-${version}-overlay-crates.tar.xz"
source_archive="$work/dist/zed-${version}.tar.gz"
start_total=$SECONDS
summary() { printf '%s\n' "$*" | tee -a "$GITHUB_STEP_SUMMARY"; }
timed() { local label="$1"; shift; local started=$SECONDS; "$@"; summary "$label: $((SECONDS - started))s"; }

resolve_tag() {
  local refs ref object direct= peeled=
  refs="$(env -u GITHUB_TOKEN git ls-remote "$repo" "refs/tags/$tag" "refs/tags/$tag^{}")"
  while read -r object ref; do
    case "$ref" in
      "refs/tags/$tag") direct="$object" ;;
      "refs/tags/$tag^{}") peeled="$object" ;;
      *) echo "Unexpected upstream tag reference" >&2; return 1 ;;
    esac
  done <<< "$refs"
  [[ "$direct" =~ ^[0-9a-f]{40}$ ]]
  [[ -z "$peeled" || "$peeled" =~ ^[0-9a-f]{40}$ ]]
  printf '%s\n' "${peeled:-$direct}"
}

acquire_source() {
  upstream_commit="$(resolve_tag)"
  env -u GITHUB_TOKEN git clone --quiet --depth=1 --single-branch --no-tags --branch "$tag" "$repo" "$checkout"
  test "$(git -C "$checkout" rev-parse HEAD)" = "$upstream_commit"
  test "$(resolve_tag)" = "$upstream_commit"
  git -C "$checkout" archive --format=tar --prefix="zed-${version}/" "$upstream_commit" | gzip -n > "$source_archive"
  mkdir "$work/source"
  tar -xzf "$source_archive" -C "$work/source"
  lock_hash="$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)"
  summary "Upstream tag: $tag; commit: $upstream_commit; Cargo.lock SHA256: $lock_hash"
}

prepare_generator() {
  python3 -m venv "$work/venv"
  env -u GITHUB_TOKEN "$work/venv/bin/python" -m pip install 'pycargoebuild==0.16.0'
  test "$("$work/venv/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("pycargoebuild"))')" = 0.16.0
  docker create --name zed-independent-portage "$GENTOO_PORTAGE_IMAGE" /bin/true > /dev/null
  docker run --rm --volumes-from zed-independent-portage --entrypoint cat "$GENTOO_STAGE3_IMAGE" /var/db/repos/gentoo/metadata/license-mapping.conf > "$work/license-mapping.conf"
  test -s "$work/license-mapping.conf"
  summary 'Generator: pycargoebuild 0.16.0'
}
cleanup() { docker rm -f zed-independent-portage >/dev/null 2>&1 || true; }
trap cleanup EXIT

generate() {
  local generator_start=$SECONDS
  "$overlay/scripts/ci/run-pycargoebuild.sh" "$work/venv/bin/pycargoebuild" \
    "$source_dir" "$archive" "$work/cache" "$work/license-mapping.conf" \
    "$work/generated-zed.ebuild" "$work" 2>&1 | tee "$work/logs/generator.log"
  test "$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)" = "$lock_hash"
  mkdir "$work/source-verify"
  tar -xzf "$source_archive" -C "$work/source-verify"
  diff -qr --no-dereference "$source_dir" "$work/source-verify/zed-${version}"
  summary "pycargoebuild download, repacking and metadata: $((SECONDS - generator_start))s"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/inspect_zed_archive.py" --archive "$archive" --lock "$source_dir/Cargo.lock" | tee -a "$GITHUB_STEP_SUMMARY"
  # pycargoebuild reports its own repacking time. The remainder includes downloads and metadata.
  grep -F 'Time elapsed during repacking:' "$work/logs/generator.log" | tee -a "$GITHUB_STEP_SUMMARY" || true
  cp -n "$work/cache/"*.gh.tar.gz "$work/dist/"
}

sync_metadata() {
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/sync_zed_git_crates.py" --candidate "$candidate" --generated "$work/generated-zed.ebuild" --source "$source_dir" --cache "$work/cache" | tee -a "$GITHUB_STEP_SUMMARY"
  python3 - "$candidate" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
old = 'https://github.com/gentoo-crate-dist/zed/releases/download/v${PV/_/-}/${P/_/-}-crates.tar.xz'
new = 'https://github.com/vovanbl411/zed-overlay/releases/download/crates-v${PV/_/-}/${P/_/-}-overlay-crates.tar.xz'
if s.count(old) != 1:
    raise SystemExit('Expected exactly one original crates SRC_URI')
s = s.replace(old, new)
if 'gentoo-crate-dist/zed' in s:
    raise SystemExit('Unexpected reference crates source in candidate')
p.write_text(s)
PY
}

validate_candidate() {
  docker run --rm --volumes-from zed-independent-portage \
    --mount "type=bind,src=$overlay,dst=/overlay" \
    --mount "type=bind,src=$work,dst=/experiment" \
    --workdir /overlay \
    --env CANDIDATE_VERSION="$version" \
    --env EXPECTED_ARCHIVE_SHA256="$(sha256sum "$archive" | cut -d' ' -f1)" \
    --env CANDIDATE_EBUILD="/overlay/${candidate#"$overlay"/}" \
    --env CANDIDATE_PATCH="/overlay/${patch#"$overlay"/}" \
    "$GENTOO_STAGE3_IMAGE" /bin/bash -euo pipefail -c '
      mkdir -p /etc/portage/repos.conf /etc/portage/package.accept_keywords /etc/portage/package.use
      printf "%s\n" "[DEFAULT]" "main-repo = gentoo" "[gentoo]" "location = /var/db/repos/gentoo" "auto-sync = no" "[zed-overlay]" "location = /overlay" "masters = gentoo" "auto-sync = no" > /etc/portage/repos.conf/zed-overlay.conf
      printf "=app-editors/zed-%s::zed-overlay ~amd64\n" "$CANDIDATE_VERSION" > /etc/portage/package.accept_keywords/zed-candidate
      printf "%s\n" "media-libs/vulkan-loader wayland" "media-video/pipewire sound-server" > /etc/portage/package.use/zed-validation
      export DISTDIR=/experiment/dist
      test "$(portageq envvar DISTDIR)" = "$DISTDIR"
      printf "%s  %s\n" "$EXPECTED_ARCHIVE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" | sha256sum -c -
      start=$SECONDS
      ebuild "$CANDIDATE_EBUILD" manifest
      printf "%s  %s\n" "$EXPECTED_ARCHIVE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" | sha256sum -c -
      echo "Manifest generation: $((SECONDS-start))s" | tee -a /experiment/logs/timing.txt
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/inspect_zed_archive.py --archive "/experiment/dist/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" --manifest /overlay/app-editors/zed/Manifest
      start=$SECONDS
      emerge -pv --oneshot "=app-editors/zed-${CANDIDATE_VERSION}::zed-overlay"
      echo "Portage dependency resolution: $((SECONDS-start))s" | tee -a /experiment/logs/timing.txt
      start=$SECONDS
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/check_zed_cargo_snapshot.py --ebuild "$CANDIDATE_EBUILD" --source "/experiment/source/zed-${CANDIDATE_VERSION}"
      patch --dry-run -p1 -d "/experiment/source/zed-${CANDIDATE_VERSION}" < "$CANDIDATE_PATCH"
      echo "Snapshot and patch validation: $((SECONDS-start))s" | tee -a /experiment/logs/timing.txt
    ' 2>&1 | tee "$work/logs/portage.log"
  cat "$work/logs/timing.txt" >> "$GITHUB_STEP_SUMMARY"
}

summary '## Independent crates validation (no publication)'
timed 'Upstream source acquisition' acquire_source
timed 'Generator environment preparation' prepare_generator
timed 'pycargoebuild generation and archive inspection' generate
timed 'GIT_CRATES synchronization' sync_metadata
validate_candidate
summary "Total independent preparation and validation: $((SECONDS - start_total))s"
