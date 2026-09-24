from __future__ import annotations

import importlib.util
import json
import os
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
        return self.snapshot_at(self.root)

    @staticmethod
    def snapshot_at(root: Path) -> dict[Path, bytes]:
        return {
            path.relative_to(root): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file()
        }

    def create_handoff_source(self, version: str = "1.16.0") -> None:
        (self.root / "app-editors/zed/Manifest").write_bytes(b"manifest\n")
        self.candidate_ebuild(version).write_bytes(b"candidate ebuild\n")
        self.candidate_patch(version).write_bytes(b"candidate patch\n")

    def create_handoff(
        self, version: str = "1.16.0", destination_name: str = "release-handoff"
    ) -> Path:
        self.create_handoff_source(version)
        destination = self.root / destination_name
        HANDOFF.create_release_handoff(
            self.root, destination, version, "a" * 40
        )
        return destination

    def handoff_metadata(self, destination: Path) -> dict[str, object]:
        return json.loads((destination / "release.json").read_text(encoding="utf-8"))

    def write_handoff_metadata(self, destination: Path, metadata: dict[str, object]) -> None:
        (destination / "release.json").write_text(
            json.dumps(metadata), encoding="utf-8"
        )

    def fresh_checkout(self) -> Path:
        checkout = self.root / "fresh-checkout"
        create_overlay(checkout)
        (checkout / "app-editors/zed/Manifest").write_bytes(b"base manifest\n")
        return checkout

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

    def test_new_release_reuses_existing_candidate_patch(self) -> None:
        candidate_patch = b"adapted candidate patch\n"
        self.candidate_patch().write_bytes(candidate_patch)

        result = HANDOFF.run_handoff(self.root, FakeClient([release("v1.16.0")]), prepare=True)

        assert result.preparation is not None
        self.assertEqual(result.preparation.outcome, "prepared")
        self.assertTrue(result.preparation.plan.reuse_existing_patch)
        self.assertEqual(self.candidate_ebuild().read_bytes(), b"ebuild 1.15.0\n")
        self.assertEqual(self.candidate_patch().read_bytes(), candidate_patch)
        self.assertIn(
            "Candidate patch: reusing existing version-specific patch",
            HANDOFF.result_lines(result),
        )

    def test_new_release_dry_run_reports_existing_candidate_patch(self) -> None:
        candidate_patch = b"adapted candidate patch\n"
        self.candidate_patch().write_bytes(candidate_patch)

        result = HANDOFF.run_handoff(self.root, FakeClient([release("v1.16.0")]), prepare=False)

        assert result.preparation is not None
        self.assertEqual(result.preparation.outcome, "dry-run")
        self.assertTrue(result.preparation.plan.reuse_existing_patch)
        self.assertFalse(self.candidate_ebuild().exists())
        self.assertEqual(self.candidate_patch().read_bytes(), candidate_patch)
        self.assertIn(
            "Candidate patch: reusing existing version-specific patch",
            HANDOFF.result_lines(result),
        )

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

    def test_creates_valid_handoff_with_exact_allowlist_and_preserved_files(self) -> None:
        destination = self.create_handoff()

        self.assertEqual(
            {
                path.relative_to(destination)
                for path in destination.rglob("*")
                if path.is_file()
            },
            {
                Path("release.json"),
                Path("app-editors/zed/Manifest"),
                Path("app-editors/zed/zed-1.16.0.ebuild"),
                Path("app-editors/zed/files/zed-1.16.0-wayland-only.patch"),
            },
        )
        for relative_path in (
            Path("app-editors/zed/Manifest"),
            Path("app-editors/zed/zed-1.16.0.ebuild"),
            Path("app-editors/zed/files/zed-1.16.0-wayland-only.patch"),
        ):
            self.assertEqual(
                (destination / relative_path).read_bytes(),
                (self.root / relative_path).read_bytes(),
            )
        self.assertEqual(
            self.handoff_metadata(destination),
            {
                "schema_version": 1,
                "base_commit": "a" * 40,
                "release_tag": "v1.16.0",
                "candidate_version": "1.16.0",
                "manifest_path": "app-editors/zed/Manifest",
                "candidate_ebuild_path": "app-editors/zed/zed-1.16.0.ebuild",
                "candidate_patch_path": "app-editors/zed/files/zed-1.16.0-wayland-only.patch",
            },
        )
        HANDOFF.validate_release_handoff(destination, expected_base_commit="a" * 40)

    def test_rejects_symlink_handoff_source(self) -> None:
        self.create_handoff_source()
        manifest = self.root / "app-editors/zed/Manifest"
        manifest.unlink()
        os.symlink("zed-1.16.0.ebuild", manifest)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.create_release_handoff(
                self.root, self.root / "release-handoff", "1.16.0", "a" * 40
            )

    def test_rejects_unexpected_extra_file(self) -> None:
        destination = self.create_handoff()
        (destination / "unexpected").write_text("no", encoding="utf-8")

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_portage_cache_inside_handoff(self) -> None:
        destination = self.create_handoff()
        cache = destination / "metadata/md5-cache"
        cache.mkdir(parents=True)
        (cache / "app-editors").write_text("cache", encoding="utf-8")

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_symlink_inside_handoff(self) -> None:
        destination = self.create_handoff()
        os.symlink("release.json", destination / "unexpected-link")

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_missing_manifest(self) -> None:
        destination = self.create_handoff()
        (destination / "app-editors/zed/Manifest").unlink()

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_malformed_and_extra_key_release_json(self) -> None:
        destination = self.create_handoff()
        (destination / "release.json").write_text("{", encoding="utf-8")
        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

        destination = self.create_handoff("1.17.0", "release-handoff-extra")
        metadata = self.handoff_metadata(destination)
        metadata["extra"] = "not allowed"
        self.write_handoff_metadata(destination, metadata)
        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_version_tag_mismatch(self) -> None:
        destination = self.create_handoff()
        metadata = self.handoff_metadata(destination)
        metadata["release_tag"] = "v1.16.1"
        self.write_handoff_metadata(destination, metadata)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_candidate_path_mismatch(self) -> None:
        destination = self.create_handoff()
        metadata = self.handoff_metadata(destination)
        metadata["candidate_patch_path"] = "app-editors/zed/files/other.patch"
        self.write_handoff_metadata(destination, metadata)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_invalid_base_sha(self) -> None:
        destination = self.create_handoff()
        metadata = self.handoff_metadata(destination)
        metadata["base_commit"] = "A" * 40
        self.write_handoff_metadata(destination, metadata)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination)

    def test_rejects_expected_base_commit_mismatch(self) -> None:
        destination = self.create_handoff()

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.validate_release_handoff(destination, expected_base_commit="b" * 40)

    def test_rejects_existing_handoff_destination(self) -> None:
        self.create_handoff_source()
        destination = self.root / "release-handoff"
        destination.mkdir()

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.create_release_handoff(
                self.root, destination, "1.16.0", "a" * 40
            )

    def test_applies_initial_handoff(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()

        applied = HANDOFF.apply_release_handoff(
            checkout, handoff, expected_base_commit="a" * 40
        )

        self.assertEqual((checkout / "app-editors/zed/Manifest").read_bytes(), b"manifest\n")
        self.assertEqual(self.candidate_ebuild().read_bytes(), b"candidate ebuild\n")
        self.assertEqual(
            (checkout / "app-editors/zed/zed-1.16.0.ebuild").read_bytes(),
            b"candidate ebuild\n",
        )
        self.assertEqual(
            (checkout / "app-editors/zed/files/zed-1.16.0-wayland-only.patch").read_bytes(),
            b"candidate patch\n",
        )
        self.assertEqual(applied.release_tag, "v1.16.0")
        self.assertEqual(applied.candidate_version, "1.16.0")
        self.assertEqual(applied.branch, "automation/zed-v1.16.0")
        self.assertTrue(applied.patch_created)

    def test_applies_resumed_handoff_without_replacing_matching_patch(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        existing_patch = checkout / "app-editors/zed/files/zed-1.16.0-wayland-only.patch"
        existing_patch.write_bytes(b"candidate patch\n")

        applied = HANDOFF.apply_release_handoff(
            checkout, handoff, expected_base_commit="a" * 40
        )

        self.assertFalse(applied.patch_created)
        self.assertEqual(existing_patch.read_bytes(), b"candidate patch\n")
        self.assertEqual((checkout / "app-editors/zed/Manifest").read_bytes(), b"manifest\n")
        self.assertEqual(
            (checkout / "app-editors/zed/zed-1.16.0.ebuild").read_bytes(),
            b"candidate ebuild\n",
        )

    def test_rejects_different_existing_patch_before_mutation(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        (checkout / "app-editors/zed/files/zed-1.16.0-wayland-only.patch").write_bytes(
            b"different patch\n"
        )
        before = self.snapshot_at(checkout)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.apply_release_handoff(checkout, handoff, expected_base_commit="a" * 40)

        self.assertEqual(self.snapshot_at(checkout), before)

    def test_rejects_existing_candidate_ebuild_before_mutation(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        (checkout / "app-editors/zed/zed-1.16.0.ebuild").write_bytes(b"existing\n")
        before = self.snapshot_at(checkout)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.apply_release_handoff(checkout, handoff, expected_base_commit="a" * 40)

        self.assertEqual(self.snapshot_at(checkout), before)

    def test_rejects_destination_manifest_symlink_before_mutation(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        manifest = checkout / "app-editors/zed/Manifest"
        manifest.unlink()
        os.symlink("zed-1.15.0.ebuild", manifest)
        before = self.snapshot_at(checkout)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.apply_release_handoff(checkout, handoff, expected_base_commit="a" * 40)

        self.assertEqual(self.snapshot_at(checkout), before)

    def test_rejects_destination_patch_symlink_before_mutation(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        patch_path = checkout / "app-editors/zed/files/zed-1.16.0-wayland-only.patch"
        os.symlink("zed-1.15.0-wayland-only.patch", patch_path)
        before = self.snapshot_at(checkout)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.apply_release_handoff(checkout, handoff, expected_base_commit="a" * 40)

        self.assertEqual(self.snapshot_at(checkout), before)

    def test_rejects_expected_base_mismatch_before_apply(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        before = self.snapshot_at(checkout)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.apply_release_handoff(checkout, handoff, expected_base_commit="b" * 40)

        self.assertEqual(self.snapshot_at(checkout), before)

    def test_rejects_invalid_handoff_before_apply(self) -> None:
        handoff = self.create_handoff()
        checkout = self.fresh_checkout()
        (handoff / "unexpected").write_text("no", encoding="utf-8")
        before = self.snapshot_at(checkout)

        with self.assertRaises(HANDOFF.HandoffError):
            HANDOFF.apply_release_handoff(checkout, handoff, expected_base_commit="a" * 40)

        self.assertEqual(self.snapshot_at(checkout), before)
