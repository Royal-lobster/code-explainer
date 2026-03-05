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
      "highlights": [
        { "start": 10, "end": 12, "ttsText": "First, the route decorator registers this as a POST endpoint at slash orders.", "explanation": "Route registration" },
        { "start": 13, "end": 15, "ttsText": "The request body is validated against the CreateOrderDto schema.", "explanation": "Request validation" },
        { "start": 17, "end": 19, "ttsText": "We extract the user ID from the authenticated request context.", "explanation": "Auth context extraction" },
        { "start": 21, "end": 25, "ttsText": "The order is created by calling the order service with the validated payload.", "explanation": "Service delegation" },
        { "start": 27, "end": 30, "ttsText": "Finally, the response is wrapped in a standard API envelope with the new order ID.", "explanation": "Response formatting" }
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
- `highlights`: required sub-ranges (minimum 1), each with `start`, `end`, `ttsText`, `explanation` (optional)

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
