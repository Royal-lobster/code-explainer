"""A model-free backend for tests and diagnostics (``TTS_BACKEND=fake``)."""

from __future__ import annotations

import re
from collections.abc import Iterator

import numpy as np

from codeexplainer.protocol import SAMPLE_RATE
from codeexplainer.tts.base import SENTENCE_SPLIT


class FakeBackend:
    """Emits a short 440 Hz tone per sentence."""

    name = "fake"

    def __init__(self, model_id: str | None = None) -> None:
        """Create the backend; ``model_id`` is accepted for interface parity and ignored."""

    @staticmethod
    def samples_per_sentence(speed: float) -> int:
        """Return how many samples one sentence produces at ``speed``."""
        return int(SAMPLE_RATE * 0.1 / speed)

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[np.ndarray]:
        """Yield one tone per non-empty sentence (see ``TTSBackend.synthesize``)."""
        n = self.samples_per_sentence(speed)
        t = np.arange(n, dtype=np.float32) / SAMPLE_RATE
        tone = (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        for sentence in re.split(SENTENCE_SPLIT, text.strip()):
            if sentence:
                yield tone.copy()
