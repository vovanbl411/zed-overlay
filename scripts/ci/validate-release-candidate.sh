#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GENTOO_PORTAGE_IMAGE:?GENTOO_PORTAGE_IMAGE is required}"
: "${GENTOO_STAGE3_IMAGE:?GENTOO_STAGE3_IMAGE is required}"

validate_candidate_paths() {
  local before_paths="$1"

  mapfile -d '' -t candidate_paths < <(
    comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
  )
  candidate_ebuild="$(printf '%s\n' "${candidate_paths[@]}" | grep -Ex 'app-editors/zed/zed-[0-9]+\.[0-9]+\.[0-9]+\.ebuild')"
  candidate_patch="app-editors/zed/files/$(basename "${candidate_ebuild%.ebuild}")-wayland-only.patch"
  test -f "$candidate_ebuild"
  test -f "$candidate_patch"
  if [ "${#candidate_paths[@]}" -eq 1 ]; then
    test "${candidate_paths[0]}" = "$candidate_ebuild"
  else
    test "${#candidate_paths[@]}" -eq 2
    printf '%s\n' "${candidate_paths[@]}" | sort | cmp -s - <(
      printf '%s\n' "$candidate_ebuild" "$candidate_patch" | sort
    )
  fi

  candidate_atom="=app-editors/${candidate_ebuild##*/}"
  candidate_atom="${candidate_atom%.ebuild}::zed-overlay"
  candidate_version="${candidate_ebuild##*/zed-}"
  candidate_version="${candidate_version%.ebuild}"
}

validate_candidate_in_container() {
  local disposable_workspace="$1"

  docker create --name zed-portage "$GENTOO_PORTAGE_IMAGE" /bin/true
  cleanup() {
    docker rm -f zed-portage >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  docker run --rm \
    --volumes-from zed-portage \
    --mount "type=bind,src=$disposable_workspace,dst=/overlay" \
    --workdir /overlay \
    --env CANDIDATE_ATOM="$candidate_atom" \
    --env CANDIDATE_EBUILD="/overlay/$candidate_ebuild" \
    --env CANDIDATE_PATCH="/overlay/$candidate_patch" \
    --env CANDIDATE_VERSION="$candidate_version" \
    "$GENTOO_STAGE3_IMAGE" \
    /bin/bash -e -c '
      mkdir -p /etc/portage/repos.conf /etc/portage/package.accept_keywords /etc/portage/package.use
      printf "%s\n" \
        "[DEFAULT]" \
        "main-repo = gentoo" \
        "" \
        "[gentoo]" \
        "location = /var/db/repos/gentoo" \
        "auto-sync = no" \
        "" \
        "[zed-overlay]" \
        "location = /overlay" \
        "masters = gentoo" \
        "auto-sync = no" \
        > /etc/portage/repos.conf/zed-overlay.conf
      printf "%s ~amd64\n" "$CANDIDATE_ATOM" \
        > /etc/portage/package.accept_keywords/zed-candidate
      printf "%s\n" \
        "media-libs/vulkan-loader wayland" \
        "media-video/pipewire sound-server" \
        > /etc/portage/package.use/zed-validation
      ebuild "$CANDIDATE_EBUILD" manifest
      emerge -pv --oneshot "$CANDIDATE_ATOM"
      patch_root="$(mktemp -d)"
      distdir="$(portageq envvar DISTDIR)"
      test -n "$distdir"
      source_archive="$distdir/zed-${CANDIDATE_VERSION}.tar.gz"
      test -f "$source_archive"
      tar -xzf "$source_archive" -C "$patch_root"
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/check_zed_cargo_snapshot.py \
        --ebuild "$CANDIDATE_EBUILD" \
        --source "$patch_root/zed-${CANDIDATE_VERSION}"
      if patch --dry-run -p1 -d "$patch_root/zed-${CANDIDATE_VERSION}" < "$CANDIDATE_PATCH"; then
        echo "Wayland patch dry-run: OK"
      else
        echo "ERROR: Wayland patch dry-run failed" >&2
        exit 1
      fi
    '
}

validate_manifest_update() {
  local manifest_checksum="$1"

  if test ! -e .git; then
    echo "Git-less workspace after container validation: OK"
  else
    echo "ERROR: disposable workspace gained .git" >&2
    exit 1
  fi

  if test "$manifest_checksum" != "$(sha256sum app-editors/zed/Manifest)"; then
    echo "Manifest update after container validation: OK"
  else
    echo "ERROR: app-editors/zed/Manifest was not updated by container validation" >&2
    exit 1
  fi
}

validate_disposable_policy() {
  local disposable_workspace="$1"
  local tracked_paths="$2"

  if PYTHONDONTWRITEBYTECODE=1 python3 scripts/overlay_policy.py \
    --root "$disposable_workspace" \
    --tracked-paths-file "$tracked_paths"; then
    echo "Overlay policy for disposable workspace: OK"
  else
    echo "ERROR: overlay policy failed for disposable workspace" >&2
    exit 1
  fi

  if test ! -e "$disposable_workspace/.git"; then
    echo "Git-less workspace after overlay policy: OK"
  else
    echo "ERROR: disposable workspace gained .git after overlay policy" >&2
    exit 1
  fi
}

assert_source_workspace_clean() {
  local source_status

  source_status="$(git -C "$GITHUB_WORKSPACE" status --short)"
  if test -z "$source_status"; then
    echo "Source workspace remains clean: OK"
  else
    echo "ERROR: source workspace was modified" >&2
    printf '%s\n' "$source_status" | sed -n '1,25p' >&2
    exit 1
  fi
}

create_release_handoff() {
  local handoff_directory="$RUNNER_TEMP/release-handoff"

  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
    --create-handoff "$handoff_directory" \
    --candidate-version "$candidate_version" \
    --base-commit "$GITHUB_SHA"
  echo "Sanitized release handoff: OK"
  echo "handoff_ready=true" >> "$GITHUB_OUTPUT"
}

main() {
  local tracked_paths="$RUNNER_TEMP/zed-overlay-tracked-paths"
  local disposable_workspace="$RUNNER_TEMP/zed-overlay"
  local before_paths="$RUNNER_TEMP/zed-overlay-before-paths"
  local prepare_log="$RUNNER_TEMP/zed-overlay-prepare.log"
  local manifest_checksum

  echo "handoff_ready=false" >> "$GITHUB_OUTPUT"
  git -C "$GITHUB_WORKSPACE" ls-files -z > "$tracked_paths"
  mkdir -p "$disposable_workspace"
  git -C "$GITHUB_WORKSPACE" archive HEAD | tar -x -C "$disposable_workspace"
  test ! -e "$disposable_workspace/.git"

  cd "$disposable_workspace"
  manifest_checksum="$(sha256sum app-editors/zed/Manifest)"
  find app-editors/zed -type f -print0 | sort -z > "$before_paths"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py --prepare | tee "$prepare_log" | tee -a "$GITHUB_STEP_SUMMARY"
  test ! -e .git

  if grep -Fxq 'Result: new-release' "$prepare_log"; then
    validate_candidate_paths "$before_paths"
    validate_candidate_in_container "$disposable_workspace"
    validate_manifest_update "$manifest_checksum"
  else
    grep -Fxq 'Result: up-to-date' "$prepare_log"
    mapfile -d '' -t candidate_paths < <(
      comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
    )
    test "${#candidate_paths[@]}" -eq 0
  fi

  validate_disposable_policy "$disposable_workspace" "$tracked_paths"
  assert_source_workspace_clean

  if grep -Fxq 'Result: new-release' "$prepare_log"; then
    create_release_handoff
  fi
}

main "$@"
