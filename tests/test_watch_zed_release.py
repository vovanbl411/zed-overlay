from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "watch_zed_release.py"
SPEC = importlib.util.spec_from_file_location("watch_zed_release", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
WATCHER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = WATCHER
SPEC.loader.exec_module(WATCHER)


def release(tag: str, *, draft: bool = False, prerelease: bool = False) -> dict[str, object]:
    return {
        "tag_name": tag,
        "html_url": f"https://github.com/zed-industries/zed/releases/tag/{tag}",
        "draft": draft,
        "prerelease": prerelease,
    }


def create_overlay(root: Path, versions: tuple[str, ...] = ("1.15.0",)) -> None:
    package_dir = root / "app-editors/zed"
    package_dir.mkdir(parents=True)
    for version in versions:
        (package_dir / f"zed-{version}.ebuild").touch()


class FakeResponse:
    def __init__(self, body: bytes, *, status: int = 200) -> None:
        self.body = io.BytesIO(body)
        self.status = status

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        return False

    def read(self, size: int = -1) -> bytes:
        return self.body.read(size)


class WatchZedReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        create_overlay(self.root)

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_detects_newer_upstream_stable_release(self) -> None:
        result = WATCHER.watch(self.root, [release("v1.16.0")])

        self.assertEqual(result.outcome, "new-release")
        self.assertEqual(result.packaged_version, (1, 15, 0))
        self.assertEqual(result.upstream_release.version, (1, 16, 0))
        self.assertEqual(result.upstream_release.tag, "v1.16.0")
        self.assertIn("v1.16.0", result.upstream_release.url)

    def test_reports_up_to_date_for_equal_or_older_upstream_release(self) -> None:
        for tag in ("v1.15.0", "v1.14.0"):
            with self.subTest(tag=tag):
                self.assertEqual(WATCHER.watch(self.root, [release(tag)]).outcome, "up-to-date")

    def test_selects_highest_release_numerically(self) -> None:
        selected = WATCHER.latest_stable_release(
            [release("v1.9.0"), release("v1.10.0"), release("v1.8.9")]
        )

        self.assertEqual(selected.version, (1, 10, 0))

    def test_ignores_draft_and_prerelease_entries(self) -> None:
        selected = WATCHER.latest_stable_release(
            [
                release("v1.17.0", draft=True),
                release("v1.16.0", prerelease=True),
                release("v1.15.1"),
            ]
        )

        self.assertEqual(selected.tag, "v1.15.1")

    def test_ignores_malformed_and_nonstable_tags(self) -> None:
        selected = WATCHER.latest_stable_release(
            [
                release("v1.16.0-rc1"),
                release("v1.16.0-pre1"),
                release("nightly"),
                release("v1.15.1"),
            ]
        )

        self.assertEqual(selected.tag, "v1.15.1")

    def test_finds_latest_packaged_version_without_hardcoding(self) -> None:
        create_overlay(self.root / "multiple", ("1.9.0", "1.10.0", "1.8.9"))

        latest = WATCHER.latest_packaged_ebuild(self.root / "multiple")

        self.assertEqual(latest.version, (1, 10, 0))

    def test_rejects_overlay_without_stable_ebuild(self) -> None:
        empty_root = self.root / "empty"
        (empty_root / "app-editors/zed").mkdir(parents=True)

        with self.assertRaisesRegex(WATCHER.WatcherError, "No stable Zed ebuild"):
            WATCHER.latest_packaged_ebuild(empty_root)

    def test_rejects_invalid_json_and_response_shape(self) -> None:
        client = WATCHER.GitHubClient()
        for body in (b"{", json.dumps({"tag_name": "v1.16.0"}).encode()):
            with self.subTest(body=body):
                with patch.object(WATCHER, "urlopen", return_value=FakeResponse(body)):
                    with self.assertRaises(WATCHER.WatcherError):
                        client.fetch_releases()

    def test_rejects_network_and_api_failures(self) -> None:
        client = WATCHER.GitHubClient()
        failures = (
            WATCHER.URLError("offline"),
            WATCHER.HTTPError(WATCHER.RELEASES_URL, 503, "unavailable", None, None),
            TimeoutError("timed out"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with patch.object(WATCHER, "urlopen", side_effect=failure):
                    with self.assertRaises(WATCHER.WatcherError):
                        client.fetch_releases()

    def test_rejects_when_no_suitable_stable_upstream_release_exists(self) -> None:
        with self.assertRaisesRegex(WATCHER.WatcherError, "no suitable stable"):
            WATCHER.latest_stable_release(
                [
                    release("v1.16.0", draft=True),
                    release("v1.16.0-rc1"),
                    release("nightly"),
                ]
            )
