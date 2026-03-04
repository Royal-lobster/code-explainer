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
