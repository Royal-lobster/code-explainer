"""Tests for backend selection."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from codeexplainer.tts import registry
from codeexplainer.tts.base import BackendUnavailable
from codeexplainer.tts.fake import FakeBackend


def installed(*modules: str) -> Callable[[str], object | None]:
    """Build a find_spec stand-in that reports only ``modules`` as importable."""
    return lambda name: object() if name in modules else None


@pytest.mark.parametrize(
    ("system", "machine", "order"),
    [
        ("Darwin", "arm64", ["mlx", "torch"]),
        ("Darwin", "x86_64", ["torch"]),
        ("Linux", "x86_64", ["torch"]),
        ("Linux", "aarch64", ["torch"]),
        ("Windows", "AMD64", ["torch"]),
    ],
)
def test_auto_order(system: str, machine: str, order: list[str]) -> None:
    """MLX is only ever considered on Apple Silicon."""
    assert registry.auto_order(system, machine) == order


def test_auto_prefers_mlx_on_apple_silicon() -> None:
    """With both installed, Apple Silicon gets the GPU backend."""
    name = registry.resolve_backend_name(
        "auto", find_spec=installed("mlx_audio", "kokoro"), system="Darwin", machine="arm64"
    )
    assert name == "mlx"


def test_auto_falls_back_to_torch_on_apple_silicon() -> None:
    """A Mac without mlx-audio still works through PyTorch."""
    name = registry.resolve_backend_name(
        "auto", find_spec=installed("kokoro"), system="Darwin", machine="arm64"
    )
    assert name == "torch"


def test_auto_on_linux_ignores_mlx() -> None:
    """Linux never selects MLX even if something called mlx_audio is importable."""
    name = registry.resolve_backend_name(
        "auto", find_spec=installed("mlx_audio", "kokoro"), system="Linux", machine="x86_64"
    )
    assert name == "torch"


def test_auto_with_nothing_installed_names_install_command() -> None:
    """The error tells the user what to install."""
    with pytest.raises(BackendUnavailable, match="pip install kokoro"):
        registry.resolve_backend_name(
            "auto", find_spec=installed(), system="Linux", machine="x86_64"
        )


def test_unknown_backend_lists_choices() -> None:
    """A typo in TTS_BACKEND is reported with the valid names."""
    with pytest.raises(BackendUnavailable, match="auto, mlx, torch, fake"):
        registry.resolve_backend_name("mxl", find_spec=installed())


def test_explicit_backend_not_installed() -> None:
    """Asking for an engine that is missing is an error, not a silent fallback."""
    with pytest.raises(BackendUnavailable, match="'torch' is not installed"):
        registry.resolve_backend_name("torch", find_spec=installed())


def test_env_var_selects_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    """TTS_BACKEND is honored when no name is passed."""
    monkeypatch.setenv("TTS_BACKEND", "FAKE")
    assert isinstance(registry.create_backend(), FakeBackend)
