from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import crates_distribution as d
import crates_github as gh
import release_handoff
import sync_zed_git_crates as sync

VERSION = '1.2.3'
BASE = 'a' * 40
COMMIT = 'b' * 40
REV = 'c' * 40
REPO = 'https://github.com/example/repo'


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.lock = self.source / 'Cargo.lock'
        self.lock.write_text(f'''version = 4
[[package]]
name = "example"
version = "1.0.0"
source = "git+{REPO}?rev={REV}#{REV}"
[[package]]
name = "registry"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"
''')
        self.source_archive = self.root / 'zed-1.2.3.tar.gz'
        self.source_archive.write_bytes(b'source archive')
        self.cache = self.root / 'cache'
        self.cache.mkdir()
        self.git_archive = self.cache / f'repo-{REV}.gh.tar.gz'
        with tarfile.open(self.git_archive, 'w:gz') as tar:
            payload = b'[package]\nname = "example"\n'
            item = tarfile.TarInfo(f'repo-{REV}/Cargo.toml')
            item.size = len(payload)
            tar.addfile(item, io.BytesIO(payload))
        self.generated = self.root / 'generated.ebuild'
        self.entry = {'name': 'example', 'repository': REPO, 'revision': REV, 'unpack_path': 'repo-%commit%'}
        self.generated.write_text(sync.entries_block([self.entry]) + 'LICENSE="MIT"\n')
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        archive_name, metadata_name = d.names(VERSION)
        self.archive = self.bundle / archive_name
        self.metadata = self.bundle / metadata_name
        with tarfile.open(self.archive, 'w:xz') as tar:
            payload = json.dumps({'package': 'abc', 'files': {}}).encode()
            item = tarfile.TarInfo('cargo_home/gentoo/registry-1.0.0/.cargo-checksum.json')
            item.size = len(payload)
            tar.addfile(item, io.BytesIO(payload))
        self.data = d.create_metadata(VERSION, COMMIT, self.source, self.source_archive, self.lock,
                                      self.archive, self.generated, self.cache)
        self.metadata.write_text(json.dumps(self.data))
        self.metadata_sha = d.sha256(self.metadata)
        overlay = self.root / 'overlay'
        package = overlay / 'app-editors/zed'
        (package / 'files').mkdir(parents=True)
        candidate = package / f'zed-{VERSION}.ebuild'
        candidate.write_text(sync.entries_block([self.entry]) + f'SRC_URI="\n{d.SOURCE_URI}\n{d.OVERLAY_URI}\n"\nLICENSE="MIT"\n')
        (package / 'files' / f'zed-{VERSION}-wayland-only.patch').write_text('patch')
        payload = self.archive.read_bytes()
        (package / 'Manifest').write_text(f'DIST {self.archive.name} {len(payload)} BLAKE2B {hashlib.blake2b(payload).hexdigest()} SHA512 {hashlib.sha512(payload).hexdigest()}\n')
        self.base_manifest = self.root / 'base-Manifest'
        self.base_manifest.write_text((package / 'Manifest').read_text())
        self.handoff = self.root / 'handoff'
        release_handoff.create_release_handoff(overlay, self.handoff, VERSION, BASE)


class DistributionTests(Fixture):
    def test_metadata_round_trip_and_bundle(self):
        self.assertEqual(d.read_metadata(self.metadata, VERSION), self.data)
        self.assertEqual(d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha), self.data)

    def test_license_expression_is_preserved_as_data(self):
        text = 'LICENSE="GPL-3+"\nLICENSE+="\n  || ( MIT Apache-2.0 )\n"\n'
        self.assertEqual(d.license_expressions(text), ['GPL-3+', '|| ( MIT Apache-2.0 )'])
        data = copy.deepcopy(self.data)
        data['licenses'] = ['GPL-3+', '|| ( MIT Apache-2.0 )']
        self.assertEqual(d.validate_metadata(data, VERSION)['licenses'], data['licenses'])
        data['licenses'] = ['MIT $(bad)']
        with self.assertRaises(ValueError): d.validate_metadata(data, VERSION)

    def test_strict_schema_and_duplicate_fields(self):
        for change in ('extra', 'schema', 'license', 'git', 'repository', 'filename'):
            data = copy.deepcopy(self.data)
            if change == 'extra': data['extra'] = 1
            elif change == 'schema': data['schema_version'] = True
            elif change == 'license': data['licenses'] = ['MIT', 'MIT']
            elif change == 'git': data['git_crates'][0]['unpack_path'] = 'repo-%commit%/../bad'
            elif change == 'repository': data['git_crates'][0]['repository'] = 'https://github.com/../repo'
            else: data['archive']['filename'] = '../bad'
            with self.subTest(change=change), self.assertRaises(ValueError):
                d.validate_metadata(data, VERSION)
        self.metadata.write_text('{"schema_version": 1, "schema_version": 1}')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON field'):
            d.read_metadata(self.metadata, VERSION)

    def test_rejects_mismatch_and_identity_changes(self):
        for commit, source, lock in ((BASE, self.source_archive, self.lock),):
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                d.validate_identity(self.data, commit, source, lock)
        self.source_archive.write_bytes(b'changed source archive')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            d.validate_identity(self.data, COMMIT, self.source_archive, self.lock)
        self.source_archive.write_bytes(b'source archive')
        self.lock.write_text(self.lock.read_text() + '\n# changed\n')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            d.validate_identity(self.data, COMMIT, self.source_archive, self.lock)
        self.archive.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'metadata'):
            d.validate_archive(self.data, self.archive)

    def test_rejects_bundle_symlink_extra_git_and_manifest_mismatch(self):
        other = self.bundle / 'extra'
        other.write_text('extra')
        with self.assertRaises(ValueError): d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)

        other.unlink()
        external = self.root / 'external.json'
        external.write_bytes(self.metadata.read_bytes())
        self.metadata.unlink()
        self.metadata.symlink_to(external)
        with self.assertRaises(ValueError): d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)
        self.metadata.unlink()
        self.metadata.write_bytes(external.read_bytes())
        candidate = self.handoff / f'app-editors/zed/zed-{VERSION}.ebuild'
        old = candidate.read_text()
        candidate.write_text(old.replace(REV, 'd' * 40))
        with self.assertRaisesRegex(ValueError, 'GIT_CRATES'): d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)
        candidate.write_text(old)
        manifest = self.handoff / 'app-editors/zed/Manifest'
        manifest.write_text(manifest.read_text().replace('BLAKE2B ', 'BLAKE2B 0'))
        with self.assertRaises(ValueError): d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)

    def test_bundle_rejects_metadata_modified_after_check(self):
        modified = copy.deepcopy(self.data)
        modified['licenses'] = ['Apache-2.0']
        self.metadata.write_text(json.dumps(modified))
        with self.assertRaisesRegex(ValueError, 'Metadata digest mismatch'):
            d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)

    def test_uri_migration_and_existing_manifest(self):
        path = self.root / 'candidate'
        path.write_text(f'SRC_URI="\n{d.SOURCE_URI}\n{d.LEGACY_URI}\n"\n')
        d.rewrite_uri(path)
        self.assertIn(d.OVERLAY_URI, path.read_text())
        self.assertNotIn(d.LEGACY_URI, path.read_text())
        d.rewrite_uri(path)
        with self.assertRaises(ValueError):
            path.write_text(f'SRC_URI="\n{d.SOURCE_URI}\n{d.LEGACY_URI}\n{d.OVERLAY_URI}\n"\n')
            d.rewrite_uri(path)
        for bad in (f'# {d.OVERLAY_URI}\nSRC_URI="\n{d.SOURCE_URI}\nhttps://example.com/archive\n"\n',
                    f'SRC_URI="\n{d.SOURCE_URI}\n{d.OVERLAY_URI}\n"\nSRC_URI+="https://example.com/x"\n'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                d.validate_uri(bad, allow_legacy=False)
        before, after = self.root / 'old', self.root / 'new'
        before.write_text('DIST old.tar.gz 3 SHA512 abc\n')
        after.write_text(before.read_text() + 'DIST new.tar.gz 3 SHA512 def\n')
        d.preserve_manifest(before, after)
        after.write_text('DIST old.tar.gz 3 SHA512 bad\n')
        with self.assertRaisesRegex(ValueError, 'changed'): d.preserve_manifest(before, after)

    def test_bundle_rejects_changed_existing_manifest_record(self):
        prior = 'DIST older.tar.gz 3 SHA512 previous\n'
        self.base_manifest.write_text(self.base_manifest.read_text() + prior)
        candidate_manifest = self.handoff / 'app-editors/zed/Manifest'
        candidate_manifest.write_text(candidate_manifest.read_text() + prior)
        d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)
        candidate_manifest.write_text(candidate_manifest.read_text().replace('previous', 'changed'))
        with self.assertRaisesRegex(ValueError, 'Existing Manifest distfile changed'):
            d.validate_bundle(self.bundle, self.handoff, BASE, self.base_manifest, self.metadata_sha)


class FakeClient:
    def __init__(self, assets: dict[str, bytes] | None = None, state: str = 'absent'):
        self.events = []
        self.assets = assets or {}
        self.state = state
        self.tag_created = False
        self.ids = {name: i + 1 for i, name in enumerate(d.names(VERSION))}

    def release(self, draft=False):
        return {'id': 9, 'tag_name': gh.release_tag(VERSION), 'draft': draft, 'prerelease': False,
                'published_at': None if draft else '2026-01-01T00:00:00Z',
                'assets': [{'id': self.ids[name], 'name': name, 'size': len(data), 'state': 'uploaded',
                            'digest': 'sha256:' + hashlib.sha256(data).hexdigest()} for name, data in self.assets.items()]}

    def api(self, path, *, method='GET', data=None):
        self.events.append((method, path))
        if path.startswith(f'/repos/{gh.REPOSITORY}/releases?'):
            return 200, [] if self.state == 'absent' else [self.release(draft=self.state == 'draft')]
        if path.endswith('/releases/tags/' + gh.release_tag(VERSION)):
            return (404, None) if self.state == 'absent' else (200, self.release(draft=self.state == 'draft'))
        if path == f'/repos/{gh.REPOSITORY}': return 200, {'full_name': gh.REPOSITORY}
        if '/git/ref/tags/' in path:
            if self.tag_created or self.state == 'published':
                return 200, {'ref': 'refs/tags/' + gh.release_tag(VERSION), 'object': {'sha': BASE, 'type': 'commit'}}
            return (200, {'ref': 'conflict'}) if self.state == 'tag' else (404, None)
        if path == f'/repos/{gh.REPOSITORY}/releases' and method == 'POST':
            self.state = 'draft'
            return 201, {'id': 9, 'tag_name': gh.release_tag(VERSION), 'draft': True, 'target_commitish': BASE}
        if path.endswith('/releases/9') and method == 'GET': return 200, self.release(draft=True)
        if path.endswith('/releases/9') and method == 'PATCH':
            self.state = 'published'
            self.tag_created = True
            return 200, self.release()
        raise AssertionError((method, path))

    def request(self, url, *, method='GET', payload=None, **kwargs):
        self.events.append((method, url))
        name = url.split('name=')[1]
        self.assets[name] = payload
        return 201, b''

    def download(self, url, path, *, auth=False):
        self.events.append(('DOWNLOAD_AUTH' if auth else 'DOWNLOAD_PUBLIC', url))
        if '/releases/assets/' in url:
            asset_id = int(url.rsplit('/', 1)[1])
            name = next(name for name, number in self.ids.items() if number == asset_id)
        else:
            name = url.rsplit('/', 1)[1]
        path.write_bytes(self.assets[name])


class GitHubTests(Fixture):
    def assets(self): return {p.name: p.read_bytes() for p in self.bundle.iterdir()}

    def test_absent_selects_generation_and_failures_do_not(self):
        self.assertEqual(gh.lookup(FakeClient(), VERSION)[0], 'generation')
        client = FakeClient(state='tag')
        with self.assertRaises(gh.GitHubError): gh.lookup(client, VERSION)
        with patch.object(client, 'api', side_effect=gh.GitHubError('network')):
            with self.assertRaises(gh.GitHubError): gh.lookup(client, VERSION)

    def test_api_auth_rate_limit_and_network_errors_fail_closed(self):
        client = gh.Client('test-token')
        for status in (401, 403, 429, 500):
            failure = urllib.error.HTTPError('https://api.github.com/', status, 'error', {}, None)
            with self.subTest(status=status), patch.object(client.opener, 'open', side_effect=failure):
                with self.assertRaises(gh.GitHubError): gh.lookup(client, VERSION)
        with patch.object(client.opener, 'open', side_effect=urllib.error.URLError('offline')):
            with self.assertRaises(gh.GitHubError): gh.lookup(client, VERSION)

    def test_published_reuse_and_missing_assets(self):
        client = FakeClient(self.assets(), 'published')
        self.assertEqual(gh.lookup(client, VERSION)[0], 'reuse')
        missing = FakeClient({self.archive.name: self.archive.read_bytes()}, 'published')
        with self.assertRaisesRegex(gh.GitHubError, 'assets'): gh.lookup(missing, VERSION)

    def test_reuse_rejects_invalid_published_metadata_before_git_downloads(self):
        assets = self.assets()
        assets[self.metadata.name] = b'{"schema_version": 999}'
        client = FakeClient(assets, 'published')
        out = self.root / 'bad-reuse'
        (out / 'cache').mkdir(parents=True)
        with self.assertRaises(ValueError):
            gh.prepare_reuse(client, VERSION, COMMIT, self.source_archive, self.source,
                             out / self.archive.name, out / self.metadata.name, out / 'cache', out / 'generated.ebuild')
        self.assertFalse(any('/archive/' in event[1] for event in client.events))

    def test_reuse_rejects_published_archive_that_disagrees_with_metadata(self):
        assets = self.assets()
        assets[self.archive.name] = b'mismatched archive'
        client = FakeClient(assets, 'published')
        out = self.root / 'bad-archive'
        (out / 'cache').mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'Archive does not match metadata'):
            gh.prepare_reuse(client, VERSION, COMMIT, self.source_archive, self.source,
                             out / self.archive.name, out / self.metadata.name, out / 'cache', out / 'generated.ebuild')
        self.assertFalse(any('/archive/' in event[1] for event in client.events))

    def test_reuse_downloads_and_validates_without_generator(self):
        client = FakeClient(self.assets(), 'published')
        original_download = client.download
        def download(url, path, *, auth=False):
            if url.startswith(REPO + '/archive/'):
                path.write_bytes(self.git_archive.read_bytes())
            else: original_download(url, path, auth=auth)
        client.download = download
        out = self.root / 'reuse'
        (out / 'cache').mkdir(parents=True)
        with patch('subprocess.run', wraps=__import__('subprocess').run) as run:
            gh.prepare_reuse(client, VERSION, COMMIT, self.source_archive, self.source,
                             out / self.archive.name, out / self.metadata.name, out / 'cache', out / 'generated.ebuild')
            self.assertTrue(all('pycargoebuild' not in str(call) for call in run.call_args_list))
        self.assertEqual((out / self.archive.name).read_bytes(), self.archive.read_bytes())

    def test_new_publication_verifies_assets_before_publish(self):
        client = FakeClient()
        self.assertEqual(gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None), 'generation')
        events = client.events
        patch_index = next(i for i, e in enumerate(events) if e[0] == 'PATCH')
        self.assertEqual(sum(e[0] == 'POST' and 'uploads.github.com' in e[1] for e in events[:patch_index]), 2)
        self.assertEqual(sum(e[0] == 'DOWNLOAD_AUTH' for e in events[:patch_index]), 2)
        self.assertEqual(sum(e[0] == 'DOWNLOAD_PUBLIC' for e in events[patch_index + 1:]), 2)

    def test_existing_release_reuses_and_conflicts_stop_without_writes(self):
        client = FakeClient(self.assets(), 'published')
        self.assertEqual(gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None), 'reuse')
        self.assertFalse(any(e[0] in ('POST', 'PATCH') for e in client.events))
        missing = FakeClient()
        with self.assertRaisesRegex(gh.GitHubError, 'disappeared'):
            gh.publish(missing, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha,
                       report=lambda _: None, expected_mode='reuse')
        self.assertFalse(any(e[0] in ('POST', 'PATCH') for e in missing.events))
        for conflict in ('draft', 'tag'):
            client = FakeClient(self.assets(), conflict)
            if conflict == 'tag':
                original = client.api
                def tag_api(path, **kwargs):
                    if path.startswith(f'/repos/{gh.REPOSITORY}/releases?'): return 200, []
                    return original(path, **kwargs)
                client.api = tag_api
            with self.subTest(conflict=conflict), self.assertRaises(gh.GitHubError):
                gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None)
            self.assertFalse(any(e[0] in ('POST', 'PATCH') for e in client.events))

    def test_mismatched_existing_assets_and_incomplete_drafts_never_mutate(self):
        assets = self.assets()
        assets[self.archive.name] = b'invalid archive'
        client = FakeClient(assets, 'published')
        with self.assertRaises(gh.GitHubError):
            gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None)
        self.assertFalse(any(e[0] in ('POST', 'PATCH') for e in client.events))
        client = FakeClient({self.archive.name: self.archive.read_bytes()}, 'draft')
        with self.assertRaisesRegex(gh.GitHubError, 'draft'):
            gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None)
        self.assertFalse(any(e[0] in ('POST', 'PATCH') for e in client.events))

    def test_failed_upload_verification_never_publishes_draft(self):
        client = FakeClient()
        original = client.download
        def corrupt(url, path, *, auth=False):
            original(url, path, auth=auth)
            if auth: path.write_bytes(b'corrupt')
        client.download = corrupt
        with self.assertRaisesRegex(gh.GitHubError, 'content mismatch'):
            gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None)
        self.assertFalse(any(e[0] == 'PATCH' for e in client.events))

    def test_failed_public_download_stops_after_release_before_pr(self):
        client = FakeClient()
        original = client.download
        def fail_public(url, path, *, auth=False):
            if not auth: raise gh.GitHubError('public download unavailable')
            original(url, path, auth=auth)
        client.download = fail_public
        with self.assertRaisesRegex(gh.GitHubError, 'public download unavailable'):
            gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None)
        self.assertTrue(any(e[0] == 'PATCH' for e in client.events))

    def test_changed_release_state_stops_before_publishing_draft(self):
        client = FakeClient()
        original_api = client.api
        lists = 0
        def concurrent(path, **kwargs):
            nonlocal lists
            if path.startswith(f'/repos/{gh.REPOSITORY}/releases?'):
                lists += 1
                if lists == 2: return 200, [client.release(draft=True), client.release(draft=True)]
            return original_api(path, **kwargs)
        client.api = concurrent
        with self.assertRaisesRegex(gh.GitHubError, 'state changed'):
            gh.publish(client, VERSION, BASE, self.bundle, self.handoff, self.base_manifest, self.metadata_sha, report=lambda _: None)
        self.assertFalse(any(event[0] == 'PATCH' for event in client.events))

    def test_workflow_publishes_before_draft_pr_and_keeps_write_boundary(self):
        workflow = (Path(__file__).parents[1] / '.github/workflows/zed-release-watcher.yml').read_text()
        self.assertLess(workflow.index('      - name: Publish validated crates release'),
                        workflow.index('      - name: Publish Draft release PR'))
        self.assertEqual(workflow.count('contents: write'), 1)
        self.assertEqual(workflow.count('pull-requests: write'), 1)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)

    def test_publish_command_rejects_validation_only_and_non_main(self):
        argv = ['crates_github.py', 'publish', '--version', VERSION, '--base-commit', BASE,
                '--bundle', str(self.bundle), '--handoff', str(self.handoff), '--base-manifest', str(self.base_manifest), '--metadata-sha256', self.metadata_sha, '--expected-mode', 'generation']
        for ref, mode in (('refs/heads/feature', 'false'), ('refs/heads/main', 'true')):
            env = {'GITHUB_TOKEN': 'test-token', 'GITHUB_REF': ref, 'GITHUB_REPOSITORY': gh.REPOSITORY,
                   'INDEPENDENT_VALIDATION': mode, 'GITHUB_SHA': BASE}
            with self.subTest(ref=ref, mode=mode), patch.dict(os.environ, env, clear=True), \
                    patch.object(sys, 'argv', argv), patch.object(gh.Client, 'api') as api:
                self.assertEqual(gh.main(), 1)
                api.assert_not_called()


if __name__ == '__main__':
    unittest.main()
