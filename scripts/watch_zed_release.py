"""Report whether GitHub has a newer stable Zed release than this overlay."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


UPSTREAM_REPOSITORY = "zed-industries/zed"
RELEASES_URL = f"https://api.github.com/repos/{UPSTREAM_REPOSITORY}/releases?per_page=100"
PACKAGE_DIRECTORY = Path("app-editors/zed")
EBUILD_PATTERN = re.compile(r"^zed-(\d+)\.(\d+)\.(\d+)\.ebuild$")
TAG_PATTERN = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
Version = tuple[int, int, int]


class WatcherError(RuntimeError):
    """Raised when release discovery cannot produce a trustworthy result."""


@dataclass(frozen=True, order=True)
class StableEbuild:
    """A packaged stable Zed ebuild and its parsed version."""

    version: Version
    path: Path


@dataclass(frozen=True)
class Release:
    """One stable upstream GitHub release."""

    tag: str
    version: Version
    url: str


@dataclass(frozen=True)
class WatchResult:
    """The comparison between packaged and latest upstream stable versions."""

    outcome: str
    packaged_version: Version
    upstream_release: Release


def version_text(version: Version) -> str:
    """Return a parsed version in dotted form."""
    return ".".join(map(str, version))


def latest_packaged_ebuild(repository_root: Path) -> StableEbuild:
    """Return the numerically newest stable Zed ebuild."""
    ebuilds = []
    for path in (repository_root / PACKAGE_DIRECTORY).glob("zed-*.ebuild"):
        match = EBUILD_PATTERN.fullmatch(path.name)
        if match is not None:
            ebuilds.append(StableEbuild(tuple(map(int, match.groups())), path))
    if not ebuilds:
        raise WatcherError("No stable Zed ebuild is present in the overlay.")
    return max(ebuilds)


def latest_stable_release(payload: object) -> Release:
    """Select the numerically newest non-draft, non-prerelease stable release."""
    if not isinstance(payload, list):
        raise WatcherError("GitHub API returned an invalid releases response.")

    releases = []
    for release_payload in payload:
        if not isinstance(release_payload, dict):
            raise WatcherError("GitHub API returned an invalid release entry.")
        draft = release_payload.get("draft")
        prerelease = release_payload.get("prerelease")
        if not isinstance(draft, bool) or not isinstance(prerelease, bool):
            raise WatcherError("GitHub API returned an invalid release status.")
        if draft or prerelease:
            continue

        tag = release_payload.get("tag_name")
        if not isinstance(tag, str):
            raise WatcherError("GitHub API returned a release without a tag.")
        match = TAG_PATTERN.fullmatch(tag)
        if match is None:
            continue
        release_url = release_payload.get("html_url")
        if not isinstance(release_url, str):
            raise WatcherError("GitHub API returned a stable release without a URL.")
        releases.append(Release(tag, tuple(map(int, match.groups())), release_url))

    if not releases:
        raise WatcherError("GitHub API returned no suitable stable Zed releases.")
    # Версия хранится как tuple чисел: сравнение выберет 1.10.0 после 1.9.0,
    # а не ошибочно отсортирует версии как строки.
    return max(releases, key=lambda release: release.version)


class GitHubClient:
    """Small read-only GitHub REST client for Zed release discovery."""

    def fetch_releases(self) -> list[Any]:
        """Fetch the public release list without requiring authentication."""
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "zed-overlay-release-watcher",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(RELEASES_URL, headers=headers)
        try:
            # URL задан константой для официального HTTPS API GitHub, а не берётся
            # из пользовательского ввода; noqa отмечает именно этот безопасный вызов.
            with urlopen(request, timeout=15) as response:  # noqa: S310
                status = getattr(response, "status", 200)
                if not isinstance(status, int) or not 200 <= status < 300:
                    raise WatcherError(f"GitHub API request failed with HTTP {status}.")
                payload = json.load(response)
        except HTTPError as error:
            raise WatcherError(
                f"GitHub API request failed with HTTP {error.code}."
            ) from error
        except URLError as error:
            raise WatcherError("GitHub API request failed due to a network error.") from error
        except OSError as error:
            raise WatcherError("GitHub API request failed due to a network error.") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise WatcherError("GitHub API returned invalid JSON.") from error
        if not isinstance(payload, list):
            raise WatcherError("GitHub API returned an invalid releases response.")
        return payload


def watch(repository_root: Path, releases: object) -> WatchResult:
    """Compare the latest packaged stable ebuild with upstream stable releases."""
    packaged = latest_packaged_ebuild(repository_root)
    upstream = latest_stable_release(releases)
    outcome = "new-release" if upstream.version > packaged.version else "up-to-date"
    return WatchResult(outcome, packaged.version, upstream)


def result_lines(result: WatchResult) -> tuple[str, ...]:
    """Render the short CLI result without modifying the repository."""
    return (
        f"Result: {result.outcome}",
        f"Packaged version: {version_text(result.packaged_version)}",
        f"Upstream version: {version_text(result.upstream_release.version)}",
        f"Upstream tag: {result.upstream_release.tag}",
        f"Upstream release: {result.upstream_release.url}",
    )


def main() -> int:
    """Run one read-only GitHub release check."""
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        releases = GitHubClient().fetch_releases()
        result = watch(Path(__file__).resolve().parents[1], releases)
    except WatcherError as error:
        print(f"Release watcher error: {error}", file=sys.stderr)
        return 1
    print("\n".join(result_lines(result)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
