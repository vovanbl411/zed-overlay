from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "check_zed_cargo_snapshot.py"
EBUILD_PATHS = tuple(
    path
    for path in (Path(__file__).parents[1] / "app-editors" / "zed").glob("zed-*.ebuild")
    if "git_crate_commit()" in path.read_text(encoding="utf-8")
)
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
\tlocal EXAMPLE_COMMIT
\tgit_crate_commit example EXAMPLE_COMMIT
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

    def run_ebuild_commit_helper(self, ebuild_text: str, crate: str) -> subprocess.CompletedProcess[str]:
        git_crates = re.search(
            r"declare -A GIT_CRATES=\(.*?^\)\n", ebuild_text, flags=re.MULTILINE | re.DOTALL
        )
        helper = re.search(
            r"\tgit_crate_commit\(\) \{.*?^\t}\n", ebuild_text, flags=re.MULTILINE | re.DOTALL
        )
        assert git_crates is not None
        assert helper is not None
        script = (
            git_crates.group(0)
            + "die() { exit 1; }\n"
            + helper.group(0)
            + f"result=\ngit_crate_commit {crate} result\nprintf '%s' \"${{result}}\"\n"
        )
        return subprocess.run(["bash", "-c", script], text=True, capture_output=True, check=False)

    def test_accepts_matching_snapshot(self) -> None:
        self.validate()

    def test_ebuild_helper_extracts_commit_from_git_crates(self) -> None:
        self.assertTrue(EBUILD_PATHS)
        for ebuild_path in EBUILD_PATHS:
            ebuild_text = ebuild_path.read_text(encoding="utf-8")
            expected = CHECKER.parse_git_crates(ebuild_text)["async-process"].commit

            result = self.run_ebuild_commit_helper(ebuild_text, "async-process")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, expected)

    def test_ebuild_helper_fails_closed_for_missing_or_malformed_entry(self) -> None:
        self.assertTrue(EBUILD_PATHS)
        ebuild_text = EBUILD_PATHS[0].read_text(encoding="utf-8")

        missing = self.run_ebuild_commit_helper(
            ebuild_text.replace("\t[async-process]=", "\t[removed-async-process]=", 1), "async-process"
        )
        malformed = self.run_ebuild_commit_helper(
            ebuild_text.replace(";async-process-%commit%'", "'", 1), "async-process"
        )
        extra_field = self.run_ebuild_commit_helper(
            ebuild_text.replace(";async-process-%commit%'", ";async-process-%commit%;extra'", 1),
            "async-process",
        )

        self.assertNotEqual(missing.returncode, 0)
        self.assertNotEqual(malformed.returncode, 0)
        self.assertNotEqual(extra_field.returncode, 0)

    def test_ebuild_offline_substitutions_are_formed_from_git_crates(self) -> None:
        self.assertTrue(EBUILD_PATHS)
        expected_crates = {
            "async-process",
            "async-task",
            "calloop",
            "libwebrtc",
            "livekit",
            "notify",
            "notify-types",
            "tree-sitter-language",
            "webrtc-sys",
            "windows-capture",
        }
        for ebuild_path in EBUILD_PATHS:
            ebuild_text = ebuild_path.read_text(encoding="utf-8")
            git_crates = CHECKER.parse_git_crates(ebuild_text)
            substitutions = CHECKER.parse_offline_substitutions(ebuild_text, git_crates)

            self.assertEqual({item.crate for item in substitutions}, expected_crates)
            for substitution in substitutions:
                self.assertEqual(substitution.commit, git_crates[substitution.crate].commit)

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

    def test_rejects_offline_commit_source_without_git_crates_entry(self) -> None:
        ebuild = self.ebuild.read_text(encoding="utf-8")
        self.ebuild.write_text(
            ebuild.replace("git_crate_commit example EXAMPLE_COMMIT", "git_crate_commit absent EXAMPLE_COMMIT"),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(CHECKER.CargoSnapshotError, "references missing GIT_CRATES entry"):
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
