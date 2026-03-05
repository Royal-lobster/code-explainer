# Step 5: Walkthrough Mode

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

The sidebar loads the plan and shows the first segment's code location. Playback does NOT start automatically — the user must press the Play button on the sidebar to begin. Tell the user: **"Press ▶ Play on the sidebar to start the walkthrough."**

3. **Handle user actions (optional):**

```bash
~/.claude/skills/explainer/scripts/explainer.sh wait-action 60
```

Returns e.g. `{"type": "user_action", "action": "next", "segmentId": 3}`. Handle as needed with `goto`, `insert_after`, or `resume` commands.

4. **Other commands:** `explainer.sh state` (check state), `explainer.sh stop` (stop walkthrough).

## Segment guidelines

- 20-80 lines per segment
- `explanation`: supports markdown. `ttsText`: plain text only, no markdown/line refs/paths
- TTS: 2-4 sentences, conversational

### Sub-highlights

Required for all segments > 10 lines. Optional for smaller.

- **One concept per highlight** — each highlight explains exactly one thing:
  - One function call, one assignment, one conditional, one return
  - For multi-arg constructors/calls: highlight each argument separately
  - For sequential operations (e.g., 3 DB updates): one highlight per operation
- **1-8 lines per highlight** (single statements can be 1-2 lines)
- **4-10 highlights per segment** (more granular = better)
- Minimum 5 highlights for segments > 40 lines
- Each has own `ttsText` (1-2 sentences)
- **Not a partition** — OK to skip boilerplate lines between highlights
- Target **50-80% line coverage** of the segment

## Narration style

- Speak as a live code tour to a colleague, not "line 1 through 8 of file.ts"
- Connect segments: "Moving down..." / "Next up..." / "This feeds into..."
- Lead with **WHY** before HOW
- Ground in concrete scenarios: "When a user places an order, this is what runs"
- `[wiring]`: breeze through. `[core]`: detail. Vary pacing.

## User controls

The sidebar handles Play/Pause, Next/Prev, speed, volume, voice, and outline navigation. The agent only needs to respond to `wait-action` events.

See `docs/tts.md` for voice config.
