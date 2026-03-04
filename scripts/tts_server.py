#!/usr/bin/env python3
"""Persistent TTS server — loads model once, streams audio chunks via Unix socket.

Eliminates ~5s cold-start per call by keeping the model in memory.
Audio is streamed chunk-by-chunk to the client for immediate playback.

Usage:
    tts_server.py              # Start server (foreground)
    tts_server.py --daemon     # Start server (background)

Clients send JSON over the Unix socket:
    {"text": "Hello world", "voice": "af_heart", "speed": 1.0}

Server responds with streamed audio:
    [4-byte big-endian length][float32 audio data] per chunk
    [4 bytes: 0x00000000] to signal end of stream
"""

import json
import os
import signal
import socket
import struct
import subprocess
import sys

SOCKET_PATH = "/tmp/tts-server.sock"
PID_FILE = "/tmp/tts-server.pid"
DEFAULT_VOICE = os.environ.get("TTS_VOICE", "af_heart")
DEFAULT_SPEED = float(os.environ.get("TTS_SPEED", "1.0"))
DEFAULT_MODEL = os.environ.get("TTS_MODEL", "prince-canuma/Kokoro-82M")


def load_tts(model_id: str):
    """Load the TTS model and pipeline once."""
    from mlx_audio.tts.models.kokoro import KokoroPipeline
    from mlx_audio.tts.utils import load_model

    print(f"[tts-server] Loading model {model_id}...", flush=True)
    model = load_model(model_id)
    pipeline = KokoroPipeline(lang_code="a", model=model, repo_id=model_id)
    print("[tts-server] Model loaded, ready.", flush=True)
    return pipeline


def generate_and_stream(conn, pipeline, text: str, voice: str, speed: float):
    """Generate audio chunks and stream them to the client."""
    import numpy as np

    for result in pipeline(
        text, voice=voice, speed=speed, split_pattern=r"(?<=[.!?])\s+"
    ):
        audio = np.array(result.audio).squeeze().astype(np.float32)
        audio_bytes = audio.tobytes()
        header = struct.pack("!I", len(audio_bytes))
        try:
            conn.sendall(header + audio_bytes)
        except BrokenPipeError:
            return

    try:
        conn.sendall(struct.pack("!I", 0))
    except BrokenPipeError:
        pass


def cleanup(*_):
    """Remove socket and pid file on exit."""
    for path in (SOCKET_PATH, PID_FILE):
        try:
            os.unlink(path)
        except OSError:
            pass
    sys.exit(0)


def run_server():
    try:
        os.unlink(SOCKET_PATH)
    except OSError:
        pass

    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    pipeline = load_tts(DEFAULT_MODEL)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(5)
    os.chmod(SOCKET_PATH, 0o600)

    print(f"[tts-server] Listening on {SOCKET_PATH}", flush=True)

    while True:
        conn, _ = server.accept()
        try:
            data = b""
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk

            if not data:
                conn.close()
                continue

            request = json.loads(data.decode("utf-8"))
            text = request.get("text", "").strip()
            voice = request.get("voice", DEFAULT_VOICE)
            speed = request.get("speed", DEFAULT_SPEED)

            if text:
                generate_and_stream(conn, pipeline, text, voice, speed)
            else:
                conn.sendall(struct.pack("!I", 0))
        except Exception as e:
            print(f"[tts-server] Error: {e}", flush=True)
        finally:
            conn.close()


if __name__ == "__main__":
    if "--daemon" in sys.argv:
        log = open("/tmp/tts-server.log", "a")
        proc = subprocess.Popen(
            [sys.executable, __file__],
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
        print(f"[tts-server] Started daemon (PID {proc.pid})")
        sys.exit(0)

    run_server()
