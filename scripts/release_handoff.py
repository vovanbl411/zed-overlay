"""Connect Zed release discovery to local candidate preparation."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIRECTORY = str(Path(__file__).parent)
if SCRIPT_DIRECTORY not in sys.path:
    sys.path.insert(0, SCRIPT_DIRECTORY)

import prepare_zed_release as preparer
import watch_zed_release as watcher


class HandoffError(RuntimeError):
    """Raised when watcher or preparation cannot complete a local handoff."""


@dataclass(frozen=True)
class HandoffResult:
    """The watcher result and optional candidate preparation result."""

    watch_result: watcher.WatchResult
    preparation: preparer.PrepareResult | None


def run_handoff(
    repository_root: Path, client: object, *, prepare: bool
) -> HandoffResult:
    """Discover a release and optionally create its candidate files."""
    try:
        releases = client.fetch_releases()
        watch_result = watcher.watch(repository_root, releases)
    except watcher.WatcherError as error:
        raise HandoffError(f"Release watcher failed: {error}") from error

    if watch_result.outcome == "up-to-date":
        return HandoffResult(watch_result, None)

    try:
        preparation = preparer.prepare_release(
            repository_root,
            watcher.version_text(watch_result.upstream_release.version),
            dry_run=not prepare,
        )
    except preparer.ReleasePreparationError as error:
        raise HandoffError(f"Candidate preparation failed: {error}") from error
    return HandoffResult(watch_result, preparation)


def result_lines(result: HandoffResult) -> tuple[str, ...]:
    """Render a concise local handoff result."""
    lines = list(watcher.result_lines(result.watch_result))
    if result.preparation is not None:
        action = "would-prepare" if result.preparation.outcome == "dry-run" else "prepared"
        lines.append(f"Preparation: {action}")
    return tuple(lines)


def main() -> int:
    """Run one local release handoff; mutation requires --prepare."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    try:
        result = run_handoff(
            Path(__file__).resolve().parents[1],
            watcher.GitHubClient(),
            prepare=args.prepare,
        )
    except HandoffError as error:
        print(f"Release handoff error: {error}", file=sys.stderr)
        return 1
    print("\n".join(result_lines(result)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
