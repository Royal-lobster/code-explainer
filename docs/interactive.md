# Step 5: Interactive Walkthrough

**If Autoplay was chosen, use `docs/autoplay.md` instead.**

For each segment:

## 5a. Highlight in VS Code

**Highlight BEFORE explaining.**

Sidebar active (from step 0):
```bash
~/.claude/skills/explainer/scripts/explainer.sh send '{"type": "goto", "segmentId": {id}}'
```

Fallback (no sidebar):
```bash
echo '{"file":"{absolute_filepath}","start":{startLine},"end":{endLine}}' > ~/.claude-highlight.json
```

Always use absolute file paths.

## 5b. Read the Segment

```
Read(file_path, offset=startLine, limit=endLine-startLine+1)
```

## 5c. Explain the Segment

**Depth by complexity tag:**
- `[core]` — full explanation (all 5 parts below)
- `[wiring]` — 1-2 sentences: "Standard module wiring — registers the services. Moving on."
- `[supporting]` — brief, focus on what it enables for core segments

**Structure for `[core]` segments:**

1. **Intent** (1-2 sentences) — What problem does this solve? What breaks without it?
2. **Mechanism** — Walk through by concept, reference specific lines.
   - Overview: 3-6 sentences. Detailed: 6-12 sentences.
3. **Concrete scenario** (1 sentence) — "When a user clicks Buy, this validates the price hasn't drifted."
4. **Non-obvious decisions** — Only if genuine. Skip if straightforward.
5. **Thread forward** (1 sentence) — Mental model for next segment, not just "next we see X".

**Skip:** import blocks, standard loops/null checks, boilerplate — unless they ARE the interesting part.

**Formatting:** Reference lines ("On line 42, `matchOrders()`..."), use `file:line` for cross-refs, backticks for names.

## 5c-tts. TTS (if enabled)

Sidebar active: TTS is automatic — just include `ttsText` in segments. No scripts needed.

Sidebar not available: TTS not supported in fallback mode.

For `ttsText` formatting rules, see `docs/tts.md`. Key rule: plain text only, no markdown/line refs/paths, 2-4 sentences, conversational.

## 5d. Wait for User

```
Segment {current}/{total} -- say "next" to continue, or ask any questions.
```

Handle: "next"→proceed, question→answer then ask if ready, "skip"→next, "skip to {N}"→jump, "go deeper"→Detailed depth, "zoom out"→Overview depth, "stop"→wrap-up, "mute"/"unmute"→toggle TTS.
