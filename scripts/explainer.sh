#!/bin/bash
# Helper for Claude to communicate with the Code Explainer VS Code extension.
# Usage:
#   explainer.sh plan <json_file>      Send walkthrough plan from file
#   explainer.sh send <json_string>    Send raw JSON message
#   explainer.sh state                 Get current walkthrough state
#   explainer.sh wait-action [timeout] Wait for user action (default 30s)
#   explainer.sh stop                  Stop the walkthrough

PORT_FILE="$HOME/.claude-explainer-port"
TOKEN_FILE="$HOME/.claude-explainer-token"

if [ ! -f "$PORT_FILE" ]; then
    echo '{"error": "Code Explainer extension not running (no port file)"}' >&2
    exit 1
fi

PORT=$(cat "$PORT_FILE")
BASE="http://127.0.0.1:$PORT"

if [ -f "$TOKEN_FILE" ]; then
    TOKEN=$(cat "$TOKEN_FILE")
    AUTH_HEADER="Authorization: Bearer $TOKEN"
else
    echo '{"error": "No auth token found"}' >&2
    exit 1
fi

case "$1" in
    plan)
        if [ -z "$2" ]; then
            echo "Usage: explainer.sh plan <json_file>" >&2
            exit 1
        fi
        curl -s -X POST "$BASE/api/message" \
            -H 'Content-Type: application/json' \
            -H "$AUTH_HEADER" \
            -d @"$2"
        ;;
    send)
        if [ -z "$2" ]; then
            echo "Usage: explainer.sh send '<json>'" >&2
            exit 1
        fi
        curl -s -X POST "$BASE/api/message" \
            -H 'Content-Type: application/json' \
            -H "$AUTH_HEADER" \
            -d "$2"
        ;;
    state)
        curl -s -H "$AUTH_HEADER" "$BASE/api/state"
        ;;
    wait-action)
        TIMEOUT="${2:-30}"
        curl -s --max-time "$((TIMEOUT + 5))" -H "$AUTH_HEADER" "$BASE/api/actions?timeout=$TIMEOUT"
        ;;
    stop)
        curl -s -X POST "$BASE/api/message" \
            -H 'Content-Type: application/json' \
            -H "$AUTH_HEADER" \
            -d '{"type": "stop"}'
        ;;
    *)
        echo "Usage: explainer.sh {plan|send|state|wait-action|stop}" >&2
        exit 1
        ;;
esac
