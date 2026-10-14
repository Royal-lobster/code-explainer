"""Start a process that outlives its parent, on any OS."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def spawn_detached(argv: list[str], log_path: Path, env: dict[str, str] | None = None) -> int:
    """Launch ``argv`` detached from the caller's session and console.

    Args:
        argv: Command and arguments.
        log_path: File receiving stdout and stderr (appended).
        env: Environment; defaults to the caller's.

    Returns:
        The child's PID.
    """
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        platform_kwargs: dict[str, object] = {"creationflags": flags}
    else:
        platform_kwargs = {"start_new_session": True}
    with open(log_path, "ab") as log:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            env=env,
            close_fds=True,
            **platform_kwargs,
        )
    return proc.pid
