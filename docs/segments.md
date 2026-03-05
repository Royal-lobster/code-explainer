# Step 3: Parallel Segment Agents (Deep Dive only)

> **Overview mode** skips this step — the planner agent already sent `set_plan` with complete highlights.

Dispatch **one sub-agent per segment** in parallel. Each agent reads its file deeply and generates dense, granular highlights. As each finishes, fire a `replace_segment` to populate the sidebar live.

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
- One concept per highlight, 1-8 lines each
- Deep Dive: 6-12 highlights per segment. Overview: 3-6.
- Split multi-operation blocks (e.g., 3 DB calls → 3 highlights)
- For constructors/calls with multiple args, one highlight per meaningful arg
- ttsText: plain text only, no markdown, no file paths, no line references. Conversational, 1-2 sentences.
- explanation: short markdown label (optional, shown in sidebar alongside code)
- Open with a line that references the previousContext ("Building on the route handler we just saw...")
- [wiring] segments: 1-3 highlights max, brief ttsText ("Standard module wiring — registers the services.")
- [core] segments: thorough. Cover intent, mechanism, concrete scenario, non-obvious decisions.

Return only the JSON object, no prose.
```

## Fire replace_segment as each agent completes

Do not wait for all agents. As soon as one returns its JSON, send it:

```bash
~/.claude/skills/explainer/scripts/explainer.sh send '{
  "type": "replace_segment",
  "id": {id},
  "segment": { ...segment JSON... }
}'
```

The sidebar updates live as segments populate. The user can start the walkthrough as soon as the first few segments are ready — they don't need to wait for all of them.

## Concurrency ceiling

Cap at **5 parallel agents** to avoid rate limits. If there are more segments, queue the remainder and dispatch as slots free up. The progressive `replace_segment` streaming makes queuing invisible to the user.

## After all segments are populated

Proceed to the walkthrough execution doc for the chosen delivery mode:
- **Walkthrough mode** → `docs/walkthrough.md` (sidebar handles playback)
- **Read mode** → `docs/read.md` (step through segments in terminal)
- **Podcast mode** → `docs/podcast.md` (render single audio file)
