# Checkpoint: native Wayland-only Zed

## Release automation status

Stage 1 passed in GitHub Actions run 44129394269 for Zed v1.28.1. It used
pycargoebuild 0.16.0 and validated 1,439 registry crates and 86 Git crates.
The 130,033,452-byte archive had SHA256
`44c617444e1778db623e403f6782ee9dab3b2ede03b352c5c32ec7723fcf1ea3`.
Generation took 937 seconds, including about 903 seconds for repacking; total
candidate preparation and validation took 1,058 seconds. All 94 tests passed.

Stage 2 has been live-validated for archive generation, publication, reuse,
and Draft PR creation. Production [run 44142769356](https://github.com/vovanbl411/zed-overlay/actions/runs/44142769356)
generated and published the archive, then failed on trailing whitespace before
creating the automation branch. After the whitespace fix,
[run 44148805330](https://github.com/vovanbl411/zed-overlay/actions/runs/44148805330)
reused the archive and opened [Draft PR #46](https://github.com/vovanbl411/zed-overlay/pull/46).
Manual Gentoo build, linkage checks, and native Wayland runtime verification
remain the acceptance gates.

## Completed

### Native baseline

Zed 1.21.0 is the confirmed manual runtime baseline on amd64. Portage built it
natively and installed `/usr/libexec/zed-editor` and `/usr/bin/zedit`.
`scanelf` and `lddtree` found no runtime linkage to `libX11`, `libxcb`, or
`xkbcommon-x11`, and `env -u DISPLAY /usr/libexec/zed-editor` started Zed and
rendered its first frame through native Wayland. The client selected an Intel
Iris Xe Vulkan adapter and reached `Authenticated`.

### Current package

Zed 1.28.1 is the current packaged version. [PR #46](https://github.com/vovanbl411/zed-overlay/pull/46)
merged `app-editors/zed/zed-1.28.1.ebuild` into `main`. Automation has confirmed:

- stable release discovery and deterministic candidate preparation;
- Manifest generation and `emerge -pv` dependency resolution;
- version-specific Wayland patch dry-run against the exact upstream source;
- overlay policy and git-less disposable validation;
- sanitized four-file release handoff and separate read-only handoff validation;
- controlled publish job, exact release Git diff allowlist, automation branch,
  and Draft PR creation.

Automation does not compile or runtime-test Zed. Manual build, linkage, and
runtime acceptance for 1.28.1 are unverified. Zed 1.21.0 on amd64 remains the
last explicitly verified runtime baseline. The arm64 build and runtime have
not been tested.

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

Release preparation copies the previous ebuild and synchronizes `GIT_CRATES`
from validated metadata. The snapshot gate still fails closed if the curated
offline substitutions or WebRTC pin differ from upstream and need manual
reconciliation. `emerge -pv` does not prove the complete offline Cargo source
graph, so a manual full build remains a required acceptance gate.

### Portage sync integration

A stale external metadata cache caused `masked by: corruption` and hid the
new upgrade from normal `@world`. Running external `egencache` immediately
made 1.21.0 an upgrade candidate. The repository now provides an optional
post-sync hook to refresh the external cache automatically; it does not put
`metadata/md5-cache/` in Git.

## Current next step

Release automation through Stage 2 is complete. Manual Gentoo acceptance for
Zed 1.28.1 remains pending.

The handbook's introduction and release watcher architecture chapter are
complete. The interactive YAML walkthrough covers lines 1–240 of the release
watcher workflow, including all three jobs. The walkthrough passed source
accuracy review, static review, and owner visual acceptance.

The documentation on `feat/docs-site` is awaiting integration into `main`.
The next educational phase is the Bash implementation walkthrough.
