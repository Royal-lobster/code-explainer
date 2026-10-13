"""Load the selected backend and synthesize once, downloading models (used by setup.sh)."""

from __future__ import annotations

import sys

from codeexplainer.protocol import SAMPLE_RATE
from codeexplainer.tts import registry
from codeexplainer.tts.base import BackendUnavailable


def main() -> int:
    """Synthesize a short phrase with the auto-selected backend.

    Returns:
        0 on success, 1 if no backend is usable or no audio was produced.
    """
    try:
        backend = registry.create_backend()
    except BackendUnavailable as exc:
        print(exc, file=sys.stderr)
        return 1
    samples = sum(chunk.size for chunk in backend.synthesize("Setup complete.", "af_heart", 1.0))
    if samples == 0:
        print(f"{backend.name}: produced no audio", file=sys.stderr)
        return 1
    print(f"{backend.name}: generated {samples / SAMPLE_RATE:.1f}s of audio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
