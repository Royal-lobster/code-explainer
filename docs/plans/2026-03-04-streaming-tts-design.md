# Streaming TTS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generate-all-then-play TTS pattern with streaming playback so audio starts in ~450ms instead of ~2.5s, and rename all files/vars to be model-agnostic.

**Architecture:** Server becomes a generation-only service that streams audio chunks over the Unix socket. Client receives chunks and plays each immediately via `sounddevice.OutputStream`. Interruption is PID-based — killing the client process stops playback instantly.

**Tech Stack:** Python 3.10+, sounddevice (already installed), mlx-audio/Kokoro, Unix sockets, bash

---

### Task 1: Create `scripts/tts_server.py` (streaming generation server)

**Files:**
- Create: `scripts/tts_server.py`

**Step 1: Write `tts_server.py`**

This replaces `kokoro_server.py`. Key changes: streams audio chunks over socket instead of playing locally, sentence-level splitting, model from env/config.

```python
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
            # Client disconnected (interrupted) — stop generating
            return

    # End-of-stream marker
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
    pipeline = load_tts(DEFAULT_MODEL)

    # Create Unix socket server
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
                # Empty text = ping/pre-start, just send end marker
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
```

**Step 2: Verify server starts and loads model**

```bash
cd /Users/srujangurram/Developer/Personal/code-explainer
.venv/bin/python3 scripts/tts_server.py &
sleep 8  # wait for model load
ls -la /tmp/tts-server.sock  # should exist
kill $(cat /tmp/tts-server.pid)
```

Expected: Socket file exists, server prints "Model loaded, ready."

**Step 3: Commit**

```bash
git add scripts/tts_server.py
git commit -m "feat: add streaming TTS server (tts_server.py)"
```

---

### Task 2: Create `scripts/tts_client.py` (streaming playback client)

**Files:**
- Create: `scripts/tts_client.py`

**Step 1: Write `tts_client.py`**

This replaces `kokoro_speak.py`. Key changes: receives streaming audio chunks, plays via sounddevice immediately per chunk.

```python
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
```

**Step 2: Test end-to-end with server**

Start the server from Task 1, then test the client:

```bash
cd /Users/srujangurram/Developer/Personal/code-explainer
# Start server
.venv/bin/python3 scripts/tts_server.py --daemon
sleep 8
# Test client
.venv/bin/python3 scripts/tts_client.py "This is a test of streaming audio playback."
```

Expected: Audio plays almost immediately (~450ms), not after a long pause. Verify `/tmp/tts-client.pid` file is created.

**Step 3: Test interruption**

```bash
# Start long speech in background
.venv/bin/python3 scripts/tts_client.py "The matchOrders method iterates through all pending buy orders and tries to find a matching sell order. It first checks price compatibility, then verifies the quantities are sufficient." &
sleep 1
# Kill it mid-speech
kill $(cat /tmp/tts-client.pid)
```

Expected: Audio stops immediately when killed.

**Step 4: Commit**

```bash
git add scripts/tts_client.py
git commit -m "feat: add streaming TTS client with sounddevice playback"
```

---

### Task 3: Update `scripts/speak.sh`

**Files:**
- Modify: `scripts/speak.sh` (entire file, 31 lines)

**Step 1: Rewrite `speak.sh` with model-agnostic naming and PID-based interrupt**

```bash
#!/bin/bash
# Text-to-speech using persistent TTS server (fast) with fallback to macOS `say`.
# Usage: speak.sh "text to speak"
# Or:    echo "text" | speak.sh
#
# On first call, starts the TTS server daemon (model loads once ~5s).
# Subsequent calls are near-instant (<500ms).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$ROOT_DIR/.venv/bin/python3"
TTS_CLIENT="$SCRIPT_DIR/tts_client.py"
CLIENT_PID_FILE="/tmp/tts-client.pid"

# Kill any previous speech
if [ -f "$CLIENT_PID_FILE" ]; then
    kill "$(cat "$CLIENT_PID_FILE")" 2>/dev/null
fi
killall say 2>/dev/null

# Get text from argument or stdin
TEXT="${1:-$(cat)}"

# Exit if no text
if [ -z "$TEXT" ]; then
    exit 0
fi

# Try TTS client (via persistent server) first, fall back to macOS say
if [ -x "$VENV_PYTHON" ] && [ -f "$TTS_CLIENT" ]; then
    "$VENV_PYTHON" "$TTS_CLIENT" "$TEXT" &
else
    say -v Samantha -r 190 "$TEXT" &
fi
```

**Step 2: Verify speak.sh works**

```bash
chmod +x scripts/speak.sh
scripts/speak.sh "Testing the new speak script."
```

Expected: Audio plays via streaming TTS.

**Step 3: Commit**

```bash
git add scripts/speak.sh
git commit -m "refactor: update speak.sh for model-agnostic TTS with PID-based interrupt"
```

---

### Task 4: Update `scripts/present.sh`

**Files:**
- Modify: `scripts/present.sh` (lines 18, 48-49, 56-62, 82-83)

**Step 1: Apply edits**

Replace line 18 (KOKORO_SCRIPT → TTS_CLIENT):
```
Old: KOKORO_SCRIPT="$SCRIPT_DIR/kokoro_speak.py"
New: TTS_CLIENT="$SCRIPT_DIR/tts_client.py"
```

Replace cleanup function (lines 48-49) — kill client PID instead of afplay:
```
Old:
    killall afplay say 2>/dev/null
New:
    [ -f /tmp/tts-client.pid ] && kill "$(cat /tmp/tts-client.pid)" 2>/dev/null
    killall say 2>/dev/null
```

Replace TTS detection block (lines 56-62):
```
Old:
use_kokoro=false
if [ -x "$VENV_PYTHON" ] && [ -f "$KOKORO_SCRIPT" ]; then
    use_kokoro=true
    # Pre-start the server so model is loaded before first narration
    "$VENV_PYTHON" "$KOKORO_SCRIPT" "" 2>/dev/null || true
fi
New:
use_tts=false
if [ -x "$VENV_PYTHON" ] && [ -f "$TTS_CLIENT" ]; then
    use_tts=true
    # Pre-start the server so model is loaded before first narration
    "$VENV_PYTHON" "$TTS_CLIENT" "" 2>/dev/null || true
fi
```

Replace usage in process_line (lines 82-83):
```
Old:
    if $use_kokoro; then
        "$VENV_PYTHON" "$KOKORO_SCRIPT" "$NARRATION"
New:
    if $use_tts; then
        "$VENV_PYTHON" "$TTS_CLIENT" "$NARRATION"
```

**Step 2: Commit**

```bash
git add scripts/present.sh
git commit -m "refactor: update present.sh for model-agnostic TTS"
```

---

### Task 5: Update `setup.sh`

**Files:**
- Modify: `setup.sh` (lines 7, 58, 120, 135-136, 141, 146-152, 186, 190-213, 232-234)

**Step 1: Apply edits**

These are the specific replacements:

1. Line 7 comment: `Kokoro TTS` → `TTS`
2. Line 58: `Kokoro TTS will run on CPU` → `TTS will run on CPU`
3. Line 120: `Setting up Python environment for Kokoro TTS` → `Setting up Python environment for TTS`
4. Lines 135-136: `Installing Kokoro TTS (mlx-audio)` → `Installing TTS dependencies (mlx-audio + sounddevice)`
5. Lines 141, 143: Add `sounddevice` to install commands:
   - `mlx-audio` → `mlx-audio sounddevice`
6. Lines 146-152: Update verify block:
   - `Kokoro can import` → `TTS can import`
   - `Kokoro TTS verified` → `TTS engine verified`
   - `Kokoro import failed` → `TTS import failed`
7. Line 186: `kokoro_speak.py` → `tts_client.py`
8. Lines 190-213: Update pre-download section header and messages:
   - `Pre-downloading Kokoro voice model` → `Pre-downloading TTS voice model`
   - `Kokoro model downloaded` → `TTS model downloaded`
9. Lines 232-234: Update env var names in output:
   - `KOKORO_VOICE` → `TTS_VOICE`
   - `KOKORO_SPEED` → `TTS_SPEED`

**Step 2: Commit**

```bash
git add setup.sh
git commit -m "refactor: update setup.sh for model-agnostic TTS naming"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/tts.md`
- Modify: `docs/config.md`
- Modify: `docs/step5-autoplay.md`
- Modify: `docs/step5-interactive.md`
- Modify: `docs/setup.md`
- Modify: `README.md`

**Step 1: Rewrite `docs/tts.md`**

```markdown
# TTS Reference

## Engine

TTS uses **Kokoro-82M** (via mlx-audio) by default -- #1 ranked open-source TTS, runs locally on Apple Silicon. The model is configurable via `TTS_MODEL` env var or user config.

Uses a **persistent server** (`tts_server.py`) that loads the model once and streams audio chunks to the client. First call takes ~5s (model load), subsequent calls play audio within ~450ms (streaming).

The server starts automatically on first TTS call and stays running in the background. Falls back to macOS `say` if mlx-audio is not installed.

## Behavior

- Speech is **non-blocking** -- Claude continues while audio plays (use `run_in_background: true` on the Bash call)
- Previous speech is **auto-canceled** when a new segment starts (the script kills the previous client process before speaking)
- Audio is **streamed** -- playback starts as soon as the first sentence is generated, while remaining sentences generate in parallel

## Voices

Default voice: `af_heart` (American English female) -- configurable via `TTS_VOICE` env var or user config.

Available voices:
| Voice | Description |
|-------|-------------|
| `af_heart` | American English female (default) |
| `af_bella` | American English female |
| `af_sarah` | American English female |
| `am_adam` | American English male |
| `am_michael` | American English male |
| `bf_emma` | British English female |
| `bm_george` | British English male |

Naming convention: `a`=American, `b`=British, `f`=female, `m`=male.

## Speed

Configurable via `TTS_SPEED` env var or user config (default 1.0).

| Speed | Use case |
|-------|----------|
| `1.0` | Normal pace, good for unfamiliar code |
| `1.25` | Slightly faster |
| `1.5` | Fast, good for familiar code |
| `2.0` | Very fast, skim mode |

**Always pass the user's speed setting** from config to the TTS scripts via `TTS_SPEED` env var.

## Formatting rules for spoken text

- **Strip all markdown** from spoken text: no backticks, no `**bold**`, no `line 42` references, no file paths
- Keep spoken explanations **shorter than written** ones -- aim for 2-4 sentences max
- The spoken text should sound **natural and conversational**, not like reading documentation
```

**Step 2: Rewrite `docs/config.md`**

Replace all `KOKORO_VOICE` → `TTS_VOICE`, `KOKORO_SPEED` → `TTS_SPEED`. Add `model` to config schema:

```markdown
# User Config

Preferences are saved at `~/.config/code-explainer/config.json`. On first use, the file won't exist — ask the user their preferences and save them. On subsequent uses, load the saved config and **skip Step 1** (don't re-ask). The user can change settings anytime by saying "change settings", "change speed", "change voice", etc.

## Config schema

```json
{
  "depth": "overview",
  "mode": "autoplay",
  "speed": 1.0,
  "voice": "af_heart",
  "model": "prince-canuma/Kokoro-82M"
}
```

## Loading config

**Before Step 1**, check if config exists:
```bash
cat ~/.config/code-explainer/config.json 2>/dev/null
```

If it exists, load the values and skip to Step 2. Tell the user: "Using your saved preferences (depth: overview, mode: autoplay, speed: 1.0x). Say 'change settings' anytime to adjust."

If it doesn't exist, proceed with Step 1 (see `docs/step1-assess.md`). After getting answers, save the config.

## Saving config

```bash
mkdir -p ~/.config/code-explainer
cat > ~/.config/code-explainer/config.json << 'EOF'
{"depth": "overview", "mode": "autoplay", "speed": 1.0, "voice": "af_heart", "model": "prince-canuma/Kokoro-82M"}
EOF
```

## Speed settings

Speed controls narration playback rate:
- `1.0` = normal speed
- `1.25` = slightly faster
- `1.5` = fast (good for familiar code)
- `2.0` = very fast (skimming)

Pass speed to TTS via the `TTS_SPEED` env var:
```bash
TTS_SPEED=1.5 ~/.claude/skills/explainer/scripts/speak.sh "text"
```

For autoplay, include speed in the presentation:
```bash
TTS_SPEED=1.5 ~/.claude/skills/explainer/scripts/present.sh /tmp/claude-presentation.txt
```
```

**Step 3: Update `docs/step5-autoplay.md`**

Replace all `KOKORO_SPEED` → `TTS_SPEED`.

**Step 4: Update `docs/setup.md`**

Replace `Kokoro TTS (mlx-audio)` → `TTS engine (mlx-audio + sounddevice)` and `Kokoro voice model` → `TTS voice model`.

**Step 5: Update `README.md`**

Replace:
- `kokoro_speak.py       # Kokoro TTS engine` → `tts_server.py           # TTS generation server`  and add `tts_client.py` line
- `KOKORO_VOICE` → `TTS_VOICE`
- `KOKORO_SPEED` → `TTS_SPEED`
- Update project structure tree to show new filenames

**Step 6: Commit**

```bash
git add docs/tts.md docs/config.md docs/step5-autoplay.md docs/step5-interactive.md docs/setup.md README.md
git commit -m "docs: update all references for streaming TTS and model-agnostic naming"
```

---

### Task 7: Delete old files

**Files:**
- Delete: `scripts/kokoro_server.py`
- Delete: `scripts/kokoro_speak.py`

**Step 1: Remove old files**

```bash
git rm scripts/kokoro_server.py scripts/kokoro_speak.py
```

**Step 2: Verify no remaining references**

```bash
grep -r "kokoro" scripts/ docs/ setup.sh README.md --include="*.sh" --include="*.py" --include="*.md"
```

Expected: No references to `kokoro_server.py`, `kokoro_speak.py`, `KOKORO_VOICE`, or `KOKORO_SPEED` in code/scripts. Only allowed in docs where describing the model name "Kokoro-82M" itself.

**Step 3: Commit**

```bash
git commit -m "chore: remove old kokoro_server.py and kokoro_speak.py"
```

---

### Task 8: End-to-end verification

**Step 1: Kill any old server**

```bash
[ -f /tmp/kokoro-tts.pid ] && kill "$(cat /tmp/kokoro-tts.pid)" 2>/dev/null
[ -f /tmp/tts-server.pid ] && kill "$(cat /tmp/tts-server.pid)" 2>/dev/null
rm -f /tmp/kokoro-tts.sock /tmp/tts-server.sock
```

**Step 2: Test speak.sh (cold start)**

```bash
cd /Users/srujangurram/Developer/Personal/code-explainer
time scripts/speak.sh "The matchOrders method iterates through all pending buy orders."
```

Expected: Server starts (~5s first time), then audio plays with streaming. Should hear first words within ~500ms of server being ready.

**Step 3: Test speak.sh (warm, should be fast)**

```bash
time scripts/speak.sh "This is a second test to verify low latency streaming."
```

Expected: Audio starts within ~500ms (no model load needed).

**Step 4: Test interruption**

```bash
scripts/speak.sh "This is a long sentence that should be interrupted before it finishes playing completely." &
sleep 1
scripts/speak.sh "Interrupted!"
```

Expected: First audio stops, second audio plays.

**Step 5: Test present.sh with a small script**

```bash
cat > /tmp/test-presentation.txt << 'EOF'
/Users/srujangurram/Developer/Personal/code-explainer/scripts/speak.sh|1|5|This is the speak script. It handles text to speech with a fallback mechanism.
/Users/srujangurram/Developer/Personal/code-explainer/scripts/speak.sh|7|15|The script kills any previous speech, then tries the TTS client first.
END
EOF
scripts/present.sh /tmp/test-presentation.txt
```

Expected: Two segments play sequentially with highlights.

**Step 6: Verify env vars work**

```bash
TTS_VOICE=am_adam TTS_SPEED=1.5 scripts/speak.sh "Testing with Adam voice at faster speed."
```

Expected: Male voice at 1.5x speed.
