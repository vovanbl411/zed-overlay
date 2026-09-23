# Checkpoint: native Wayland-only Zed 1.15.0

This stage is complete. It establishes a working native Gentoo package and
records the verified runtime boundary; it does not add update automation or CI.

## Confirmed

- The overlay builds Zed natively through Gentoo Portage.
- The current package is `app-editors/zed-1.15.0`, based on the official Gentoo
  ebuild.
- The overlay is a Git repository named `zed-overlay`.
- `metadata/layout.conf` contains `masters = gentoo` and
  `thin-manifests = true`.
- Pregenerated `metadata/md5-cache/` is not stored in Git. The local Portage
  cache is generated with:

  ```sh
  egencache --repo=zed-overlay --update --external-cache-only
  ```

- The downstream Wayland-only patch applies successfully as a normal unified
  diff. Its required pre-use check is `gpatch --dry-run -p1` against the matching
  source tree.
- The X11 backend has been removed from the production feature graph.
- The package built successfully with:

  ```sh
  emerge -av =app-editors/zed-1.15.0::zed-overlay
  ```

- Portage installed `/usr/libexec/zed-editor` and `/usr/bin/zedit`.
- Runtime verification passed:
  - `scanelf` reported no `libX11`, `libxcb`, or `xkbcommon-x11` linkage.
  - `lddtree ... | grep -Ei 'libX11|libxcb|xkbcommon-x11'` returned no output.
  - `env -u DISPLAY /usr/libexec/zed-editor` started Zed and rendered the first
    frame.
  - The application used Vulkan on Intel Iris Xe.

Together, these checks confirm a native Wayland-only runtime.

## Decisions

- Wayland is the only production display backend for this build. X11 is not a
  fallback target.
- Linux local screen capture is intentionally disabled. Zed 1.15.0 does not use
  screen sharing in its Wayland UI, while enabling `scap/wayland` introduces the
  old `pipewire-rs 0.8` and `zed-scap 0.0.8` dependency chain.
- Flatpak was retained only until the native runtime gate passed. It is no
  longer part of the target configuration.
- The `proc-macro-error2 v2.0.1` message is a non-blocking warning about future
  Rust incompatibility.
- A Zed hang-detector message at roughly 132 ms during startup is not a current
  blocker.

## Intentional limitations

- Local screen sharing is unavailable in this Wayland-only build.
- The patch and dependency decision are specific to Zed 1.15.0 and must be
  reassessed separately for a future version.

## Not done

- Automation for updating the overlay.
- A convenient update workflow for new Zed versions.
- CI or other automated validation.
- Further documentation of the update process.
