"""Filesystem locations shared by every Code Explainer process, resolved per OS.

The VS Code extension mirrors this logic in ``vscode-extension/src/tts/paths.ts``;
keep the two in sync.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

STATE_DIR_ENV = "CODE_EXPLAINER_STATE_DIR"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def state_dir() -> Path:
    """Return the per-user runtime directory, creating it if needed.

    Returns:
        ``$CODE_EXPLAINER_STATE_DIR`` when set, else ``~/.code-explainer/run``.
    """
    override = os.environ.get(STATE_DIR_ENV)
    path = Path(override) if override else Path.home() / ".code-explainer" / "run"
    path.mkdir(parents=True, exist_ok=True)
    return path


def endpoint_file() -> Path:
    """Return the path of the file advertising the running TTS server."""
    return state_dir() / "tts-server.json"


def log_file() -> Path:
    """Return the path of the TTS server log."""
    return state_dir() / "tts-server.log"


def venv_python(project_root: Path, platform: str | None = None) -> Path:
    """Return the interpreter inside ``project_root/.venv`` for an OS.

    Args:
        project_root: Directory containing ``.venv``.
        platform: A ``sys.platform`` value; defaults to the current one.

    Returns:
        ``Scripts/python.exe`` on Windows, ``bin/python3`` elsewhere.
    """
    if (platform or sys.platform) == "win32":
        return project_root / ".venv" / "Scripts" / "python.exe"
    return project_root / ".venv" / "bin" / "python3"


def default_python() -> Path:
    """Pick the interpreter that has the TTS dependencies installed.

    Checks ``$TTS_WORKSPACE_ROOT/.venv`` (set by the VS Code extension), then
    this project's ``.venv``, then falls back to the running interpreter.

    Returns:
        Path to a Python executable.
    """
    roots = [Path(r) for r in [os.environ.get("TTS_WORKSPACE_ROOT")] if r]
    roots.append(PROJECT_ROOT)
    for root in roots:
        candidate = venv_python(root)
        if candidate.is_file():
            return candidate
    return Path(sys.executable)
