---
name: explainer
description: "Use when the user asks to explain, walk through, or understand a feature, module, or code flow in the codebase. Triggers on 'explain', 'walk me through', 'how does X work', 'what does this code do'."
---

# Code Explainer

Interactive code walkthrough. Scans the codebase for a feature, builds a segment plan, then walks through each segment — highlighting code in VS Code and explaining at their chosen depth.

## Checklist

Complete these steps in order:

0. **Parallel init** — Dispatch both in a **single response**:
   - **Sidebar check (Bash):** `PORT=$(cat ~/.claude-explainer-port 2>/dev/null) && TOKEN=$(cat ~/.claude-explainer-token 2>/dev/null) && curl -sf -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/health"` — `{"status":"ok"}` means sidebar is active. When active, **NEVER output walkthrough content as terminal text**; all output goes through sidebar HTTP API only.
   - **Assess familiarity (AskUserQuestion):** Read `docs/assess.md` and ask preferences.

1. **Scan codebase** — Read `docs/scan.md`. Dispatch haiku sub-agent with depth level from step 0.
2. **Build + present plan** — Read `docs/plan.md`. Parse scan results into ordered segments, present to user, wait for approval.
3. **Execute walkthrough** — Read the doc for chosen mode: `docs/walkthrough.md`, `docs/read.md`, or `docs/podcast.md`. Walkthrough and podcast reference `docs/tts.md`.
4. **Wrap up** — 3-5 key takeaways, how feature fits the broader architecture, offer to dive deeper or explain related features.

**First-time setup?** Read `docs/setup.md`.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Scope too large | Stick to segment boundaries. Overview: max 80 lines, Detailed: max 40. Split if bigger |
| Not connecting segments | Include a context line linking to previous segment |
| Forgetting to highlight | Sidebar: automatic. Fallback: write to `~/.claude-highlight.json` |
| Reading entire file | Use offset+limit on Read for just the segment |
| Not waiting for user | Pause after each segment for questions |
| ttsText missing or has markdown | Include plain `ttsText` in every segment — strip backticks, bold, line refs from spoken text |
| Explaining obvious code, missing the "why" | Skip standard patterns (loops, imports, null checks). Always explain intent before mechanism |
| Ignoring complexity tags | `[core]` = thorough, `[wiring]` = breeze through, `[supporting]` = brief |
| Sidebar check not parallelized | Dispatch Bash health check + AskUserQuestion in one response, not sequentially |
| Text output when sidebar active | If health check returned ok, send plan JSON only — no terminal text |
| Sub-highlights too broad | One concept per highlight, 1-8 lines each. Split multi-operation blocks. For constructors with N args, use N highlights. Target 4-10 highlights per segment |
| Wrong field names in sidebar JSON | Use `start`/`end`/`title`/`ttsText`/`highlights` — NOT `startLine`/`endLine`/`label`/`subHighlights`. See `docs/plan.md` step 3a for exact schema |
| Skipping `set_plan` before `goto` | Sidebar needs the full plan loaded first. Always send `set_plan` via `explainer.sh plan` before any `goto` messages |
