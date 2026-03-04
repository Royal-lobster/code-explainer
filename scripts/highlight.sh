#!/bin/bash
# Highlight a range of lines in VS Code via the claude-explainer extension.
# Writes a JSON file that the extension watches and reacts to.
# Usage: highlight.sh <file> <start_line> <end_line>

FILE="$1"
START="$2"
END="$3"

# Use python/node-free JSON construction with proper escaping
ESCAPED_FILE=$(printf '%s' "$FILE" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"file":"%s","start":%d,"end":%d}\n' "$ESCAPED_FILE" "$START" "$END" > ~/.claude-highlight.json
