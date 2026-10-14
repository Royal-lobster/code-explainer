# Setup (one-time)

Run the setup script — it handles everything:

```bash
~/.claude/skills/explainer/setup.sh
```

This will:
1. Check prerequisites (macOS or Linux, Python 3.10+, Node.js, VS Code or Cursor)
2. Ask your model preferences — shows the default `LARGE`/`MEDIUM`/`SMALL` models and lets you swap them for any model your agent supports (GPT-4o, Gemini, local models, etc.)
3. Create a Python venv and install the TTS engine for this machine (mlx-audio on Apple Silicon, kokoro/PyTorch elsewhere; CPU-only PyTorch on Linux without an NVIDIA GPU)
4. Build and install the `code-explainer` extension (VS Code + Cursor)
5. Pre-download the TTS voice model (~330 MB)

After setup, reload your editor: `Cmd+Shift+P` (macOS) / `Ctrl+Shift+P` (Linux) → "Developer: Reload Window".

**Requirements:** macOS or Linux (Windows via WSL), Python 3.10+ (3.10-3.12 on Intel Macs), Node.js, VS Code or Cursor with CLI enabled.
