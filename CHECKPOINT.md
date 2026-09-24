# Checkpoint: native Wayland-only Zed

## Completed

### Native baseline

Zed 1.15.0 is the confirmed manual runtime baseline. Portage built it natively
and installed `/usr/libexec/zed-editor` and `/usr/bin/zedit`. `scanelf` and
`lddtree` found no runtime linkage to `libX11`, `libxcb`, or `xkbcommon-x11`,
and `env -u DISPLAY /usr/libexec/zed-editor` started Zed and rendered its first
frame through native Wayland.

### Current package

The current package is `app-editors/zed-1.21.0`. Automation has confirmed:

- stable release discovery and deterministic candidate preparation;
- Manifest generation and `emerge -pv` dependency resolution;
- version-specific Wayland patch dry-run against the exact upstream source;
- overlay policy and git-less disposable validation;
- sanitized four-file release handoff and separate read-only handoff validation;
- controlled publish job, exact release Git diff allowlist, automation branch,
  and Draft PR creation.

Automation does not compile or runtime-test Zed. Full build and runtime
acceptance remain a manual gate on a real Gentoo workstation before a new
release is treated as runtime-validated.

### Portage sync integration

A stale external metadata cache caused `masked by: corruption` and hid the
new upgrade from normal `@world`. Running external `egencache` immediately
made 1.21.0 an upgrade candidate. The repository now provides an optional
post-sync hook to refresh the external cache automatically; it does not put
`metadata/md5-cache/` in Git.

## Current next step

The next real gate is manual acceptance of `app-editors/zed-1.21.0` on the
Gentoo workstation:

```sh
emerge -av app-editors/zed::zed-overlay
```

Then verify `scanelf`, `lddtree`, native Wayland startup and runtime, and the
absence of unwanted X11 runtime linkage. This gate is not yet complete.
