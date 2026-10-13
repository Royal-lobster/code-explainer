"""In-process tests for the TTS server."""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from codeexplainer import client, protocol, server
from codeexplainer.endpoint import Endpoint, read_endpoint
from codeexplainer.tts.fake import FakeBackend


class FloodBackend:
    """Produces far more audio than socket buffers hold."""

    name = "flood"

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[np.ndarray]:
        """Yield 200 one-second chunks."""
        for _ in range(200):
            yield np.zeros(protocol.SAMPLE_RATE, dtype=np.float32)


class ExplodingBackend(FakeBackend):
    """Fails on demand."""

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[np.ndarray]:
        """Raise for the text ``boom``, otherwise behave like FakeBackend."""
        if text == "boom":
            raise RuntimeError("engine crashed")
        yield from super().synthesize(text, voice, speed)


def start(backend: object, **kwargs: float) -> tuple[server.TTSServer, threading.Thread, Endpoint]:
    """Start a server on a background thread."""
    srv = server.TTSServer(backend, poll_interval=0.05, **kwargs)
    ep = srv.start()
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    return srv, thread, ep


@pytest.fixture
def running(state_dir: Path) -> Iterator[tuple[server.TTSServer, Endpoint]]:
    """A FakeBackend server with idle shutdown disabled."""
    srv, thread, ep = start(ExplodingBackend(), idle_timeout=0)
    yield srv, ep
    srv.stop()
    thread.join(timeout=5)


def test_endpoint_published_on_loopback(running: tuple[server.TTSServer, Endpoint]) -> None:
    """The server advertises a loopback port and a strong token."""
    _, ep = running
    assert read_endpoint() == ep
    assert ep.host == "127.0.0.1" and ep.port > 0 and len(ep.token) >= 32


def test_ping_and_stream(running: tuple[server.TTSServer, Endpoint]) -> None:
    """One frame per sentence, each a little-endian float32 sentence."""
    _, ep = running
    assert client.ping(ep)
    chunks = list(client.stream_audio(ep, "One. Two. Three.", "af_heart", 1.0))
    assert len(chunks) == 3
    assert all(len(c) == FakeBackend.samples_per_sentence(1.0) * 4 for c in chunks)
    assert np.frombuffer(chunks[0], dtype="<f4").max() > 0


def test_blank_text_returns_only_end_frame(running: tuple[server.TTSServer, Endpoint]) -> None:
    """Empty narration is a valid, empty response."""
    _, ep = running
    assert list(client.stream_audio(ep, "   ", "af_heart", 1.0)) == []


def test_large_unicode_request(running: tuple[server.TTSServer, Endpoint]) -> None:
    """A long non-ASCII narration arrives intact."""
    _, ep = running
    assert len(list(client.stream_audio(ep, "Ünïcødé text " * 20000, "af_heart", 1.0))) == 1


def test_wrong_token_gets_nothing(running: tuple[server.TTSServer, Endpoint]) -> None:
    """Without the token there is no audio, no shutdown, and the server survives."""
    srv, ep = running
    intruder = replace(ep, token="guess")
    assert not client.ping(intruder)
    assert not client.shutdown(intruder)
    with pytest.raises(protocol.ProtocolError):
        list(client.stream_audio(intruder, "Hello.", "af_heart", 1.0))
    assert client.ping(ep)


def test_backend_error_keeps_server_alive(running: tuple[server.TTSServer, Endpoint]) -> None:
    """An engine exception fails that request only."""
    _, ep = running
    with pytest.raises(protocol.ProtocolError):
        list(client.stream_audio(ep, "boom", "af_heart", 1.0))
    assert client.ping(ep)


def test_client_abort_mid_stream_keeps_server_alive(state_dir: Path) -> None:
    """Skipping a segment (closing mid-stream) must not kill the server."""
    srv, thread, ep = start(FloodBackend(), idle_timeout=0)
    try:
        with socket.create_connection((ep.host, ep.port), timeout=5) as sock:
            protocol.send_request(sock, {"token": ep.token, "text": "Long narration."})
            assert protocol.recv_exactly(sock, 4) is not None
        deadline = time.monotonic() + 10
        while not client.ping(ep):
            assert time.monotonic() < deadline, "server stopped answering after client abort"
            time.sleep(0.1)
    finally:
        srv.stop()
        thread.join(timeout=10)


def test_shutdown_request_stops_and_cleans_up(state_dir: Path) -> None:
    """An authenticated shutdown stops the loop and removes the endpoint."""
    srv, thread, ep = start(FakeBackend(), idle_timeout=0)
    assert client.shutdown(ep)
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert read_endpoint() is None


def test_idle_timeout_stops_and_cleans_up(state_dir: Path) -> None:
    """An unused server frees its memory by exiting."""
    _, thread, _ = start(FakeBackend(), idle_timeout=0.2)
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert read_endpoint() is None


def test_second_server_defers_to_live_one(
    running: tuple[server.TTSServer, Endpoint], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A racing second start exits without overwriting the live endpoint."""
    _, ep = running
    monkeypatch.setenv("TTS_BACKEND", "fake")
    assert server.run() == 0
    assert read_endpoint() == ep
