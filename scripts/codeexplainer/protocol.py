"""Wire protocol shared by the TTS server and its clients (stdlib only).

A client connects over TCP, sends one UTF-8 JSON object and half-closes its
write side. The server answers with frames: a 4-byte big-endian length, then
that many bytes of little-endian float32 mono PCM at ``SAMPLE_RATE``. A
zero-length frame ends the response. ``vscode-extension/src/tts-bridge.ts``
implements the client side in TypeScript.
"""

from __future__ import annotations

import json
import socket
import struct
from collections.abc import Iterator

SAMPLE_RATE = 24000
MAX_REQUEST_BYTES = 1_000_000
_HEADER = struct.Struct("!I")
END_FRAME = _HEADER.pack(0)


class ProtocolError(ConnectionError):
    """Raised when the peer sends malformed data or closes mid-response."""


def encode_frame(payload: bytes) -> bytes:
    """Prefix a non-empty payload with its length.

    Args:
        payload: Audio bytes.

    Returns:
        The framed bytes.

    Raises:
        ValueError: If ``payload`` is empty (that would read as end of stream).
    """
    if not payload:
        raise ValueError("payload must be non-empty; send END_FRAME to finish")
    return _HEADER.pack(len(payload)) + payload


def recv_exactly(sock: socket.socket, n: int) -> bytes | None:
    """Read exactly ``n`` bytes.

    Args:
        sock: Connected socket.
        n: Number of bytes.

    Returns:
        The bytes, or None if the peer closed first.
    """
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def read_frames(sock: socket.socket) -> Iterator[bytes]:
    """Yield frame payloads until the end frame.

    Args:
        sock: Socket the request was sent on.

    Yields:
        Audio payloads in order.

    Raises:
        ProtocolError: If the connection closes before the end frame.
    """
    while True:
        header = recv_exactly(sock, _HEADER.size)
        if header is None:
            raise ProtocolError("connection closed before end of stream")
        (length,) = _HEADER.unpack(header)
        if length == 0:
            return
        payload = recv_exactly(sock, length)
        if payload is None:
            raise ProtocolError("connection closed mid-frame")
        yield payload


def read_request(sock: socket.socket, max_bytes: int = MAX_REQUEST_BYTES) -> dict:
    """Read a JSON request until the client half-closes.

    Args:
        sock: Accepted connection.
        max_bytes: Size limit.

    Returns:
        The decoded request object.

    Raises:
        ProtocolError: If the request is empty, too large, or not a UTF-8 JSON object.
    """
    buf = bytearray()
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        buf += chunk
        if len(buf) > max_bytes:
            raise ProtocolError("request too large")
    if not buf:
        raise ProtocolError("empty request")
    try:
        request = json.loads(buf.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"malformed request: {exc}") from exc
    if not isinstance(request, dict):
        raise ProtocolError("request must be a JSON object")
    return request


def send_request(sock: socket.socket, request: dict) -> None:
    """Send a JSON request and half-close the write side.

    Args:
        sock: Connected socket.
        request: JSON-serialisable object.
    """
    sock.sendall(json.dumps(request).encode("utf-8"))
    sock.shutdown(socket.SHUT_WR)
