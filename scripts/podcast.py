#!/usr/bin/env python3
"""Generate a podcast WAV file from a walkthrough plan.

Takes a JSON plan file (same format as walkthrough mode) and synthesizes all
segment narrations into a single WAV file using the TTS server.

Usage:
    podcast.py <plan.json> [output.wav]

The plan JSON must have this structure:
    {
        "title": "Feature Name Walkthrough",
        "segments": [
            {"id": 1, "title": "...", "ttsText": "Narration for this segment"},
            ...
        ]
    }

Starts the TTS server automatically if it is not running.
"""

from __future__ import annotations

import array
import json
import os
import sys
import wave

from codeexplainer import client
from codeexplainer.endpoint import Endpoint
from codeexplainer.protocol import SAMPLE_RATE

PAUSE_SECONDS = 0.8  # Silence between segments


def synthesize(ep: Endpoint, text: str, voice: str, speed: float) -> bytes:
    """Collect all audio for ``text`` as raw little-endian float32 bytes."""
    return b"".join(client.stream_audio(ep, text, voice, speed))


def float32_to_int16(raw: bytes) -> bytes:
    """Convert little-endian float32 audio to int16 for WAV output."""
    floats = array.array("f", raw)
    if sys.byteorder == "big":
        floats.byteswap()
    samples = array.array("h", (int(max(-1.0, min(1.0, s)) * 32767) for s in floats))
    if sys.byteorder == "big":
        samples.byteswap()
    return samples.tobytes()


def generate_silence(seconds: float) -> bytes:
    """Generate silence as int16 bytes."""
    return bytes(2 * int(SAMPLE_RATE * seconds))


def main():
    """Build the podcast WAV from a plan file given on the command line."""
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <plan.json> [output.wav]", file=sys.stderr)
        sys.exit(1)

    plan_path = sys.argv[1]
    with open(plan_path) as f:
        plan = json.load(f)

    title = plan.get("title", "walkthrough")
    segments = plan.get("segments", [])
    if not segments:
        print("[podcast] No segments found in plan.", file=sys.stderr)
        sys.exit(1)

    voice = plan.get("voice", os.environ.get("TTS_VOICE", "af_heart"))
    speed = plan.get("speed", float(os.environ.get("TTS_SPEED", "1.0")))
    default_name = f"{title.replace(' ', '-').lower()}-podcast.wav"
    output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), default_name)

    ep = client.ensure_server()

    silence = generate_silence(PAUSE_SECONDS)
    all_audio = b""

    for i, seg in enumerate(segments):
        tts_text = seg.get("ttsText", "").strip()
        if not tts_text:
            continue

        seg_title = seg.get("title", f"Segment {seg.get('id', i + 1)}")
        print(f"[podcast] ({i + 1}/{len(segments)}) {seg_title}")

        raw = synthesize(ep, tts_text, voice, speed)
        if raw:
            all_audio += float32_to_int16(raw)
            all_audio += silence

    if not all_audio:
        print("[podcast] No audio generated.", file=sys.stderr)
        sys.exit(1)

    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(all_audio)

    print(f"[podcast] Saved: {output_path}")


if __name__ == "__main__":
    main()
