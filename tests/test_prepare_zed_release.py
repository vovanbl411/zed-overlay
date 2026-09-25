from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "prepare_zed_release.py"
# Импортируем автономный CLI-скрипт по пути: каталог scripts не является Python-пакетом,
# и тест проверяет тот же код, который запускает CI.
SPEC = importlib.util.spec_from_file_location("prepare_zed_release", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
PREPARE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PREPARE
SPEC.loader.exec_module(PREPARE)


def create_overlay(root: Path) -> None:
    # Две стабильные версии позволяют проверить выбор самой новой и убедиться,
    # что подготовка candidate не удаляет уже упакованные файлы.
    package_dir = root / "app-editors/zed"
    (package_dir / "files").mkdir(parents=True)
    (package_dir / "zed-1.14.0.ebuild").write_bytes(b"old ebuild\n")
    (package_dir / "zed-1.15.0.ebuild").write_bytes(b"current ebuild\n")
    (package_dir / "files/zed-1.14.0-wayland-only.patch").write_bytes(b"old patch\n")
    (package_dir / "files/zed-1.15.0-wayland-only.patch").write_bytes(b"current patch\n")


class PrepareZedReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        create_overlay(self.root)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def candidate_ebuild(self) -> Path:
        return self.root / "app-editors/zed/zed-1.16.0.ebuild"

    def candidate_patch(self) -> Path:
        return self.root / "app-editors/zed/files/zed-1.16.0-wayland-only.patch"

    def file_snapshot(self) -> dict[Path, bytes]:
        return {
            path.relative_to(self.root): path.read_bytes()
            for path in self.root.rglob("*")
            if path.is_file()
        }

    def test_prepares_new_version_without_removing_existing_files(self) -> None:
        result = PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertEqual(result.outcome, "prepared")
        self.assertEqual(result.plan.source.version, (1, 15, 0))
        self.assertTrue((self.root / "app-editors/zed/zed-1.14.0.ebuild").is_file())
        self.assertTrue((self.root / "app-editors/zed/zed-1.15.0.ebuild").is_file())
        self.assertTrue(
            (self.root / "app-editors/zed/files/zed-1.14.0-wayland-only.patch").is_file()
        )
        self.assertTrue(
            (self.root / "app-editors/zed/files/zed-1.15.0-wayland-only.patch").is_file()
        )

    def test_copies_ebuild_and_patch_without_content_changes(self) -> None:
        PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertEqual(
            self.candidate_ebuild().read_bytes(),
            (self.root / "app-editors/zed/zed-1.15.0.ebuild").read_bytes(),
        )
        self.assertEqual(
            self.candidate_patch().read_bytes(),
            (self.root / "app-editors/zed/files/zed-1.15.0-wayland-only.patch").read_bytes(),
        )

    def test_dry_run_does_not_change_filesystem(self) -> None:
        before = self.file_snapshot()

        result = PREPARE.prepare_release(self.root, "1.16.0", dry_run=True)

        self.assertEqual(result.outcome, "dry-run")
        self.assertEqual(self.file_snapshot(), before)

    def test_dry_run_reuses_existing_candidate_patch_without_changes(self) -> None:
        self.candidate_patch().write_bytes(b"adapted candidate patch\n")
        before = self.file_snapshot()

        result = PREPARE.prepare_release(self.root, "1.16.0", dry_run=True)

        self.assertEqual(result.outcome, "dry-run")
        self.assertTrue(result.plan.reuse_existing_patch)
        self.assertTrue(
            any("Would reuse existing patch" in line for line in PREPARE.summary_lines(result))
        )
        self.assertEqual(self.file_snapshot(), before)

    def test_rejects_equal_version_without_changing_files(self) -> None:
        before = self.file_snapshot()

        with self.assertRaises(PREPARE.ReleasePreparationError):
            PREPARE.prepare_release(self.root, "1.15.0", dry_run=False)

        self.assertEqual(self.file_snapshot(), before)

    def test_rejects_older_version(self) -> None:
        with self.assertRaisesRegex(PREPARE.ReleasePreparationError, "newer"):
            PREPARE.prepare_release(self.root, "1.14.9", dry_run=False)

        self.assertFalse(self.candidate_ebuild().exists())
        self.assertFalse(self.candidate_patch().exists())

    def test_rejects_malformed_or_nonstable_versions(self) -> None:
        for version in ("1.16", "v1.16.0", "1.16.0-rc1"):
            with self.subTest(version=version):
                with self.assertRaisesRegex(PREPARE.ReleasePreparationError, "stable Zed"):
                    PREPARE.prepare_release(self.root, version, dry_run=False)

    def test_rejects_existing_target_ebuild_without_creating_patch(self) -> None:
        self.candidate_ebuild().write_bytes(b"existing candidate ebuild\n")

        with self.assertRaisesRegex(PREPARE.ReleasePreparationError, "already exists"):
            PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertEqual(self.candidate_ebuild().read_bytes(), b"existing candidate ebuild\n")
        self.assertFalse(self.candidate_patch().exists())

    def test_reuses_existing_candidate_patch_and_creates_only_ebuild(self) -> None:
        candidate_patch = b"adapted candidate patch\n"
        self.candidate_patch().write_bytes(candidate_patch)

        result = PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertEqual(result.outcome, "prepared")
        self.assertTrue(result.plan.reuse_existing_patch)
        self.assertEqual(self.candidate_ebuild().read_bytes(), b"current ebuild\n")
        self.assertEqual(self.candidate_patch().read_bytes(), candidate_patch)

    def test_ebuild_creation_failure_preserves_existing_candidate_patch(self) -> None:
        candidate_patch = b"adapted candidate patch\n"
        self.candidate_patch().write_bytes(candidate_patch)

        with patch.object(
            PREPARE,
            "write_new_file",
            side_effect=PREPARE.ReleasePreparationError("simulated ebuild write failure"),
        ):
            with self.assertRaisesRegex(PREPARE.ReleasePreparationError, "simulated"):
                PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertFalse(self.candidate_ebuild().exists())
        self.assertEqual(self.candidate_patch().read_bytes(), candidate_patch)

    def test_rolls_back_ebuild_if_patch_creation_fails(self) -> None:
        original_write = PREPARE.write_new_file

        def fail_patch(path: Path, contents: bytes) -> None:
            if path == self.candidate_patch():
                raise PREPARE.ReleasePreparationError("simulated patch write failure")
            original_write(path, contents)

        with patch.object(PREPARE, "write_new_file", side_effect=fail_patch):
            with self.assertRaisesRegex(PREPARE.ReleasePreparationError, "simulated"):
                PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertFalse(self.candidate_ebuild().exists())
        self.assertFalse(self.candidate_patch().exists())

    def test_rolls_back_ebuild_when_os_open_fails_for_patch(self) -> None:
        before = self.file_snapshot()
        original_open = PREPARE.os.open

        def fail_target_patch(path: Path, flags: int, mode: int) -> int:
            if Path(path) == self.candidate_patch():
                raise PermissionError("simulated patch creation failure")
            return original_open(path, flags, mode)

        with patch.object(PREPARE.os, "open", side_effect=fail_target_patch):
            with self.assertRaisesRegex(PREPARE.ReleasePreparationError, "Could not create"):
                PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertFalse(self.candidate_ebuild().exists())
        self.assertFalse(self.candidate_patch().exists())
        self.assertEqual(self.file_snapshot(), before)
