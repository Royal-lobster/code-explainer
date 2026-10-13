"""End-to-end test for podcast generation."""

from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import pytest
from codeexplainer import client
from codeexplainer.endpoint import read_endpoint
from codeexplainer.tts.fake import FakeBackend

PODCAST = client.SERVER_SCRIPT.parent / "podcast.py"


def test_podcast_writes_wav(
    state_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each narrated segment is followed by 0.8 s of silence; blank segments are skipped."""
    monkeypatch.setenv("TTS_BACKEND", "fake")
    plan = tmp_path / "plan.json"
    plan.write_text(
        json.dumps(
            {
                "title": "Demo",
                "segments": [
                    {"id": 1, "title": "A", "ttsText": "First segment."},
                    {"id": 2, "title": "B", "ttsText": "  "},
                    {"id": 3, "title": "C", "ttsText": "Second segment."},
                ],
            }
        )
    )
    out = tmp_path / "out.wav"
    try:
        result = subprocess.run(
            [sys.executable, str(PODCAST), str(plan), str(out)], capture_output=True, text=True
        )
        assert result.returncode == 0, result.stderr
        with wave.open(str(out)) as wf:
            assert (wf.getnchannels(), wf.getsampwidth(), wf.getframerate()) == (1, 2, 24000)
            expected = 2 * (FakeBackend.samples_per_sentence(1.0) + int(24000 * 0.8))
            assert wf.getnframes() == expected
    finally:
        ep = read_endpoint()
        if ep:
            client.shutdown(ep)
