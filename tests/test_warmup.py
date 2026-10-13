"""Tests for the setup-time warm-up command."""

from __future__ import annotations

import pytest
from codeexplainer.tts import warmup


def test_warmup_with_fake_backend(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Warm-up reports the backend and a non-zero duration."""
    monkeypatch.setenv("TTS_BACKEND", "fake")
    assert warmup.main() == 0
    assert capsys.readouterr().out.startswith("fake: generated 0.")


def test_warmup_without_backend(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A missing engine is reported, not raised."""
    monkeypatch.setenv("TTS_BACKEND", "nonexistent")
    assert warmup.main() == 1
    assert "Unknown TTS_BACKEND" in capsys.readouterr().err


@pytest.mark.real_tts
def test_warmup_with_real_engine() -> None:
    """With the tts extra installed, the auto-selected engine produces audio."""
    assert warmup.main() == 0
