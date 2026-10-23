# Checkpoint: native Wayland-only Zed

## Completed

### Native baseline

Zed 1.21.0 is the confirmed manual runtime baseline on amd64. Portage built it
natively and installed `/usr/libexec/zed-editor` and `/usr/bin/zedit`.
`scanelf` and `lddtree` found no runtime linkage to `libX11`, `libxcb`, or
`xkbcommon-x11`, and `env -u DISPLAY /usr/libexec/zed-editor` started Zed and
rendered its first frame through native Wayland. The client selected an Intel
Iris Xe Vulkan adapter and reached `Authenticated`.

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
X11 `DISPLAY`. Zed 1.21.0 is runtime-validated on amd64. The arm64 build and
runtime have not been tested.

### Zed 1.25.2 release candidate (2026-10-23)

Prepared locally from clean `main` at
`0cc3b1aee41ab26e0c1d43667a27be98c78cbf8c`, whose latest ebuild was 1.24.2,
using `scripts/prepare_zed_release.py --release-version 1.25.2`.
The copied snapshot failed against the exact upstream v1.25.2 source before
reconciliation. The candidate now matches all 85 Cargo.lock Git crates:
15 additions, the new async-task repository/revision, and the rodio revision.

Verified locally:

- Cargo snapshot gate: OK against the clean v1.25.2 source.
- Portage `unpack prepare`: OK in a fresh temporary directory; all 85 Git
  crate paths contain Cargo.toml with the expected package name.
- `cargo metadata --offline --format-version 1`: OK on the prepared tree.
  Both cpal declarations and khronos-egl require explicit path substitutions;
  failures without them were reproduced. Wgpu uses cargo.eclass patches.
- Unchanged version-specific Wayland patch: `gpatch --dry-run -p1` OK.
- Portage Manifest generation and `emerge -pv --oneshot`: OK on amd64.
- Overlay policy, shell syntax, and `git diff --check`: OK.
- Unittest: 75/75 pass after correcting the version-specific expectations in
  `test_ebuild_offline_substitutions_are_formed_from_git_crates`: ten
  substitutions for older ebuilds, twelve starting with 1.25.2. Exact set
  equality and commit checks against GIT_CRATES remain enforced.

Portage used build user/group `vladimir` and an empty scheduling command.
`CHECKREQS_DONOTHING=1` allowed unpack/prepare on the 12 GiB temporary filesystem
without satisfying the 20 GiB full-build disk requirement. Full build,
`scanelf`, `lddtree`, native Wayland startup, and arm64 acceptance were NOT RUN.
This candidate is not runtime-validated.

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
