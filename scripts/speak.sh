#!/bin/bash
# Text-to-speech using Kokoro TTS server (fast) with fallback to macOS `say`.
# Usage: speak.sh "text to speak"
# Or:    echo "text" | speak.sh
#
# On first call, starts the Kokoro server daemon (model loads once ~5s).
# Subsequent calls are near-instant (<500ms).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$ROOT_DIR/.venv/bin/python3"
KOKORO_SCRIPT="$SCRIPT_DIR/kokoro_speak.py"

# Kill any previous speech (both Kokoro/afplay and macOS say)
killall afplay say 2>/dev/null

# Get text from argument or stdin
TEXT="${1:-$(cat)}"

# Exit if no text
if [ -z "$TEXT" ]; then
    exit 0
fi

# Try Kokoro (via persistent server) first, fall back to macOS say
if [ -x "$VENV_PYTHON" ] && [ -f "$KOKORO_SCRIPT" ]; then
    "$VENV_PYTHON" "$KOKORO_SCRIPT" "$TEXT" &
else
    say -v Samantha -r 190 "$TEXT" &
fi
