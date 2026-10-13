"""Client side of the TTS server: find it, start it, talk to it (stdlib only)."""

from __future__ import annotations

import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

from codeexplainer import paths, protocol
from codeexplainer.endpoint import Endpoint, read_endpoint, remove_endpoint

SERVER_SCRIPT = Path(__file__).resolve().parent.parent / "tts_server.py"


def _command(ep: Endpoint, request: dict, timeout: float) -> bool:
    """Send a control request and report whether the server acknowledged it."""
    try:
        with socket.create_connection((ep.host, ep.port), timeout=timeout) as sock:
            protocol.send_request(sock, {"token": ep.token, **request})
            for _ in protocol.read_frames(sock):
                pass
        return True
    except OSError:
        return False


def ping(ep: Endpoint, timeout: float = 2.0) -> bool:
    """Report whether a server is alive at ``ep`` and accepts its token."""
    return _command(ep, {"ping": True}, timeout)


def shutdown(ep: Endpoint, timeout: float = 5.0) -> bool:
    """Ask the server at ``ep`` to exit. Returns True if it acknowledged."""
    return _command(ep, {"shutdown": True}, timeout)


def stream_audio(
    ep: Endpoint, text: str, voice: str, speed: float, timeout: float = 120.0
) -> Iterator[bytes]:
    """Synthesize ``text`` and yield raw little-endian float32 chunks.

    Args:
        ep: Server endpoint.
        text: Narration.
        voice: Voice id.
        speed: Rate multiplier.
        timeout: Per-socket-operation timeout in seconds.

    Yields:
        Audio chunks as they are generated.

    Raises:
        OSError: If the server is unreachable or the stream breaks (``ProtocolError``).
    """
    with socket.create_connection((ep.host, ep.port), timeout=timeout) as sock:
        protocol.send_request(
            sock, {"token": ep.token, "text": text, "voice": voice, "speed": speed}
        )
        yield from protocol.read_frames(sock)


def live_endpoint() -> Endpoint | None:
    """Return the running server's endpoint, cleaning up a stale file if found."""
    ep = read_endpoint()
    if ep is None:
        return None
    if ping(ep):
        return ep
    remove_endpoint(only_if_pid=ep.pid)
    return None


def ensure_server(python: Path | None = None, start_timeout: float = 120.0) -> Endpoint:
    """Return a live server endpoint, starting a daemon if needed.

    Args:
        python: Interpreter with the TTS dependencies; defaults to ``paths.default_python()``.
        start_timeout: Seconds to wait for the model to load.

    Returns:
        The live endpoint.

    Raises:
        RuntimeError: If the daemon refused to start (e.g. no backend installed).
        TimeoutError: If the server did not become ready in time.
    """
    ep = live_endpoint()
    if ep is not None:
        return ep
    python = python or paths.default_python()
    result = subprocess.run(
        [str(python), str(SERVER_SCRIPT), "--daemon"], capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"TTS server failed to start: {(result.stderr or result.stdout).strip()}"
        )
    deadline = time.monotonic() + start_timeout
    while time.monotonic() < deadline:
        ep = live_endpoint()
        if ep is not None:
            return ep
        time.sleep(0.25)
    raise TimeoutError(f"TTS server not ready after {start_timeout:.0f}s; see {paths.log_file()}")
