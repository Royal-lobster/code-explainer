"""Tests for the TTS wire protocol."""

from __future__ import annotations

import json
import socket
import threading

import pytest
from codeexplainer import protocol


def pair() -> tuple[socket.socket, socket.socket]:
    """Return a connected socket pair (works on every OS)."""
    return socket.socketpair()


def test_frames_roundtrip() -> None:
    """Frames come out as they went in, and the end frame stops iteration."""
    a, b = pair()
    with a, b:
        a.sendall(
            protocol.encode_frame(b"abcd") + protocol.encode_frame(b"ef") + protocol.END_FRAME
        )
        assert list(protocol.read_frames(b)) == [b"abcd", b"ef"]


def test_close_before_end_frame_raises() -> None:
    """A server dying mid-response is an error, not a silent short answer."""
    a, b = pair()
    with b:
        a.sendall(protocol.encode_frame(b"abcd"))
        a.close()
        with pytest.raises(protocol.ProtocolError):
            list(protocol.read_frames(b))


def test_close_mid_frame_raises() -> None:
    """A truncated payload raises."""
    a, b = pair()
    with b:
        a.sendall(protocol.encode_frame(b"abcdefgh")[:6])
        a.close()
        with pytest.raises(protocol.ProtocolError):
            list(protocol.read_frames(b))


def test_empty_payload_rejected() -> None:
    """Zero-length data frames would be read as the end of stream."""
    with pytest.raises(ValueError):
        protocol.encode_frame(b"")


def test_request_split_across_many_sends() -> None:
    """Large, non-ASCII requests arriving in pieces are reassembled."""
    a, b = pair()
    request = {"token": "t", "text": "Ünïcødé narration " * 20000}

    def send() -> None:
        """Send the request from another thread so buffers cannot deadlock."""
        protocol.send_request(a, request)

    with a, b:
        sender = threading.Thread(target=send)
        sender.start()
        assert protocol.read_request(b) == request
        sender.join()


@pytest.mark.parametrize("raw", [b"", b"not json", b"[1, 2]", b"\xff\xfe"])
def test_bad_requests_raise(raw: bytes) -> None:
    """Empty, malformed, non-object and non-UTF-8 requests raise ProtocolError."""
    a, b = pair()
    with b:
        a.sendall(raw)
        a.close()
        with pytest.raises(protocol.ProtocolError):
            protocol.read_request(b)


def test_oversized_request_raises() -> None:
    """Requests over the limit are refused."""
    a, b = pair()
    with b:
        a.sendall(json.dumps({"text": "x" * 200}).encode())
        a.close()
        with pytest.raises(protocol.ProtocolError):
            protocol.read_request(b, max_bytes=100)
