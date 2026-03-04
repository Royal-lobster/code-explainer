# Step 5: Podcast Mode

Synthesize the entire walkthrough into a single WAV file. No sidebar or highlighting needed.

## Steps

1. **Build plan JSON** — same segment format as autoplay, but only `ttsText` matters. Write narration that flows as a continuous podcast.

```json
{
    "title": "Feature Name Walkthrough",
    "voice": "af_heart",
    "speed": 1.0,
    "segments": [
        {
            "id": 1,
            "title": "Introduction",
            "ttsText": "Welcome to this walkthrough of the authentication system. We'll start with how login requests are handled, then follow the token through validation and session management."
        },
        {
            "id": 2,
            "title": "Request handling",
            "ttsText": "The login flow starts in the auth controller. When a user submits their credentials, the controller validates the input shape, then delegates to the auth service for the actual verification."
        }
    ]
}
```

2. **Generate:**

```bash
cat > /tmp/walkthrough-plan.json << 'PLAN_EOF'
{ "title": "...", "voice": "af_heart", "speed": 1.0, "segments": [...] }
PLAN_EOF
python3 ~/.claude/skills/explainer/scripts/podcast.py /tmp/walkthrough-plan.json
```

Optional custom output path:
```bash
python3 ~/.claude/skills/explainer/scripts/podcast.py /tmp/walkthrough-plan.json ~/Desktop/auth-walkthrough.wav
```

3. **Tell user the file path.** Offer to play: `open ./feature-name-walkthrough-podcast.wav`

## Narration style

Podcast narration should flow as a **continuous audio tour**:
- **Intro segment** (id: 0) — set context: what feature, why it matters, what we'll cover
- **Transitions** — "Now that we've seen how requests arrive, let's follow the data into the service layer"
- **Outro segment** — recap key takeaways
- **3-6 sentences per segment** — longer than interactive since user can't see code
- **Reference code conceptually** — "the validate function" not "line 42" or file paths
- **Describe code shape** — "a small utility, about ten lines, that takes a token and returns the decoded payload"

## Plan JSON fields

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Used in default output filename |
| `segments` | yes | Array of `{id, title, ttsText}` |
| `voice` | no | Default: user config or `af_heart` |
| `speed` | no | Default: user config or `1.0` |

See `docs/tts.md` for voice options.
