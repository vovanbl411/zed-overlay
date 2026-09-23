from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIRECTORY = str(Path(__file__).parents[1] / "scripts")
if SCRIPTS_DIRECTORY not in sys.path:
    sys.path.insert(0, SCRIPTS_DIRECTORY)

from overlay_policy import OverlayPolicyError, validate_overlay


REPOSITORY_ROOT = Path(__file__).parents[1]
VALID_PATCH = """\
diff --git a/Cargo.toml b/Cargo.toml
index 1111111..2222222 100644
--- a/Cargo.toml
+++ b/Cargo.toml
-gpui = { workspace = true, features = [\"screen-capture\", \"x11\", \"wayland\"] }
+gpui = { workspace = true, features = [\"wayland\"] }
"""


def create_overlay(root: Path) -> None:
    (root / "profiles").mkdir(parents=True)
    (root / "profiles/repo_name").write_text("zed-overlay\n", encoding="utf-8")
    (root / "metadata").mkdir()
    (root / "metadata/layout.conf").write_text(
        "masters = gentoo\nthin-manifests = true\n", encoding="utf-8"
    )
    package_dir = root / "app-editors/zed"
    (package_dir / "files").mkdir(parents=True)
    (package_dir / "metadata.xml").write_text("<pkgmetadata />\n", encoding="utf-8")
    (package_dir / "Manifest").write_text("DIST placeholder 0 BLAKE2B deadbeef\n", encoding="utf-8")
    (package_dir / "zed-1.15.0.ebuild").write_text(
        'PATCHES=( "${FILESDIR}/${P}-wayland-only.patch" )\n', encoding="utf-8"
    )
    (package_dir / "files/zed-1.15.0-wayland-only.patch").write_text(
        VALID_PATCH, encoding="utf-8"
    )


class OverlayPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        create_overlay(self.root)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_policy_accepts_current_repository(self) -> None:
        ebuilds = validate_overlay(REPOSITORY_ROOT)

        self.assertTrue(ebuilds)

    def test_policy_rejects_wrong_repository_name(self) -> None:
        (self.root / "profiles/repo_name").write_text("other-overlay\n", encoding="utf-8")

        with self.assertRaisesRegex(OverlayPolicyError, "profiles/repo_name"):
            validate_overlay(self.root, tracked_paths=())

    def test_policy_rejects_wrong_layout_setting(self) -> None:
        (self.root / "metadata/layout.conf").write_text(
            "masters = gentoo\nthin-manifests = false\n", encoding="utf-8"
        )

        with self.assertRaisesRegex(OverlayPolicyError, "thin-manifests"):
            validate_overlay(self.root, tracked_paths=())

    def test_policy_rejects_missing_manifest(self) -> None:
        (self.root / "app-editors/zed/Manifest").unlink()

        with self.assertRaisesRegex(OverlayPolicyError, "Manifest"):
            validate_overlay(self.root, tracked_paths=())

    def test_policy_rejects_tracked_md5_cache(self) -> None:
        with self.assertRaisesRegex(OverlayPolicyError, "metadata/md5-cache"):
            validate_overlay(self.root, tracked_paths={"metadata/md5-cache/zed-1.15.0"})

    def test_policy_rejects_patch_that_restores_x11(self) -> None:
        patch_path = self.root / "app-editors/zed/files/zed-1.15.0-wayland-only.patch"
        patch_path.write_text(
            VALID_PATCH + '+gpui_platform = { features = ["x11"] }\n', encoding="utf-8"
        )

        with self.assertRaisesRegex(OverlayPolicyError, "x11"):
            validate_overlay(self.root, tracked_paths=())
