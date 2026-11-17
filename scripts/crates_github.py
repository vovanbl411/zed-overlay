"""Read or publish the overlay's validated crates release assets."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import crates_distribution as distribution
import inspect_zed_archive as inspector
import sync_zed_git_crates as sync

REPOSITORY = 'vovanbl411/zed-overlay'
API = 'https://api.github.com'
PUBLIC = 'https://github.com/vovanbl411/zed-overlay/releases/download'


class GitHubError(RuntimeError):
    pass


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and urllib.parse.urlsplit(newurl).netloc != urllib.parse.urlsplit(req.full_url).netloc:
            redirected.remove_header('Authorization')
        if not newurl.startswith('https://'):
            raise GitHubError('Refusing a non-HTTPS redirect')
        return redirected


class Client:
    def __init__(self, token: str):
        if not token:
            raise GitHubError('GitHub token is required')
        self.token = token
        self.opener = urllib.request.build_opener(SafeRedirect())

    def request(self, url: str, *, method: str = 'GET', payload: bytes | None = None,
                content_type: str = 'application/json', auth: bool = True,
                accept: str = 'application/vnd.github+json', output: Path | None = None) -> tuple[int, bytes]:
        if not url.startswith('https://'):
            raise GitHubError('Only HTTPS is supported')
        headers = {'Accept': accept, 'User-Agent': 'zed-overlay-release', 'X-GitHub-Api-Version': '2022-11-28'}
        if auth:
            host = urllib.parse.urlsplit(url).hostname
            if host not in ('api.github.com', 'uploads.github.com'):
                raise GitHubError('Refusing to send credentials to an unexpected host')
            headers['Authorization'] = f'Bearer {self.token}'
        if payload is not None:
            headers['Content-Type'] = content_type
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=90) as response:
                if output is not None:
                    with output.open('xb') as dest:
                        shutil.copyfileobj(response, dest, length=1024 * 1024)
                    return response.status, b''
                body = response.read(4_000_001)
                if len(body) > 4_000_000:
                    raise GitHubError('GitHub response is too large')
                return response.status, body
        except urllib.error.HTTPError as error:
            error.close()
            if error.code == 404:
                return 404, b''
            raise GitHubError(f'GitHub request failed: HTTP {error.code}') from error
        except (urllib.error.URLError, OSError) as error:
            raise GitHubError(f'GitHub network or download error: {error}') from error

    def api(self, path: str, *, method: str = 'GET', data: dict | None = None) -> tuple[int, object]:
        status, body = self.request(API + path, method=method,
                                    payload=None if data is None else json.dumps(data).encode())
        if status == 404:
            return status, None
        try:
            return status, json.loads(body, object_pairs_hook=distribution.unique_object)
        except (ValueError, UnicodeError) as error:
            raise GitHubError('GitHub returned invalid JSON') from error

    def download(self, url: str, path: Path, *, auth: bool = False) -> None:
        status, _ = self.request(url, auth=auth, output=path,
                                 accept='application/octet-stream')
        if status != 200:
            raise GitHubError(f'Asset download failed: HTTP {status}')


def release_tag(version: str) -> str:
    distribution.names(version)
    return f'crates-v{version}'


def expected_assets(release: object, version: str, *, draft: bool = False) -> dict[str, dict]:
    if (not isinstance(release, dict) or release.get('tag_name') != release_tag(version) or
            release.get('draft') is not draft or release.get('prerelease') is not False or
            type(release.get('id')) is not int or release['id'] <= 0 or
            (not draft and not isinstance(release.get('published_at'), str)) or
            (draft and release.get('published_at') is not None) or
            not isinstance(release.get('assets'), list)):
        raise GitHubError('Invalid release identity or state')
    names = set(distribution.names(version))
    assets = release['assets']
    if (len(assets) != len(names) or
            any(not isinstance(a, dict) or not isinstance(a.get('name'), str) for a in assets)):
        raise GitHubError('Release assets are incomplete or unexpected')
    if {a.get('name') for a in assets} != names:
        raise GitHubError('Release asset names are incomplete or unexpected')
    for asset in assets:
        if (type(asset.get('id')) is not int or asset['id'] <= 0 or
                type(asset.get('size')) is not int or asset['size'] <= 0 or
                asset.get('state') != 'uploaded'):
            raise GitHubError('Invalid release asset metadata')
    if len({a['id'] for a in assets}) != len(assets):
        raise GitHubError('Duplicate release asset IDs')
    return {a['name']: a for a in assets}


def require_published_tag(client: Client, version: str) -> None:
    tag = release_tag(version)
    status, reference = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
    obj = reference.get('object') if isinstance(reference, dict) else None
    if (status != 200 or not isinstance(reference, dict) or reference.get('ref') != f'refs/tags/{tag}' or
            not isinstance(obj, dict) or obj.get('type') not in ('tag', 'commit') or
            not isinstance(obj.get('sha'), str) or not distribution.SHA1.fullmatch(obj['sha'])):
        raise GitHubError('Published release has no valid matching Git tag')


def lookup(client: Client, version: str) -> tuple[str, dict | None]:
    tag = release_tag(version)
    status, release = client.api(f'/repos/{REPOSITORY}/releases/tags/{tag}')
    if status == 200:
        expected_assets(release, version)
        require_published_tag(client, version)
        return 'reuse', release
    if status != 404:
        raise GitHubError(f'Unexpected release lookup status: {status}')
    status, repo = client.api(f'/repos/{REPOSITORY}')
    if (status != 200 or not isinstance(repo, dict) or not isinstance(repo.get('full_name'), str) or
            repo['full_name'].lower() != REPOSITORY):
        raise GitHubError('Cannot confirm access to the expected repository')
    status, _ = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
    if status == 200:
        raise GitHubError('A standalone or unpublished tag already exists')
    if status != 404:
        raise GitHubError(f'Cannot determine tag state: HTTP {status}')
    # Read-only tokens cannot list all drafts; the write job checks them before mutation.
    return 'generation', None


def public_url(version: str, filename: str) -> str:
    if filename not in distribution.names(version):
        raise GitHubError('Unexpected asset filename')
    return f'{PUBLIC}/{release_tag(version)}/{filename}'


def prepare_reuse(client: Client, version: str, commit: str, source_archive: Path,
                  source: Path, archive: Path, metadata: Path, cache: Path, generated: Path) -> None:
    mode, release = lookup(client, version)
    if mode != 'reuse':
        raise GitHubError('Release disappeared before reuse')
    assets = expected_assets(release, version)
    client.download(public_url(version, metadata.name), metadata)
    data = distribution.read_metadata(metadata, version)
    if (assets[metadata.name]['size'] != metadata.stat().st_size or
            assets[metadata.name].get('digest') != 'sha256:' + distribution.sha256(metadata)):
        raise GitHubError('Published metadata asset size or digest mismatch')
    client.download(public_url(version, archive.name), archive)
    distribution.validate_archive(data, archive)
    if (assets[archive.name]['size'] != archive.stat().st_size or
            assets[archive.name].get('digest') != 'sha256:' + distribution.sha256(archive)):
        raise GitHubError('Published archive asset size or digest mismatch')
    distribution.validate_identity(data, commit, source_archive, source / 'Cargo.lock')
    inspector.inspect(archive, source / 'Cargo.lock')
    declaration = sync.entries_block(data['git_crates'])
    for entry in data['git_crates']:
        repo = entry['repository']
        revision = entry['revision']
        filename = f"{repo.rsplit('/', 1)[1]}-{revision}.gh.tar.gz"
        dest = cache / filename
        if not dest.exists():
            client.download(f'{repo}/archive/{revision}.tar.gz', dest)
    sync.validate_sources(declaration, source, cache)
    licenses = ''.join(f'LICENSE+="{value}"\n' for value in data['licenses'])
    generated.write_text(declaration + licenses, encoding='utf-8')


def all_releases(client: Client) -> list[dict]:
    releases: list[dict] = []
    for page in range(1, 101):
        status, payload = client.api(f'/repos/{REPOSITORY}/releases?per_page=100&page={page}')
        if status != 200 or not isinstance(payload, list) or any(not isinstance(x, dict) for x in payload):
            raise GitHubError('Cannot list releases including drafts')
        releases.extend(payload)
        if len(payload) < 100:
            return releases
    raise GitHubError('Too many release pages')


def verify_remote_assets(client: Client, release: dict, version: str, bundle: Path, *, draft: bool) -> None:
    assets = expected_assets(release, version, draft=draft)
    with tempfile.TemporaryDirectory(prefix='zed-asset-verify-') as directory:
        for name, asset in assets.items():
            local = bundle / name
            if asset['size'] != local.stat().st_size:
                raise GitHubError(f'Remote asset size mismatch: {name}')
            expected_digest = 'sha256:' + distribution.sha256(local)
            if asset.get('digest') != expected_digest:
                raise GitHubError(f'Remote asset SHA256 mismatch: {name}')
            downloaded = Path(directory) / name
            client.download(f"{API}/repos/{REPOSITORY}/releases/assets/{asset['id']}", downloaded, auth=True)
            if distribution.sha256(downloaded) != distribution.sha256(local):
                raise GitHubError(f'Remote asset content mismatch: {name}')


def publish(client: Client, version: str, base_commit: str, bundle: Path, handoff: Path,
            base_manifest: Path, metadata_sha256: str, report=print,
            expected_mode: str = 'generation') -> str:
    if expected_mode not in ('generation', 'reuse'):
        raise GitHubError('Invalid validated archive mode')
    distribution.validate_bundle(bundle, handoff, base_commit, base_manifest, metadata_sha256)
    publication_start = time.monotonic()
    tag = release_tag(version)
    matches = [r for r in all_releases(client) if r.get('tag_name') == tag]
    if len(matches) > 1:
        raise GitHubError('Multiple releases use the requested tag')
    if matches:
        release = matches[0]
        if release.get('draft') is not False:
            raise GitHubError('Conflicting draft release requires manual recovery')
        require_published_tag(client, version)
        verify_remote_assets(client, release, version, bundle, draft=False)
        result = 'reuse'
    else:
        if expected_mode == 'reuse':
            raise GitHubError('Previously published release disappeared before publication')
        status, _ = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
        if status != 404:
            raise GitHubError('Conflicting standalone tag or failed tag lookup')
        status, release = client.api(f'/repos/{REPOSITORY}/releases', method='POST', data={
            'tag_name': tag, 'target_commitish': base_commit, 'name': tag,
            'draft': True, 'prerelease': False, 'make_latest': 'false',
        })
        if (status != 201 or not isinstance(release, dict) or release.get('draft') is not True or
                release.get('tag_name') != tag or release.get('target_commitish') != base_commit or
                type(release.get('id')) is not int):
            raise GitHubError('Draft release creation returned an invalid response')
        release_id = release['id']
        report(f'Draft {tag} created; failed uploads or checks require manual recovery')
        for name in distribution.names(version):
            content = (bundle / name).read_bytes()
            status, _ = client.request(f'https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets?name={name}',
                                       method='POST', payload=content,
                                       content_type='application/octet-stream')
            if status != 201:
                raise GitHubError(f'Asset upload failed: {name} HTTP {status}')
        status, release = client.api(f'/repos/{REPOSITORY}/releases/{release_id}')
        if status != 200 or not isinstance(release, dict):
            raise GitHubError('Cannot inspect uploaded draft release')
        verify_remote_assets(client, release, version, bundle, draft=True)
        matches = [r for r in all_releases(client) if r.get('tag_name') == tag]
        if len(matches) != 1 or matches[0].get('id') != release_id or matches[0].get('draft') is not True:
            raise GitHubError('Release state changed during draft upload')
        status, _ = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
        if status != 404:
            raise GitHubError('Tag appeared during draft upload')
        status, release = client.api(f'/repos/{REPOSITORY}/releases/{release_id}', method='PATCH',
                                     data={'draft': False, 'make_latest': 'false'})
        if status != 200 or not isinstance(release, dict) or release.get('draft') is not False:
            raise GitHubError('Release publication failed or returned invalid state')
        report(f'Release {tag} published; public verification is pending')
        expected_assets(release, version)
        if release['id'] != release_id:
            raise GitHubError('Published release ID changed')
        status, reference = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
        obj = reference.get('object') if isinstance(reference, dict) else None
        if (status != 200 or not isinstance(obj, dict) or
                obj.get('sha') != base_commit or obj.get('type') != 'commit'):
            raise GitHubError('Published tag does not point to the validated base commit')
        result = 'generation'
    report(f'Release upload/publication or reuse verification: {time.monotonic() - publication_start:.1f}s')
    public_start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='zed-public-verify-') as directory:
        for name in distribution.names(version):
            dest = Path(directory) / name
            client.download(public_url(version, name), dest)
            local = bundle / name
            if dest.stat().st_size != local.stat().st_size or distribution.sha256(dest) != distribution.sha256(local):
                raise GitHubError(f'Public asset does not match validated bundle: {name}')
            if name.endswith('.tar.xz'):
                metadata = release_handoff_metadata(handoff, base_commit)
                inspector.verify_manifest(dest, handoff / metadata['manifest_path'])
    report(f'Public download verification: {time.monotonic() - public_start:.1f}s')
    return result


def release_handoff_metadata(handoff: Path, base_commit: str) -> dict:
    return distribution.release_handoff.validate_release_handoff(handoff, expected_base_commit=base_commit)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    lookup_parser = sub.add_parser('lookup')
    lookup_parser.add_argument('--version', required=True)
    reuse = sub.add_parser('reuse')
    for name in ('version', 'commit', 'source-archive', 'source', 'archive', 'metadata', 'cache', 'generated'):
        reuse.add_argument('--' + name, required=True)
    publisher = sub.add_parser('publish')
    for name in ('version', 'base-commit', 'base-manifest', 'bundle', 'handoff', 'expected-mode', 'metadata-sha256'):
        publisher.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        client = Client(os.environ.get('GITHUB_TOKEN', ''))
        if args.action == 'lookup':
            print(lookup(client, args.version)[0])
        elif args.action == 'reuse':
            prepare_reuse(client, args.version, args.commit, Path(args.source_archive), Path(args.source),
                          Path(args.archive), Path(args.metadata), Path(args.cache), Path(args.generated))
        else:
            if (os.environ.get('GITHUB_REF') != 'refs/heads/main' or
                    os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or
                    os.environ.get('INDEPENDENT_VALIDATION') != 'false' or
                    os.environ.get('GITHUB_SHA') != args.base_commit):
                raise GitHubError('Publication requires main, the workflow base, and production mode')
            start = time.monotonic()
            result = publish(client, args.version, args.base_commit, Path(args.bundle), Path(args.handoff),
                             Path(args.base_manifest), args.metadata_sha256, expected_mode=args.expected_mode)
            print(f'Release result: {result}; publication and public verification: {time.monotonic() - start:.1f}s')
            print(f'Crates release: https://github.com/{REPOSITORY}/releases/tag/{release_tag(args.version)}')
            output = os.environ.get('GITHUB_OUTPUT')
            if output:
                with open(output, 'a', encoding='utf-8') as f:
                    f.write(f'publication_result={result}\n')
    except (GitHubError, OSError, ValueError, KeyError, distribution.snapshot.CargoSnapshotError,
            distribution.release_handoff.HandoffError) as error:
        print(f'Crates release error: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
