<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="Code Explainer icon" />
</p>

<h1 align="center">Code Explainer</h1>

<p align="center">
  <strong>Interactive code walkthroughs with editor highlighting and AI-powered voice narration.</strong>
</p>

<p align="center">
  An AI coding agent skill that scans your codebase, builds a walkthrough plan, and explains code segment-by-segment — highlighting lines in VS Code / Cursor and narrating with natural-sounding TTS.
</p>

<p align="center">
  <a href="#-features">Features</a> &bull;
  <a href="#-installation">Installation</a> &bull;
  <a href="#-usage">Usage</a> &bull;
  <a href="#-modes">Modes</a> &bull;
  <a href="#-voice-configuration">Voice Config</a>
</p>

---

## Features

- **VS Code & Cursor** — Automatically opens files, scrolls to code, and highlights line ranges with a gold background decoration
- **Local TTS** — Natural-sounding voice narration powered by Kokoro-82M (#1 ranked open-source TTS), running locally on Apple Silicon
- **Three Modes** — Autoplay (hands-free), Interactive + TTS, or Interactive (text only)
- **Adaptive Depth** — Overview, detailed, or focused explanations based on your familiarity
- **Plan-First** — Scans the codebase, presents a walkthrough plan, and lets you reorder before starting

## Requirements

- macOS (Apple Silicon recommended for GPU-accelerated TTS)
- Python 3.10+
- Node.js 18+
- VS Code or Cursor with CLI enabled (`code` or `cursor` command)

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/Royal-lobster/code-explainer.git

# 2. Symlink to Claude Code skills directory
mkdir -p ~/.claude/skills
ln -s "$(pwd)/code-explainer" ~/.claude/skills/explainer

# 3. Run setup (installs everything)
~/.claude/skills/explainer/setup.sh

# 4. Reload your editor
# Cmd+Shift+P → "Developer: Reload Window"
```

The setup script handles:
- Python venv creation with TTS engine (mlx-audio + sounddevice)
- Extension build and installation (VS Code + Cursor)
- Voice model download (~330 MB)
- Script permissions

## Usage

In Claude Code (or any compatible AI coding agent):

```
/explainer the authentication system
```

Or naturally:

```
Explain how the matching engine works
Walk me through the order flow
How does the WebSocket gateway handle events?
```

## Modes

| Mode | Description |
|------|-------------|
| **Autoplay** | Highlights move through code automatically while voice narrates in sync. Hands-free — just watch and listen. |
| **Interactive + TTS** | Step-by-step with voice. Highlights code, explains in text + voice, waits for "next". |
| **Interactive** | Step-by-step, text only. Highlights code, explains in text, waits for "next". |

### User Controls

| Command | Action |
|---------|--------|
| `next` | Move to next segment |
| `skip` | Skip current segment |
| `skip to 4` | Jump to segment 4 |
| `go deeper` | Re-explain with more detail |
| `zoom out` | Re-explain at overview level |
| `pause` | Stop autoplay |
| `mute` / `unmute` | Toggle voice narration |
| `stop` | End walkthrough |

## Voice Configuration

Code Explainer uses [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [mlx-audio](https://github.com/Blaizzy/mlx-audio) for high-quality local TTS. Falls back to macOS `say` if unavailable.

```bash
# Change voice
export TTS_VOICE=am_adam    # American male

# Change speed
export TTS_SPEED=1.2        # 20% faster
```

### Available Voices

| Voice | Description |
|-------|-------------|
| `af_heart` | American English, female (default) |
| `af_bella` | American English, female |
| `af_sarah` | American English, female |
| `am_adam` | American English, male |
| `am_michael` | American English, male |
| `bf_emma` | British English, female |
| `bm_george` | British English, male |

## How It Works

```
1. You ask to explain a feature
2. AI scans the codebase (uses a lightweight sub-agent)
3. Builds an ordered walkthrough plan
4. You approve or adjust the plan
5. For each segment:
   ├── Highlights lines in your editor (via extension)
   ├── Reads the code
   ├── Explains the segment
   ├── Narrates via TTS (if enabled)
   └── Waits for your input (or auto-advances in autoplay)
6. Summarizes key takeaways
```

## Project Structure

```
code-explainer/
├── SKILL.md                  # AI agent skill instructions
├── setup.sh                  # One-command setup script
├── scripts/
│   ├── highlight.sh          # Triggers VS Code highlighting
│   ├── speak.sh              # TTS wrapper (Kokoro + say fallback)
│   ├── present.sh            # Autoplay conductor
│   ├── tts_server.py          # TTS generation server
│   └── tts_client.py          # TTS streaming client
├── vscode-extension/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/extension.ts      # Editor extension (file watcher + decorator)
└── assets/
    └── icon.svg
```

## License

MIT
