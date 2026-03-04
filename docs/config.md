# User Config

Preferences are saved at `~/.config/code-explainer/config.json`. On first use, the file won't exist — ask the user their preferences and save them. On subsequent uses, load the saved config and **skip Step 1** (don't re-ask). The user can change settings anytime by saying "change settings", "change speed", "change voice", etc.

## Config schema

```json
{
  "depth": "overview",
  "mode": "autoplay | interactive+tts | interactive | podcast",
  "speed": 1.0,
  "voice": "af_heart",
  "model": "prince-canuma/Kokoro-82M"
}
```

## Loading config

**Before Step 1**, check if config exists:
```bash
cat ~/.config/code-explainer/config.json 2>/dev/null
```

If it exists, load the values and skip to Step 2. Tell the user: "Using your saved preferences (depth: overview, mode: autoplay, speed: 1.0x). Say 'change settings' anytime to adjust."

If it doesn't exist, proceed with Step 1 (see `docs/step1-assess.md`). After getting answers, save the config.

## Saving config

```bash
mkdir -p ~/.config/code-explainer
cat > ~/.config/code-explainer/config.json << 'EOF'
{"depth": "overview", "mode": "autoplay", "speed": 1.0, "voice": "af_heart", "model": "prince-canuma/Kokoro-82M"}
EOF
```

## Speed settings

Speed controls narration playback rate:
- `1.0` = normal speed
- `1.25` = slightly faster
- `1.5` = fast (good for familiar code)
- `2.0` = very fast (skimming)

Pass speed to TTS via the `TTS_SPEED` env var:
```bash
TTS_SPEED=1.5 ~/.claude/skills/explainer/scripts/speak.sh "text"
```

For autoplay, include speed in the presentation:
```bash
TTS_SPEED=1.5 ~/.claude/skills/explainer/scripts/present.sh /tmp/claude-presentation.txt
```
