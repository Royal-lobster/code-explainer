# Step 5: Interactive Walkthrough

**If Autoplay was chosen, use `docs/step5-autoplay.md` instead.**

For Interactive modes, do these steps for EACH segment:

## 5a. Highlight in VS Code

**MANDATORY: Highlight code BEFORE explaining each segment.**

If the sidebar extension is running (`~/.claude-explainer-port` exists), highlighting happens automatically when you send the walkthrough plan — the extension highlights each segment as it plays.

For interactive (non-autoplay) mode, you can send a goto command to highlight a specific segment:

```bash
~/.claude/skills/explainer/scripts/explainer.sh send '{"type": "goto", "segmentId": {id}}'
```

**Fallback:** If the sidebar extension is not running, write the highlight JSON directly:

```bash
echo '{"file":"{absolute_filepath}","start":{startLine},"end":{endLine}}' > ~/.claude-highlight.json
```

The VS Code extension's file-watcher fallback will pick it up, opening the file and highlighting the range with a gold background.

**Important:** Always use absolute file paths.

## 5b. Read the Segment

Use the Read tool with offset and limit to read exactly the segment's lines:

```
Read(file_path, offset=startLine, limit=endLine-startLine+1)
```

## 5c. Explain the Segment

**Adapt your depth based on the segment's complexity tag:**
- `[core]` segments — full explanation using all 5 parts below
- `[wiring]` segments — 1-2 sentences max: "This is standard NestJS module wiring — it registers the services we just saw. The interesting part is next."
- `[supporting]` segments — brief explanation, focus on what it enables for core segments

**Structure your explanation as (for `[core]` segments):**

1. **Intent** (1-2 sentences) — What problem does this code solve? Why does it exist? What would break without it? Lead with this BEFORE describing any mechanics.
2. **Mechanism** — Walk through the code, grouped by concept (not strictly line-by-line). Reference specific lines.
   - Overview depth: 3-6 sentences, skip implementation details
   - Detailed depth: 6-12 sentences, include patterns, design decisions, edge cases
3. **Concrete scenario** (1 sentence) — Ground it in a real user action: "When a user clicks Buy, this validates the price hasn't drifted more than 2% since they saw the quote."
4. **Non-obvious decisions** (only if genuine) — Call out surprising choices, deliberate trade-offs, or unusual patterns. Skip this entirely if the code is straightforward. Don't manufacture insights.
5. **Thread forward** (1 sentence) — What mental model should the listener carry into the next segment? Not just "next we look at X" but "now that we know how orders are validated, we'll see how they get matched against the order book."

**What NOT to explain:**
- Import blocks — unless unusual imports reveal architecture decisions
- Standard loops, null checks, try/catch — unless the catch logic IS the interesting part
- Boilerplate (module decorators, standard constructor DI, getter/setter patterns)
- Anything a developer at the target depth level would immediately understand
- When a segment is mostly boilerplate, acknowledge it: "This is standard setup — the key line is 34 where..."

**Formatting rules:**
- Reference specific line numbers: "On line 42, the `matchOrders()` call..."
- Use the file_path:line_number pattern for cross-references
- Use code inline references with backticks for variable/function names

## 5c-tts. Speak the Explanation (if TTS enabled)

If TTS is enabled, create a **spoken version** of the explanation and pipe it to the speak script. The spoken version must be simplified for natural listening. See `docs/tts.md` for voice, speed, and formatting rules.

**Conversion rules (written -> spoken):**
- Strip all markdown formatting (backticks, bold, headers)
- Remove line number references ("On line 42," -> "")
- Remove file path references
- Simplify code references ("the `matchOrders()` method" -> "the matchOrders method")
- Keep it to 2-4 sentences max -- shorter than the written explanation
- Make it conversational, as if explaining to a colleague

**Example:**
- Written: "On line 42, the `matchOrders()` method iterates through the `pendingOrders` array, calling `tryFill()` for each order that meets the price threshold."
- Spoken: "The matchOrders method iterates through pending orders, calling tryFill for each order that meets the price threshold."

**If using the sidebar extension:** TTS is handled automatically by the extension's built-in TTS bridge. The sidebar streams audio via Web Audio API when a segment becomes active. No need to call any script — just include `ttsText` in your segments.

**If sidebar is not available:** TTS is not supported in fallback mode (the old `speak.sh` has been removed).

## 5d. Wait for User

After explaining each segment, end with:

```
Segment {current}/{total} -- say "next" to continue, or ask any questions about this part.
```

**Handle user responses:**
- "next" / "continue" / "go" -> proceed to next segment
- A question -> answer it, then ask if ready for next segment
- "skip" -> move to next segment without explaining
- "skip to {N}" -> jump to segment N
- "go deeper" -> re-read the segment with Detailed depth
- "zoom out" -> re-read with Overview depth
- "stop" / "done" -> jump to wrap-up
- "mute" / "silence" -> disable TTS for remaining segments, confirm with "Audio muted."
- "unmute" / "audio on" -> re-enable TTS for remaining segments, confirm with "Audio enabled."
