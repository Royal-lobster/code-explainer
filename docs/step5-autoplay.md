# Step 5: Autoplay Mode

Sidebar-driven playback. Send the walkthrough plan to the sidebar extension which handles highlighting, TTS streaming, and auto-advancing.

**Prerequisite:** Sidebar status already determined in step 0 (parallel init).

## Steps

1. **Build the plan JSON:**

```json
{
    "type": "set_plan",
    "title": "Feature Name Walkthrough",
    "segments": [
        {
            "id": 1,
            "file": "/absolute/path/to/file.ts",
            "start": 1,
            "end": 40,
            "title": "Module definition",
            "explanation": "This is the **module definition**. It imports all the services and sets up the constructor.",
            "ttsText": "This is the module definition. It imports all the services and sets up the constructor.",
            "highlights": [
                { "start": 1, "end": 8, "ttsText": "First we have the imports, pulling in the services needed for order matching." },
                { "start": 10, "end": 25, "ttsText": "Next, the class definition with its injectable decorator and constructor dependencies." },
                { "start": 27, "end": 40, "ttsText": "Finally, the initialization method that loads existing orders into the in-memory book." }
            ]
        }
    ]
}
```

2. **Send to sidebar:**

```bash
cat > /tmp/walkthrough-plan.json << 'EOF'
{ "type": "set_plan", "title": "...", "segments": [...] }
EOF
~/.claude/skills/explainer/scripts/explainer.sh plan /tmp/walkthrough-plan.json
```

Playback starts immediately.

3. **Handle user actions (optional):**

```bash
~/.claude/skills/explainer/scripts/explainer.sh wait-action 60
```

Returns e.g. `{"type": "user_action", "action": "go_deeper", "segmentId": 3}`. Handle with:

```bash
~/.claude/skills/explainer/scripts/explainer.sh send '{"type": "insert_after", "afterSegment": 3, "segments": [...]}'
~/.claude/skills/explainer/scripts/explainer.sh send '{"type": "resume"}'
```

4. **Other commands:** `explainer.sh state` (check state), `explainer.sh stop` (stop walkthrough).

## Segment guidelines

- 20-80 lines per segment
- `explanation`: supports markdown. `ttsText`: plain text only, no markdown/line refs/paths
- TTS: 2-4 sentences, conversational

### Sub-highlights

Required for segments > 30 lines. Optional for smaller. Skip for < 10 lines.

- 2-5 sub-ranges per segment, each **5-15 lines** at logical boundaries
- Each has own `ttsText` (1-2 sentences)
- **Not a partition** — zoom into key code, target 30-60% line coverage
- Minimum 3 highlights for segments > 40 lines

## Narration style

- Speak as a live code tour to a colleague, not "line 1 through 8 of file.ts"
- Connect segments: "Moving down..." / "Next up..." / "This feeds into..."
- Lead with **WHY** before HOW
- Ground in concrete scenarios: "When a user places an order, this is what runs"
- `[wiring]`: breeze through. `[core]`: detail. Vary pacing.

## User controls

The sidebar handles Play/Pause, Next/Prev, Go Deeper, Zoom Out, speed, volume, voice, and outline navigation. The agent only needs to respond to `wait-action` events.

See `docs/tts.md` for voice config.
