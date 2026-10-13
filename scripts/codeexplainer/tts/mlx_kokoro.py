"""Kokoro on Apple Silicon via mlx-audio (GPU-accelerated)."""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np

from codeexplainer.tts.base import SENTENCE_SPLIT, BackendUnavailable

DEFAULT_MODEL = "prince-canuma/Kokoro-82M"


class MlxKokoroBackend:
    """Kokoro-82M running on MLX."""

    name = "mlx"

    def __init__(self, model_id: str | None = None) -> None:
        """Load the model.

        Args:
            model_id: Hugging Face repo id; defaults to ``DEFAULT_MODEL``.

        Raises:
            BackendUnavailable: If mlx-audio is not importable.
        """
        try:
            from mlx_audio.tts.models.kokoro import KokoroPipeline
            from mlx_audio.tts.utils import load_model
        except ImportError as exc:
            raise BackendUnavailable(f"mlx-audio is not installed ({exc})") from exc
        model_id = model_id or DEFAULT_MODEL
        model = load_model(model_id)
        self._pipeline = KokoroPipeline(lang_code="a", model=model, repo_id=model_id)

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[np.ndarray]:
        """Yield audio per sentence (see ``TTSBackend.synthesize``)."""
        for result in self._pipeline(text, voice=voice, speed=speed, split_pattern=SENTENCE_SPLIT):
            yield np.array(result.audio).astype(np.float32).reshape(-1)
