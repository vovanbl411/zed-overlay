# CI and Security Model

English | [Русский](CI_AND_SECURITY.md)

## Regular CI

The workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs for
`pull_request` events and `push` events to `main`. It has `contents: read`
permission and runs these checks:

- `scripts/overlay_policy.py` checks the overlay layout and Wayland-only policy.
- `bash -n scripts/ci/*.sh` checks shell syntax without installing ShellCheck.
- `python3 -m unittest discover -s tests -v` runs the unit tests.

The recommended ruleset below uses `Overlay policy` as its required status
check. This is the job name, not the workflow name; changing it also requires
updating the GitHub ruleset.
`actions/checkout` is pinned to a full commit SHA and uses
`persist-credentials: false`.

Regular pull request CI has read-only token permissions and does not request
repository secrets. It does not build Zed or perform runtime acceptance.

## Release watcher workflow

The workflow [`.github/workflows/zed-release-watcher.yml`](../.github/workflows/zed-release-watcher.yml)
runs daily at 06:17 UTC and can also be started with `workflow_dispatch`. It
checks for a release and prepares a candidate in a disposable workspace.

The `check` job runs overlay policy and unit tests, then calls
`scripts/ci/validate-release-candidate.sh`. That script creates a git-less
workspace with `git archive` and runs `release_handoff.py --prepare` once. This
command discovers the latest upstream stable release and reports either
`up-to-date` or `new-release`. Discovery and preparation errors stop the job.

For a new release, validation checks the exact candidate ebuild and patch paths,
then runs Portage checks in the pinned Gentoo container images. It confirms that
`--prepare` left the original Manifest unchanged; `ebuild "$CANDIDATE_EBUILD" manifest`
updates the Manifest later, inside the container. The job then runs
`emerge -pv --oneshot`, checks the Cargo and WebRTC snapshots against the
extracted source archive, dry-runs the Wayland patch, checks overlay policy,
and confirms that the source checkout is still clean. An up-to-date result skips
candidate path checks and Docker validation; overlay policy and checkout
cleanliness checks still run.

Container checks run only on amd64. The arm64 build and runtime have not been
tested.

Only a new release produces a sanitized handoff artifact. A separate read-only
job checks its exact file layout and confirms that its base commit matches the
workflow commit. The publish job runs only for `main`, after that validation
succeeds. It checks out a clean `main`, applies the validated handoff, reruns
overlay policy, and creates a Draft PR on a branch named
`automation/zed-v<version>`. An existing open automation PR makes the run
idempotent; an existing remote branch without an open PR fails closed.

The Draft PR includes a manual acceptance checklist. Before treating a release
as runtime-validated, build it with
`emerge -1av =app-editors/zed-<version>::zed-overlay`, check linkage with
`scanelf` and `lddtree`, and verify native Wayland startup without unwanted X11
runtime linkage. CI does not perform these steps or a full Zed build.

## Permissions and artifact boundary

The workflow grants `contents: read` by default. Checkout steps set
`persist-credentials: false`; actions use full commit SHA pins, and the Gentoo
container images are pinned by digest.

Only `publish-draft-release-pr` receives `contents: write` and
`pull-requests: write`. That job runs only on `main` after the handoff has passed
validation. The uploaded artifact contains only the allowlisted Manifest,
candidate ebuild, candidate patch, and `release.json`; it is validated before it
is applied to a fresh checkout. No automatic merge is configured.

## Recommended ruleset for `main`

Configure this ruleset manually in `Settings → Rules → Rulesets`:

```text
Ruleset: Protect main
Enforcement: Active
Target: Default branch
Bypass list: empty

Restrict deletions: ON
Block force pushes: ON

Require pull request before merging: ON
Required approvals: 0
Require conversation resolution: ON

Require status checks: ON
Required check: Overlay policy
Require branches to be up to date: ON

Require signed commits: OFF for now
Require linear history: OFF
Merge queue: OFF
```

`Required approvals: 0` can suit a personal repository: changes still go
through a pull request, required CI, and the owner's decision. The repository
contents cannot confirm whether this GitHub-level ruleset is enabled.

## GitHub Actions and secret scanning

- Keep only the Actions the workflows need. Pin third-party Actions to full
  immutable commit SHAs, not mutable tags.
- Keep default workflow token permissions read-only. The regular pull request CI
  does not request repository secrets.
- Dependabot in [`.github/dependabot.yml`](../.github/dependabot.yml) checks for
  GitHub Actions updates weekly. Review its pull requests and run CI; do not
  enable auto-merge.
- Keep write permissions limited to the publish job described above.
- We recommend enabling GitHub Secret Scanning and Push Protection manually.
  Their status cannot be confirmed from repository files.
