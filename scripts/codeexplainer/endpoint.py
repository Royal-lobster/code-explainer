"""The endpoint file: how clients find and authenticate to the TTS server."""

from __future__ import annotations

import contextlib
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from codeexplainer import paths


@dataclass(frozen=True)
class Endpoint:
    """Where a TTS server listens and the secret clients must present.

    Attributes:
        host: Loopback address the server is bound to.
        port: TCP port.
        token: Shared secret required on every request.
        pid: Server process id, for diagnostics and safe cleanup only.
    """

    host: str
    port: int
    token: str
    pid: int


def write_endpoint(ep: Endpoint, path: Path | None = None) -> None:
    """Atomically publish an endpoint, readable only by the current user.

    Args:
        ep: Endpoint to publish.
        path: Destination; defaults to ``paths.endpoint_file()``.
    """
    path = path or paths.endpoint_file()
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(asdict(ep), f)
    os.replace(tmp, path)


def read_endpoint(path: Path | None = None) -> Endpoint | None:
    """Read the published endpoint.

    Args:
        path: Source; defaults to ``paths.endpoint_file()``.

    Returns:
        The endpoint, or None if the file is missing or malformed.
    """
    path = path or paths.endpoint_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ep = Endpoint(host=data["host"], port=data["port"], token=data["token"], pid=data["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    types_ok = (
        isinstance(ep.host, str)
        and isinstance(ep.port, int)
        and isinstance(ep.token, str)
        and isinstance(ep.pid, int)
    )
    return ep if types_ok else None


def remove_endpoint(only_if_pid: int | None = None, path: Path | None = None) -> None:
    """Delete the endpoint file.

    Args:
        only_if_pid: If given, delete only when the file still names this PID,
            so cleaning up a dead server never removes a newer server's file.
        path: File to remove; defaults to ``paths.endpoint_file()``.
    """
    path = path or paths.endpoint_file()
    if only_if_pid is not None:
        current = read_endpoint(path)
        if current is not None and current.pid != only_if_pid:
            return
    with contextlib.suppress(FileNotFoundError):
        path.unlink()
