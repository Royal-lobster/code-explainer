# Step 3: Parallel Segment Agents (Deep Dive only)

> **Overview mode** skips this step — the planner agent already sent `set_plan` with complete highlights.

Dispatch **one sub-agent per segment** in parallel. Each agent reads its file deeply and generates dense, granular highlights. Wait for ALL agents to complete before sending anything to the sidebar.

## Per-segment sub-agent

Agent tool parameters:
- `model`: `MEDIUM` ← replace with model from SKILL.md
- `description`: `Generate highlights for {segment.title}`

### Prompt template

```
You are generating walkthrough highlights for one segment of a code explanation.

Feature: "{feature}"
File: {file}
Lines: {start}–{end}
Complexity: {complexity}
Depth: {overview|deep-dive}

Narrative context:
- Previous segment established: {previousContext}
- Your role in the story: {role}
- You hand off to next segment: {nextContext}
- Suggested opening angle: {narrativeHook}

Read the code:
{file_content}   ← use offset={start} limit={end-start+1}

Generate a JSON segment object:

{
  "id": {id},
  "file": "{file}",
  "start": {start},
  "end": {end},
  "title": "{title}",
  "explanation": "<markdown explanation of the full segment>",
  "highlights": [
    {
      "start": <line>,
      "end": <line>,
      "ttsText": "<1-2 sentence plain-text narration for this highlight>",
      "explanation": "<optional markdown label shown in sidebar>"
    }
  ]
}

Highlight rules:

Think of highlights as a **teacher's pointer**, not PowerPoint slides. The teacher talks while pointing at different parts of the board — the pointer moves fast, the voice flows. Each highlight is "look here" while I explain, not a separate mini-lecture.

- **6-12 highlights per segment** in Deep Dive. Quality over quantity.
- **1-4 lines per highlight**. Group related lines (e.g., a condition + its body, a variable + its usage). Only use single-line highlights for truly standalone key lines.
- **Skip boilerplate**: imports, obvious field declarations, closing braces, standard enum values, trivial assignments. If a line is self-explanatory to someone reading code, don't highlight it.
- **Highlight what's interesting**: non-obvious logic, key design decisions, the "why" lines, surprising patterns, error handling strategies, the lines that make this code *this* code rather than generic boilerplate.
- `ttsText`: **1-2 sentences**, plain text only. Explain the *intent* or *why*, not just what the line does. "The retry budget is set to three — enough to recover from a nonce collision but not so many that a broken transaction loops forever." not "This sets the retry limit to three."
- `explanation`: 2-5 word label shown in sidebar. "Retry budget", "Nonce recovery", "Balance gate". Think tooltip, not prose.
- First highlight: open with a one-liner referencing previousContext. ("Picking up from the controller, here's where credentials are actually checked.")
- `[wiring]` segments: **3-5 highlights max**. Hit only the non-obvious config choices. "Registers the auth module." and move on.
- `[core]` segments: **8-12 highlights**. Cover every important decision, skip standard patterns.

Return only the JSON object, no prose.
```

### Example — constructor with 4 args

Good — pointer style, group related lines:
```json
"highlights": [
  { "start": 12, "end": 16, "ttsText": "Four services are injected — the interesting ones are UserRepository for database access and JwtService for token signing. The mailer and config service are standard NestJS plumbing.", "explanation": "DI dependencies" },
  { "start": 18, "end": 18, "ttsText": "Token expiry is set from config right here in the constructor — no magic number buried deep in a method where you'd never find it.", "explanation": "Token expiry from config" }
]
```

Not this — one highlight per line narrating the obvious:
```json
"highlights": [
  { "start": 12, "end": 12, "ttsText": "The constructor opens here.", "explanation": "Constructor" },
  { "start": 13, "end": 13, "ttsText": "Injects the user repository for database access.", "explanation": "UserRepository" },
  { "start": 14, "end": 14, "ttsText": "Injects the JWT service for token signing.", "explanation": "JwtService" },
  { "start": 15, "end": 15, "ttsText": "Injects the mailer for sending verification emails.", "explanation": "MailerService" },
  { "start": 16, "end": 16, "ttsText": "And the config service to pull environment values at runtime.", "explanation": "ConfigService" }
]
```

## Wait for all agents, then send one complete `set_plan`

Do NOT send anything to the sidebar until every agent has returned. Once all segments are ready, assemble them into a single `set_plan` and send it:

```bash
cat > /tmp/walkthrough-plan.json << 'EOF'
{
  "type": "set_plan",
  "title": "{feature} Walkthrough",
  "segments": [
    { ...segment 1 with full highlights... },
    { ...segment 2 with full highlights... },
    ...
  ]
}
EOF
~/.claude/skills/explainer/scripts/explainer.sh plan /tmp/walkthrough-plan.json
```

## Concurrency ceiling

Cap at **5 parallel agents** to avoid rate limits. If there are more segments, queue the remainder and dispatch as slots free up.

## After `set_plan` is sent

Proceed to the walkthrough execution doc for the chosen delivery mode:
- **Walkthrough mode** → `docs/walkthrough.md` (sidebar handles playback)
- **Read mode** → `docs/read.md` (step through segments in terminal)
- **Podcast mode** → `docs/podcast.md` (render single audio file)
