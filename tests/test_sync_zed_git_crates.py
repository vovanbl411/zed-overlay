from __future__ import annotations

import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import sync_zed_git_crates as sync
import check_zed_cargo_snapshot as check

A = 'a' * 40
B = 'b' * 40
REPO = 'https://github.com/example/repo'


def entry(name: str, revision: str = A, path: str = 'repo-%commit%') -> str:
    return f"\t[{name}]='{REPO};{revision};{path}'\n"


def declaration(*entries: str) -> str:
    return 'declare -A GIT_CRATES=(\n' + ''.join(entries) + ')\n'


class SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.cache = self.root / 'cache'
        self.cache.mkdir()
        self.candidate = self.root / 'candidate.ebuild'
        self.generated = self.root / 'generated.ebuild'
        (self.source / 'Cargo.toml').write_text('[workspace]\n')
        (self.source / 'corgi.toml').write_text('[tools.webrtc-prebuilt]\nversion = "x"\n')
        self.candidate.write_text('before\n' + declaration(entry('old')) + 'WEBRTC_COMMIT="x"\nafter\n')

    def setup_generated(self, names: list[str], revision: str = B) -> None:
        self.generated.write_text(declaration(*(entry(name, revision, f'repo-%commit%/{name}') for name in names)))
        (self.source / 'Cargo.lock').write_text('version = 4\n' + ''.join(
            f'[[package]]\nname = "{name}"\nversion = "1.0.0"\nsource = "git+{REPO}?rev={revision}#{revision}"\n'
            for name in names))
        with tarfile.open(self.cache / f'repo-{revision}.gh.tar.gz', 'w:gz') as tar:
            for name in names:
                data = f'[package]\nname = "{name}"\n'.encode()
                info = tarfile.TarInfo(f'repo-{revision}/{name}/Cargo.toml')
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

    def run_sync(self) -> int:
        return sync.sync(self.candidate, self.generated, self.source, self.cache)

    def test_revision_additions_removals_and_preservation(self) -> None:
        self.setup_generated(['new', 'second'])
        before = self.candidate.read_text()
        self.assertEqual(self.run_sync(), 2)
        after = self.candidate.read_text()
        start, end, _ = sync.block(before)
        new_start, new_end, _ = sync.block(after)
        self.assertEqual(before[:start], after[:new_start])
        self.assertEqual(before[end:], after[new_end:])
        self.assertNotIn('[old]', after)
        self.assertIn(entry('new', B, 'repo-%commit%/new'), after)

    def test_existing_dependency_revision_is_updated(self) -> None:
        self.setup_generated(['old'])
        self.assertIn(A, self.candidate.read_text())
        self.assertEqual(self.run_sync(), 1)
        self.assertIn(entry('old', B, 'repo-%commit%/old'), self.candidate.read_text())
        self.assertNotIn(A, self.candidate.read_text())

    def test_rejects_malformed_duplicate_and_unsafe(self) -> None:
        self.setup_generated(['new'])
        good = self.generated.read_text()
        for bad in (good.replace("[new]=", "[new]=bad"),
                    good.replace(')\n', entry('new', B, 'repo-%commit%/new') + ')\n'),
                    good.replace('repo-%commit%/new', 'repo-%commit%/../new'),
                    good.replace('repo-%commit%/new', 'repo-%commit%/$(touch-x)')):
            with self.subTest(bad=bad):
                self.generated.write_text(bad)
                before = self.candidate.read_bytes()
                with self.assertRaises(check.CargoSnapshotError):
                    self.run_sync()
                self.assertEqual(before, self.candidate.read_bytes())

    def test_rejects_lock_mismatch_and_wrong_crate_identity(self) -> None:
        self.setup_generated(['new'])
        (self.source / 'Cargo.lock').write_text((self.source / 'Cargo.lock').read_text().replace(B, A))
        with self.assertRaises(check.CargoSnapshotError):
            self.run_sync()
        self.setup_generated(['new'])
        with tarfile.open(self.cache / f'repo-{B}.gh.tar.gz', 'w:gz') as tar:
            data = b'[package]\nname = "wrong"\n'
            info = tarfile.TarInfo(f'repo-{B}/new/Cargo.toml')
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        with self.assertRaisesRegex(check.CargoSnapshotError, 'identity mismatch'):
            self.run_sync()

    def test_rejects_duplicate_block(self) -> None:
        self.setup_generated(['new'])
        self.generated.write_text(self.generated.read_text() * 2)
        with self.assertRaisesRegex(check.CargoSnapshotError, 'exactly one'):
            self.run_sync()

    def test_rejects_webrtc_drift_without_modifying_candidate(self) -> None:
        self.setup_generated(['new'])
        (self.source / 'corgi.toml').write_text('[tools.webrtc-prebuilt]\nversion = "changed"\n')
        original = self.candidate.read_bytes()
        with self.assertRaisesRegex(check.CargoSnapshotError, 'WEBRTC_COMMIT differs'):
            self.run_sync()
        self.assertEqual(original, self.candidate.read_bytes())


if __name__ == '__main__':
    unittest.main()
