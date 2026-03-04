<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="Code Explainer icon" />
</p>

<h1 align="center">Code Explainer</h1>

<p align="center">
  <strong>✨ Interactive code walkthroughs with editor highlighting and AI-powered voice narration.</strong>
</p>

<p align="center">
  A Claude Code skill that scans your codebase, builds a walkthrough plan, and explains code segment-by-segment — highlighting lines in VS Code / Cursor with a dedicated sidebar panel and narrating with natural-sounding local TTS.
</p>

<p align="center">
  <a href="#-features">Features</a> &bull;
  <a href="#-requirements">Requirements</a> &bull;
  <a href="#-installation">Installation</a> &bull;
  <a href="#-usage">Usage</a> &bull;
  <a href="#-modes">Modes</a> &bull;
  <a href="#-voice-configuration">Voice Config</a> &bull;
  <a href="#-architecture">Architecture</a>
</p>

---

## 🚀 Features

- 🪟 **VS Code Sidebar** — Dedicated sidebar panel with walkthrough controls, segment navigation, and live explanation display
- 🎯 **Code Highlighting** — Automatically opens files, scrolls to code, and highlights line ranges with a gold background decoration
- 🔊 **Local TTS** — Natural-sounding voice narration powered by Kokoro-82M (#1 ranked open-source TTS), running locally on Apple Silicon via mlx-audio
- 🎬 **Three Modes** — Autoplay (hands-free), Interactive + TTS, or Interactive (text only)
- 🧠 **Adaptive Depth** — Overview, detailed, or focused explanations based on your familiarity
- 📋 **Plan-First** — Scans the codebase, presents a walkthrough plan, and lets you reorder before starting
- 💾 **Persistent Config** — Saves your preferences (depth, mode, speed, voice) to `~/.config/code-explainer/config.json`

## 📦 Requirements

- 🍎 macOS (Apple Silicon recommended for GPU-accelerated TTS)
- 🐍 Python 3.10+
- 📗 Node.js 18+
- 🖥️ VS Code or Cursor with CLI enabled (`code` or `cursor` command)

## 🔧 Installation

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
- 🐍 Python venv creation with TTS engine (mlx-audio + sounddevice)
- 🧩 VS Code extension build and installation (.vsix for VS Code + Cursor)
- 🗣️ Voice model download (~330 MB)
- 🔑 Script permissions

## 💬 Usage

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

## ⚙️ How It Works

```
1. 💬 You ask to explain a feature
2. 🔍 AI scans the codebase (dispatches a lightweight sub-agent)
3. 📋 Builds an ordered walkthrough plan with complexity tags
4. ✅ You approve or adjust the plan
5. 🔄 For each segment:
   ├── 📡 Sends the plan to the sidebar via HTTP API
   ├── 🎯 Highlights lines in your editor
   ├── 📖 Reads the code and explains the segment
   ├── 🔊 Streams TTS audio to the sidebar (if enabled)
   └── ⏸️  Waits for your input (or auto-advances in autoplay)
6. 📝 Summarizes key takeaways
```

## 🎬 Modes

| Mode | Description |
|------|-------------|
| 🎥 **Autoplay** | Highlights move through code automatically while voice narrates in sync. Hands-free — just watch and listen. |
| 🎙️ **Interactive + TTS** | Step-by-step with voice. Highlights code, explains in text + voice, waits for "next". |
| 📝 **Interactive** | Step-by-step, text only. Highlights code, explains in text, waits for "next". |

### 🪟 Sidebar Controls

The VS Code sidebar provides buttons for all walkthrough controls:

- ▶️ **Play / Pause** — Toggle autoplay
- ⏭️ **Next / Previous** — Navigate between segments
- 🔬 **Go Deeper** — Re-explain the current segment with more detail
- 🔭 **Zoom Out** — Re-explain at overview level
- ⏩ **Speed** — Adjust TTS playback speed
- 🔈 **Volume** — Adjust TTS volume
- 🗣️ **Voice** — Select TTS voice
- 🔇 **Mute / Unmute** — Toggle voice narration

### ⌨️ Text Controls

You can also type commands in the Claude Code chat:

| Command | Action |
|---------|--------|
| `next` | ⏭️ Move to next segment |
| `skip` | ⏩ Skip current segment |
| `skip to 4` | 🎯 Jump to segment 4 |
| `go deeper` | 🔬 Re-explain with more detail |
| `zoom out` | 🔭 Re-explain at overview level |
| `pause` | ⏸️ Stop autoplay |
| `mute` / `unmute` | 🔇 Toggle voice narration |
| `stop` | ⏹️ End walkthrough |

## 🗣️ Voice Configuration

Code Explainer uses [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [mlx-audio](https://github.com/Blaizzy/mlx-audio) for high-quality local TTS. Falls back to macOS `say` if unavailable.

```bash
# Change voice
export TTS_VOICE=am_adam    # American male

# Change speed
export TTS_SPEED=1.2        # 20% faster
```

### 🎤 Available Voices

| Voice | Description |
|-------|-------------|
| `af_heart` | 🇺🇸 American English, female (default) |
| `af_bella` | 🇺🇸 American English, female |
| `af_sarah` | 🇺🇸 American English, female |
| `am_adam` | 🇺🇸 American English, male |
| `am_michael` | 🇺🇸 American English, male |
| `bf_emma` | 🇬🇧 British English, female |
| `bm_george` | 🇬🇧 British English, male |

## 🏗️ Architecture

The extension runs an HTTP + WebSocket server on localhost for communication between Claude Code and the VS Code sidebar.

```
Claude Code ──HTTP──▶ Extension Server ──Events──▶ Sidebar Webview
                           │                            │
                      Highlight API              TTS Audio Stream
                           │                            │
                     VS Code Editor              Browser AudioContext
```

### 🧩 Key Components

| Component | Description |
|-----------|-------------|
| 🌐 **Extension Server** (`server.ts`) | HTTP + WebSocket server with bearer token auth. Endpoints for plan delivery, state queries, and long-polling user actions. |
| 🪟 **Sidebar** (`sidebar.ts`) | Webview panel showing the walkthrough — segment list, explanations, and playback controls. |
| 🔄 **Walkthrough** (`walkthrough.ts`) | State machine managing segment navigation and playback status. |
| 🎯 **Highlight** (`highlight.ts`) | Opens files, scrolls to ranges, and applies gold background decorations. Falls back to file-watcher mode. |
| 🔊 **TTS Bridge** (`tts-bridge.ts`) | Streams audio from the Python TTS server to the sidebar webview via WebSocket. |
| 🐍 **TTS Server** (`tts_server.py`) | Persistent Python daemon that loads Kokoro once and streams audio over a Unix socket. |
| 📡 **Helper Script** (`explainer.sh`) | CLI wrapper around the HTTP API — used by Claude to send plans and poll for user actions. |

## 📁 Project Structure

```
code-explainer/
├── 📄 SKILL.md                      # AI agent skill instructions
├── 🔧 setup.sh                      # One-command setup script
├── 📂 scripts/
│   ├── 📡 explainer.sh              # HTTP API helper for Claude
│   └── 🐍 tts_server.py             # Persistent TTS server (Kokoro-82M)
├── 📂 docs/
│   ├── 📖 setup.md                  # Setup reference
│   ├── ⚙️ config.md                 # User preferences & config schema
│   ├── 1️⃣ step1-assess.md           # Preference gathering
│   ├── 2️⃣ step2-scan.md             # Codebase scanning via sub-agent
│   ├── 3️⃣ step3-plan.md             # Walkthrough plan generation
│   ├── 5️⃣ step5-interactive.md      # Interactive mode execution
│   ├── 🎥 step5-autoplay.md         # Autoplay mode with sidebar streaming
│   └── 🗣️ tts.md                    # TTS reference (voices, speeds)
├── 📂 vscode-extension/
│   ├── 📦 package.json
│   ├── ⚙️ tsconfig.json
│   └── 📂 src/
│       ├── 🚀 extension.ts          # Main entry point
│       ├── 🌐 server.ts             # HTTP + WebSocket server
│       ├── 🪟 sidebar.ts            # Webview sidebar provider
│       ├── 🔄 walkthrough.ts        # Walkthrough state machine
│       ├── 🎯 highlight.ts          # Code highlighting
│       ├── 🔊 tts-bridge.ts         # TTS audio streaming
│       └── 📝 types.ts              # Message protocol types
└── 📂 assets/
    └── 🎨 icon.svg
```

## 📄 License

MIT
