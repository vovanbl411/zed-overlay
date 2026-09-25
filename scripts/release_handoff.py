"""Connect Zed release discovery to local candidate preparation."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCRIPT_DIRECTORY = str(Path(__file__).parent)
if SCRIPT_DIRECTORY not in sys.path:
    sys.path.insert(0, SCRIPT_DIRECTORY)

import prepare_zed_release as preparer
import watch_zed_release as watcher


class HandoffError(RuntimeError):
    """Raised when watcher or preparation cannot complete a local handoff."""


HANDOFF_SCHEMA_VERSION = 1
MANIFEST_PATH = Path("app-editors/zed/Manifest")
VERSION_PATTERN = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


@dataclass(frozen=True)
class HandoffResult:
    """The watcher result and optional candidate preparation result."""

    watch_result: watcher.WatchResult
    preparation: preparer.PrepareResult | None


@dataclass(frozen=True)
class AppliedHandoff:
    """The deterministic values produced by a validated handoff apply."""

    release_tag: str
    candidate_version: str
    branch: str
    patch_created: bool


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
        if result.preparation.plan.reuse_existing_patch:
            lines.append("Candidate patch: reusing existing version-specific patch")
    return tuple(lines)


def _validate_candidate_version(candidate_version: str) -> None:
    if not VERSION_PATTERN.fullmatch(candidate_version):
        raise HandoffError(f"Invalid candidate version: {candidate_version!r}")


def _validate_base_commit(base_commit: str) -> None:
    if not COMMIT_PATTERN.fullmatch(base_commit):
        raise HandoffError("Base commit must be a lowercase 40-character Git SHA")


def _artifact_paths(candidate_version: str) -> tuple[Path, Path, Path]:
    _validate_candidate_version(candidate_version)
    return (
        MANIFEST_PATH,
        Path(f"app-editors/zed/zed-{candidate_version}.ebuild"),
        Path(f"app-editors/zed/files/zed-{candidate_version}-wayland-only.patch"),
    )


def _release_metadata(candidate_version: str, base_commit: str) -> dict[str, object]:
    manifest_path, candidate_ebuild_path, candidate_patch_path = _artifact_paths(
        candidate_version
    )
    _validate_base_commit(base_commit)
    return {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "base_commit": base_commit,
        "release_tag": f"v{candidate_version}",
        "candidate_version": candidate_version,
        "manifest_path": manifest_path.as_posix(),
        "candidate_ebuild_path": candidate_ebuild_path.as_posix(),
        "candidate_patch_path": candidate_patch_path.as_posix(),
    }


def _require_regular_file(path: Path, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError as error:
        raise HandoffError(f"Missing {description}: {path}") from error
    if not stat.S_ISREG(mode):
        raise HandoffError(f"{description} must be a regular file: {path}")


def create_release_handoff(
    repository_root: Path,
    destination: Path,
    candidate_version: str,
    base_commit: str,
) -> None:
    """Create and validate a minimal, allowlisted release handoff artifact."""
    metadata = _release_metadata(candidate_version, base_commit)
    if destination.exists() or destination.is_symlink():
        raise HandoffError(f"Handoff destination already exists: {destination}")

    package_paths = _artifact_paths(candidate_version)
    for relative_path in package_paths:
        _require_regular_file(repository_root / relative_path, "handoff source file")

    destination.mkdir()
    (destination / "app-editors").mkdir()
    (destination / "app-editors/zed").mkdir()
    (destination / "app-editors/zed/files").mkdir()
    for relative_path in package_paths:
        shutil.copyfile(repository_root / relative_path, destination / relative_path)
    (destination / "release.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    validate_release_handoff(destination, expected_base_commit=base_commit)


def _validate_artifact_layout(destination: Path, expected_files: set[Path]) -> None:
    try:
        root_mode = destination.lstat().st_mode
    except FileNotFoundError as error:
        raise HandoffError(f"Handoff artifact is missing: {destination}") from error
    if not stat.S_ISDIR(root_mode):
        raise HandoffError(f"Handoff artifact must be a directory: {destination}")

    expected_directories = {
        Path("app-editors"),
        Path("app-editors/zed"),
        Path("app-editors/zed/files"),
    }
    found_files: set[Path] = set()
    found_directories: set[Path] = set()

    # Handoff приходит как отдельный artifact из CI: запрещаем symlink и special files,
    # чтобы проверка не прочитала данные за пределами каталога artifact.
    def walk(directory: Path, relative_directory: Path) -> None:
        with os.scandir(directory) as entries:
            for entry in entries:
                relative_path = relative_directory / entry.name
                mode = entry.stat(follow_symlinks=False).st_mode
                if stat.S_ISLNK(mode):
                    raise HandoffError(f"Handoff artifact contains symlink: {relative_path}")
                if stat.S_ISDIR(mode):
                    if relative_path not in expected_directories:
                        raise HandoffError(
                            f"Handoff artifact contains unexpected directory: {relative_path}"
                        )
                    found_directories.add(relative_path)
                    walk(Path(entry.path), relative_path)
                elif stat.S_ISREG(mode):
                    if relative_path not in expected_files:
                        raise HandoffError(
                            f"Handoff artifact contains unexpected file: {relative_path}"
                        )
                    found_files.add(relative_path)
                else:
                    raise HandoffError(
                        f"Handoff artifact contains special file: {relative_path}"
                    )

    walk(destination, Path())
    if found_directories != expected_directories:
        raise HandoffError("Handoff artifact is missing an expected directory")
    if found_files != expected_files:
        raise HandoffError("Handoff artifact is missing an expected file")


def _read_release_metadata(path: Path) -> dict[str, object]:
    try:
        parsed: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise HandoffError(f"Invalid release.json: {error}") from error
    if not isinstance(parsed, dict):
        raise HandoffError("release.json must contain an object")
    return parsed


def validate_release_handoff(
    destination: Path, *, expected_base_commit: str | None = None
) -> dict[str, object]:
    """Fail closed unless a handoff contains exactly the expected artifact."""
    if expected_base_commit is not None:
        _validate_base_commit(expected_base_commit)

    release_json = Path("release.json")
    try:
        root_mode = destination.lstat().st_mode
    except FileNotFoundError as error:
        raise HandoffError(f"Handoff artifact is missing: {destination}") from error
    if not stat.S_ISDIR(root_mode):
        raise HandoffError(f"Handoff artifact must be a directory: {destination}")
    _require_regular_file(destination / release_json, "release.json")
    metadata = _read_release_metadata(destination / release_json)
    expected_keys = {
        "schema_version",
        "base_commit",
        "release_tag",
        "candidate_version",
        "manifest_path",
        "candidate_ebuild_path",
        "candidate_patch_path",
    }
    if set(metadata) != expected_keys:
        raise HandoffError("release.json fields do not match the handoff schema")
    if (
        type(metadata["schema_version"]) is not int
        or metadata["schema_version"] != HANDOFF_SCHEMA_VERSION
    ):
        raise HandoffError("release.json has an invalid schema_version")

    candidate_version = metadata["candidate_version"]
    base_commit = metadata["base_commit"]
    if not isinstance(candidate_version, str):
        raise HandoffError("release.json has an invalid candidate_version")
    if not isinstance(base_commit, str):
        raise HandoffError("release.json has an invalid base_commit")
    _validate_candidate_version(candidate_version)
    _validate_base_commit(base_commit)
    expected_metadata = _release_metadata(candidate_version, base_commit)
    if metadata != expected_metadata:
        raise HandoffError("release.json version, tag, or paths are inconsistent")
    if expected_base_commit is not None and base_commit != expected_base_commit:
        raise HandoffError("release.json base_commit does not match the expected commit")

    expected_files = {Path("release.json"), *_artifact_paths(candidate_version)}
    _validate_artifact_layout(destination, expected_files)
    return expected_metadata


def _require_directory(path: Path, description: str) -> None:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError as error:
        raise HandoffError(f"Missing {description}: {path}") from error
    if not stat.S_ISDIR(mode):
        raise HandoffError(f"{description} must be a directory: {path}")


def _path_exists(path: Path) -> bool:
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def _write_new_file(path: Path, content: bytes) -> None:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except OSError as error:
        raise HandoffError(f"Could not create handoff destination file: {path}") from error
    with os.fdopen(descriptor, "wb") as output:
        output.write(content)


def apply_release_handoff(
    repository_root: Path, handoff_directory: Path, *, expected_base_commit: str
) -> AppliedHandoff:
    """Apply only validated package files to a fresh base checkout."""
    metadata = validate_release_handoff(
        handoff_directory, expected_base_commit=expected_base_commit
    )
    candidate_version = metadata["candidate_version"]
    release_tag = metadata["release_tag"]
    if not isinstance(candidate_version, str) or not isinstance(release_tag, str):
        raise HandoffError("Validated handoff metadata has an invalid release identity")
    manifest_path, candidate_ebuild_path, candidate_patch_path = _artifact_paths(
        candidate_version
    )

    package_directory = repository_root / "app-editors/zed"
    files_directory = package_directory / "files"
    _require_directory(repository_root / "app-editors", "package parent directory")
    _require_directory(package_directory, "package directory")
    _require_directory(files_directory, "package files directory")
    _require_regular_file(repository_root / manifest_path, "destination Manifest")

    destination_ebuild = repository_root / candidate_ebuild_path
    destination_patch = repository_root / candidate_patch_path
    if _path_exists(destination_ebuild):
        raise HandoffError(f"Candidate ebuild already exists: {destination_ebuild}")

    artifact_manifest = handoff_directory / manifest_path
    artifact_ebuild = handoff_directory / candidate_ebuild_path
    artifact_patch = handoff_directory / candidate_patch_path
    _require_regular_file(artifact_manifest, "handoff Manifest")
    _require_regular_file(artifact_ebuild, "handoff candidate ebuild")
    _require_regular_file(artifact_patch, "handoff candidate patch")
    manifest_content = artifact_manifest.read_bytes()
    ebuild_content = artifact_ebuild.read_bytes()
    patch_content = artifact_patch.read_bytes()

    patch_created = not _path_exists(destination_patch)
    if not patch_created:
        _require_regular_file(destination_patch, "destination candidate patch")
        if destination_patch.read_bytes() != patch_content:
            raise HandoffError(
                f"Existing candidate patch differs from handoff: {destination_patch}"
            )

    # Сначала размещаем ebuild и patch, затем копируем соответствующий им Manifest;
    # так Manifest не объявляет candidate до появления обоих package files.
    _write_new_file(destination_ebuild, ebuild_content)
    if patch_created:
        _write_new_file(destination_patch, patch_content)
    (repository_root / manifest_path).write_bytes(manifest_content)
    return AppliedHandoff(
        release_tag=release_tag,
        candidate_version=candidate_version,
        branch=f"automation/zed-{release_tag}",
        patch_created=patch_created,
    )


def _write_github_output(path: Path, result: AppliedHandoff) -> None:
    values = {
        "release_tag": result.release_tag,
        "candidate_version": result.candidate_version,
        "branch": result.branch,
        "patch_created": str(result.patch_created).lower(),
    }
    with path.open("a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")


def main() -> int:
    """Run one local release handoff; mutation requires --prepare."""
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--create-handoff", type=Path, metavar="DESTINATION")
    action.add_argument("--validate-handoff", type=Path, metavar="DESTINATION")
    action.add_argument("--apply-handoff", type=Path, metavar="DESTINATION")
    parser.add_argument("--candidate-version")
    parser.add_argument("--base-commit")
    parser.add_argument("--expected-base-commit")
    parser.add_argument("--repository-root", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    if args.create_handoff is not None:
        if args.candidate_version is None or args.base_commit is None:
            parser.error("--create-handoff requires --candidate-version and --base-commit")
        try:
            create_release_handoff(
                Path.cwd(), args.create_handoff, args.candidate_version, args.base_commit
            )
        except HandoffError as error:
            print(f"Release handoff error: {error}", file=sys.stderr)
            return 1
        return 0
    if args.validate_handoff is not None:
        try:
            validate_release_handoff(
                args.validate_handoff, expected_base_commit=args.expected_base_commit
            )
        except HandoffError as error:
            print(f"Release handoff error: {error}", file=sys.stderr)
            return 1
        return 0
    if args.apply_handoff is not None:
        if args.repository_root is None or args.expected_base_commit is None:
            parser.error("--apply-handoff requires --repository-root and --expected-base-commit")
        try:
            applied = apply_release_handoff(
                args.repository_root,
                args.apply_handoff,
                expected_base_commit=args.expected_base_commit,
            )
            if args.github_output is not None:
                _write_github_output(args.github_output, applied)
        except HandoffError as error:
            print(f"Release handoff error: {error}", file=sys.stderr)
            return 1
        return 0
    if (
        args.candidate_version is not None
        or args.base_commit is not None
        or args.expected_base_commit is not None
        or args.repository_root is not None
        or args.github_output is not None
    ):
        parser.error("handoff metadata options require a handoff action")
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
