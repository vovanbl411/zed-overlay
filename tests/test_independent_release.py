from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]


class IndependentReleaseTests(unittest.TestCase):
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
