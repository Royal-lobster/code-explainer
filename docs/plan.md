# Step 2: Planner (Deep Dive only)

> **Overview mode** skips this step — a single Haiku agent builds plan + highlights in one pass and sends `set_plan` directly.

Dispatch a **`LARGE`** sub-agent to turn the scout's file map into a narrative plan. The planner decides *how to tell the story*, not just what files exist.

Immediately after the planner finishes, send a **stub `set_plan`** to the sidebar so the user sees the outline while segment agents run in the background.

## Planner sub-agent

Agent tool parameters:
- `model`: `LARGE` ← replace with model from SKILL.md
- `description`: `Plan walkthrough narrative for {feature}`

### Prompt template

```
You are planning a code walkthrough for "{feature}".

The scout found these files (in call-flow order):

{scout_output}

Your job is to produce an ordered list of walkthrough segments with narrative transition objects.
Do NOT read the actual code — work only from the scout's summaries.

For each segment output:

{
  "id": <sequential integer>,
  "file": "<absolute path>",
  "start": <1-based line number>,
  "end": <1-based line number>,
  "title": "<short segment label>",
  "complexity": "<core|wiring|supporting>",
  "previousContext": "<what the previous segment established, or 'Entry point' for first>",
  "role": "<what this segment does in 1-2 sentences>",
  "nextContext": "<what this segment hands off to the next>",
  "narrativeHook": "<how to open the explanation — what angle makes this segment interesting>"
}

Rules:
- Order by pedagogical flow, not just call order. Sometimes it's clearer to show the data shape before the code that creates it.
- Keep [wiring] segments brief — flag them so the segment agent breezes through.
- The narrativeHook should give the segment agent a concrete angle, not just "explain this file".
- previousContext / nextContext are the connective tissue that makes segments feel like one continuous story.

Return a JSON array of segment objects.
```

## Immediately after the planner finishes

**1. Send a stub `set_plan` to the sidebar** (if active) with empty highlights. This makes the outline visible right away while segment agents generate in the background.

```json
{
  "type": "set_plan",
  "title": "{feature} Walkthrough",
  "segments": [
    {
      "id": 1,
      "file": "/absolute/path/to/file.ts",
      "start": 10,
      "end": 45,
      "title": "HTTP endpoint handler",
      "explanation": "Generating...",
      "highlights": [{ "start": 10, "end": 45, "ttsText": "Generating..." }]
    }
  ]
}
```

```bash
cat > /tmp/walkthrough-plan.json << 'EOF'
{ "type": "set_plan", "title": "...", "segments": [...] }
EOF
~/.claude/skills/explainer/scripts/explainer.sh plan /tmp/walkthrough-plan.json
```

**2. Proceed to Step 3** — pass the planner's transition objects to the segment agents.

## Present plan to user

After sending to sidebar, also show the plan in chat so the user can reorder or skip segments before generation begins:

```
I'll walk through {feature} in {N} segments:

1. src/controllers/auth.controller.ts:10-45 — HTTP endpoint handler [core]
2. src/modules/auth.module.ts:1-30 — Module registration [wiring]
3. src/services/auth.service.ts:20-65 — Core authentication logic [core]
...

Generating detailed explanations in the background. Say "go" to start, or adjust the plan first.
```
