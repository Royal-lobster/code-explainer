#!/usr/bin/env python3
"""Kokoro TTS client — sends text to the persistent server for fast speech.

Falls back to direct generation if the server isn't running.

Usage:
    kokoro_speak.py "Text to speak"
    echo "Text to speak" | kokoro_speak.py
"""

import json
import os
import socket
import subprocess
import sys

SOCKET_PATH = "/tmp/kokoro-tts.sock"
PID_FILE = "/tmp/kokoro-tts.pid"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
VENV_PYTHON = os.path.join(ROOT_DIR, ".venv", "bin", "python3")
SERVER_SCRIPT = os.path.join(SCRIPT_DIR, "kokoro_server.py")


def server_running() -> bool:
    """Check if the TTS server socket exists."""
    return os.path.exists(SOCKET_PATH)


def start_server():
    """Start the TTS server as a daemon and wait for it to be ready."""
    print("[kokoro-tts] Starting server (first-time model load ~5s)...", flush=True)
    log = open("/tmp/kokoro-tts.log", "a")
    subprocess.Popen(
        [VENV_PYTHON, SERVER_SCRIPT, "--daemon"],
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    log.close()
    # Wait for server to be ready (up to 30s for model loading)
    import time
    for _ in range(60):
        time.sleep(0.5)
        if server_running():
            print("[kokoro-tts] Server ready.", flush=True)
            return True
    print("[kokoro-tts] Server failed to start.", flush=True)
    return False


def speak_via_server(text: str, voice: str, speed: float) -> bool:
    """Send text to the TTS server. Returns True on success."""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(30)
        s.connect(SOCKET_PATH)
        request = json.dumps({"text": text, "voice": voice, "speed": speed})
        s.sendall(request.encode("utf-8"))
        s.shutdown(socket.SHUT_WR)
        response = s.recv(4096)
        s.close()
        result = json.loads(response.decode("utf-8"))
        return result.get("status") == "ok"
    except Exception as e:
        print(f"[kokoro-tts] Server error: {e}", flush=True)
        return False


def speak_direct(text: str, voice: str, speed: float):
    """Fallback: generate audio directly (slow, loads model each time)."""
    import glob
    import tempfile
    from mlx_audio.tts.generate import generate_audio

    with tempfile.TemporaryDirectory() as tmpdir:
        output_prefix = os.path.join(tmpdir, "speech")
        lang = voice[0] if voice else "a"
        generate_audio(
            text=text,
            model="prince-canuma/Kokoro-82M",
            voice=voice,
            speed=speed,
            lang_code=lang,
            file_prefix=output_prefix,
            audio_format="wav",
            verbose=False,
        )
        wav_files = sorted(glob.glob(os.path.join(tmpdir, "speech_*.wav")))
        for wav in wav_files:
            subprocess.run(["afplay", wav], check=True)


def main():
    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
    else:
        text = sys.stdin.read()

    if not text.strip():
        return

    voice = os.environ.get("KOKORO_VOICE", "af_heart")
    speed = float(os.environ.get("KOKORO_SPEED", "1.0"))

    # Try server first (fast path)
    if server_running() or start_server():
        if speak_via_server(text, voice, speed):
            return

    # Fallback to direct generation
    print("[kokoro-tts] Falling back to direct generation...", flush=True)
    speak_direct(text, voice, speed)


if __name__ == "__main__":
    main()
