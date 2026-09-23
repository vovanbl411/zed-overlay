from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "release_handoff.py"
SPEC = importlib.util.spec_from_file_location("release_handoff", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
HANDOFF = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HANDOFF
SPEC.loader.exec_module(HANDOFF)


def release(tag: str) -> dict[str, object]:
    return {
        "tag_name": tag,
        "html_url": f"https://github.com/zed-industries/zed/releases/tag/{tag}",
        "draft": False,
        "prerelease": False,
    }


def create_overlay(root: Path, versions: tuple[str, ...] = ("1.15.0",)) -> None:
    package_dir = root / "app-editors/zed"
    (package_dir / "files").mkdir(parents=True)
    for version in versions:
        (package_dir / f"zed-{version}.ebuild").write_bytes(
            f"ebuild {version}\n".encode()
        )
        (package_dir / "files" / f"zed-{version}-wayland-only.patch").write_bytes(
            f"patch {version}\n".encode()
        )


class FakeClient:
    def __init__(self, releases: object | None = None, error: Exception | None = None) -> None:
        self.releases = releases
        self.error = error
        self.calls = 0

    def fetch_releases(self) -> object:
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.releases


class ReleaseHandoffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        create_overlay(self.root)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def candidate_ebuild(self, version: str = "1.16.0") -> Path:
        return self.root / "app-editors/zed" / f"zed-{version}.ebuild"

    def candidate_patch(self, version: str = "1.16.0") -> Path:
        return self.root / "app-editors/zed/files" / f"zed-{version}-wayland-only.patch"

    def snapshot(self) -> dict[Path, bytes]:
        return {
            path.relative_to(self.root): path.read_bytes()
            for path in self.root.rglob("*")
            if path.is_file()
        }

    def test_new_release_default_mode_validates_without_changing_files(self) -> None:
        before = self.snapshot()

        result = HANDOFF.run_handoff(self.root, FakeClient([release("v1.16.0")]), prepare=False)

        self.assertEqual(result.watch_result.upstream_release.version, (1, 16, 0))
        assert result.preparation is not None
        self.assertEqual(result.preparation.outcome, "dry-run")
        self.assertEqual(result.preparation.plan.candidate_version, (1, 16, 0))
        self.assertIn("Preparation: would-prepare", HANDOFF.result_lines(result))
        self.assertEqual(self.snapshot(), before)

    def test_new_release_prepare_creates_matching_candidate_pair(self) -> None:
        result = HANDOFF.run_handoff(self.root, FakeClient([release("v1.16.0")]), prepare=True)

        assert result.preparation is not None
        self.assertEqual(result.preparation.outcome, "prepared")
        self.assertEqual(result.preparation.plan.candidate_version, (1, 16, 0))
        self.assertEqual(self.candidate_ebuild().read_bytes(), b"ebuild 1.15.0\n")
        self.assertEqual(self.candidate_patch().read_bytes(), b"patch 1.15.0\n")

    def test_up_to_date_does_not_prepare(self) -> None:
        before = self.snapshot()

        result = HANDOFF.run_handoff(self.root, FakeClient([release("v1.15.0")]), prepare=False)

        self.assertEqual(result.watch_result.outcome, "up-to-date")
        self.assertIsNone(result.preparation)
        self.assertEqual(self.snapshot(), before)

    def test_up_to_date_prepare_still_does_not_create_files(self) -> None:
        before = self.snapshot()

        with patch.object(HANDOFF.preparer, "prepare_release") as prepare_release:
            result = HANDOFF.run_handoff(
                self.root, FakeClient([release("v1.15.0")]), prepare=True
            )

        self.assertEqual(result.watch_result.outcome, "up-to-date")
        self.assertIsNone(result.preparation)
        prepare_release.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_existing_candidate_target_is_reported_without_overwrite(self) -> None:
        self.candidate_patch().write_bytes(b"existing candidate\n")

        with self.assertRaisesRegex(HANDOFF.HandoffError, "Candidate preparation failed"):
            HANDOFF.run_handoff(self.root, FakeClient([release("v1.16.0")]), prepare=False)

        self.assertFalse(self.candidate_ebuild().exists())
        self.assertEqual(self.candidate_patch().read_bytes(), b"existing candidate\n")

    def test_watcher_failure_does_not_start_preparation(self) -> None:
        client = FakeClient(error=HANDOFF.watcher.WatcherError("simulated watcher failure"))

        with patch.object(HANDOFF.preparer, "prepare_release") as prepare_release:
            with self.assertRaisesRegex(HANDOFF.HandoffError, "watcher failed"):
                HANDOFF.run_handoff(self.root, client, prepare=False)

        prepare_release.assert_not_called()

    def test_prepare_failure_propagates_without_partial_state(self) -> None:
        before = self.snapshot()
        original_open = HANDOFF.preparer.os.open

        def fail_target_patch(path: Path, flags: int, mode: int) -> int:
            if Path(path) == self.candidate_patch():
                raise PermissionError("simulated patch creation failure")
            return original_open(path, flags, mode)

        with patch.object(HANDOFF.preparer.os, "open", side_effect=fail_target_patch):
            with self.assertRaisesRegex(HANDOFF.HandoffError, "Candidate preparation failed"):
                HANDOFF.run_handoff(self.root, FakeClient([release("v1.16.0")]), prepare=True)

        self.assertFalse(self.candidate_ebuild().exists())
        self.assertFalse(self.candidate_patch().exists())
        self.assertEqual(self.snapshot(), before)

    def test_uses_watcher_numeric_release_selection(self) -> None:
        numeric_root = self.root / "numeric"
        create_overlay(numeric_root, ("1.8.0",))

        result = HANDOFF.run_handoff(
            numeric_root,
            FakeClient([release("v1.9.0"), release("v1.10.0")]),
            prepare=False,
        )

        self.assertEqual(result.watch_result.upstream_release.version, (1, 10, 0))
        assert result.preparation is not None
        self.assertEqual(result.preparation.plan.candidate_version, (1, 10, 0))
