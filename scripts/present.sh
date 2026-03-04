#!/bin/bash
# Presentation conductor — plays a code walkthrough with synced highlights + voice.
# Reads a generated script of highlight + narration steps.
# Usage: present.sh <script_file>
#   where script_file contains lines of: FILE|START|END|NARRATION
#
# Each line highlights the range, then speaks the narration (blocking).
# When narration finishes, the next highlight fires — natural sync.
#
# Send SIGTERM or SIGINT to stop.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_FILE="$1"
VENV_PYTHON="$ROOT_DIR/.venv/bin/python3"
KOKORO_SCRIPT="$SCRIPT_DIR/kokoro_speak.py"

if [ -z "$SCRIPT_FILE" ] || [ ! -f "$SCRIPT_FILE" ]; then
    echo "Usage: present.sh <script_file>"
    exit 1
fi

# Cleanup on exit — kill any lingering speech process
cleanup() {
    killall afplay say 2>/dev/null
    exit 0
}
trap cleanup SIGTERM SIGINT

# Determine TTS method: Kokoro (high quality) or macOS say (fallback)
use_kokoro=false
if [ -x "$VENV_PYTHON" ] && [ -f "$KOKORO_SCRIPT" ]; then
    use_kokoro=true
    # Pre-start the server so model is loaded before first narration
    "$VENV_PYTHON" "$KOKORO_SCRIPT" "" 2>/dev/null || true
fi

# Read and execute each step
while IFS='|' read -r FILE START END NARRATION; do
    # Skip empty lines and comments
    [ -z "$FILE" ] && continue
    [[ "$FILE" == \#* ]] && continue

    # Highlight the range in the editor
    "$SCRIPT_DIR/highlight.sh" "$FILE" "$START" "$END"

    # Small pause for editor to react
    sleep 0.3

    # Speak narration — blocks until done (this IS the timer)
    if $use_kokoro; then
        "$VENV_PYTHON" "$KOKORO_SCRIPT" "$NARRATION"
    else
        say -v Samantha -r 190 "$NARRATION"
    fi

    # Brief pause between steps
    sleep 0.4
done < "$SCRIPT_FILE"
