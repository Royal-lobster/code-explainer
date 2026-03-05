# Step 3: Build + Present Plan

Parse the sub-agent's response into ordered segments.

**Verify:** segments ordered by call flow, within size limits for chosen depth, absolute paths used. Split if needed.

## 3a. Send plan to sidebar (if active)

Build a `set_plan` JSON message matching the sidebar API schema exactly:

```json
{
  "type": "set_plan",
  "title": "Feature Name Walkthrough",
  "segments": [
    {
      "id": 1,
      "file": "/absolute/path/to/file.ts",
      "start": 10,
      "end": 45,
      "title": "HTTP endpoint, request validation",
      "explanation": "",
      "ttsText": "",
      "highlights": [
        { "start": 10, "end": 20, "ttsText": "Plain text narration for this sub-range.", "explanation": "Optional markdown explanation for this highlight." },
        { "start": 25, "end": 40, "ttsText": "Plain text narration for this sub-range." }
      ]
    }
  ]
}
```

**Field reference** (from `vscode-extension/src/types.ts`):
- `id`: sequential integer
- `file`: absolute path
- `start` / `end`: 1-based line numbers (NOT `startLine` / `endLine`)
- `title`: short segment label (NOT `label` or `description`)
- `explanation`: markdown explanation (can be empty at plan time, filled during walkthrough)
- `ttsText`: plain-text narration (can be empty at plan time, filled during walkthrough)
- `highlights`: optional sub-ranges, each with `start`, `end`, `ttsText`, `explanation` (optional)

Send via:
```bash
cat > /tmp/walkthrough-plan.json << 'EOF'
{ "type": "set_plan", "title": "...", "segments": [...] }
EOF
~/.claude/skills/explainer/scripts/explainer.sh plan /tmp/walkthrough-plan.json
```

## 3b. Present to user

```
I'll walk through {feature} in {N} segments:

1. src/controllers/auth.controller.ts:10-45 -- HTTP endpoint, request validation [core]
2. src/modules/auth.module.ts:1-30 -- Module registration and DI wiring [wiring]
3. src/services/auth.service.ts:20-65 -- Core authentication logic [core]
4. src/services/token.service.ts:15-50 -- JWT generation and verification [supporting]
...

Ready to start? You can reorder, skip, or add segments.
```

Wait for user to approve, adjust, or say "go".
