"""Prepare local Zed release candidate files without validating the release."""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path


PACKAGE_DIRECTORY = Path("app-editors/zed")
STABLE_EBUILD_PATTERN = re.compile(r"^zed-(\d+)\.(\d+)\.(\d+)\.ebuild$")
Version = tuple[int, int, int]


class ReleasePreparationError(RuntimeError):
    """Raised when a candidate cannot be prepared safely."""


@dataclass(frozen=True, order=True)
class StableEbuild:
    """A stable Zed ebuild and its parsed version."""

    version: Version
    path: Path


@dataclass(frozen=True)
class ReleasePlan:
    """The source and target files for one local candidate."""

    source: StableEbuild
    candidate_version: Version
    source_patch: Path
    target_ebuild: Path
    target_patch: Path
    reuse_existing_patch: bool


@dataclass(frozen=True)
class PrepareResult:
    """The outcome of preparing or previewing one candidate."""

    outcome: str
    plan: ReleasePlan


def parse_stable_version(value: str) -> Version:
    """Parse a strict stable X.Y.Z version."""
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value)
    if match is None:
        raise ReleasePreparationError(f"Not a stable Zed version: {value}.")
    return tuple(map(int, match.groups()))


def version_text(version: Version) -> str:
    """Return a parsed version in canonical filename form."""
    return ".".join(map(str, version))


def stable_ebuilds(repository_root: Path) -> list[StableEbuild]:
    """Return all stable Zed ebuilds in version order."""
    package_dir = repository_root / PACKAGE_DIRECTORY
    ebuilds = []
    for path in package_dir.glob("zed-*.ebuild"):
        match = STABLE_EBUILD_PATTERN.fullmatch(path.name)
        if match is not None:
            ebuilds.append(StableEbuild(tuple(map(int, match.groups())), path))
    return sorted(ebuilds)


def plan_release(repository_root: Path, candidate_version: Version) -> ReleasePlan:
    """Build a non-mutating candidate plan from the latest stable ebuild."""
    package_dir = repository_root / PACKAGE_DIRECTORY
    candidate_name = f"zed-{version_text(candidate_version)}"
    target_ebuild = package_dir / f"{candidate_name}.ebuild"
    target_patch = package_dir / "files" / f"{candidate_name}-wayland-only.patch"
    if target_ebuild.exists() or target_ebuild.is_symlink():
        raise ReleasePreparationError(f"Candidate target already exists: {target_ebuild}.")
    # Файл с таким именем может уже содержать локальную адаптацию patch;
    # сохраняем его и оставляем проверку применимости отдельному validation gate.
    reuse_existing_patch = target_patch.exists() or target_patch.is_symlink()
    if reuse_existing_patch and (not target_patch.is_file() or target_patch.is_symlink()):
        raise ReleasePreparationError(
            f"Candidate patch must be a regular file: {target_patch}."
        )

    ebuilds = stable_ebuilds(repository_root)
    if not ebuilds:
        raise ReleasePreparationError("No stable Zed ebuild is available as a source.")
    source = ebuilds[-1]
    if candidate_version <= source.version:
        raise ReleasePreparationError(
            "Candidate version must be newer than the latest packaged stable version "
            f"({version_text(source.version)})."
        )

    source_patch = package_dir / "files" / f"{source.path.stem}-wayland-only.patch"
    if not source_patch.is_file():
        raise ReleasePreparationError(f"Source Wayland-only patch is missing: {source_patch}.")

    return ReleasePlan(
        source=source,
        candidate_version=candidate_version,
        source_patch=source_patch,
        target_ebuild=target_ebuild,
        target_patch=target_patch,
        reuse_existing_patch=reuse_existing_patch,
    )


def write_new_file(path: Path, contents: bytes) -> None:
    """Create path exclusively, removing a partial file if writing fails."""
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError as error:
        raise ReleasePreparationError(f"Candidate target already exists: {path}.") from error
    except OSError as error:
        raise ReleasePreparationError(f"Could not create candidate file: {path}.") from error
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(contents)
    except OSError as error:
        try:
            path.unlink()
        except OSError as cleanup_error:
            raise ReleasePreparationError(
                f"Could not remove partial candidate file: {path}."
            ) from cleanup_error
        raise ReleasePreparationError(f"Could not create candidate file: {path}.") from error


def remove_created_file(path: Path) -> None:
    """Remove a candidate that was created before a paired write failed."""
    try:
        path.unlink()
    except OSError as error:
        raise ReleasePreparationError(
            f"Could not roll back partial candidate file: {path}."
        ) from error


def prepare_release(
    repository_root: Path, release_version: str, *, dry_run: bool
) -> PrepareResult:
    """Copy the latest ebuild and patch into a new local candidate pair."""
    candidate_version = parse_stable_version(release_version)
    plan = plan_release(repository_root, candidate_version)
    if dry_run:
        return PrepareResult("dry-run", plan)

    try:
        source_ebuild = plan.source.path.read_bytes()
        source_patch = None if plan.reuse_existing_patch else plan.source_patch.read_bytes()
    except OSError as error:
        raise ReleasePreparationError("Could not read source candidate files.") from error

    write_new_file(plan.target_ebuild, source_ebuild)
    if plan.reuse_existing_patch:
        return PrepareResult("prepared", plan)
    try:
        assert source_patch is not None
        write_new_file(plan.target_patch, source_patch)
    except ReleasePreparationError:
        # Если запись patch не удалась после записи ebuild, удаляем ebuild,
        # чтобы в overlay не осталась неполная пара candidate-файлов.
        remove_created_file(plan.target_ebuild)
        raise
    return PrepareResult("prepared", plan)


def summary_lines(result: PrepareResult) -> tuple[str, ...]:
    """Render a concise local preparation summary."""
    action = "Would create" if result.outcome == "dry-run" else "Created"
    patch_action = "Would reuse" if result.outcome == "dry-run" else "Reused"
    patch_line = (
        f"{patch_action} existing patch: {result.plan.target_patch}"
        if result.plan.reuse_existing_patch
        else f"{action} patch: {result.plan.target_patch}"
    )
    patch_note = (
        "The existing patch is preserved and still requires "
        "gpatch --dry-run -p1 against the new upstream source tree."
        if result.plan.reuse_existing_patch
        else "The copied patch is only a candidate and still requires "
        "gpatch --dry-run -p1 against the new upstream source tree."
    )
    return (
        f"Source version: {version_text(result.plan.source.version)}",
        f"Candidate version: {version_text(result.plan.candidate_version)}",
        f"{action} ebuild: {result.plan.target_ebuild}",
        patch_line,
        "Manifest was not updated.",
        patch_note,
    )


def main() -> int:
    """Run local candidate preparation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-version", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        result = prepare_release(
            Path(__file__).resolve().parents[1],
            args.release_version,
            dry_run=args.dry_run,
        )
    except ReleasePreparationError as error:
        print(f"Release preparation error: {error}", file=sys.stderr)
        return 1
    print("\n".join(summary_lines(result)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
