# Sharing Walkthroughs Design

## Problem

Walkthroughs are ephemeral — they exist only in-memory during an active session. Users want to:
- Save walkthroughs for later replay
- Share walkthroughs with teammates via the repo

## Solution

Save walkthroughs as `.walkthrough.json` files in a `.walkthroughs/` directory at the workspace root. Files use relative paths so they're portable across machines.

## File Format

Same as the existing `set_plan` payload, with relative file paths:

```json
{
  "title": "Authentication Flow",
  "segments": [
    {
      "id": 1,
      "file": "src/auth/login.ts",
      "start": 10,
      "end": 45,
      "title": "Token validation",
      "explanation": "...",
      "highlights": [
        { "start": 12, "end": 15, "ttsText": "..." }
      ]
    }
  ]
}
```

Filename: `.walkthroughs/<title-slug>.json` (e.g., `authentication-flow.json`)

## Save Flow

Triggers:
- Command palette: "Code Explainer: Save Walkthrough"
- Sidebar: save icon in walkthrough header
- Agent CLI: `explainer.sh save [name]`

Behavior:
1. Take current in-memory plan
2. Convert absolute paths → relative (to workspace root)
3. Write to `.walkthroughs/<slug>.json`
4. Prompt to overwrite if file exists
5. Show VS Code notification on success

## Load & Replay Flow

Triggers:
- Command palette: "Code Explainer: Load Walkthrough" → QuickPick list
- Sidebar: "Saved Walkthroughs" browse section (idle state) or TreeView
- Agent CLI: `explainer.sh load <name>`

Behavior:
1. Read JSON from `.walkthroughs/`
2. Convert relative paths → absolute
3. Call existing `setPlan()` — walkthrough plays as normal (TTS, highlighting, navigation all unchanged)

## Sidebar Changes

- **Idle state**: Show "Saved Walkthroughs" section listing available files. Click to load and play.
- **Playing state**: Show save icon in header area.
- **TreeView**: Register a secondary view for persistent browse of saved walkthroughs.

## Agent/CLI Integration

New `explainer.sh` commands:
- `explainer.sh save [name]` — POST to `/api/save`
- `explainer.sh load [name]` — POST to `/api/message` with loaded plan
- `explainer.sh list` — GET `/api/walkthroughs`

New extension API endpoints:
- `POST /api/save` — saves current plan to disk with optional name
- `GET /api/walkthroughs` — lists saved walkthrough files

## Key Decisions

- **Relative paths**: Required for portability across machines
- **No audio in files**: TTS regenerated locally by recipient (keeps files ~5-20KB)
- **No metadata**: Title and segments only. No author, date, or staleness detection in v1.
- **No auto-save**: User explicitly triggers save
- **.walkthroughs/ directory**: Hidden directory at repo root, version-controlled
