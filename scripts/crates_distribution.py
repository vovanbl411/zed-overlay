"""Validate the data-only distribution bundle for a Zed crates release."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path

import check_zed_cargo_snapshot as snapshot
import inspect_zed_archive as inspector
import release_handoff
import sync_zed_git_crates as sync

VERSION = re.compile(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)')
SHA256 = re.compile(r'[0-9a-f]{64}')
SHA1 = re.compile(r'[0-9a-f]{40}')
LICENSE = re.compile(r'[A-Za-z0-9.+_?()| -]+')
LEGACY_URI = 'https://github.com/gentoo-crate-dist/zed/releases/download/v${PV/_/-}/${P/_/-}-crates.tar.xz'
OVERLAY_URI = 'https://github.com/vovanbl411/zed-overlay/releases/download/crates-v${PV/_/-}/${P/_/-}-overlay-crates.tar.xz'
SOURCE_URI = 'https://github.com/zed-industries/zed/archive/refs/tags/v${PV/_/-}.tar.gz -> ${P}.tar.gz'


def names(version: str) -> tuple[str, str]:
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError('Invalid Zed version')
    base = f'zed-{version}-overlay-crates'
    return base + '.tar.xz', base + '.json'


def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    obj: dict[str, object] = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError(f'Duplicate JSON field: {key}')
        obj[key] = value
    return obj


def sha256(path: Path) -> str:
    return inspector.digest(path, 'sha256')


def regular(path: Path) -> None:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f'Expected regular file: {path}')


def validate_metadata(data: object, version: str) -> dict:
    archive_name, _ = names(version)
    keys = {'schema_version', 'zed_version', 'upstream_tag', 'upstream_commit',
            'source_sha256', 'cargo_lock_sha256', 'generator', 'archive', 'git_crates', 'licenses'}
    if not isinstance(data, dict) or set(data) != keys:
        raise ValueError('Metadata fields do not match schema')
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ValueError('Unsupported metadata schema version')
    if data['zed_version'] != version or data['upstream_tag'] != f'v{version}':
        raise ValueError('Metadata release identity mismatch')
    for key, pattern in (('upstream_commit', SHA1), ('source_sha256', SHA256), ('cargo_lock_sha256', SHA256)):
        if not isinstance(data[key], str) or not pattern.fullmatch(data[key]):
            raise ValueError(f'Invalid {key}')
    if data['generator'] != {'name': 'pycargoebuild', 'version': '0.16.0'}:
        raise ValueError('Unsupported generator')
    archive = data['archive']
    if (not isinstance(archive, dict) or set(archive) != {'filename', 'size', 'sha256'} or
        archive['filename'] != archive_name or type(archive['size']) is not int or archive['size'] <= 0 or
        not isinstance(archive['sha256'], str) or not SHA256.fullmatch(archive['sha256'])):
        raise ValueError('Invalid archive metadata')
    crates = data['git_crates']
    if not isinstance(crates, list) or not crates:
        raise ValueError('Missing Git crate metadata')
    for entry in crates:
        if (not isinstance(entry, dict) or set(entry) != {'name', 'repository', 'revision', 'unpack_path'} or
                any(not isinstance(v, str) for v in entry.values())):
            raise ValueError('Invalid Git crate record')
    try:
        normalized = sync.parse_entries(sync.entries_block(crates))
    except (ValueError, snapshot.CargoSnapshotError) as error:
        raise ValueError(f'Invalid Git crate metadata: {error}') from error
    if normalized != crates or len({x['name'] for x in crates}) != len(crates):
        raise ValueError('Duplicate or noncanonical Git crate metadata')
    licenses = data['licenses']
    if (not isinstance(licenses, list) or not licenses or
            any(not isinstance(x, str) or len(x) > 10000 or not LICENSE.fullmatch(x)
                or x != ' '.join(x.split()) for x in licenses)
            or licenses != sorted(set(licenses))):
        raise ValueError('Invalid license metadata')
    return data


def read_metadata(path: Path, version: str) -> dict:
    regular(path)
    if path.stat().st_size > 1_000_000:
        raise ValueError('Metadata is too large')
    return validate_metadata(json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object), version)


def create_metadata(version: str, commit: str, source: Path, source_archive: Path, lock: Path,
                    archive: Path, generated: Path, cache: Path) -> dict:
    archive_name, _ = names(version)
    if archive.name != archive_name:
        raise ValueError('Archive filename mismatch')
    text = generated.read_text(encoding='utf-8')
    sync.validate_sources(text, source, cache)
    data = {'schema_version': 1, 'zed_version': version, 'upstream_tag': f'v{version}',
            'upstream_commit': commit, 'source_sha256': sha256(source_archive),
            'cargo_lock_sha256': sha256(lock), 'generator': {'name': 'pycargoebuild', 'version': '0.16.0'},
            'archive': {'filename': archive.name, 'size': archive.stat().st_size, 'sha256': sha256(archive)},
            'git_crates': sync.parse_entries(text), 'licenses': license_expressions(text)}
    return validate_metadata(data, version)


def license_expressions(text: str) -> list[str]:
    """Preserve each generated Gentoo license expression for manual review."""
    values = re.findall(r'^LICENSE\+?="([^"]*)"', text, re.MULTILINE)
    return sorted({' '.join(value.split()) for value in values if value.strip()})


def validate_archive(data: dict, archive: Path) -> None:
    regular(archive)
    if archive.name != data['archive']['filename'] or archive.stat().st_size != data['archive']['size'] or sha256(archive) != data['archive']['sha256']:
        raise ValueError('Archive does not match metadata')


def validate_identity(data: dict, commit: str, source_archive: Path, lock: Path) -> None:
    if (data['upstream_commit'] != commit or data['source_sha256'] != sha256(source_archive) or
            data['cargo_lock_sha256'] != sha256(lock)):
        raise ValueError('Upstream commit, source archive or Cargo.lock mismatch')
    expected = snapshot.parse_lock(lock)
    actual = snapshot.parse_git_crates(sync.entries_block(data['git_crates']))
    errors = snapshot.compare_snapshots(expected, actual)
    if errors:
        raise ValueError('\n'.join(errors))


def validate_uri(text: str, *, allow_legacy: bool) -> None:
    assignments = re.findall(r'^\s*SRC_URI\s*\+?=', text, re.MULTILINE)
    blocks = re.findall(r'^SRC_URI="([^\"]*)"', text, re.MULTILINE)
    if len(assignments) != 1 or len(blocks) != 1:
        raise ValueError('Expected exactly one simple SRC_URI assignment')
    lines = [line.strip() for line in blocks[0].splitlines()]
    if lines.count(SOURCE_URI) != 1:
        raise ValueError('Upstream source SRC_URI mismatch')
    legacy, migrated = text.count(LEGACY_URI), text.count(OVERLAY_URI)
    allowed = ((1, 0), (0, 1)) if allow_legacy else ((0, 1),)
    if (legacy, migrated) not in allowed:
        raise ValueError('Unexpected candidate crates SRC_URI')
    expected = LEGACY_URI if legacy else OVERLAY_URI
    if lines.count(expected) != 1:
        raise ValueError('Candidate crates URL is not an SRC_URI entry')


def rewrite_uri(candidate: Path) -> None:
    text = candidate.read_text(encoding='utf-8')
    validate_uri(text, allow_legacy=True)
    updated = text.replace(LEGACY_URI, OVERLAY_URI)
    if 'gentoo-crate-dist/zed' in updated:
        raise ValueError('Unexpected legacy crates source')
    validate_uri(updated, allow_legacy=False)
    candidate.write_text(updated, encoding='utf-8')


def manifest_records(path: Path) -> dict[str, str]:
    records: dict[str, str] = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[0] != 'DIST' or parts[1] in records:
            raise ValueError('Malformed or duplicate Manifest entry')
        records[parts[1]] = line
    return records


def preserve_manifest(before: Path, after: Path) -> None:
    old, new = manifest_records(before), manifest_records(after)
    for name, line in old.items():
        if new.get(name) != line:
            raise ValueError(f'Existing Manifest distfile changed: {name}')


def validate_bundle(bundle: Path, handoff: Path, base_commit: str, base_manifest: Path,
                    metadata_sha256: str) -> dict:
    meta = release_handoff.validate_release_handoff(handoff, expected_base_commit=base_commit)
    version = meta['candidate_version']
    archive_name, metadata_name = names(version)
    if not stat.S_ISDIR(bundle.lstat().st_mode) or {p.name for p in bundle.iterdir()} != {archive_name, metadata_name}:
        raise ValueError('Distribution bundle has unexpected files')
    if not SHA256.fullmatch(metadata_sha256):
        raise ValueError('Invalid expected metadata digest')
    data = read_metadata(bundle / metadata_name, version)
    if sha256(bundle / metadata_name) != metadata_sha256:
        raise ValueError('Metadata digest mismatch')
    validate_archive(data, bundle / archive_name)
    candidate = (handoff / meta['candidate_ebuild_path']).read_text(encoding='utf-8')
    validate_uri(candidate, allow_legacy=False)
    if 'gentoo-crate-dist/zed' in candidate:
        raise ValueError('Candidate retains legacy crates source')
    if sync.parse_entries(candidate) != data['git_crates']:
        raise ValueError('Candidate GIT_CRATES disagrees with metadata')
    inspector.verify_manifest(bundle / archive_name, handoff / meta['manifest_path'])
    regular(base_manifest)
    preserve_manifest(base_manifest, handoff / meta['manifest_path'])
    return data


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    create = sub.add_parser('create')
    for name in ('version', 'commit', 'source', 'source-archive', 'lock', 'archive', 'generated', 'cache', 'output'):
        create.add_argument('--' + name, required=True)
    identity = sub.add_parser('identity')
    for name in ('version', 'commit', 'source-archive', 'lock', 'archive', 'metadata'):
        identity.add_argument('--' + name, required=True)
    rewrite = sub.add_parser('rewrite-uri')
    rewrite.add_argument('candidate', type=Path)
    bundle = sub.add_parser('bundle')
    for name in ('bundle', 'handoff', 'base-commit', 'base-manifest', 'metadata-sha256'):
        bundle.add_argument('--' + name, required=True)
    preserve = sub.add_parser('preserve-manifest')
    preserve.add_argument('before', type=Path)
    preserve.add_argument('after', type=Path)
    args = p.parse_args()
    try:
        if args.action == 'create':
            data = create_metadata(args.version, args.commit, Path(args.source), Path(args.source_archive), Path(args.lock), Path(args.archive), Path(args.generated), Path(args.cache))
            Path(args.output).write_text(json.dumps(data, sort_keys=True, indent=2) + '\n', encoding='utf-8')
        elif args.action == 'identity':
            data = read_metadata(Path(args.metadata), args.version)
            validate_archive(data, Path(args.archive))
            validate_identity(data, args.commit, Path(args.source_archive), Path(args.lock))
        elif args.action == 'rewrite-uri':
            rewrite_uri(args.candidate)
        elif args.action == 'bundle':
            validate_bundle(Path(args.bundle), Path(args.handoff), args.base_commit,
                            Path(args.base_manifest), args.metadata_sha256)
        else:
            preserve_manifest(args.before, args.after)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, snapshot.CargoSnapshotError, release_handoff.HandoffError) as error:
        print(f'Distribution validation failed: {error}', file=sys.stderr)
        return 1
    print(f'Distribution {args.action}: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
