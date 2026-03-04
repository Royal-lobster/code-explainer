# Setup (one-time)

Run the setup script — it handles everything:

```bash
~/.claude/skills/explainer/setup.sh
```

This will:
1. Check prerequisites (macOS, Python 3.10+, Node.js, VS Code or Cursor)
2. Create a Python venv and install TTS engine (mlx-audio + sounddevice)
3. Build and install the `code-explainer` extension (VS Code + Cursor)
4. Pre-download the TTS voice model (~330 MB)

After setup, reload your editor: `Cmd+Shift+P` → "Developer: Reload Window".

**Requirements:** macOS (Apple Silicon recommended), Python 3.10+, Node.js, VS Code or Cursor with CLI enabled.
