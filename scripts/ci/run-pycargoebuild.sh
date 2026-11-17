#!/usr/bin/env bash
set -euo pipefail
binary="${1:?generator required}"
source_dir="${2:?source required}"
archive="${3:?archive required}"
cache="${4:?cache required}"
mapping="${5:?license mapping required}"
ebuild="${6:?output ebuild required}"
home="${7:?isolated home required}"
cd "$source_dir"
env -u GITHUB_TOKEN HOME="$home" "$binary" --no-config --crate-tarball \
  --crate-tarball-path "$archive" --distdir "$cache" --license-mapping "$mapping" \
  --output "$ebuild" crates/zed
