"""End-to-end tests that launch tts_server.py as a real detached process."""

from __future__ import annotations

import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from codeexplainer import client
from codeexplainer.endpoint import Endpoint, read_endpoint, write_endpoint

PYTHON = Path(sys.executable)


@pytest.fixture
def fake_env(state_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Run real servers with the fake backend, and always stop them afterwards."""
    monkeypatch.setenv("TTS_BACKEND", "fake")
    monkeypatch.setenv("TTS_IDLE_TIMEOUT", "60")
    yield state_dir
    ep = read_endpoint()
    if ep is not None:
        client.shutdown(ep)


def wait_until_gone(timeout: float = 10.0) -> None:
    """Wait for the endpoint file to disappear."""
    deadline = time.monotonic() + timeout
    while read_endpoint() is not None:
        assert time.monotonic() < deadline, "server did not shut down"
        time.sleep(0.1)


def closed_port() -> int:
    """Return a port that nothing is listening on."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_ensure_server_starts_daemon_and_streams(fake_env: Path) -> None:
    """The full start, stream, shutdown cycle works as a detached process."""
    ep = client.ensure_server(python=PYTHON, start_timeout=30)
    assert len(list(client.stream_audio(ep, "Hello there. General Kenobi.", "af_heart", 1.0))) == 2
    assert client.ensure_server(python=PYTHON) == ep  # reused, not restarted
    assert client.shutdown(ep)
    wait_until_gone()


def test_ensure_server_replaces_stale_endpoint(fake_env: Path) -> None:
    """A file left by a crashed server is cleaned up and a new server started."""
    stale = Endpoint(host="127.0.0.1", port=closed_port(), token="stale", pid=999_999)
    write_endpoint(stale)
    ep = client.ensure_server(python=PYTHON, start_timeout=30)
    assert ep != stale and client.ping(ep)


def test_stop_flag(fake_env: Path) -> None:
    """``tts_server.py --stop`` shuts a running server down on any OS."""
    client.ensure_server(python=PYTHON, start_timeout=30)
    result = subprocess.run(
        [str(PYTHON), str(client.SERVER_SCRIPT), "--stop"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    wait_until_gone()


def test_stop_flag_when_not_running(fake_env: Path) -> None:
    """Stopping nothing is not an error."""
    result = subprocess.run([str(PYTHON), str(client.SERVER_SCRIPT), "--stop"])
    assert result.returncode == 0


def test_daemon_fails_fast_without_backend(fake_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A bad backend is reported immediately with a useful message."""
    monkeypatch.setenv("TTS_BACKEND", "nonexistent")
    started = time.monotonic()
    result = subprocess.run(
        [str(PYTHON), str(client.SERVER_SCRIPT), "--daemon"], capture_output=True, text=True
    )
    assert result.returncode == 1
    assert "Unknown TTS_BACKEND" in result.stderr
    assert time.monotonic() - started < 10
    with pytest.raises(RuntimeError, match="Unknown TTS_BACKEND"):
        client.ensure_server(python=PYTHON)


def test_stop_flag_without_numpy(fake_env: Path) -> None:
    """``--stop`` needs only the stdlib, so the uninstall steps work with a bare system Python."""
    client.ensure_server(python=PYTHON, start_timeout=30)
    result = subprocess.run(
        [str(PYTHON), "-S", str(client.SERVER_SCRIPT), "--stop"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    assert "Stopped" in result.stdout
    wait_until_gone()
