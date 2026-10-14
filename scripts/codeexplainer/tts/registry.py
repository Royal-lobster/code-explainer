"""Chooses a TTS backend for this machine without importing engines it will not use."""

from __future__ import annotations

import importlib
import importlib.util
import os
import platform
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from codeexplainer.tts.base import BackendUnavailable, TTSBackend

FindSpec = Callable[[str], object | None]


@dataclass(frozen=True)
class BackendSpec:
    """How to detect and construct one backend.

    Attributes:
        name: Value accepted by ``TTS_BACKEND``.
        factory: ``"module:Class"`` path, imported only when selected.
        requires: Top-level modules that must be importable.
        install_hint: Shown to the user when the backend is missing.
    """

    name: str
    factory: str
    requires: tuple[str, ...]
    install_hint: str


BACKENDS: dict[str, BackendSpec] = {
    "mlx": BackendSpec(
        "mlx",
        "codeexplainer.tts.mlx_kokoro:MlxKokoroBackend",
        ("mlx_audio",),
        "pip install mlx-audio (Apple Silicon macOS only)",
    ),
    "torch": BackendSpec(
        "torch",
        "codeexplainer.tts.torch_kokoro:TorchKokoroBackend",
        ("kokoro",),
        "pip install kokoro",
    ),
    "fake": BackendSpec("fake", "codeexplainer.tts.fake:FakeBackend", (), "built in"),
}


def auto_order(system: str | None = None, machine: str | None = None) -> list[str]:
    """Return backend names to try, best first, for an OS and CPU.

    Args:
        system: ``platform.system()`` value; defaults to the current one.
        machine: ``platform.machine()`` value; defaults to the current one.

    Returns:
        ``["mlx", "torch"]`` on Apple Silicon, otherwise ``["torch"]``.
    """
    system = system or platform.system()
    machine = machine or platform.machine()
    if system == "Darwin" and machine == "arm64":
        return ["mlx", "torch"]
    return ["torch"]


def _installed(spec: BackendSpec, find_spec: FindSpec) -> bool:
    """Report whether every module a backend needs is importable."""
    return all(find_spec(module) is not None for module in spec.requires)


def resolve_backend_name(
    requested: str | None = None,
    *,
    specs: Mapping[str, BackendSpec] = BACKENDS,
    find_spec: FindSpec = importlib.util.find_spec,
    system: str | None = None,
    machine: str | None = None,
) -> str:
    """Decide which backend to use, cheaply (no engine is imported).

    Args:
        requested: ``auto`` or a backend name; defaults to ``$TTS_BACKEND`` or ``auto``.
        specs: Known backends.
        find_spec: Module detector, injectable for tests.
        system: Override for ``platform.system()``.
        machine: Override for ``platform.machine()``.

    Returns:
        A key of ``specs``.

    Raises:
        BackendUnavailable: If the name is unknown or no suitable engine is installed.
    """
    name = (requested or os.environ.get("TTS_BACKEND") or "auto").strip().lower()
    if name == "auto":
        order = auto_order(system, machine)
        for candidate in order:
            if _installed(specs[candidate], find_spec):
                return candidate
        hints = "; ".join(f"{n}: {specs[n].install_hint}" for n in order)
        raise BackendUnavailable(
            f"No TTS backend is installed for this machine. Re-run setup.sh, or {hints}"
        )
    if name not in specs:
        raise BackendUnavailable(
            f"Unknown TTS_BACKEND {name!r}; choose one of: auto, {', '.join(specs)}"
        )
    if not _installed(specs[name], find_spec):
        raise BackendUnavailable(
            f"TTS backend {name!r} is not installed: {specs[name].install_hint}"
        )
    return name


def create_backend(
    requested: str | None = None,
    *,
    model_id: str | None = None,
    specs: Mapping[str, BackendSpec] = BACKENDS,
    find_spec: FindSpec = importlib.util.find_spec,
) -> TTSBackend:
    """Resolve, import and construct a backend.

    Args:
        requested: See ``resolve_backend_name``.
        model_id: Model override; defaults to ``$TTS_MODEL`` or the backend's default.
        specs: Known backends.
        find_spec: Module detector, injectable for tests.

    Returns:
        A loaded backend.

    Raises:
        BackendUnavailable: If no backend can be used.
    """
    name = resolve_backend_name(requested, specs=specs, find_spec=find_spec)
    module_name, _, attr = specs[name].factory.partition(":")
    backend_cls = getattr(importlib.import_module(module_name), attr)
    return backend_cls(model_id=model_id or os.environ.get("TTS_MODEL") or None)
