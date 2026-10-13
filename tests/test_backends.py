"""Tests for the concrete backends, without any real engine installed."""

from __future__ import annotations

import sys
import types

import numpy as np
import pytest
from codeexplainer.protocol import SAMPLE_RATE
from codeexplainer.tts.base import BackendUnavailable
from codeexplainer.tts.fake import FakeBackend


def test_fake_one_chunk_per_sentence() -> None:
    """The fake backend splits like the real ones and emits float32."""
    chunks = list(FakeBackend().synthesize("One. Two! Three?", "af_heart", 1.0))
    assert len(chunks) == 3
    assert all(c.dtype == np.float32 and c.ndim == 1 for c in chunks)
    assert chunks[0].size == FakeBackend.samples_per_sentence(1.0) == SAMPLE_RATE // 10


def test_fake_speed_shortens_audio() -> None:
    """Faster speech means fewer samples."""
    assert FakeBackend.samples_per_sentence(2.0) == FakeBackend.samples_per_sentence(1.0) // 2


def test_fake_blank_text_yields_nothing() -> None:
    """Whitespace produces no audio."""
    assert list(FakeBackend().synthesize("   ", "af_heart", 1.0)) == []


def install_modules(monkeypatch: pytest.MonkeyPatch, modules: dict[str, object]) -> None:
    """Register stand-in modules in ``sys.modules`` for the duration of a test."""
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)


def test_torch_backend_unavailable_without_kokoro(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing engine surfaces as BackendUnavailable."""
    from codeexplainer.tts.torch_kokoro import TorchKokoroBackend

    install_modules(monkeypatch, {"kokoro": None})
    with pytest.raises(BackendUnavailable, match="kokoro"):
        TorchKokoroBackend()


def test_mlx_backend_unavailable_without_mlx_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing engine surfaces as BackendUnavailable."""
    from codeexplainer.tts.mlx_kokoro import MlxKokoroBackend

    install_modules(monkeypatch, {"mlx_audio": None})
    with pytest.raises(BackendUnavailable, match="mlx-audio"):
        MlxKokoroBackend()


class FakeTensor:
    """Mimics the slice of the torch.Tensor API the backend uses."""

    def __init__(self, data: np.ndarray) -> None:
        self._data = data

    def detach(self) -> FakeTensor:
        """Return self, like a tensor with no grad."""
        return self

    def cpu(self) -> FakeTensor:
        """Return self, like a CPU tensor."""
        return self

    def numpy(self) -> np.ndarray:
        """Return the wrapped array."""
        return self._data


def test_torch_backend_converts_and_skips_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tensors become flat float32 arrays; results without audio are skipped."""
    calls: dict[str, object] = {}

    class KPipeline:
        """Stand-in for kokoro.KPipeline."""

        def __init__(self, lang_code: str, repo_id: str) -> None:
            calls["init"] = (lang_code, repo_id)

        def __call__(self, text: str, voice: str, speed: float, split_pattern: str):
            """Yield two results, one without audio."""
            calls["call"] = (text, voice, speed)
            yield types.SimpleNamespace(audio=FakeTensor(np.ones((1, 4), dtype=np.float64)))
            yield types.SimpleNamespace(audio=None)

    install_modules(monkeypatch, {"kokoro": types.SimpleNamespace(KPipeline=KPipeline)})
    from codeexplainer.tts.torch_kokoro import TorchKokoroBackend

    chunks = list(TorchKokoroBackend().synthesize("Hi.", "af_heart", 1.5))
    assert calls["init"] == ("a", "hexgrad/Kokoro-82M")
    assert calls["call"] == ("Hi.", "af_heart", 1.5)
    assert len(chunks) == 1 and chunks[0].dtype == np.float32 and chunks[0].shape == (4,)


def test_mlx_backend_converts(monkeypatch: pytest.MonkeyPatch) -> None:
    """MLX arrays become flat float32 arrays and the model id is honored."""
    loaded: list[str] = []

    class KokoroPipeline:
        """Stand-in for mlx_audio's KokoroPipeline."""

        def __init__(self, lang_code: str, model: object, repo_id: str) -> None:
            self.repo_id = repo_id

        def __call__(self, text: str, voice: str, speed: float, split_pattern: str):
            """Yield one result."""
            yield types.SimpleNamespace(audio=np.zeros((1, 3), dtype=np.float16))

    install_modules(
        monkeypatch,
        {
            "mlx_audio": types.ModuleType("mlx_audio"),
            "mlx_audio.tts": types.ModuleType("mlx_audio.tts"),
            "mlx_audio.tts.models": types.ModuleType("mlx_audio.tts.models"),
            "mlx_audio.tts.models.kokoro": types.SimpleNamespace(KokoroPipeline=KokoroPipeline),
            "mlx_audio.tts.utils": types.SimpleNamespace(load_model=lambda m: loaded.append(m)),
        },
    )
    from codeexplainer.tts.mlx_kokoro import MlxKokoroBackend

    chunks = list(MlxKokoroBackend(model_id="custom/model").synthesize("Hi.", "af_heart", 1.0))
    assert loaded == ["custom/model"]
    assert chunks[0].dtype == np.float32 and chunks[0].shape == (3,)
