# Step 5-autoplay: Autoplay Mode (Streaming)

In autoplay mode, the walkthrough plays automatically -- highlights move through the code while narration plays in sync. The user watches and listens.

**Key design: streaming generation.** The presentation starts playing as soon as the first sub-blocks are written, while you continue generating the rest. This avoids making the user wait for the entire script to be generated upfront.

## How it works

1. **Create the script file and start the streaming presenter:**

```bash
> /tmp/claude-presentation.txt
```

Then launch the streaming presenter with `run_in_background: true`:
```bash
KOKORO_SPEED={speed} ~/.claude/skills/explainer/scripts/present.sh --stream /tmp/claude-presentation.txt
```

Tell the user: "Starting walkthrough -- say 'pause' to stop or ask a question anytime."

2. **For each segment, read → generate → append:**

Process segments **one at a time**. For each segment in the plan:

a. **Read the segment** using the Read tool with offset and limit
b. **Break into sub-blocks** of 5-15 lines (imports, constructor, method body, return statement, etc.)
c. **Generate narration** for each sub-block (1-2 sentences, no markdown/code formatting)
d. **Append sub-blocks to the script file:**

```bash
cat >> /tmp/claude-presentation.txt << 'BLOCK'
/path/to/matching.module.ts|1|8|Here we have the module definition. It imports all the services needed for order matching.
/path/to/matching.module.ts|10|20|The module decorator wires up providers and exports. Notice how the matching engine and orderbook manager are both registered here.
BLOCK
```

The presenter picks up and plays each batch as soon as it's written. While the first segment's narrations play (~20-40 seconds), you generate the next segment's sub-blocks in parallel.

3. **After the last segment, write the end marker:**

```bash
echo "END" >> /tmp/claude-presentation.txt
```

**Important:** Always use `cat >> ... << 'BLOCK'` (double `>>` to append, single-quoted delimiter for literal content). Each append is picked up immediately by the streaming presenter.

## Sub-block sizing guidelines

- Each sub-block should be 5-15 lines -- small enough that the highlight visibly moves
- Each narration should take 3-8 seconds to speak (roughly 10-25 words)
- A 40-line segment should break into ~4-6 sub-blocks
- A full walkthrough of 6 segments produces ~25-35 sub-blocks (~2-4 minutes total)

## User controls during autoplay

- **"pause"** / **"stop"** -- Kill the background presentation: `killall present.sh say 2>/dev/null`
- **"resume"** -- Not supported (restart from a specific segment instead)
- **"restart from segment N"** -- Regenerate the presentation script starting from segment N and relaunch
- Any question -- Kill the presentation, answer the question, then offer to resume

## Autoplay narration style

- Speak as if giving a live code tour to a colleague
- "Here we have the module definition..." not "This is line 1 through 8 of matching.module.ts"
- Connect sub-blocks: "Moving down, we see..." / "Next up is..." / "This feeds into..."
- Keep it flowing -- the highlight movement + voice should feel continuous
- **Lead with WHY before HOW**: "The system needs to validate prices before matching — here's how it does that" not "This function takes a price parameter and checks..."
- **Ground in concrete scenarios**: "When a user places a market order, this is the code that runs"
- **Breeze through boilerplate**: For `[wiring]` segments, don't narrate line-by-line. Instead: "This is standard module setup — the interesting part is coming up next" and move on quickly
- **Vary pacing**: Slow down and add detail on `[core]` sub-blocks with dense or surprising logic. Speed through obvious patterns and setup code.

See `docs/tts.md` for voice configuration, speed settings, and formatting rules.
