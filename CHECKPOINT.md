# Checkpoint: native Wayland-only Zed

## Completed

### Native baseline

Zed 1.21.0 is the confirmed manual runtime baseline. Portage built it natively
and installed `/usr/libexec/zed-editor` and `/usr/bin/zedit`. `scanelf` and
`lddtree` found no runtime linkage to `libX11`, `libxcb`, or `xkbcommon-x11`,
and `env -u DISPLAY /usr/libexec/zed-editor` started Zed and rendered its first
frame through native Wayland. The client selected a Vulkan adapter on Intel Iris
Xe and reached `Authenticated`.

### Current package

The current package is `app-editors/zed-1.21.0`. Automation has confirmed:

- stable release discovery and deterministic candidate preparation;
- Manifest generation and `emerge -pv` dependency resolution;
- version-specific Wayland patch dry-run against the exact upstream source;
- overlay policy and git-less disposable validation;
- sanitized four-file release handoff and separate read-only handoff validation;
- controlled publish job, exact release Git diff allowlist, automation branch,
  and Draft PR creation.

Automation does not compile or runtime-test Zed. Manual Gentoo runtime
acceptance for 1.21.0 is complete: Portage built and installed the package,
runtime-linkage checks passed, and native Wayland startup completed without an
X11 `DISPLAY`. Zed 1.21.0 is runtime-validated.

## Technical debt

Release preparation still copies the previous ebuild, but automation now
fail-closes when its version-sensitive Cargo Git dependency snapshot
(`GIT_CRATES` and related offline path substitutions) differs from the exact
upstream `Cargo.lock` or `Cargo.toml`. Automation only detects drift; a human
must reconcile the ebuild snapshot. `emerge -pv` does not prove that the full
offline Cargo source graph is correct, so a manual full build remains a
required acceptance gate.

### Portage sync integration

A stale external metadata cache caused `masked by: corruption` and hid the
new upgrade from normal `@world`. Running external `egencache` immediately
made 1.21.0 an upgrade candidate. The repository now provides an optional
post-sync hook to refresh the external cache automatically; it does not put
`metadata/md5-cache/` in Git.

## Current next step

For future Zed release candidates, use the Cargo Git dependency snapshot gate
to detect drift, then reconcile any reported ebuild changes manually.
