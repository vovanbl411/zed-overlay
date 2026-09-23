"""Validate the structural and Wayland-only policy of this overlay."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path
from typing import Iterable


PACKAGE_DIRECTORY = Path("app-editors/zed")
REPOSITORY_NAME = "zed-overlay"
REQUIRED_LAYOUT = {
    "masters": "gentoo",
    "thin-manifests": "true",
}
PATCH_REFERENCE = re.compile(
    r'PATCHES\s*=\s*\(\s*"\$\{FILESDIR\}/\$\{P\}-wayland-only\.patch"\s*\)',
    re.DOTALL,
)


class OverlayPolicyError(RuntimeError):
    """Raised when the repository does not meet its overlay policy."""


def git_tracked_paths(repository_root: Path) -> set[str]:
    """Return paths tracked by Git, relative to the repository root."""
    result = subprocess.run(
        ("git", "-C", str(repository_root), "ls-files", "-z"),
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        raise OverlayPolicyError("Cannot inspect Git-tracked paths.")
    return {
        path.decode("utf-8")
        for path in result.stdout.split(b"\0")
        if path
    }


def layout_settings(layout_path: Path) -> dict[str, str]:
    """Read non-comment key/value settings from layout.conf."""
    settings: dict[str, str] = {}
    for line in layout_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        settings[key.strip()] = value.strip()
    return settings


def require_file(path: Path) -> None:
    """Require a regular file at path."""
    if not path.is_file():
        raise OverlayPolicyError(f"Required file is missing: {path}.")


def validate_wayland_patch(patch_path: Path) -> None:
    """Reject obvious restorations of X11 or Linux screen capture."""
    patch_lines = patch_path.read_text(encoding="utf-8").splitlines()
    if not any(line.startswith("diff --git ") for line in patch_lines):
        raise OverlayPolicyError(f"Patch is not a unified Git diff: {patch_path}.")
    if not any(line.startswith("--- a/") for line in patch_lines) or not any(
        line.startswith("+++ b/") for line in patch_lines
    ):
        raise OverlayPolicyError(f"Patch lacks unified-diff file markers: {patch_path}.")

    added_lines = [line[1:] for line in patch_lines if line.startswith("+") and not line.startswith("+++")]
    removed_lines = [line[1:] for line in patch_lines if line.startswith("-") and not line.startswith("---")]
    added_text = "\n".join(added_lines).lower()
    removed_text = "\n".join(removed_lines).lower()

    for forbidden in ("x11", "screen-capture", "scap/wayland"):
        if forbidden in added_text:
            raise OverlayPolicyError(
                f"Wayland-only patch adds forbidden feature '{forbidden}': {patch_path}."
            )
    if "x11" not in removed_text or "screen-capture" not in removed_text:
        raise OverlayPolicyError(
            f"Wayland-only patch must remove X11 and screen-capture features: {patch_path}."
        )
    if not re.search(r'features\s*=\s*\[[^]]*"wayland"', "\n".join(added_lines)):
        raise OverlayPolicyError(f"Wayland-only patch does not retain a Wayland feature: {patch_path}.")


def validate_overlay(
    repository_root: Path, *, tracked_paths: Iterable[str] | None = None
) -> tuple[Path, ...]:
    """Validate stable repository structure and Wayland-only policy."""
    repository_root = repository_root.resolve()
    repo_name_path = repository_root / "profiles/repo_name"
    require_file(repo_name_path)
    if repo_name_path.read_text(encoding="utf-8").strip() != REPOSITORY_NAME:
        raise OverlayPolicyError(f"profiles/repo_name must be '{REPOSITORY_NAME}'.")

    layout_path = repository_root / "metadata/layout.conf"
    require_file(layout_path)
    settings = layout_settings(layout_path)
    for key, expected_value in REQUIRED_LAYOUT.items():
        if settings.get(key) != expected_value:
            raise OverlayPolicyError(
                f"metadata/layout.conf must set {key} = {expected_value}."
            )

    package_dir = repository_root / PACKAGE_DIRECTORY
    if not package_dir.is_dir():
        raise OverlayPolicyError(f"Package directory is missing: {PACKAGE_DIRECTORY}.")
    for required_name in ("metadata.xml", "Manifest"):
        require_file(package_dir / required_name)

    ebuilds = tuple(sorted(package_dir.glob("zed-*.ebuild")))
    if not ebuilds:
        raise OverlayPolicyError(f"No Zed ebuild found in {PACKAGE_DIRECTORY}.")
    for ebuild_path in ebuilds:
        if not PATCH_REFERENCE.search(ebuild_path.read_text(encoding="utf-8")):
            raise OverlayPolicyError(
                f"Ebuild must apply the Wayland-only patch through PATCHES: {ebuild_path}."
            )
        patch_path = package_dir / "files" / f"{ebuild_path.stem}-wayland-only.patch"
        require_file(patch_path)
        validate_wayland_patch(patch_path)

    tracked = set(tracked_paths) if tracked_paths is not None else git_tracked_paths(repository_root)
    if any(path == "metadata/md5-cache" or path.startswith("metadata/md5-cache/") for path in tracked):
        raise OverlayPolicyError("Pregenerated metadata/md5-cache must not be tracked by Git.")

    return ebuilds


def main() -> int:
    """Run the policy checker for this repository or a supplied root."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="overlay repository root (default: this script's repository)",
    )
    args = parser.parse_args()
    try:
        ebuilds = validate_overlay(args.root)
    except OverlayPolicyError as error:
        print(f"overlay policy: FAILED: {error}")
        return 1
    print(f"overlay policy: OK ({len(ebuilds)} Zed ebuild(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
