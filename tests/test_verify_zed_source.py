from __future__ import annotations

import io
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import verify_zed_source as source


class SourceArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.archive = Path(self.temp.name) / 'source.tar.gz'
        self.expected = {
            'Cargo.lock': ('100644', source.blob_hash(b'locked')),
            'bin/tool': ('100755', source.blob_hash(b'run')),
            'link': ('120000', source.blob_hash(b'Cargo.lock')),
        }

    def make_archive(self, *, lock: bytes = b'locked', executable: bool = True,
                     link: str = 'Cargo.lock', omit_lock: bool = False,
                     extra: str | None = None) -> None:
        with tarfile.open(self.archive, 'w:gz') as tar:
            directory = tarfile.TarInfo('zed-1.2.3')
            directory.type = tarfile.DIRTYPE
            tar.addfile(directory)
            files = [('Cargo.lock', lock, 0o644), ('bin/tool', b'run', 0o755 if executable else 0o644)]
            for path, content, mode in files:
                if path == 'Cargo.lock' and omit_lock:
                    continue
                item = tarfile.TarInfo('zed-1.2.3/' + path)
                item.mode = mode
                item.size = len(content)
                tar.addfile(item, io.BytesIO(content))
            item = tarfile.TarInfo('zed-1.2.3/link')
            item.type = tarfile.SYMTYPE
            item.linkname = link
            tar.addfile(item)
            if extra:
                item = tarfile.TarInfo(extra)
                item.size = 1
                tar.addfile(item, io.BytesIO(b'x'))

    def test_matching_tree_passes(self) -> None:
        self.make_archive()
        source.verify_archive(self.archive, 'zed-1.2.3', self.expected)

    def test_rejects_changed_content_mode_symlink_or_missing_file(self) -> None:
        for args in ({'lock': b'changed'}, {'executable': False}, {'link': '../outside'}, {'omit_lock': True}):
            with self.subTest(args=args):
                self.make_archive(**args)
                with self.assertRaises(source.SourceVerificationError):
                    source.verify_archive(self.archive, 'zed-1.2.3', self.expected)

    def test_rejects_extra_unsafe_and_duplicate_paths(self) -> None:
        for path in ('zed-1.2.3/extra', 'zed-1.2.3/../escape', 'zed-1.2.3/Cargo.lock', 'other/file'):
            with self.subTest(path=path):
                self.make_archive(extra=path)
                with self.assertRaises(source.SourceVerificationError):
                    source.verify_archive(self.archive, 'zed-1.2.3', self.expected)

    def test_git_tree_uses_exact_commit_and_rejects_submodules(self) -> None:
        result = subprocess.CompletedProcess([], 0, stdout=b'100644 blob ' + b'a' * 40 + b'\tCargo.lock\0')
        with patch.object(source.subprocess, 'run', return_value=result) as run:
            self.assertEqual(source.git_tree(Path('/checkout'), 'b' * 40), {'Cargo.lock': ('100644', 'a' * 40)})
            self.assertEqual(run.call_args.args[0][-1], 'b' * 40)
        result.stdout = b'160000 commit ' + b'a' * 40 + b'\tmodule\0'
        with patch.object(source.subprocess, 'run', return_value=result):
            with self.assertRaises(source.SourceVerificationError):
                source.git_tree(Path('/checkout'), 'b' * 40)

    def test_real_git_tree_object_matches_archive(self) -> None:
        repository = Path(self.temp.name) / 'objects.git'
        subprocess.run(['git', 'init', '--bare', '-q', str(repository)], check=True)
        blob = subprocess.run(['git', '-C', str(repository), 'hash-object', '-w', '--stdin'],
                              input=b'locked', stdout=subprocess.PIPE, check=True).stdout.strip()
        tree = subprocess.run(['git', '-C', str(repository), 'mktree'],
                              input=b'100644 blob ' + blob + b'\tCargo.lock\n',
                              stdout=subprocess.PIPE, check=True).stdout.decode().strip()
        with tarfile.open(self.archive, 'w:gz') as tar:
            entry = tarfile.TarInfo('zed-1.2.3/Cargo.lock')
            entry.size = 6
            tar.addfile(entry, io.BytesIO(b'locked'))
        expected = source.git_tree(repository, tree)
        source.verify_archive(self.archive, 'zed-1.2.3', expected)


if __name__ == '__main__':
    unittest.main()
