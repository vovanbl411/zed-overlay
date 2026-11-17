from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import inspect_zed_archive as inspect


class ArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.archive = self.root / 'zed-1.2.3-overlay-crates.tar.xz'
        self.lock = self.root / 'Cargo.lock'
        self.lock.write_text('version = 4\n[[package]]\nname = "example"\nversion = "1.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "abc"\n')

    def create_archive(self, checksum: str = 'abc', extra: str | None = None) -> None:
        with tarfile.open(self.archive, 'w:xz') as tar:
            files = {'cargo_home/gentoo/example-1.0/Cargo.toml': b'[package]',
                     'cargo_home/gentoo/example-1.0/.cargo-checksum.json': json.dumps({'package': checksum, 'files': {}}).encode()}
            if extra:
                files[extra] = b'bad'
            for name, data in files.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                tar.addfile(item, io.BytesIO(data))

    def test_archive_identity_and_checksum(self) -> None:
        self.create_archive()
        self.assertEqual(inspect.inspect(self.archive, self.lock), 1)
        self.create_archive('wrong')
        with self.assertRaises(ValueError):
            inspect.inspect(self.archive, self.lock)
        self.create_archive(extra='cargo_home/gentoo/../escape')
        with self.assertRaises(ValueError):
            inspect.inspect(self.archive, self.lock)

    def test_manifest_digest_mismatch(self) -> None:
        self.create_archive()
        data = self.archive.read_bytes()
        manifest = self.root / 'Manifest'
        manifest.write_text(f'DIST {self.archive.name} {len(data)} BLAKE2B {hashlib.blake2b(data).hexdigest()} SHA512 {hashlib.sha512(data).hexdigest()}\n')
        inspect.verify_manifest(self.archive, manifest)
        manifest.write_text(manifest.read_text().replace(hashlib.sha512(data).hexdigest(), '0' * 128))
        with self.assertRaisesRegex(ValueError, 'SHA512 mismatch'):
            inspect.verify_manifest(self.archive, manifest)


if __name__ == '__main__':
    unittest.main()
