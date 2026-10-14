"""Kokoro via the official PyTorch package (Linux, Windows, Intel and Apple Silicon Macs)."""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np

from codeexplainer.tts.base import SENTENCE_SPLIT, BackendUnavailable

DEFAULT_MODEL = "hexgrad/Kokoro-82M"


class TorchKokoroBackend:
    """Kokoro-82M running on PyTorch (CUDA when available, else CPU)."""

    name = "torch"

    def __init__(self, model_id: str | None = None) -> None:
        """Load the pipeline.

        Args:
            model_id: Hugging Face repo id; defaults to ``DEFAULT_MODEL``.

        Raises:
            BackendUnavailable: If the kokoro package is not importable.
        """
        try:
            from kokoro import KPipeline
        except ImportError as exc:
            raise BackendUnavailable(f"kokoro is not installed ({exc})") from exc
        self._pipeline = KPipeline(lang_code="a", repo_id=model_id or DEFAULT_MODEL)

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[np.ndarray]:
        """Yield audio per sentence (see ``TTSBackend.synthesize``)."""
        for result in self._pipeline(text, voice=voice, speed=speed, split_pattern=SENTENCE_SPLIT):
            if result.audio is None:
                continue
            yield result.audio.detach().cpu().numpy().astype(np.float32).reshape(-1)
