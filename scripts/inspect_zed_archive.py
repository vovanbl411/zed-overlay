"""Inspect a generated registry archive or compare it with a Portage Manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tarfile
import tomllib
from pathlib import Path


def digest(path: Path, algorithm: str) -> str:
    h = hashlib.new(algorithm)
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inspect(archive: Path, lock: Path) -> int:
    subprocess.run(['xz', '-t', str(archive)], check=True)
    with lock.open('rb') as f:
        packages = tomllib.load(f)['package']
    expected = {f"{p['name']}-{p['version']}": p['checksum'] for p in packages
                if p.get('source', '').startswith('registry+')}
    found: set[str] = set()
    checks: dict[str, str] = {}
    with tarfile.open(archive, 'r|xz') as tar:
        for member in tar:
            parts = member.name.split('/')
            if (len(parts) < 4 or parts[:2] != ['cargo_home', 'gentoo'] or
                    any(part in ('', '.', '..') for part in parts) or not member.isfile() or
                    member.name in found):
                raise ValueError(f'Unsafe or duplicate archive member: {member.name}')
            found.add(member.name)
            if parts[-1] == '.cargo-checksum.json':
                if len(parts) != 4 or parts[2] in checks or member.size > 100_000:
                    raise ValueError(f'Invalid crate checksum record: {member.name}')
                f = tar.extractfile(member)
                assert f is not None
                checks[parts[2]] = json.load(f)['package']
    crates = {name.split('/')[2] for name in found}
    if crates != expected.keys() or checks != expected:
        raise ValueError('Archive registry crate names or package checksums differ from Cargo.lock')
    print(f'Registry crate count: {len(crates)}')
    print(f'Archive size: {archive.stat().st_size} bytes')
    print(f'Archive SHA256: {digest(archive, "sha256")}')
    return len(crates)


def verify_manifest(archive: Path, manifest: Path) -> None:
    records = [line.split() for line in manifest.read_text().splitlines()
               if line.startswith(f'DIST {archive.name} ')]
    if len(records) != 1:
        raise ValueError('Manifest must contain exactly one generated archive record')
    record = records[0]
    if len(record) != 7 or int(record[2]) != archive.stat().st_size:
        raise ValueError('Manifest size or digest fields are invalid')
    checks = dict(zip(record[3::2], record[4::2]))
    if set(checks) != {'BLAKE2B', 'SHA512'}:
        raise ValueError('Manifest must contain BLAKE2B and SHA512 digests')
    for name, expected in checks.items():
        if digest(archive, name.lower()) != expected.lower():
            raise ValueError(f'Manifest {name} mismatch')
    print('Generated archive Manifest digests: OK')


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--lock', type=Path)
    group.add_argument('--manifest', type=Path)
    args = p.parse_args()
    try:
        if args.lock:
            inspect(args.archive, args.lock)
        else:
            verify_manifest(args.archive, args.manifest)
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as e:
        print(f'Archive validation failed: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
