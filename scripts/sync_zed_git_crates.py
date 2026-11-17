"""Validate generated Cargo metadata and synchronize a disposable candidate."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile
import tempfile
import tomllib
from pathlib import Path, PurePosixPath

import check_zed_cargo_snapshot as snapshot

ENTRY = snapshot.GIT_CRATE_ENTRY
NAME = re.compile(r"[A-Za-z0-9_-]+")
REPO = re.compile(r"https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)")
PART = re.compile(r"[A-Za-z0-9_.-]+")
SHA = re.compile(r"[0-9a-f]{40}")


def block(text: str) -> tuple[int, int, str]:
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if snapshot.GIT_CRATES_START.fullmatch(line.rstrip("\r\n"))]
    if len(starts) != 1:
        raise snapshot.CargoSnapshotError("Expected exactly one GIT_CRATES block.")
    start = starts[0]
    for end in range(start + 1, len(lines)):
        if lines[end].strip() == ")":
            return sum(map(len, lines[:start])), sum(map(len, lines[:end + 1])), "".join(lines[start:end + 1])
    raise snapshot.CargoSnapshotError("Unterminated GIT_CRATES block.")


def validate_sources(generated: str, source: Path, cache: Path) -> dict[str, snapshot.GitCrate]:
    _, _, declaration = block(generated)
    crates = snapshot.parse_git_crates(declaration)
    errors = snapshot.compare_snapshots(snapshot.parse_lock(source / "Cargo.lock"), crates)
    if errors:
        raise snapshot.CargoSnapshotError("\n".join(errors))
    for line in declaration.splitlines()[1:-1]:
        if not line.strip():
            continue
        match = ENTRY.fullmatch(line)
        if not match:
            raise snapshot.CargoSnapshotError("Malformed generated entry.")
        name, value = match.groups()
        repository, commit, unpack = value.split(";")
        repo = REPO.fullmatch(repository)
        if not NAME.fullmatch(name) or not repo or not SHA.fullmatch(commit):
            raise snapshot.CargoSnapshotError(f"Unsupported generated entry: {name!r}.")
        repo_name = repo.group(2)
        if repo_name.endswith('.git'):
            raise snapshot.CargoSnapshotError(f"Unsupported repository spelling: {repository!r}.")
        components = unpack.split('/')
        if (not components or components[0] != f"{repo_name}-%commit%" or
                any(not PART.fullmatch(p) or p in ('.', '..') for p in components[1:])):
            raise snapshot.CargoSnapshotError(f"Unsafe unpack path for {name!r}: {unpack!r}.")
        archive = cache / f"{repo_name}-{commit}.gh.tar.gz"
        member_name = str(PurePosixPath(unpack.replace('%commit%', commit)) / 'Cargo.toml')
        try:
            with tarfile.open(archive, 'r:gz') as tar:
                matches = [m for m in tar if m.name == member_name]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 2_000_000:
                    raise snapshot.CargoSnapshotError(f"Invalid Cargo.toml for {name!r} in {archive.name}.")
                f = tar.extractfile(matches[0])
                assert f is not None
                manifest = tomllib.loads(f.read().decode('utf-8'))
                if manifest.get('package', {}).get('name') != name:
                    raise snapshot.CargoSnapshotError(f"Crate identity mismatch for {name!r}.")
        except (OSError, tarfile.TarError, UnicodeError, tomllib.TOMLDecodeError) as error:
            raise snapshot.CargoSnapshotError(f"Cannot validate source for {name!r}: {error}") from error
    return crates


def sync(candidate: Path, generated: Path, source: Path, cache: Path) -> int:
    generated_text = snapshot.read_text(generated)
    crates = validate_sources(generated_text, source, cache)
    original = snapshot.read_text(candidate)
    start, end, _ = block(original)
    _, _, replacement = block(generated_text)
    updated = original[:start] + replacement + original[end:]
    # All validation happens before writing. Offline substitutions remain curated.
    snapshot.parse_offline_substitutions(updated, crates)
    tmp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=candidate.parent, delete=False) as f:
            tmp = Path(f.name)
            f.write(updated)
        snapshot.validate(tmp, source)
        os.chmod(tmp, candidate.stat().st_mode & 0o777)
        tmp.replace(candidate)
    finally:
        if tmp is not None and tmp.exists():
            tmp.unlink()
    return len(crates)


def license_terms(text: str) -> set[str]:
    terms: set[str] = set()
    for match in re.finditer(r'^LICENSE\+?="([^"]*)"', text, re.MULTILINE):
        terms.update(match.group(1).split())
    return terms


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--generated', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    args = parser.parse_args()
    try:
        candidate_terms = license_terms(snapshot.read_text(args.candidate))
        generated_terms = license_terms(snapshot.read_text(args.generated))
        count = sync(args.candidate, args.generated, args.source, args.cache)
        print(f'Git dependency count: {count}')
        print('Generated-only licenses for review: ' + json.dumps(sorted(generated_terms - candidate_terms)))
        print('Candidate-only licenses for review: ' + json.dumps(sorted(candidate_terms - generated_terms)))
    except (OSError, ValueError, snapshot.CargoSnapshotError) as error:
        print(f'Git synchronization failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
