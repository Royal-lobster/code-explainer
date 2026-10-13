"""Tests for the endpoint file."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from codeexplainer import paths
from codeexplainer.endpoint import Endpoint, read_endpoint, remove_endpoint, write_endpoint

EP = Endpoint(host="127.0.0.1", port=50123, token="abc", pid=4242)


def test_roundtrip(state_dir: Path) -> None:
    """What is written is read back unchanged, with no temp file left behind."""
    write_endpoint(EP)
    assert read_endpoint() == EP
    assert [p.name for p in state_dir.iterdir()] == ["tts-server.json"]


def test_missing_file_reads_as_none(state_dir: Path) -> None:
    """No file means no server."""
    assert read_endpoint() is None


@pytest.mark.parametrize(
    "content",
    ["not json", "[]", '{"host": "x"}', '{"host": 1, "port": "p", "token": "t", "pid": 1}'],
)
def test_corrupt_file_reads_as_none(state_dir: Path, content: str) -> None:
    """A truncated or hand-edited file is treated as absent, never raised."""
    paths.endpoint_file().write_text(content)
    assert read_endpoint() is None


def test_remove_only_if_pid_matches(state_dir: Path) -> None:
    """A client cleaning up a dead server never deletes a newer server's file."""
    write_endpoint(EP)
    remove_endpoint(only_if_pid=EP.pid + 1)
    assert read_endpoint() == EP
    remove_endpoint(only_if_pid=EP.pid)
    assert read_endpoint() is None


def test_remove_missing_is_noop(state_dir: Path) -> None:
    """Removing twice is harmless."""
    remove_endpoint()
    remove_endpoint()


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permissions")
def test_file_is_private(state_dir: Path) -> None:
    """The token is readable only by the owner."""
    write_endpoint(EP)
    assert os.stat(paths.endpoint_file()).st_mode & 0o777 == 0o600
