#!/usr/bin/env python3
"""TTS client — sends text to the persistent server, plays streamed audio.

Receives audio chunks from the server and plays each immediately via
sounddevice, so the user hears the first sentence within ~450ms.

Falls back to direct generation if the server isn't running.

Usage:
    tts_client.py "Text to speak"
    echo "Text to speak" | tts_client.py
"""

import json
import os
import socket
import struct
import subprocess
import sys

SOCKET_PATH = "/tmp/tts-server.sock"
PID_FILE = "/tmp/tts-server.pid"
CLIENT_PID_FILE = "/tmp/tts-client.pid"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
VENV_PYTHON = os.path.join(ROOT_DIR, ".venv", "bin", "python3")
SERVER_SCRIPT = os.path.join(SCRIPT_DIR, "tts_server.py")

SAMPLE_RATE = 24000


def server_running() -> bool:
    """Check if the TTS server socket exists."""
    return os.path.exists(SOCKET_PATH)


def start_server():
    """Start the TTS server as a daemon and wait for it to be ready."""
    import time

    print("[tts] Starting server (first-time model load ~5s)...", flush=True)
    subprocess.Popen(
        [VENV_PYTHON, SERVER_SCRIPT, "--daemon"],
        stdout=open("/tmp/tts-server.log", "a"),
        stderr=subprocess.STDOUT,
    )
    for _ in range(60):
        time.sleep(0.5)
        if server_running():
            print("[tts] Server ready.", flush=True)
            return True
    print("[tts] Server failed to start.", flush=True)
    return False


def recv_exactly(sock, n: int) -> bytes:
    """Receive exactly n bytes from socket."""
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("Connection closed")
        data += chunk
    return data


def speak_via_server(text: str, voice: str, speed: float) -> bool:
    """Send text to server and play streamed audio chunks."""
    import numpy as np
    import sounddevice as sd

    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(30)
        s.connect(SOCKET_PATH)
        request = json.dumps({"text": text, "voice": voice, "speed": speed})
        s.sendall(request.encode("utf-8"))
        s.shutdown(socket.SHUT_WR)

        stream = sd.OutputStream(
            samplerate=SAMPLE_RATE, channels=1, dtype="float32"
        )
        stream.start()

        while True:
            header = recv_exactly(s, 4)
            length = struct.unpack("!I", header)[0]
            if length == 0:
                break
            audio_bytes = recv_exactly(s, length)
            audio = np.frombuffer(audio_bytes, dtype=np.float32)
            stream.write(audio.reshape(-1, 1))

        stream.stop()
        stream.close()
        s.close()
        return True
    except Exception as e:
        print(f"[tts] Server error: {e}", flush=True)
        return False


def speak_direct(text: str, voice: str, speed: float):
    """Fallback: generate and play directly (slow, loads model each time)."""
    import numpy as np
    import sounddevice as sd

    from mlx_audio.tts.models.kokoro import KokoroPipeline
    from mlx_audio.tts.utils import load_model

    model_id = os.environ.get("TTS_MODEL", "prince-canuma/Kokoro-82M")
    model = load_model(model_id)
    pipeline = KokoroPipeline(lang_code="a", model=model, repo_id=model_id)

    stream = sd.OutputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="float32"
    )
    stream.start()

    for result in pipeline(
        text, voice=voice, speed=speed, split_pattern=r"(?<=[.!?])\s+"
    ):
        audio = np.array(result.audio).squeeze().astype(np.float32)
        stream.write(audio.reshape(-1, 1))

    stream.stop()
    stream.close()


def main():
    # Write PID for interruption by speak.sh
    with open(CLIENT_PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
    else:
        text = sys.stdin.read()

    if not text.strip():
        return

    voice = os.environ.get("TTS_VOICE", "af_heart")
    speed = float(os.environ.get("TTS_SPEED", "1.0"))

    # Try server first (fast path)
    if server_running() or start_server():
        if speak_via_server(text, voice, speed):
            return

    # Fallback to direct generation
    print("[tts] Falling back to direct generation...", flush=True)
    speak_direct(text, voice, speed)


if __name__ == "__main__":
    main()
