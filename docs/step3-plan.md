# Step 3: Build + Present Plan

Parse the sub-agent's response into ordered segments:

```
{number}. {file}:{startLine}-{endLine} -- {brief description} [{complexity}]
```

**Verify:** segments ordered by call flow, within size limits for chosen depth, absolute paths used. Split if needed.

**Present to user:**

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
