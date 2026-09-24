from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "check_zed_cargo_snapshot.py"
SPEC = importlib.util.spec_from_file_location("check_zed_cargo_snapshot", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
CHECKER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CHECKER
SPEC.loader.exec_module(CHECKER)


COMMIT = "a" * 40
OTHER_COMMIT = "b" * 40
REPOSITORY = "https://github.com/example/repository"
OTHER_REPOSITORY = "https://github.com/example/other"


def write_fixture(root: Path) -> tuple[Path, Path]:
    ebuild = root / "zed.ebuild"
    source = root / "source"
    source.mkdir()
    ebuild.write_text(
        f'''declare -A GIT_CRATES=(
\t[example]='{REPOSITORY};{COMMIT};repository-%commit%'
)

src_prepare() {{
\tlocal EXAMPLE_COMMIT="{COMMIT}"
\tlocal EXAMPLE_GIT="example = {{ git = \\"{REPOSITORY}.git\\", rev = \\"${{EXAMPLE_COMMIT}}\\""
\tlocal EXAMPLE_PATH="example = {{ path = \\"${{WORKDIR}}/repository-${{EXAMPLE_COMMIT}}\\""
}}
''',
        encoding="utf-8",
    )
    (source / "Cargo.lock").write_text(
        f'''version = 4

[[package]]
name = "example"
version = "1.0.0"
source = "git+{REPOSITORY}.git?rev={COMMIT}#{COMMIT}"
''',
        encoding="utf-8",
    )
    (source / "Cargo.toml").write_text(
        f'''[patch.crates-io]
example = {{ git = "{REPOSITORY}.git", rev = "{COMMIT}" }}
''',
        encoding="utf-8",
    )
    return ebuild, source


class CargoSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.ebuild, self.source = write_fixture(self.root)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def validate(self) -> None:
        CHECKER.validate(self.ebuild, self.source)

    def test_accepts_matching_snapshot(self) -> None:
        self.validate()

    def test_rejects_upstream_revision_change(self) -> None:
        lock = self.source / "Cargo.lock"
        lock.write_text(lock.read_text(encoding="utf-8").replace(COMMIT, OTHER_COMMIT), encoding="utf-8")

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "revision differs"):
            self.validate()

    def test_rejects_new_upstream_git_dependency(self) -> None:
        with (self.source / "Cargo.lock").open("a", encoding="utf-8") as lock:
            lock.write(
                f'''\n[[package]]
name = "new-crate"
version = "1.0.0"
source = "git+https://github.com/example/new?rev={COMMIT}#{COMMIT}"
'''
            )

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "new-crate.*missing"):
            self.validate()

    def test_rejects_removed_upstream_git_dependency(self) -> None:
        (self.source / "Cargo.lock").write_text(
            "version = 4\npackage = []\n", encoding="utf-8"
        )

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "example.*absent"):
            self.validate()

    def test_rejects_repository_mismatch(self) -> None:
        lock = self.source / "Cargo.lock"
        lock.write_text(lock.read_text(encoding="utf-8").replace(REPOSITORY, OTHER_REPOSITORY), encoding="utf-8")

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "repository differs"):
            self.validate()

    def test_rejects_offline_substitution_commit_mismatch(self) -> None:
        ebuild = self.ebuild.read_text(encoding="utf-8")
        self.ebuild.write_text(
            ebuild.replace('local EXAMPLE_COMMIT="' + COMMIT + '"', 'local EXAMPLE_COMMIT="' + OTHER_COMMIT + '"'),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "offline substitution differs"):
            self.validate()

    def test_rejects_missing_offline_declaration(self) -> None:
        (self.source / "Cargo.toml").write_text("[patch.crates-io]\n", encoding="utf-8")

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "absent from upstream Cargo.toml"):
            self.validate()

    def test_rejects_malformed_git_crates_entry(self) -> None:
        self.ebuild.write_text(
            self.ebuild.read_text(encoding="utf-8").replace(";repository-%commit%", ""),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "Malformed GIT_CRATES"):
            self.validate()
