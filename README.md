<p align="center">
  <img src="vscode-extension/media/icon.png" width="120" height="120" alt="Code Explainer icon" />
</p>

<h1 align="center">Code Explainer</h1>

<p align="center">
  <strong>✨ Interactive code walkthroughs with editor highlighting and AI-powered voice narration.</strong>
</p>

<p align="center">
  A coding agent skill that scans your codebase, builds a walkthrough plan, and explains code segment-by-segment — highlighting lines in VS Code / Cursor with a dedicated sidebar panel and narrating with natural-sounding local TTS. Works with Claude Code, Codex, OpenCode, Kilo Code, Amp, and more.
</p>

---

## 🚀 Features

- 🪟 **VS Code Sidebar** — Dedicated sidebar panel with walkthrough controls, segment navigation, and live explanation display
- 🎯 **Code Highlighting** — Automatically opens files, scrolls to code, and highlights line ranges with a gold background decoration
- 🔊 **Local TTS** — Natural-sounding voice narration powered by Kokoro-82M (#1 ranked open-source TTS), running locally on Apple Silicon via mlx-audio
- 🎬 **Three Modes** — Walkthrough (hands-free with TTS), Read (text in terminal), or Podcast (single audio file)
- 🧠 **Adaptive Depth** — Overview, detailed, or focused explanations based on your familiarity
- 📋 **Plan-First** — Scans the codebase, presents a walkthrough plan, and lets you reorder before starting

## 📦 Requirements

- 🍎 macOS (Apple Silicon recommended for GPU-accelerated TTS)
- 🐍 Python 3.10+
- 📗 Node.js 18+
- 🖥️ VS Code or Cursor with CLI enabled (`code` or `cursor` command)

## 🔧 Installation

Just tell your coding agent:

```
Install the code explainer skill from https://github.com/Royal-lobster/code-explainer
```

Your agent will clone the repo into the skills directory, run `setup.sh`, and ask you to reload your editor — all while keeping you in the loop at each step.

<details>
<summary>📋 Manual installation</summary>

### Skill-native agents

These agents support the `skills/<name>/SKILL.md` format natively. Clone directly into the skills directory:

| Agent | Install commands |
|-------|-----------------|
| **Claude Code** | `git clone https://github.com/Royal-lobster/code-explainer.git ~/.claude/skills/explainer` |
| **Amp** | `git clone https://github.com/Royal-lobster/code-explainer.git ~/.config/agents/skills/explainer` |
| **OpenCode** | `git clone https://github.com/Royal-lobster/code-explainer.git ~/.config/opencode/skills/explainer` |
| **Codex CLI** | `git clone https://github.com/Royal-lobster/code-explainer.git ~/.codex/skills/explainer` |

Then run setup:

```bash
<SKILLS_DIR>/explainer/setup.sh
# Reload your editor: Cmd+Shift+P → "Developer: Reload Window"
```

### Rule-based agents

These agents use their own rules/instructions format. Clone to any location, run setup, then point your agent's rules at the `SKILL.md`:

```bash
# 1. Clone to a shared location
git clone https://github.com/Royal-lobster/code-explainer.git ~/code-explainer

# 2. Run setup
~/code-explainer/setup.sh

# 3. Reload your editor: Cmd+Shift+P → "Developer: Reload Window"
```

Then add a rule or instruction pointing to the skill:

| Agent | How to add |
|-------|------------|
| **Cursor** | Add a `.cursor/rules/explainer.mdc` file in your project that includes the contents of `SKILL.md` |
| **Windsurf** | Append the contents of `SKILL.md` to `~/.codeium/windsurf/memories/global_rules.md` |
| **Kilo Code** | Copy `SKILL.md` to `~/.kilocode/rules/explainer.md` |
| **Roo Code** | Copy `SKILL.md` to `~/.roo/rules/explainer.md` |
| **Cline** | Copy `SKILL.md` to your `.clinerules/explainer.md` directory |

> **Note:** The `SKILL.md` references relative paths (e.g., `docs/assess.md`), so the full repo must exist at the cloned location. For rule-based agents, ensure paths in the copied rules resolve correctly or use absolute paths.

### What setup.sh does

- 🐍 Python venv creation with TTS engine (mlx-audio + sounddevice)
- 🧩 VS Code extension build and installation (.vsix for VS Code + Cursor)
- 🗣️ Voice model download (~330 MB)
- 🔑 Script permissions

</details>

## 💬 Usage

In your coding agent:

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
   └── ⏸️  Waits for your input (or auto-advances in walkthrough mode)
6. 📝 Summarizes key takeaways
```

## 🎬 Modes

| Mode | Description |
|------|-------------|
| 🎥 **Walkthrough** | Highlights move through code automatically while voice narrates in sync. Hands-free — just watch and listen. |
| 📝 **Read** | Text explanations in terminal. Highlights code, explains in text, waits for "next". No sidebar or TTS required. |
| 🎙️ **Podcast** | Generates a single audio file of the entire walkthrough. Listen anywhere. |

### 🪟 Sidebar Controls

The VS Code sidebar provides buttons for all walkthrough controls:

- ▶️ **Play / Pause** — Toggle walkthrough playback
- ⏭️ **Next / Previous** — Navigate between segments
- ⏩ **Speed** — Adjust TTS playback speed
- 🔈 **Volume** — Adjust TTS volume
- 🗣️ **Voice** — Select TTS voice
- 🔇 **Mute / Unmute** — Toggle voice narration

### ⌨️ Text Controls

You can also type commands in your agent's chat:

| Command | Action |
|---------|--------|
| `next` | ⏭️ Move to next segment |
| `skip` | ⏩ Skip current segment |
| `skip to 4` | 🎯 Jump to segment 4 |
| `pause` | ⏸️ Pause walkthrough |
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

The extension runs an HTTP + WebSocket server on localhost for communication between your coding agent and the VS Code sidebar.

```
Coding Agent ──HTTP──▶ Extension Server ──Events──▶ Sidebar Webview
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
| 📡 **Helper Script** (`explainer.sh`) | CLI wrapper around the HTTP API — used by the coding agent to send plans and poll for user actions. |

## 📁 Project Structure

```
code-explainer/
├── 📄 SKILL.md                      # AI agent skill instructions
├── 🔧 setup.sh                      # One-command setup script
├── 📂 scripts/
│   ├── 📡 explainer.sh              # HTTP API helper for the coding agent
│   └── 🐍 tts_server.py             # Persistent TTS server (Kokoro-82M)
├── 📂 docs/
│   ├── 📖 setup.md                  # Setup reference
│   ├── 🎯 assess.md                 # Preference gathering
│   ├── 🔍 scan.md                   # Codebase scanning via sub-agent
│   ├── 📋 plan.md                   # Walkthrough plan generation
│   ├── 🎥 walkthrough.md             # Walkthrough mode with sidebar + TTS
│   ├── 📝 read.md                    # Read mode (text in terminal)
│   ├── 🎙️ podcast.md                # Podcast mode (single audio file)
│   └── 🗣️ tts.md                    # TTS reference (voices, speeds)
└── 📂 vscode-extension/
    ├── 📦 package.json
    ├── ⚙️ tsconfig.json
    ├── 📂 src/
    │   ├── 🚀 extension.ts          # Main entry point
    │   ├── 🌐 server.ts             # HTTP + WebSocket server
    │   ├── 🪟 sidebar.ts            # Webview sidebar provider
    │   ├── 🔄 walkthrough.ts        # Walkthrough state machine
    │   ├── 🎯 highlight.ts          # Code highlighting
    │   ├── 🔊 tts-bridge.ts         # TTS audio streaming
    │   └── 📝 types.ts              # Message protocol types
    └── 📂 media/
        └── 🎨 icon.svg
```

## 📄 License

MIT
