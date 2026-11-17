from __future__ import annotations

import os
import hashlib
import io
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]


class IndependentReleaseTests(unittest.TestCase):
    def test_source_acquisition_uses_src_uri_and_rejects_commit_mismatch(self) -> None:
        script = (ROOT / 'scripts/ci/independent-crates.sh').read_text()
        acquisition = script.split('\nprepare_generator() {', 1)[0] + '\nacquire_source\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin'
            binary.mkdir()
            archive = root / 'download.tar.gz'
            data = b'lockfile'
            with tarfile.open(archive, 'w:gz') as tar:
                entry = tarfile.TarInfo('zed-1.2.3/Cargo.lock')
                entry.size = len(data)
                tar.addfile(entry, io.BytesIO(data))
            blob = hashlib.sha1(b'blob 8\0' + data).hexdigest()
            git = binary / 'git'
            git.write_text('''#!/bin/bash
if [[ "$1" == ls-remote ]]; then printf '%s\\trefs/tags/v1.2.3\\n' "$MOCK_COMMIT"
elif [[ "$1" == clone ]]; then mkdir "${!#}"
elif [[ "$3" == rev-parse ]]; then echo "$MOCK_COMMIT"
elif [[ "$3" == ls-tree ]]; then printf '100644 blob %s\\tCargo.lock\\0' "$MOCK_BLOB"
else exit 2; fi
''')
            git.chmod(0o755)
            curl = binary / 'curl'
            curl.write_text('''#!/bin/bash
url= dest=
while (($#)); do
  case "$1" in https://*) url=$1 ;; -o) shift; dest=$1 ;; esac
  shift
done
printf '%s' "$url" > "$MOCK_URL"
cp "$MOCK_ARCHIVE" "$dest"
''')
            curl.chmod(0o755)
            candidate = root / 'candidate.ebuild'
            candidate.write_text('https://github.com/zed-industries/zed/archive/refs/tags/v${PV/_/-}.tar.gz -> ${P}.tar.gz\n')
            summary = root / 'summary'
            summary.touch()
            env = os.environ.copy()
            env.update(PATH=f'{binary}:' + env['PATH'], MOCK_ARCHIVE=str(archive),
                       MOCK_URL=str(root / 'url'), MOCK_COMMIT='a' * 40, MOCK_BLOB=blob,
                       RUNNER_TEMP=str(root), GITHUB_STEP_SUMMARY=str(summary))
            command = ['bash', '-c', acquisition, 'acquire', '1.2.3', str(candidate),
                       str(root / 'patch'), str(ROOT)]
            result = subprocess.run(command, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / 'url').read_text(),
                             'https://github.com/zed-industries/zed/archive/refs/tags/v1.2.3.tar.gz')
            self.assertEqual((root / 'zed-independent/dist/zed-1.2.3.tar.gz').read_bytes(), archive.read_bytes())
            env['MOCK_BLOB'] = '0' * 40
            second = root / 'second'
            second.mkdir()
            env['RUNNER_TEMP'] = str(second)
            result = subprocess.run(command, env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Git blob differs', result.stderr)

    def test_generator_failure_propagates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'generator'
            binary.write_text('#!/bin/sh\nexit 42\n')
            binary.chmod(0o755)
            result = subprocess.run([
                str(ROOT / 'scripts/ci/run-pycargoebuild.sh'), str(binary), str(root),
                str(root / 'output.tar.xz'), str(root / 'cache'), str(root / 'license'),
                str(root / 'generated.ebuild'), str(root),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 42)
            self.assertFalse((root / 'output.tar.xz').exists())

    def run_validation(self, failure: bool, *, normal: bool = False) -> tuple[subprocess.CompletedProcess[str], str, bool]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / 'fixture'
            (fixture / 'app-editors/zed/files').mkdir(parents=True)
            (fixture / 'app-editors/zed/zed-1.0.0.ebuild').write_text('base')
            (fixture / 'app-editors/zed/Manifest').write_text('old manifest')
            helper = fixture / 'scripts/ci/independent-crates.sh'
            helper.parent.mkdir(parents=True)
            helper.write_text('#!/bin/bash\n' + ('exit 23\n' if failure else 'echo new > app-editors/zed/Manifest\n'))
            helper.chmod(0o755)
            bindir = root / 'bin'
            bindir.mkdir()
            git = bindir / 'git'
            git.write_text('''#!/bin/bash
case "$3" in
  ls-files) exit 0 ;;
  archive) tar -c -C "$MOCK_FIXTURE" . ;;
  status) exit 0 ;;
  *) exit 99 ;;
esac
''')
            git.chmod(0o755)
            python = bindir / 'python3'
            python.write_text('''#!/bin/bash
case "$*" in
  *--prepare*)
    if [[ "$MOCK_UP_TO_DATE" == 1 ]]; then echo 'Result: up-to-date'; exit 0; fi
    echo candidate > app-editors/zed/zed-1.1.0.ebuild
    echo patch > app-editors/zed/files/zed-1.1.0-wayland-only.patch
    echo 'Result: new-release' ;;
  *--create-handoff*) touch "$MOCK_HANDOFF" ;;
  *) exit 0 ;;
esac
''')
            python.chmod(0o755)
            temp = root / 'runner'
            temp.mkdir()
            output = root / 'output'
            summary = root / 'summary'
            output.touch()
            summary.touch()
            env = os.environ.copy()
            env.update(PATH=f'{bindir}:' + env['PATH'], GITHUB_WORKSPACE=str(root),
                       RUNNER_TEMP=str(temp), GITHUB_OUTPUT=str(output),
                       GITHUB_STEP_SUMMARY=str(summary), GITHUB_SHA='a' * 40,
                       GENTOO_PORTAGE_IMAGE='image', GENTOO_STAGE3_IMAGE='image',
                       GITHUB_EVENT_NAME='schedule' if normal else 'workflow_dispatch',
                       INDEPENDENT_VALIDATION='false' if normal else 'true',
                       MOCK_UP_TO_DATE='1' if normal else '0',
                       MOCK_FIXTURE=str(fixture), MOCK_HANDOFF=str(root / 'published'))
            result = subprocess.run([str(ROOT / 'scripts/ci/validate-release-candidate.sh')],
                                    env=env, capture_output=True, text=True)
            return result, output.read_text(), (root / 'published').exists()

    def test_validation_only_never_creates_handoff(self) -> None:
        result, output, handoff = self.run_validation(False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, 'handoff_ready=false\n')
        self.assertFalse(handoff)

    def test_validation_failure_propagates_and_never_creates_handoff(self) -> None:
        result, output, handoff = self.run_validation(True)
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertEqual(output, 'handoff_ready=false\n')
        self.assertFalse(handoff)

    def test_normal_up_to_date_run_preserves_handoff_behavior(self) -> None:
        result, output, handoff = self.run_validation(False, normal=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, 'handoff_ready=false\n')
        self.assertFalse(handoff)

    def test_workflow_adds_independent_guards_without_write_permissions(self) -> None:
        workflow = (ROOT / '.github/workflows/zed-release-watcher.yml').read_text()
        self.assertIn('timeout-minutes: 90', workflow)
        self.assertGreaterEqual(workflow.count("!(github.event_name == 'workflow_dispatch' && inputs.independent_validation)"), 3)
        self.assertEqual(workflow.count('contents: write'), 1)
        self.assertEqual(workflow.count('pull-requests: write'), 1)


if __name__ == '__main__':
    unittest.main()
