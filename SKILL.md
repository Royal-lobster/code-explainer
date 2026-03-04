---
name: explainer
description: "Use when the user asks to explain, walk through, or understand a feature, module, or code flow in the codebase. Triggers on phrases like 'explain', 'walk me through', 'how does X work', 'what does this code do'."
---

# Code Explainer

## Setup (one-time)

Run the setup script — it handles everything:

```bash
~/.claude/skills/explainer/setup.sh
```

This will:
1. Check prerequisites (macOS, Python 3.10+, Node.js, VS Code or Cursor)
2. Create a Python venv and install Kokoro TTS (mlx-audio)
3. Build and install the `code-explainer` extension (VS Code + Cursor)
4. Pre-download the Kokoro voice model (~330 MB)

After setup, reload your editor: `Cmd+Shift+P` → "Developer: Reload Window".

**Requirements:** macOS (Apple Silicon recommended), Python 3.10+, Node.js, VS Code or Cursor with CLI enabled.

## Overview

Interactive code walkthrough skill. Scans the codebase for a feature, builds a segment-by-segment plan, then walks the user through each segment -- highlighting code in VS Code and explaining it at their chosen depth level.

## When to Use

- User asks to "explain" or "walk me through" a feature
- User wants to understand how a module, service, or flow works
- User says "how does X work" about the codebase
- User asks for a code walkthrough or tour

## When NOT to Use

- User wants to fix a bug (use systematic-debugging)
- User wants to change code (use brainstorming/writing-plans)
- User asks a quick factual question ("what port does the backend run on?")

## Checklist

You MUST complete these steps in order:

1. **Assess familiarity** -- ask the user their depth preference
2. **Scan the codebase** -- find all files relevant to the feature
3. **Build walkthrough plan** -- ordered segments with file:lines and descriptions
4. **Present plan** -- get user approval, allow reordering
5. **Execute walkthrough** -- segment by segment with VS Code navigation
6. **Wrap up** -- summarize key takeaways

## User Config

Preferences are saved at `~/.config/code-explainer/config.json`. On first use, the file won't exist — ask the user their preferences and save them. On subsequent uses, load the saved config and **skip Step 1** (don't re-ask). The user can change settings anytime by saying "change settings", "change speed", "change voice", etc.

**Config schema:**
```json
{
  "depth": "overview",
  "mode": "autoplay",
  "speed": 1.0,
  "voice": "af_heart"
}
```

**Before Step 1**, check if config exists:
```bash
cat ~/.config/code-explainer/config.json 2>/dev/null
```

If it exists, load the values and skip to Step 2. Tell the user: "Using your saved preferences (depth: overview, mode: autoplay, speed: 1.0x). Say 'change settings' anytime to adjust."

If it doesn't exist, proceed with Step 1 below. After getting answers, save the config:
```bash
mkdir -p ~/.config/code-explainer
cat > ~/.config/code-explainer/config.json << 'EOF'
{"depth": "overview", "mode": "autoplay", "speed": 1.0, "voice": "af_heart"}
EOF
```

**Speed** controls narration playback rate:
- `1.0` = normal speed
- `1.25` = slightly faster
- `1.5` = fast (good for familiar code)
- `2.0` = very fast (skimming)

Pass speed to TTS via the `KOKORO_SPEED` env var:
```bash
KOKORO_SPEED=1.5 ~/.claude/skills/explainer/scripts/speak.sh "text"
```

For autoplay, include speed in the presentation:
```bash
KOKORO_SPEED=1.5 ~/.claude/skills/explainer/scripts/present.sh /tmp/claude-presentation.txt
```

## Step 1: Assess Familiarity

Ask the user using AskUserQuestion (combine into one question set):

**Question 1: "What depth level do you want for this explanation?"**

| Level | Description | Segment style |
|-------|-------------|---------------|
| **Overview** | High-level architecture, how pieces connect, data flow | 40-80 line segments, skip implementation details, focus on structure |
| **Detailed** | Line-by-line explanation, patterns, design decisions | 15-40 line segments, explain why code is written this way |
| **Focused** | Answer a specific question about a specific part | Jump directly to relevant code, explain only what's asked |

Default to **Overview** if the user seems unfamiliar with the code.

**Question 2: "How do you want the walkthrough delivered?"**

| Mode | Description |
|------|-------------|
| **Autoplay** (recommended) | Highlights move through code automatically while narration plays in sync. Hands-free — just watch and listen. Say "pause" to stop. |
| **Interactive + TTS** | Step-by-step with voice. Claude highlights, explains in text + voice, then waits for "next". You control the pace. |
| **Interactive (text only)** | Step-by-step, text only. Claude highlights, explains in text, waits for "next". |

Default to **Interactive (text only)** if the user doesn't answer.

**Question 3: "What narration speed?"**

| Speed | Description |
|-------|-------------|
| **1x** (default) | Normal pace, good for unfamiliar code |
| **1.25x** | Slightly faster |
| **1.5x** | Fast, good for familiar code |
| **2x** | Very fast, skim mode |

Default to **1x**.

After getting answers, save to config file (see User Config section above). Track all settings throughout the session.

## Step 2: Scan the Codebase (via sub-agent)

**Dispatch a haiku sub-agent** to scan the codebase. This saves main conversation context for the walkthrough itself.

Use the Agent tool with these parameters:
- `subagent_type`: `Explore`
- `model`: `haiku`
- `description`: `Scan codebase for {feature}`

**Prompt template for the sub-agent:**

```
Scan this codebase to find all files relevant to "{feature}".

1. Grep for: {feature name}, key class names, key function names
2. Glob for file patterns in relevant directories
3. Read entry points and key files to understand the flow
4. Follow imports to discover related files
5. Look for service classes, controllers, modules, types, and tests

Return a structured result:
- **Entry point**: the file/function where the feature starts
- **Core files**: list of files with brief description of each
- **Call chain**: what calls what (A -> B -> C)
- **Walkthrough plan**: ordered list of segments, each as:
  {file_absolute_path}:{startLine}-{endLine} -- {brief description}

Depth level: {overview|detailed|focused}
Segment sizing:
- Overview: 40-80 lines per segment, 4-8 segments total
- Detailed: 15-40 lines per segment, 8-15 segments total
- Focused: 1-3 segments, only what's relevant

Ordering: start with entry point, follow data/call flow, group related logic, end with utilities/types/config.
```

**Tips for the prompt:**
- Include the feature name and any files the user mentioned or has open
- Specify the depth level chosen in Step 1
- If the user pointed to a specific file, tell the sub-agent to start there

The sub-agent returns the walkthrough plan. You then present it in Step 4.

## Step 3: Build Walkthrough Plan

Parse the sub-agent's response into an ordered list of segments. Each segment is:

```
{number}. {file}:{startLine}-{endLine} -- {brief description}
```

**Verify the plan:**
- Segments are ordered by data/call flow (entry point first)
- No segment exceeds the size limit for the chosen depth
- Absolute file paths are used
- Adjust or split segments if needed

## Step 4: Present Plan

Show the plan to the user in a numbered list:

```
I'll walk through {feature} in {N} segments:

1. src/controllers/auth.controller.ts:10-45 -- HTTP endpoint, request validation
2. src/services/auth.service.ts:20-65 -- Core authentication logic
3. src/services/token.service.ts:15-50 -- JWT generation and verification
...

Ready to start? You can reorder, skip, or add segments.
```

Wait for the user to approve, adjust, or say "go".

## Step 5: Execute Walkthrough

**If Autoplay was chosen, skip to Step 5-autoplay below.**

For Interactive modes, do these steps for EACH segment:

### 5a. Highlight in VS Code

**MANDATORY: Run this BEFORE explaining each segment.** This writes a JSON file that the code-explainer VS Code extension picks up to open the file, highlight the line range, and scroll to it:

```bash
~/.claude/skills/explainer/scripts/highlight.sh {absolute_filepath} {startLine} {endLine}
```

The highlight script writes `{"file":"...","start":N,"end":N}` to `~/.claude-highlight.json`. The VS Code extension watches this file and reacts by:
1. Opening the file in the editor
2. Selecting the specified line range
3. Scrolling to center the selection in the viewport
4. Applying a subtle gold background decoration so the range stands out visually

**Important:** Always use absolute file paths. The VS Code extension must be installed (see Setup section above). If the extension is not installed, the highlight will have no effect -- the walkthrough still works, just without automatic navigation.

### 5b. Read the Segment

Use the Read tool with offset and limit to read exactly the segment's lines:

```
Read(file_path, offset=startLine, limit=endLine-startLine+1)
```

### 5c. Explain the Segment

**Structure your explanation as:**

1. **Context line** (1 sentence) -- how this connects to the previous segment or the overall flow
2. **What this code does** -- explain the segment's purpose
3. **Key details** (depth-dependent):
   - Overview: skip implementation details, focus on what and why
   - Detailed: explain patterns, design decisions, edge cases, why it's written this way
4. **Connection forward** (1 sentence) -- what comes next and why

**Formatting rules:**
- Reference specific line numbers: "On line 42, the `matchOrders()` call..."
- Use the file_path:line_number pattern for cross-references
- Keep each segment explanation concise -- aim for 3-8 sentences for overview, 8-15 for detailed
- Use code inline references with backticks for variable/function names

### 5c-tts. Speak the Explanation (if TTS enabled)

If TTS is enabled, create a **spoken version** of the explanation and pipe it to the speak script. The spoken version must be simplified for natural listening:

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

**Execute via Bash with `run_in_background: true`** so speech does not block Claude:

```bash
~/.claude/skills/explainer/scripts/speak.sh "The matchOrders method iterates through pending orders..."
```

### 5d. Wait for User

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

## Step 5-autoplay: Autoplay Mode

In autoplay mode, the walkthrough plays automatically -- highlights move through the code while narration plays in sync. The user watches and listens.

### How it works

1. **Read all segments** -- Read each segment's code to understand it
2. **Break segments into sub-blocks** -- Within each segment, identify logical sub-blocks of 5-15 lines (imports, constructor, method body, return statement, etc.)
3. **Write narration per sub-block** -- Short, conversational narration (1-2 sentences per sub-block). Strip all markdown/code formatting.
4. **Generate a presentation script** -- Write a pipe-delimited file where each line is:
   ```
   /absolute/path/to/file.ts|startLine|endLine|Narration text for this block
   ```
5. **Write the script to a temp file** and launch `present.sh`:

```bash
# Write the presentation script
cat > /tmp/claude-presentation.txt << 'PRESENTATION'
/path/to/matching.module.ts|1|8|This is the module definition. It imports all the services needed for order matching.
/path/to/matching.module.ts|10|20|The module decorator wires up providers and exports. Notice how the matching engine and orderbook manager are both registered here.
/path/to/orderbook-manager.service.ts|15|30|The orderbook manager service handles order placement. It maintains separate buy and sell books.
PRESENTATION

# Launch in background
~/.claude/skills/explainer/scripts/present.sh /tmp/claude-presentation.txt
```

6. **Run via Bash with `run_in_background: true`** so the presentation plays while Claude remains responsive
7. **Tell the user**: "Playing walkthrough -- say 'pause' to stop or 'resume' to continue."

### Sub-block sizing guidelines

- Each sub-block should be 5-15 lines -- small enough that the highlight visibly moves
- Each narration should take 3-8 seconds to speak (roughly 10-25 words)
- A 40-line segment should break into ~4-6 sub-blocks
- A full walkthrough of 6 segments produces ~25-35 sub-blocks (~2-4 minutes total)

### User controls during video mode

- **"pause"** / **"stop"** -- Kill the background presentation: `killall present.sh say 2>/dev/null`
- **"resume"** -- Not supported (restart from a specific segment instead)
- **"restart from segment N"** -- Regenerate the presentation script starting from segment N and relaunch
- Any question -- Kill the presentation, answer the question, then offer to resume

### Video mode narration style

- Speak as if giving a live code tour to a colleague
- "Here we have the module definition..." not "This is line 1 through 8 of matching.module.ts"
- Connect sub-blocks: "Moving down, we see..." / "Next up is..." / "This feeds into..."
- Keep it flowing -- the highlight movement + voice should feel continuous

## Step 6: Wrap Up

After the last segment (or when user says "done"):

1. **Summary** -- 3-5 bullet points of the key takeaways
2. **Architecture note** -- how this feature fits into the broader system
3. **Offer next steps** -- "Want me to dive deeper into any part, or explain a related feature?"

## Example Session

```
User: /explainer the order matching engine

Claude: [Asks depth preference]

User: Overview

Claude: [Scans codebase, finds 5 relevant files]
Claude: I'll walk through the matching engine in 6 segments:
  1. matching.module.ts:1-25 -- Module setup and dependencies
  2. orderbook-manager.service.ts:1-40 -- Orderbook structure and initialization
  3. orderbook-manager.service.ts:42-95 -- Order placement and book management
  4. matching-engine.service.ts:1-60 -- Core matching algorithm
  5. matching-engine.service.ts:62-120 -- Fill execution and settlement
  6. matching.gateway.ts:1-45 -- WebSocket events and real-time updates
Ready to start?

User: go

Claude: [runs: highlight.sh /path/to/matching.module.ts 1 25]
         -> VS Code extension opens file, highlights lines 1-25
Claude: [reads lines 1-25]
Claude: **Segment 1/6 -- Module Setup**
This is the NestJS module that wires up the matching engine...
[explanation]
Segment 1/6 -- say "next" to continue, or ask questions.

User: next

Claude: [runs: highlight.sh /path/to/orderbook-manager.service.ts 1 40]
         -> VS Code extension opens file, highlights lines 1-40
...
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Explaining too much at once | Stick to segment boundaries, keep explanations concise |
| Not connecting segments | Always include a context line linking to previous segment |
| Forgetting to highlight | ALWAYS run `highlight.sh` before explaining each segment |
| Reading the entire file | Use offset+limit on Read to show only the segment |
| Not waiting for user | Always pause after each segment for questions |
| Segments too large | Overview: max 80 lines. Detailed: max 40 lines. Split if bigger |
| Not speaking before explaining | If TTS is enabled, ALWAYS run speak.sh after writing the explanation |
| Speaking markdown formatting | Strip all backticks, bold markers, line refs from spoken text |

## TTS Notes

- TTS uses **Kokoro-82M** (via mlx-audio) -- #1 ranked open-source TTS, runs locally on Apple Silicon
- Uses a **persistent server** (`kokoro_server.py`) that loads the model once. First call takes ~5s (model load), subsequent calls are near-instant (<500ms generation)
- The server starts automatically on first TTS call and stays running in the background
- Falls back to macOS `say` if Kokoro is not installed
- Speech is **non-blocking** -- Claude continues while audio plays (use `run_in_background: true` on the Bash call)
- Previous speech is **auto-canceled** when a new segment starts (the script kills `afplay`/`say` before speaking)
- **Strip all markdown** from spoken text: no backticks, no `**bold**`, no `line 42` references, no file paths
- Keep spoken explanations **shorter than written** ones -- aim for 2-4 sentences max
- The spoken text should sound **natural and conversational**, not like reading documentation
- Voice: `af_heart` (American English female) -- configurable via `KOKORO_VOICE` env var or user config
- Available voices: `af_heart`, `af_bella`, `af_sarah`, `am_adam`, `am_michael`, `bf_emma`, `bm_george` (a=American, b=British, f=female, m=male)
- Speed: configurable via `KOKORO_SPEED` env var or user config (default 1.0). Supports 1.0x, 1.25x, 1.5x, 2.0x
- **Always pass the user's speed setting** from config to the TTS scripts via `KOKORO_SPEED` env var
