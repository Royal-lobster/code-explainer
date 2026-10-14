"""Tests for platform-neutral path resolution."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from codeexplainer import paths


def test_state_dir_honors_override(state_dir: Path) -> None:
    """The env override wins and the directory is created."""
    assert paths.state_dir() == state_dir
    assert state_dir.is_dir()


def test_state_dir_defaults_under_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Without an override the state dir lives in the user's home directory."""
    monkeypatch.delenv("CODE_EXPLAINER_STATE_DIR", raising=False)
    monkeypatch.setattr(paths.Path, "home", classmethod(lambda cls: tmp_path))
    assert paths.state_dir() == tmp_path / ".code-explainer" / "run"


def test_endpoint_and_log_live_in_state_dir(state_dir: Path) -> None:
    """Runtime files sit together in the state dir."""
    assert paths.endpoint_file() == state_dir / "tts-server.json"
    assert paths.log_file() == state_dir / "tts-server.log"


@pytest.mark.parametrize(
    ("platform", "tail"),
    [
        ("win32", ("Scripts", "python.exe")),
        ("linux", ("bin", "python3")),
        ("darwin", ("bin", "python3")),
    ],
)
def test_venv_python_layout(platform: str, tail: tuple[str, str]) -> None:
    """Each OS uses its own venv layout."""
    assert paths.venv_python(Path("root"), platform).parts[-3:] == (".venv", *tail)


def test_default_python_prefers_workspace_venv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """TTS_WORKSPACE_ROOT's venv is used when it exists."""
    python = paths.venv_python(tmp_path)
    python.parent.mkdir(parents=True)
    python.touch()
    monkeypatch.setenv("TTS_WORKSPACE_ROOT", str(tmp_path))
    assert paths.default_python() == python


def test_default_python_falls_back_to_current_interpreter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no venv anywhere the running interpreter is used."""
    monkeypatch.delenv("TTS_WORKSPACE_ROOT", raising=False)
    monkeypatch.setattr(paths, "PROJECT_ROOT", tmp_path)
    assert paths.default_python() == Path(sys.executable)
