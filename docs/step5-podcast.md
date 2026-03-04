# Step 5-podcast: Podcast Mode (Audio File Generation)

In podcast mode, the entire walkthrough is synthesized into a single WAV file the user can listen to anywhere — no VS Code extension required.

**Key design: standalone audio.** Claude generates all segment narrations, sends them to the TTS server, and produces one WAV file. No sidebar, no highlighting, no interactivity needed.

## How it works

1. **Build the walkthrough plan as a JSON file:**

Same segment format as autoplay, but only `ttsText` matters for audio generation. Write conversational narration that flows as a continuous podcast rather than isolated segments.

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
            "ttsText": "The login flow starts in the auth controller. When a user submits their credentials, the controller validates the input shape, then delegates to the auth service for the actual verification. This separation keeps the HTTP concerns away from the business logic."
        }
    ]
}
```

2. **Write the plan to a temp file and run the podcast script:**

```bash
cat > /tmp/walkthrough-plan.json << 'PLAN_EOF'
{ "title": "...", "voice": "af_heart", "speed": 1.0, "segments": [...] }
PLAN_EOF
python3 ~/.claude/skills/explainer/scripts/podcast.py /tmp/walkthrough-plan.json
```

The script saves the WAV file in the current working directory (e.g., `./feature-name-walkthrough-podcast.wav`).

You can also specify a custom output path:
```bash
python3 ~/.claude/skills/explainer/scripts/podcast.py /tmp/walkthrough-plan.json ~/Desktop/auth-walkthrough.wav
```

3. **Tell the user where the file is** and offer to play it:

```bash
# macOS
open ./feature-name-walkthrough-podcast.wav
```

## Podcast narration style

Podcast mode narration should feel like a **continuous audio tour**, not disjointed segments:

- **Start with an intro segment** — set context: what feature, why it matters, what we'll cover
- **Use transitions between segments** — "Now that we've seen how requests arrive, let's follow the data into the service layer"
- **End with a summary segment** — recap the key takeaways
- **Longer narrations than interactive mode** — aim for 3-6 sentences per segment since the user can't see the code
- **Reference code conceptually** — say "the validate function" not "line 42" or "src/auth/validate.ts"
- **Explain more context** — the user can't see the code, so describe what the code looks like: "This is a small utility function, about ten lines, that takes a token string and returns the decoded payload"

## Segment generation guidelines

- Include an **intro segment** (id: 0) and **outro segment** (last id) that don't map to code
- Each code segment's `ttsText` should be **3-6 sentences**
- Use the same voice and speed throughout for consistency
- Strip all markdown, file paths, and line numbers from `ttsText`
- `voice` and `speed` in the plan JSON override env vars / user config

## Plan JSON fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | yes | Walkthrough title (used in default output filename) |
| `segments` | yes | Array of segment objects |
| `voice` | no | TTS voice (default: user config or `af_heart`) |
| `speed` | no | TTS speed (default: user config or `1.0`) |

Each segment:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Segment number |
| `title` | yes | Segment title (shown in progress output) |
| `ttsText` | yes | The narration text — must be plain text, no markdown |
| `file` | no | Source file (not used for audio, but useful for reference) |
| `start` | no | Start line (not used for audio) |
| `end` | no | End line (not used for audio) |

See `docs/tts.md` for voice options and formatting rules.
