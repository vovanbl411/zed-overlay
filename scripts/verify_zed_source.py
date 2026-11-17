"""Verify an upstream source archive against the exact Git commit tree."""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tarfile
from pathlib import Path, PurePosixPath


class SourceVerificationError(ValueError):
    """The archive is not the expected Git tree."""


def git_tree(checkout: Path, commit: str) -> dict[str, tuple[str, str]]:
    result = subprocess.run(
        ['git', '-C', str(checkout), 'ls-tree', '-r', '-z', '--full-tree', commit],
        check=True, stdout=subprocess.PIPE,
    )
    entries: dict[str, tuple[str, str]] = {}
    for item in result.stdout.split(b'\0'):
        if not item:
            continue
        metadata, name = item.split(b'\t', 1)
        mode, kind, object_id = metadata.decode('ascii').split(' ')
        path = name.decode('utf-8')
        if kind != 'blob' or mode not in ('100644', '100755', '120000'):
            raise SourceVerificationError(f'Unsupported Git tree entry: {path!r}')
        if path in entries:
            raise SourceVerificationError(f'Duplicate Git tree entry: {path!r}')
        entries[path] = (mode, object_id)
    if not entries:
        raise SourceVerificationError('Git commit tree is empty')
    return entries


def blob_hash(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()


def verify_archive(archive: Path, root: str, expected: dict[str, tuple[str, str]]) -> None:
    seen: set[str] = set()
    directories: set[str] = {root}
    for path in expected:
        parent = PurePosixPath(root, path).parent
        while str(parent) != '.':
            directories.add(str(parent))
            parent = parent.parent
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            name = member.name.rstrip('/')
            parts = name.split('/')
            if (not name or name in seen or parts[0] != root or
                    any(part in ('', '.', '..') for part in parts)):
                raise SourceVerificationError(f'Unsafe or duplicate archive member: {member.name!r}')
            seen.add(name)
            if member.isdir():
                if name not in directories:
                    raise SourceVerificationError(f'Unexpected archive directory: {name!r}')
                continue
            if len(parts) < 2:
                raise SourceVerificationError(f'Unexpected archive member: {name!r}')
            path = '/'.join(parts[1:])
            if path not in expected:
                raise SourceVerificationError(f'Unexpected archive path: {path!r}')
            mode, object_id = expected[path]
            if mode == '120000' and member.issym():
                data = member.linkname.encode('utf-8')
            elif mode in ('100644', '100755') and member.isfile():
                if bool(member.mode & 0o111) != (mode == '100755'):
                    raise SourceVerificationError(f'Executable mode differs: {path!r}')
                f = tar.extractfile(member)
                if f is None:
                    raise SourceVerificationError(f'Cannot read archive member: {path!r}')
                hasher = hashlib.sha1(b'blob ' + str(member.size).encode('ascii') + b'\0')
                for chunk in iter(lambda: f.read(1024 * 1024), b''):
                    hasher.update(chunk)
                if hasher.hexdigest() != object_id:
                    raise SourceVerificationError(f'Git blob differs: {path!r}')
                continue
            else:
                raise SourceVerificationError(f'File type differs: {path!r}')
            if blob_hash(data) != object_id:
                raise SourceVerificationError(f'Git blob differs: {path!r}')
    missing = set(expected) - {name[len(root) + 1:] for name in seen if name.startswith(root + '/')}
    if missing:
        raise SourceVerificationError(f'Archive is missing Git paths: {sorted(missing)[:5]!r}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    try:
        verify_archive(args.archive, args.root, git_tree(args.checkout, args.commit))
    except (OSError, UnicodeError, ValueError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f'Source archive verification failed: {error}', file=sys.stderr)
        return 1
    print('Source archive matches the upstream Git commit tree: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
