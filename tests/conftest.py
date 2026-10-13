"""Shared pytest fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def state_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point every Code Explainer process at an isolated state directory.

    Returns:
        The directory exported as ``CODE_EXPLAINER_STATE_DIR``.
    """
    path = tmp_path / "state"
    monkeypatch.setenv("CODE_EXPLAINER_STATE_DIR", str(path))
    return path
