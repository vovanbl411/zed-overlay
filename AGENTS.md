# Repository Instructions

This repository maintains the `zed-overlay` Gentoo overlay for a native Zed
build. The current package is `app-editors/zed-1.15.0`, based on the official
Gentoo ebuild and adapted for a Wayland-only production feature graph.

## Working rules

- Keep changes within the requested scope. Prefer the smallest change that can
  be verified with an explicit gate.
- Reproduce the relevant existing gates before changing behavior, then rerun
  them after the change.
- Do not restore the X11 backend or its production feature edges.
- Do not enable `scap/wayland` without a separate, explicit decision that
  accounts for the `pipewire-rs 0.8` and `zed-scap 0.0.8` dependency chain.
- Do not commit pregenerated `metadata/md5-cache/`. Generate the local Portage
  cache with:

  ```sh
  egencache --repo=zed-overlay --update --external-cache-only
  ```

- Do not combine a Zed version bump with architectural changes.
- Keep patches as normal unified diffs. Before using a changed patch, verify it
  against the matching Zed source tree with:

  ```sh
  gpatch --dry-run -p1 < path/to/patch
  ```

## Existing gates

- The patch applies with `gpatch --dry-run -p1`.
- Portage resolves and builds `=app-editors/zed-1.15.0::zed-overlay`.
- `scanelf` and `lddtree` show no linkage to `libX11`, `libxcb`, or
  `xkbcommon-x11`.
- `env -u DISPLAY /usr/libexec/zed-editor` starts Zed and renders its first
  frame through native Wayland.

Do not edit the ebuild, patch, or Manifest unless the task requires it. Preserve
unrelated user changes and review the final diff before reporting completion.
