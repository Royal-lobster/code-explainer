#!/usr/bin/env python3
"""Generate a podcast WAV file from a walkthrough plan.

Takes a JSON plan file (same format as autoplay) and synthesizes all
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

Requires the TTS server to be running (tts_server.py).
"""

import json
import os
import socket
import struct
import sys
import wave

SOCKET_PATH = "/tmp/tts-server.sock"
SAMPLE_RATE = 24000  # Kokoro-82M default sample rate
PAUSE_SECONDS = 0.8  # Silence between segments


def ensure_tts_server():
    """Start the TTS server if it's not already running."""
    if os.path.exists(SOCKET_PATH):
        return

    script_dir = os.path.dirname(os.path.abspath(__file__))
    server_script = os.path.join(script_dir, "tts_server.py")

    print("[podcast] TTS server not running, starting it...")
    import subprocess
    subprocess.run([sys.executable, server_script, "--daemon"], check=True)

    # Wait for socket to appear
    import time
    for _ in range(30):
        if os.path.exists(SOCKET_PATH):
            return
        time.sleep(1)
    print("[podcast] Error: TTS server did not start in time.", file=sys.stderr)
    sys.exit(1)


def synthesize(text: str, voice: str, speed: float) -> bytes:
    """Send text to the TTS server and collect all audio chunks as raw float32 bytes."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(SOCKET_PATH)

    request = json.dumps({"text": text, "voice": voice, "speed": speed}).encode()
    sock.sendall(request)
    sock.shutdown(socket.SHUT_WR)  # Signal end of request

    audio_data = b""
    while True:
        header = _recv_exactly(sock, 4)
        if header is None:
            break
        length = struct.unpack("!I", header)[0]
        if length == 0:
            break
        chunk = _recv_exactly(sock, length)
        if chunk is None:
            break
        audio_data += chunk

    sock.close()
    return audio_data


def _recv_exactly(sock, n: int) -> bytes | None:
    """Receive exactly n bytes from socket."""
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            return None
        data += chunk
    return data


def float32_to_int16(raw: bytes) -> bytes:
    """Convert float32 audio to int16 for WAV output."""
    import array
    floats = array.array("f", raw)
    samples = array.array("h", (int(max(-1.0, min(1.0, s)) * 32767) for s in floats))
    return samples.tobytes()


def generate_silence(seconds: float) -> bytes:
    """Generate silence as int16 bytes."""
    import array
    n_samples = int(SAMPLE_RATE * seconds)
    silence = array.array("h", [0] * n_samples)
    return silence.tobytes()


def main():
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

    ensure_tts_server()

    silence = generate_silence(PAUSE_SECONDS)
    all_audio = b""

    for i, seg in enumerate(segments):
        tts_text = seg.get("ttsText", "").strip()
        if not tts_text:
            continue

        seg_title = seg.get("title", f"Segment {seg.get('id', i + 1)}")
        print(f"[podcast] ({i + 1}/{len(segments)}) {seg_title}")

        raw = synthesize(tts_text, voice, speed)
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
