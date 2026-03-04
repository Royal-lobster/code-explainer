# Step 5-autoplay: Autoplay Mode (Sidebar Streaming)

In autoplay mode, the walkthrough plays automatically in the VS Code sidebar -- highlights move through the code while TTS narration plays in sync. The user watches and listens via the sidebar webview.

**Key design: sidebar-driven playback.** Send the walkthrough plan to the VS Code sidebar extension via HTTP, which handles highlighting, TTS audio streaming, and auto-advancing through segments autonomously.

## How it works

1. **Check if the sidebar extension is available:**

```bash
if [ -f ~/.claude-explainer-port ]; then
    # Sidebar extension is running — use HTTP API
else
    # Fall back to file-watcher protocol (see legacy section below)
fi
```

2. **Build the walkthrough plan as a JSON object:**

```json
{
    "type": "set_plan",
    "title": "Feature Name Walkthrough",
    "segments": [
        {
            "id": 1,
            "file": "/absolute/path/to/file.ts",
            "start": 1,
            "end": 20,
            "title": "Module definition",
            "explanation": "This is the **module definition**. It imports all the services needed for order matching.",
            "ttsText": "This is the module definition. It imports all the services needed for order matching."
        }
    ]
}
```

3. **Send the plan to the extension:**

Write the JSON to a temp file and send via the helper script:

```bash
cat > /tmp/walkthrough-plan.json << 'EOF'
{ "type": "set_plan", "title": "...", "segments": [...] }
EOF
~/.claude/skills/explainer/scripts/explainer.sh plan /tmp/walkthrough-plan.json
```

The sidebar immediately begins playback — highlighting code, showing explanations, and streaming TTS audio.

4. **Wait for user actions (optional):**

```bash
~/.claude/skills/explainer/scripts/explainer.sh wait-action 60
```

This long-polls for user interactions (Go Deeper, Zoom Out). When the user clicks one, you receive a JSON response:

```json
{"type": "user_action", "action": "go_deeper", "segmentId": 3}
```

Handle by sending plan mutations:

```bash
# Insert deeper sub-segments after the current one
~/.claude/skills/explainer/scripts/explainer.sh send '{"type": "insert_after", "afterSegment": 3, "segments": [...]}'

# Resume playback
~/.claude/skills/explainer/scripts/explainer.sh send '{"type": "resume"}'
```

5. **Check state anytime:**

```bash
~/.claude/skills/explainer/scripts/explainer.sh state
```

6. **Stop the walkthrough:**

```bash
~/.claude/skills/explainer/scripts/explainer.sh stop
```

## Segment generation guidelines

- Each segment should be 5-40 lines of code
- `explanation` field supports simple markdown (bold, inline code)
- `ttsText` field must be plain text — no markdown, no line references, no file paths
- TTS text should be 2-4 sentences, conversational style
- The sidebar auto-advances after each segment's TTS finishes

## Autoplay narration style

- Speak as if giving a live code tour to a colleague
- "Here we have the module definition..." not "This is line 1 through 8 of matching.module.ts"
- Connect segments: "Moving down, we see..." / "Next up is..." / "This feeds into..."
- **Lead with WHY before HOW**: "The system needs to validate prices before matching — here's how it does that"
- **Ground in concrete scenarios**: "When a user places a market order, this is the code that runs"
- **Breeze through boilerplate**: For `[wiring]` segments: "This is standard module setup — the interesting part is coming up next"
- **Vary pacing**: More detail on `[core]` sub-blocks. Speed through obvious patterns.

## User controls during autoplay

The sidebar provides built-in controls:
- **Play/Pause button** — pauses TTS and highlighting
- **Next/Previous buttons** — skip between segments
- **Go Deeper** — pauses and sends a user_action for Claude to generate sub-segments
- **Zoom Out** — pauses and sends a user_action for Claude to provide higher-level view
- **Speed buttons** — 1x, 1.25x, 1.5x, 2x TTS playback speed
- **Volume slider + Mute** — audio control
- **Voice selector** — choose TTS voice
- **Outline** — click any segment to jump to it

See `docs/tts.md` for voice configuration and formatting rules.
