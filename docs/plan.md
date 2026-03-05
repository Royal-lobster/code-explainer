# Step 2: Planner (Deep Dive only)

> **Overview mode** skips this step — a single Haiku agent builds plan + highlights in one pass and sends `set_plan` directly.

Dispatch a **`LARGE`** sub-agent to turn the scout's file map into a narrative plan. The planner decides *how to tell the story*, not just what files exist.

After the planner finishes, proceed to dispatch segment agents. Do NOT send anything to the sidebar yet — wait until all segment agents have completed and you have full highlights for every segment.

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

## After the planner finishes

Show the plan outline in chat so the user can reorder or skip segments before generation begins:

```
I'll walk through {feature} in {N} segments:

1. src/controllers/auth.controller.ts:10-45 — HTTP endpoint handler [core]
2. src/modules/auth.module.ts:1-30 — Module registration [wiring]
3. src/services/auth.service.ts:20-65 — Core authentication logic [core]
...

Say "go" to start generating, or adjust the plan first.
```

Once the user approves, proceed to Step 3 — pass the planner's transition objects to the segment agents.
