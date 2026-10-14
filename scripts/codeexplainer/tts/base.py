"""The contract every TTS backend fulfils."""

from __future__ import annotations

from collections.abc import Iterator
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import numpy as np

SENTENCE_SPLIT = r"(?<=[.!?])\s+"


class BackendUnavailable(RuntimeError):
    """Raised when a backend's engine is not installed or not supported here."""


class TTSBackend(Protocol):
    """A loaded speech engine.

    Implementations import their engine inside ``__init__`` only, so importing
    the module never fails on an unsupported OS.
    """

    name: str

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[np.ndarray]:
        """Yield audio sentence by sentence.

        Args:
            text: Plain text to speak.
            voice: Kokoro voice id, e.g. ``af_heart``.
            speed: Speaking rate multiplier.

        Yields:
            1-D float32 arrays of mono PCM at ``protocol.SAMPLE_RATE``.
        """
        ...
