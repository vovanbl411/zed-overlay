#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${BRANCH:?BRANCH is required}"
: "${CANDIDATE_VERSION:?CANDIDATE_VERSION is required}"
: "${PATCH_CREATED:?PATCH_CREATED is required}"

candidate_ebuild="app-editors/zed/zed-${CANDIDATE_VERSION}.ebuild"
candidate_patch="app-editors/zed/files/zed-${CANDIDATE_VERSION}-wayland-only.patch"
git add app-editors/zed/Manifest "$candidate_ebuild" "$candidate_patch"
git diff --cached --check

expected_paths="$RUNNER_TEMP/zed-release-expected-paths"
{
  printf '%s\n' app-editors/zed/Manifest "$candidate_ebuild"
  if test "$PATCH_CREATED" = true; then
    printf '%s\n' "$candidate_patch"
  fi
} | sort > "$expected_paths"
actual_paths="$(git diff --cached --name-only | sort)"
if ! printf '%s\n' "$actual_paths" | cmp -s "$expected_paths" -; then
  echo "ERROR: staged paths do not match the release handoff allowlist" >&2
  echo "Expected:" >&2
  cat "$expected_paths" >&2
  echo "Actual:" >&2
  printf '%s\n' "$actual_paths" >&2
  exit 1
fi
if test -n "$(git diff --name-only)"; then
  echo "ERROR: unstaged tracked changes remain after handoff apply" >&2
  git diff --name-only >&2
  exit 1
fi
if test -n "$(git ls-files --others --exclude-standard)"; then
  echo "ERROR: unexpected untracked files remain after handoff apply" >&2
  git ls-files --others --exclude-standard >&2
  exit 1
fi

pull_response="$RUNNER_TEMP/zed-release-pulls.json"
curl --fail --silent --show-error --get \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer $GITHUB_TOKEN" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  --data-urlencode "state=open" \
  --data-urlencode "base=main" \
  --data-urlencode "head=${GITHUB_REPOSITORY_OWNER}:${BRANCH}" \
  --data-urlencode "per_page=1" \
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/pulls" \
  > "$pull_response"
existing_pr_url="$(python3 - "$pull_response" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response:
    payload = json.load(response)
if not isinstance(payload, list):
    raise SystemExit("Pull request query returned an invalid response")
if payload:
    url = payload[0].get("html_url")
    if not isinstance(url, str):
        raise SystemExit("Existing pull request has no URL")
    print(url)
PY
)"
if test -n "$existing_pr_url"; then
  printf 'Existing automation PR: %s\n' "$existing_pr_url" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

branch_response="$RUNNER_TEMP/zed-release-branch.json"
branch_status="$(curl --silent --show-error --output "$branch_response" \
  --write-out '%{http_code}' \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer $GITHUB_TOKEN" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/git/ref/heads/$BRANCH")"
case "$branch_status" in
  404) ;;
  200)
    echo "ERROR: remote automation branch exists without an open PR: $BRANCH" >&2
    exit 1
    ;;
  *)
    echo "ERROR: could not determine remote branch state (HTTP $branch_status)" >&2
    exit 1
    ;;
esac

git switch --create "$BRANCH"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git diff --cached --check
if git diff --cached --quiet; then
  echo "ERROR: release handoff would create an empty commit" >&2
  exit 1
fi
git commit -m "update: Zed v${CANDIDATE_VERSION}"

original_remote="$(git remote get-url origin)"
restore_origin() {
  git remote set-url origin "$original_remote"
}
trap restore_origin EXIT
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
git push origin "HEAD:refs/heads/$BRANCH"
restore_origin
trap - EXIT

payload="$(python3 - "$CANDIDATE_VERSION" "$BRANCH" <<'PY'
import json
import sys

version, branch = sys.argv[1:]
body = f'''## Automated validation

- Stable release discovered
- Manifest generated
- Portage dependency resolution passed
- Wayland-only patch applies cleanly
- Overlay policy passed
- Sanitized handoff validated

## Manual acceptance required before merge

- [ ] Review upstream release notes
- [ ] Review ebuild / Manifest / Wayland patch diff
- [ ] Full `emerge -1av =app-editors/zed-{version}::zed-overlay`
- [ ] Verify linkage (`scanelf` / `lddtree`) remains free of unwanted X11 runtime linkage
- [ ] Verify native Wayland startup/runtime
'''
print(json.dumps({
    "title": f"[release-bump] Zed v{version}",
    "head": branch,
    "base": "main",
    "draft": True,
    "body": body,
}))
PY
)"
pr_response="$RUNNER_TEMP/zed-release-pr.json"
curl --fail --silent --show-error \
  --request POST \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer $GITHUB_TOKEN" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  --header "Content-Type: application/json" \
  --data "$payload" \
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/pulls" \
  > "$pr_response"
pr_url="$(python3 - "$pr_response" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response:
    url = json.load(response).get("html_url")
if not isinstance(url, str):
    raise SystemExit("Created pull request has no URL")
print(url)
PY
)"
printf 'Created draft automation PR: %s\n' "$pr_url" >> "$GITHUB_STEP_SUMMARY"
