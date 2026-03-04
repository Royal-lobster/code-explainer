#!/bin/bash
# Presentation conductor — plays a code walkthrough with synced highlights + voice.
# Reads a generated script of highlight + narration steps.
# Usage: present.sh [--stream] <script_file>
#   where script_file contains lines of: FILE|START|END|NARRATION
#
# Batch mode (default): Reads complete file, processes all lines.
# Stream mode (--stream): Follows file with tail -f, processes lines as they
#   appear. Stops when it encounters an "END" line. Use this when the script
#   is being generated progressively — playback starts immediately while new
#   lines are still being appended.
#
# Send SIGTERM or SIGINT to stop.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$ROOT_DIR/.venv/bin/python3"
TTS_CLIENT="$SCRIPT_DIR/tts_client.py"

# Parse flags
STREAM_MODE=false
if [ "$1" = "--stream" ]; then
    STREAM_MODE=true
    shift
fi

SCRIPT_FILE="$1"

if [ -z "$SCRIPT_FILE" ]; then
    echo "Usage: present.sh [--stream] <script_file>"
    exit 1
fi

# In stream mode, create the file if it doesn't exist yet (writer may not have started)
if $STREAM_MODE && [ ! -f "$SCRIPT_FILE" ]; then
    touch "$SCRIPT_FILE"
fi

if [ ! -f "$SCRIPT_FILE" ]; then
    echo "Error: script file not found: $SCRIPT_FILE"
    exit 1
fi

# Track child processes for cleanup
TAIL_PID=""
STREAM_FIFO=""

cleanup() {
    [ -f /tmp/tts-client.pid ] && kill "$(cat /tmp/tts-client.pid)" 2>/dev/null
    killall say 2>/dev/null
    [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null
    [ -n "$STREAM_FIFO" ] && rm -f "$STREAM_FIFO"
    exit 0
}
trap cleanup SIGTERM SIGINT EXIT

use_tts=false
if [ -x "$VENV_PYTHON" ] && [ -f "$TTS_CLIENT" ]; then
    use_tts=true
    # Pre-start the server so model is loaded before first narration
    "$VENV_PYTHON" "$TTS_CLIENT" "" 2>/dev/null || true
fi

# Process a single presentation line
process_line() {
    local FILE="$1" START="$2" END="$3" NARRATION="$4"

    # Skip empty lines and comments
    [ -z "$FILE" ] && return 0
    [[ "$FILE" == \#* ]] && return 0

    # END sentinel — signal completion
    [ "$FILE" = "END" ] && return 1

    # Highlight the range in the editor
    "$SCRIPT_DIR/highlight.sh" "$FILE" "$START" "$END"

    # Small pause for editor to react
    sleep 0.3

    # Speak narration — blocks until done (this IS the timer)
    if $use_tts; then
        "$VENV_PYTHON" "$TTS_CLIENT" "$NARRATION"
    else
        say -v Samantha -r 190 "$NARRATION"
    fi

    # Brief pause between steps
    sleep 0.4
    return 0
}

if $STREAM_MODE; then
    # Stream mode: follow the file as lines are appended.
    # Uses a named pipe so the while loop runs in the current shell
    # (not a subshell), allowing clean break + cleanup.
    STREAM_FIFO=$(mktemp -u /tmp/present-fifo.XXXXXX)
    mkfifo "$STREAM_FIFO"

    tail -n +1 -f "$SCRIPT_FILE" > "$STREAM_FIFO" &
    TAIL_PID=$!

    while IFS='|' read -r FILE START END NARRATION; do
        process_line "$FILE" "$START" "$END" "$NARRATION" || break
    done < "$STREAM_FIFO"
else
    # Batch mode: read the complete file (original behavior)
    while IFS='|' read -r FILE START END NARRATION; do
        process_line "$FILE" "$START" "$END" "$NARRATION" || break
    done < "$SCRIPT_FILE"
fi
