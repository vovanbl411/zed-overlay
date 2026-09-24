"""Fail closed when a Zed Cargo Git dependency snapshot drifts from its ebuild."""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


GIT_CRATES_START = re.compile(r"^declare -A GIT_CRATES=\(\s*$")
GIT_CRATE_ENTRY = re.compile(r"^\s*\[([^][]+)\]='([^']*)'\s*$")
LOCAL_ASSIGNMENT = re.compile(
    r'^\s*local\s+([A-Z][A-Z0-9_]*)="((?:[^"\\]|\\.)*)"\s*$'
)
GIT_CRATE_COMMIT_ASSIGNMENT = re.compile(
    r"^\s*git_crate_commit ([A-Za-z0-9_-]+) ([A-Z][A-Z0-9_]*)\s*$"
)
COMMIT = re.compile(r"^[0-9a-f]{7,64}$")
VARIABLE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
GIT_DECLARATION = re.compile(
    r'^([A-Za-z0-9_-]+) = \{ git = "([^"]+)"(?:, rev = "([0-9a-f]+)")?$'
)
PATH_DECLARATION = re.compile(r'^([A-Za-z0-9_-]+) = \{ path = "([^"]+)"$')


class CargoSnapshotError(RuntimeError):
    """Raised when the candidate cannot be compared reliably."""


@dataclass(frozen=True)
class GitCrate:
    repository: str
    commit: str


@dataclass(frozen=True)
class OfflineSubstitution:
    crate: str
    repository: str
    commit: str
    declaration: str


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise CargoSnapshotError(f"Could not read {path} as UTF-8.") from error


def canonical_repository(value: str) -> str:
    """Normalize only harmless Git URL spelling differences."""
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc or parsed.query or parsed.fragment:
        raise CargoSnapshotError(f"Malformed Git repository URL: {value!r}.")
    path = parsed.path.rstrip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if not path:
        raise CargoSnapshotError(f"Malformed Git repository URL: {value!r}.")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


def parse_git_crates(ebuild_text: str) -> dict[str, GitCrate]:
    """Read the simple associative-array form emitted by the ebuild."""
    lines = ebuild_text.splitlines()
    try:
        start = next(index for index, line in enumerate(lines) if GIT_CRATES_START.fullmatch(line))
    except StopIteration as error:
        raise CargoSnapshotError("Missing declare -A GIT_CRATES block.") from error

    crates: dict[str, GitCrate] = {}
    for line in lines[start + 1 :]:
        if line.strip() == ")":
            if not crates:
                raise CargoSnapshotError("GIT_CRATES block is empty.")
            return crates
        if not line.strip():
            continue
        match = GIT_CRATE_ENTRY.fullmatch(line)
        if match is None:
            raise CargoSnapshotError(f"Malformed GIT_CRATES entry: {line.strip()!r}.")
        name, value = match.groups()
        parts = value.split(";")
        if len(parts) != 3 or not all(parts):
            raise CargoSnapshotError(f"Malformed GIT_CRATES entry for {name!r}.")
        repository, commit, _unpack_path = parts
        if not COMMIT.fullmatch(commit):
            raise CargoSnapshotError(f"Malformed GIT_CRATES commit for {name!r}: {commit!r}.")
        if name in crates:
            raise CargoSnapshotError(f"Duplicate GIT_CRATES entry for {name!r}.")
        crates[name] = GitCrate(canonical_repository(repository), commit)
    raise CargoSnapshotError("Unterminated GIT_CRATES block.")


def parse_lock(path: Path) -> dict[str, GitCrate]:
    try:
        with path.open("rb") as lock_file:
            lock = tomllib.load(lock_file)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise CargoSnapshotError(f"Could not parse {path}.") from error

    packages = lock.get("package")
    if not isinstance(packages, list):
        raise CargoSnapshotError("Cargo.lock has no package list.")
    crates: dict[str, GitCrate] = {}
    for package in packages:
        if not isinstance(package, dict):
            raise CargoSnapshotError("Cargo.lock has a malformed package entry.")
        source = package.get("source")
        if source is None:
            continue
        name = package.get("name")
        if not isinstance(name, str) or not isinstance(source, str):
            raise CargoSnapshotError("Cargo.lock has a malformed package source.")
        if not source.startswith("git+"):
            continue
        repository_and_query, separator, commit = source[4:].partition("#")
        if not separator or not COMMIT.fullmatch(commit):
            raise CargoSnapshotError(f"Malformed Git source for {name!r}: {source!r}.")
        repository = repository_and_query.split("?", 1)[0]
        crate = GitCrate(canonical_repository(repository), commit)
        existing = crates.get(name)
        if existing is not None and existing != crate:
            raise CargoSnapshotError(f"Cargo.lock has conflicting Git sources for {name!r}.")
        crates[name] = crate
    return crates


def validate_cargo_toml(path: Path) -> None:
    try:
        with path.open("rb") as cargo_file:
            cargo_toml = tomllib.load(cargo_file)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise CargoSnapshotError(f"Could not parse {path}.") from error
    if not isinstance(cargo_toml, dict):
        raise CargoSnapshotError(f"Malformed {path}.")


def expand_variables(
    value: str, variables: dict[str, str], label: str, *, allow_external: bool = False
) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        try:
            return variables[name]
        except KeyError as error:
            if allow_external:
                return match.group(0)
            raise CargoSnapshotError(f"{label} references undefined variable {name!r}.") from error

    return VARIABLE.sub(replace, value).replace(r'\"', '"')


def parse_offline_substitutions(
    ebuild_text: str, git_crates: dict[str, GitCrate]
) -> list[OfflineSubstitution]:
    """Validate the existing explicit local Cargo replacement convention."""
    variables: dict[str, str] = {}
    for line in ebuild_text.splitlines():
        match = LOCAL_ASSIGNMENT.fullmatch(line)
        if match is not None:
            name, value = match.groups()
            if name in variables:
                raise CargoSnapshotError(f"Duplicate local variable {name!r}.")
            variables[name] = value

    for line in ebuild_text.splitlines():
        match = GIT_CRATE_COMMIT_ASSIGNMENT.fullmatch(line)
        if match is None:
            continue
        crate, name = match.groups()
        try:
            variables[name] = git_crates[crate].commit
        except KeyError as error:
            raise CargoSnapshotError(
                f"Offline commit {name!r} references missing GIT_CRATES entry {crate!r}."
            ) from error

    substitutions: list[OfflineSubstitution] = []
    for name, raw_declaration in variables.items():
        if not name.endswith("_GIT"):
            continue
        stem = name.removesuffix("_GIT")
        declaration = expand_variables(raw_declaration, variables, name)
        match = GIT_DECLARATION.fullmatch(declaration)
        if match is None:
            raise CargoSnapshotError(f"Malformed offline Git declaration {name!r}.")
        crate, repository, declared_commit = match.groups()
        commit_variables = VARIABLE.findall(raw_declaration)
        if not commit_variables:
            commit_variable = f"{stem}_COMMIT"
        elif len(commit_variables) == 1 and commit_variables[0].endswith("_COMMIT"):
            commit_variable = commit_variables[0]
        else:
            raise CargoSnapshotError(f"Offline Git declaration {name!r} has no single commit variable.")
        commit = variables.get(commit_variable)
        if commit is None or not COMMIT.fullmatch(commit):
            raise CargoSnapshotError(f"Malformed offline commit for {name!r}.")
        if declared_commit is not None and declared_commit != commit:
            raise CargoSnapshotError(f"Offline Git declaration {name!r} disagrees with its commit variable.")

        path_variable = f"{stem}_PATH"
        try:
            path_declaration = expand_variables(
                variables[path_variable], variables, path_variable, allow_external=True
            )
        except KeyError as error:
            raise CargoSnapshotError(f"Missing offline path declaration {path_variable!r}.") from error
        path_match = PATH_DECLARATION.fullmatch(path_declaration)
        if path_match is None or path_match.group(1) != crate or commit not in path_match.group(2):
            raise CargoSnapshotError(f"Malformed offline path declaration {path_variable!r}.")
        substitutions.append(
            OfflineSubstitution(crate, canonical_repository(repository), commit, declaration)
        )
    return substitutions


def compare_snapshots(upstream: dict[str, GitCrate], ebuild: dict[str, GitCrate]) -> list[str]:
    errors: list[str] = []
    for name in sorted(upstream.keys() - ebuild.keys()):
        errors.append(f"{name}: upstream Git dependency is missing from GIT_CRATES.")
    for name in sorted(ebuild.keys() - upstream.keys()):
        errors.append(f"{name}: GIT_CRATES entry is absent from upstream Cargo.lock.")
    for name in sorted(upstream.keys() & ebuild.keys()):
        upstream_crate = upstream[name]
        ebuild_crate = ebuild[name]
        if upstream_crate.repository != ebuild_crate.repository:
            errors.append(
                f"{name}: repository differs (upstream {upstream_crate.repository}, "
                f"ebuild {ebuild_crate.repository})."
            )
        if upstream_crate.commit != ebuild_crate.commit:
            errors.append(
                f"{name}: revision differs (upstream {upstream_crate.commit}, "
                f"ebuild {ebuild_crate.commit})."
            )
    return errors


def validate(ebuild_path: Path, source_path: Path) -> None:
    """Validate a candidate ebuild against one exact extracted upstream source tree."""
    ebuild_text = read_text(ebuild_path)
    lock_crates = parse_lock(source_path / "Cargo.lock")
    ebuild_crates = parse_git_crates(ebuild_text)
    errors = compare_snapshots(lock_crates, ebuild_crates)

    cargo_toml_path = source_path / "Cargo.toml"
    validate_cargo_toml(cargo_toml_path)
    cargo_toml = read_text(cargo_toml_path)
    for substitution in parse_offline_substitutions(ebuild_text, ebuild_crates):
        if substitution.declaration not in cargo_toml:
            errors.append(
                f"{substitution.crate}: expected offline Git declaration is absent from upstream Cargo.toml."
            )
    if errors:
        raise CargoSnapshotError("\n".join(errors))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ebuild", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    try:
        validate(args.ebuild, args.source)
    except CargoSnapshotError as error:
        print(f"Cargo Git dependency snapshot: ERROR: {error}", file=sys.stderr)
        return 1
    print("Cargo Git dependency snapshot: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
