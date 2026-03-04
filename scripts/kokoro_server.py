#!/usr/bin/env python3
"""Persistent Kokoro TTS server — loads model once, serves via Unix socket.

Eliminates ~5s cold-start per call by keeping the model in memory.

Usage:
    kokoro_server.py              # Start server (foreground)
    kokoro_server.py --daemon     # Start server (background)

Clients send JSON over the Unix socket:
    {"text": "Hello world", "voice": "af_heart", "speed": 1.0}

Server responds with JSON:
    {"status": "ok"} after playback finishes
    {"status": "error", "message": "..."} on failure
"""

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile

SOCKET_PATH = "/tmp/kokoro-tts.sock"
PID_FILE = "/tmp/kokoro-tts.pid"
DEFAULT_VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
DEFAULT_SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))
MODEL_ID = "prince-canuma/Kokoro-82M"


def load_tts():
    """Load the Kokoro model and pipeline once."""
    from mlx_audio.tts.models.kokoro import KokoroPipeline
    from mlx_audio.tts.utils import load_model

    print("[kokoro-server] Loading model...", flush=True)
    model = load_model(MODEL_ID)
    pipeline = KokoroPipeline(lang_code="a", model=model, repo_id=MODEL_ID)
    print("[kokoro-server] Model loaded, ready.", flush=True)
    return pipeline


def speak(pipeline, text: str, voice: str, speed: float):
    """Generate and play audio."""
    import mlx.core as mx
    import numpy as np

    # Kill any lingering playback
    subprocess.run(["killall", "afplay"], capture_output=True)

    audio_chunks = []
    for result in pipeline(text, voice=voice, speed=speed):
        audio_chunks.append(result.audio)

    if not audio_chunks:
        return

    combined = mx.concatenate(audio_chunks)
    arr = np.array(combined).squeeze()  # Remove batch dim -> 1D
    # Convert float32 [-1,1] to int16 for WAV
    arr_int16 = (arr * 32767).clip(-32768, 32767).astype(np.int16)

    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path = os.path.join(tmpdir, "speech.wav")
        import wave

        with wave.open(wav_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(24000)
            wf.writeframes(arr_int16.tobytes())

        subprocess.run(["afplay", wav_path], check=True)


def cleanup(*_):
    """Remove socket and pid file on exit."""
    try:
        os.unlink(SOCKET_PATH)
    except OSError:
        pass
    try:
        os.unlink(PID_FILE)
    except OSError:
        pass
    sys.exit(0)


def run_server():
    # Clean up stale socket
    try:
        os.unlink(SOCKET_PATH)
    except OSError:
        pass

    # Write PID file
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    # Load model (the slow part — only happens once)
    pipeline = load_tts()

    # Create Unix socket server
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(5)
    os.chmod(SOCKET_PATH, 0o600)

    print(f"[kokoro-server] Listening on {SOCKET_PATH}", flush=True)

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
                continue

            request = json.loads(data.decode("utf-8"))
            text = request.get("text", "").strip()
            voice = request.get("voice", DEFAULT_VOICE)
            speed = request.get("speed", DEFAULT_SPEED)

            if text:
                speak(pipeline, text, voice, speed)

            conn.sendall(json.dumps({"status": "ok"}).encode("utf-8"))
        except Exception as e:
            try:
                conn.sendall(
                    json.dumps({"status": "error", "message": str(e)}).encode("utf-8")
                )
            except Exception:
                pass
            print(f"[kokoro-server] Error: {e}", flush=True)
        finally:
            conn.close()


if __name__ == "__main__":
    if "--daemon" in sys.argv:
        # Spawn a fresh process (not fork!) to preserve Metal GPU access
        log = open("/tmp/kokoro-tts.log", "a")
        proc = subprocess.Popen(
            [sys.executable, __file__],
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
        log.close()
        print(f"[kokoro-server] Started daemon (PID {proc.pid})")
        sys.exit(0)

    run_server()
