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

  # Сравниваем список файлов до и после подготовки: ожидаем новый ebuild и,
  # если подходящего patch ещё не было, его версионную пару.
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
  local metadata_hash

  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
    --create-handoff "$handoff_directory" \
    --candidate-version "$candidate_version" \
    --base-commit "$GITHUB_SHA"
  metadata_hash="$(sha256sum "$RUNNER_TEMP/crates-distribution/zed-${candidate_version}-overlay-crates.json" | cut -d' ' -f1)"
  [[ "$metadata_hash" =~ ^[0-9a-f]{64}$ ]]
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
    --bundle "$RUNNER_TEMP/crates-distribution" --handoff "$handoff_directory" \
    --base-commit "$GITHUB_SHA" --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
    --metadata-sha256 "$metadata_hash"
  echo "Sanitized release handoff and distribution bundle: OK"
  echo "Metadata SHA256: $metadata_hash" | tee -a "$GITHUB_STEP_SUMMARY"
  echo "metadata_sha256=$metadata_hash" >> "$GITHUB_OUTPUT"
  echo "handoff_ready=true" >> "$GITHUB_OUTPUT"
}

main() {
  local validation_mode="${INDEPENDENT_VALIDATION:-false}"
  local total_started=$SECONDS
  case "$validation_mode" in
    false) ;;
    true) test "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ;;
    *) echo "ERROR: invalid independent validation mode" >&2; exit 1 ;;
  esac
  local tracked_paths="$RUNNER_TEMP/zed-overlay-tracked-paths"
  local disposable_workspace="$RUNNER_TEMP/zed-overlay"
  local before_paths="$RUNNER_TEMP/zed-overlay-before-paths"
  local prepare_log="$RUNNER_TEMP/zed-overlay-prepare.log"
  local manifest_checksum

  echo "handoff_ready=false" >> "$GITHUB_OUTPUT"
  git -C "$GITHUB_WORKSPACE" ls-files -z > "$tracked_paths"
  mkdir -p "$disposable_workspace"
  # Проверяем архив HEAD, а не рабочий checkout: подготовка candidate не должна
  # загрязнять исходное дерево, а в архив не попадает каталог .git.
  git -C "$GITHUB_WORKSPACE" archive HEAD | tar -x -C "$disposable_workspace"
  test ! -e "$disposable_workspace/.git"

  cd "$disposable_workspace"
  manifest_checksum="$(sha256sum app-editors/zed/Manifest)"
  find app-editors/zed -type f -print0 | sort -z > "$before_paths"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py --prepare | tee "$prepare_log" | tee -a "$GITHUB_STEP_SUMMARY"
  test ! -e .git
  # Этот checksum фиксирует границу: --prepare добавляет candidate-файлы,
  # но Manifest разрешено менять только позднее через ebuild manifest.
  test "$manifest_checksum" = "$(sha256sum app-editors/zed/Manifest)"

  if grep -Fxq 'Result: new-release' "$prepare_log"; then
    validate_candidate_paths "$before_paths"
    "$disposable_workspace/scripts/ci/independent-crates.sh" \
      "$candidate_version" "$disposable_workspace/$candidate_ebuild" \
      "$disposable_workspace/$candidate_patch" "$disposable_workspace"
    validate_manifest_update "$manifest_checksum"
  else
    grep -Fxq 'Result: up-to-date' "$prepare_log"
    echo 'Result: up-to-date' >> "$GITHUB_STEP_SUMMARY"
    mapfile -d '' -t candidate_paths < <(
      comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
    )
    test "${#candidate_paths[@]}" -eq 0
  fi

  validate_disposable_policy "$disposable_workspace" "$tracked_paths"
  assert_source_workspace_clean

  if [ "$validation_mode" = true ]; then
    echo "Total candidate preparation and validation: $((SECONDS - total_started))s" | tee -a "$GITHUB_STEP_SUMMARY"
    echo "Validation-only: release handoff disabled"
  elif grep -Fxq 'Result: new-release' "$prepare_log"; then
    local archive_mode
    archive_mode="$(cat "$RUNNER_TEMP/zed-independent/logs/result.txt")"
    case "$archive_mode" in generation|reuse) ;; *) echo "Invalid archive mode" >&2; exit 1 ;; esac
    echo "archive_mode=$archive_mode" >> "$GITHUB_OUTPUT"
    create_release_handoff
  fi
}

main "$@"
