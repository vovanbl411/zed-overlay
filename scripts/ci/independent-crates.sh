#!/usr/bin/env bash
# Generate or reuse validated crates in the read-only check job.
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
metadata="$work/dist/zed-${version}-overlay-crates.json"
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
  test "$(grep -Fc 'https://github.com/zed-industries/zed/archive/refs/tags/v${PV/_/-}.tar.gz -> ${P}.tar.gz' "$candidate")" = 1
  env -u GITHUB_TOKEN curl -fsSL --retry 3 \
    "https://github.com/zed-industries/zed/archive/refs/tags/${tag}.tar.gz" \
    -o "$source_archive"
  test "$(resolve_tag)" = "$upstream_commit"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/verify_zed_source.py" \
    --archive "$source_archive" --checkout "$checkout" --commit "$upstream_commit" \
    --root "zed-${version}"
  mkdir "$work/source"
  tar -xzf "$source_archive" -C "$work/source"
  lock_hash="$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)"
  source_hash="$(sha256sum "$source_archive" | cut -d' ' -f1)"
  summary "Upstream tag: $tag; commit: $upstream_commit; source archive SHA256: $source_hash; Cargo.lock SHA256: $lock_hash"
}

prepare_portage() {
  docker create --name zed-independent-portage "$GENTOO_PORTAGE_IMAGE" /bin/true > /dev/null
}

prepare_generator() {
  python3 -m venv "$work/venv"
  env -u GITHUB_TOKEN "$work/venv/bin/python" -m pip install 'pycargoebuild==0.16.0'
  test "$("$work/venv/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("pycargoebuild"))')" = 0.16.0
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
  summary "pycargoebuild download, repacking and metadata: $((SECONDS - generator_start))s"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/inspect_zed_archive.py" --archive "$archive" --lock "$source_dir/Cargo.lock" | tee -a "$GITHUB_STEP_SUMMARY"
  grep -F 'Time elapsed during repacking:' "$work/logs/generator.log" | tee -a "$GITHUB_STEP_SUMMARY" || true
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" create \
    --version "$version" --commit "$upstream_commit" --source "$source_dir" \
    --source-archive "$source_archive" --lock "$source_dir/Cargo.lock" --archive "$archive" \
    --generated "$work/generated-zed.ebuild" --cache "$work/cache" --output "$metadata"
}

reuse() {
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" reuse \
    --version "$version" --commit "$upstream_commit" --source-archive "$source_archive" \
    --source "$source_dir" --archive "$archive" --metadata "$metadata" \
    --cache "$work/cache" --generated "$work/generated-zed.ebuild"
}

verify_inputs() {
  test "$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)" = "$lock_hash"
  mkdir "$work/source-verify"
  tar -xzf "$source_archive" -C "$work/source-verify"
  diff -qr --no-dereference "$source_dir" "$work/source-verify/zed-${version}"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" identity \
    --version "$version" --commit "$upstream_commit" --source-archive "$source_archive" \
    --lock "$source_dir/Cargo.lock" --archive "$archive" --metadata "$metadata"
  cp -n "$work/cache/"*.gh.tar.gz "$work/dist/"
}

sync_metadata() {
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/sync_zed_git_crates.py" --candidate "$candidate" --generated "$work/generated-zed.ebuild" --source "$source_dir" --cache "$work/cache" | tee -a "$GITHUB_STEP_SUMMARY"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" rewrite-uri "$candidate"
}

validate_candidate() {
  cp "$overlay/app-editors/zed/Manifest" "$work/original-Manifest"
  docker run --rm --volumes-from zed-independent-portage \
    --mount "type=bind,src=$overlay,dst=/overlay" \
    --mount "type=bind,src=$work,dst=/experiment" \
    --workdir /overlay \
    --env CANDIDATE_VERSION="$version" \
    --env EXPECTED_ARCHIVE_SHA256="$(sha256sum "$archive" | cut -d' ' -f1)" \
    --env EXPECTED_SOURCE_SHA256="$source_hash" \
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
      printf "%s  %s\n" "$EXPECTED_SOURCE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}.tar.gz" | sha256sum -c -
      start=$SECONDS
      ebuild "$CANDIDATE_EBUILD" manifest
      printf "%s  %s\n" "$EXPECTED_ARCHIVE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" | sha256sum -c -
      printf "%s  %s\n" "$EXPECTED_SOURCE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}.tar.gz" | sha256sum -c -
      echo "Manifest generation: $((SECONDS-start))s" | tee -a /experiment/logs/timing.txt
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/inspect_zed_archive.py --archive "/experiment/dist/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" --manifest /overlay/app-editors/zed/Manifest
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/inspect_zed_archive.py --archive "/experiment/dist/zed-${CANDIDATE_VERSION}.tar.gz" --manifest /overlay/app-editors/zed/Manifest
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py preserve-manifest /experiment/original-Manifest /overlay/app-editors/zed/Manifest
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

summary '## Independent crates preparation'
timed 'Upstream source acquisition' acquire_source
mode="$(PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" lookup --version "$version")"
summary "Result: $mode"
timed 'Portage environment preparation' prepare_portage
case "$mode" in
  generation)
    timed 'Generator environment preparation' prepare_generator
    timed 'Archive generation and validation' generate
    ;;
  reuse) timed 'Archive download and validation' reuse ;;
  *) echo "ERROR: invalid archive selection" >&2; exit 1 ;;
esac
timed 'Metadata and source integrity validation' verify_inputs
timed 'GIT_CRATES synchronization' sync_metadata
timed 'Candidate validation' validate_candidate
mkdir "$RUNNER_TEMP/crates-distribution"
cp "$archive" "$metadata" "$RUNNER_TEMP/crates-distribution/"
printf '%s\n' "$mode" > "$work/logs/result.txt"
summary "Total independent preparation and validation: $((SECONDS - start_total))s"
