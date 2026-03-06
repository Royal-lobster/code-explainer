#!/bin/bash
set -e

# ============================================================================
# Code Explainer — Setup Script
# ============================================================================
# Interactive code walkthrough skill with VS Code highlighting and TTS.
# Works on macOS with Apple Silicon (M1/M2/M3/M4).
#
# Usage: ./setup.sh
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
EXT_DIR="$SCRIPT_DIR/vscode-extension"
MIN_PYTHON="3.10"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

step=0
total_steps=7

header() {
    echo ""
    step=$((step + 1))
    echo -e "${BLUE}[$step/$total_steps]${NC} ${BOLD}$1${NC}"
}

ok() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
skip() { echo -e "  ${YELLOW}→${NC} $1 (skipped)"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Code Explainer — Setup                     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"

# ── Step 1: Check prerequisites ─────────────────────────────────────────────
header "Checking prerequisites"

# macOS check
if [[ "$(uname)" != "Darwin" ]]; then
    fail "This skill requires macOS (detected: $(uname))"
fi
ok "macOS detected"

# Apple Silicon check
if [[ "$(uname -m)" == "arm64" ]]; then
    ok "Apple Silicon detected"
else
    warn "Intel Mac detected — TTS will run on CPU (slower)"
fi

# Editor CLI check (VS Code or Cursor)
EDITORS=()
if command -v code &>/dev/null; then
    EDITORS+=("code")
    ok "VS Code CLI found: $(code --version | head -1)"
fi
if command -v cursor &>/dev/null; then
    EDITORS+=("cursor")
    ok "Cursor CLI found"
fi
if [[ ${#EDITORS[@]} -eq 0 ]]; then
    fail "No editor CLI found. Install VS Code ('code') or Cursor ('cursor') and enable the CLI command: Cmd+Shift+P → 'Shell Command: Install ...'"
fi

# Node.js check (for VS Code extension)
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    ok "Node.js found: $NODE_VERSION"
else
    fail "Node.js not found. Install via: brew install node"
fi

# npm check
if command -v npm &>/dev/null; then
    ok "npm found: $(npm --version)"
else
    fail "npm not found. Install via: brew install node"
fi

# Python 3.10+ check
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
        PY_VERSION=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
        PY_MAJOR=$("$candidate" -c "import sys; print(sys.version_info.major)" 2>/dev/null)
        PY_MINOR=$("$candidate" -c "import sys; print(sys.version_info.minor)" 2>/dev/null)
        if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge 10 ]]; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [[ -n "$PYTHON" ]]; then
    ok "Python $PY_VERSION found: $(which "$PYTHON")"
else
    fail "Python 3.10+ not found. Install via: brew install python@3.13"
fi

# uv check (preferred) or pip fallback
USE_UV=false
if command -v uv &>/dev/null; then
    ok "uv found (fast package manager)"
    USE_UV=true
else
    warn "uv not found — using pip (slower). Install uv for faster setup: brew install uv"
fi

# ── Step 2: Configure AI models ─────────────────────────────────────────────
header "Configure AI models"

SKILL_FILE="$SCRIPT_DIR/SKILL.md"

# Read current values from SKILL.md
CURRENT_LARGE=$(python3 -c "import re; m=re.search(r'\| \`LARGE\` \| \`([^\`]+)\`', open('$SKILL_FILE').read()); print(m.group(1) if m else 'opus')" 2>/dev/null || echo "opus")
CURRENT_MEDIUM=$(python3 -c "import re; m=re.search(r'\| \`MEDIUM\` \| \`([^\`]+)\`', open('$SKILL_FILE').read()); print(m.group(1) if m else 'sonnet')" 2>/dev/null || echo "sonnet")
CURRENT_SMALL=$(python3 -c "import re; m=re.search(r'\| \`SMALL\` \| \`([^\`]+)\`', open('$SKILL_FILE').read()); print(m.group(1) if m else 'haiku')" 2>/dev/null || echo "haiku")

echo ""
echo -e "  Default model configuration:"
echo -e "    ${BOLD}LARGE${NC}  — planner (best reasoning)    : ${BLUE}$CURRENT_LARGE${NC}"
echo -e "    ${BOLD}MEDIUM${NC} — segment agents (deep reading): ${BLUE}$CURRENT_MEDIUM${NC}"
echo -e "    ${BOLD}SMALL${NC}  — scout + overview (fast)      : ${BLUE}$CURRENT_SMALL${NC}"
echo ""
echo -e "  Use any model name your agent supports (e.g. ${BLUE}gpt-4o${NC}, ${BLUE}gemini-2.5-pro${NC})."
echo -ne "  ${BOLD}Keep these defaults?${NC} [Y/n] "
read -r KEEP_MODELS </dev/tty

if [[ "$KEEP_MODELS" =~ ^[Nn] ]]; then
    echo ""
    echo -ne "  LARGE  [$CURRENT_LARGE]: "
    read -r NEW_LARGE </dev/tty
    echo -ne "  MEDIUM [$CURRENT_MEDIUM]: "
    read -r NEW_MEDIUM </dev/tty
    echo -ne "  SMALL  [$CURRENT_SMALL]: "
    read -r NEW_SMALL </dev/tty

    # Fall back to current value if user pressed Enter
    NEW_LARGE="${NEW_LARGE:-$CURRENT_LARGE}"
    NEW_MEDIUM="${NEW_MEDIUM:-$CURRENT_MEDIUM}"
    NEW_SMALL="${NEW_SMALL:-$CURRENT_SMALL}"

    # Update SKILL.md with chosen models (sanitize input to prevent markdown corruption)
    python3 - "$SKILL_FILE" "$NEW_LARGE" "$NEW_MEDIUM" "$NEW_SMALL" << 'PYEOF'
import re, sys

def sanitize(val):
    """Strip characters that would corrupt the markdown table."""
    return val.replace('`', '').replace('|', '').replace('\n', '').strip()

path, large, medium, small = sys.argv[1], sanitize(sys.argv[2]), sanitize(sys.argv[3]), sanitize(sys.argv[4])
content = open(path).read()
content = re.sub(r'(\| `LARGE` \| )`[^`]+`', r'\1`' + large + '`', content)
content = re.sub(r'(\| `MEDIUM` \| )`[^`]+`', r'\1`' + medium + '`', content)
content = re.sub(r'(\| `SMALL` \| )`[^`]+`', r'\1`' + small + '`', content)
open(path, 'w').write(content)
PYEOF

    ok "Models saved to SKILL.md"
    echo -e "    LARGE  → ${GREEN}$NEW_LARGE${NC}"
    echo -e "    MEDIUM → ${GREEN}$NEW_MEDIUM${NC}"
    echo -e "    SMALL  → ${GREEN}$NEW_SMALL${NC}"
else
    ok "Using default models"
fi

# ── Step 3: Create Python virtual environment ───────────────────────────────
header "Setting up Python environment for TTS"

if [[ -d "$VENV_DIR" ]]; then
    ok "Virtual environment already exists at $VENV_DIR"
else
    if $USE_UV; then
        uv venv "$VENV_DIR" --python "$PYTHON" 2>&1 | tail -1
    else
        "$PYTHON" -m venv "$VENV_DIR"
    fi
    ok "Created virtual environment at $VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python3"

# ── Step 3: Install TTS dependencies ────────────────────────────────────────
header "Installing TTS dependencies (mlx-audio + sounddevice)"

echo "  This may take a few minutes on first install..."

if $USE_UV; then
    uv pip install --python "$VENV_PYTHON" pip mlx-audio sounddevice 2>&1 | grep -E "^(Installed|Already|Resolved)" | head -5
else
    "$VENV_PYTHON" -m pip install --quiet mlx-audio sounddevice 2>&1 | tail -3
fi
ok "TTS dependencies installed"

# Verify TTS can import
if "$VENV_PYTHON" -c "from mlx_audio.tts.generate import generate_audio; print('ok')" 2>/dev/null | grep -q "ok"; then
    ok "TTS engine verified"
else
    warn "TTS import failed — TTS will fall back to macOS 'say' command"
fi

# ── Step 4: Build and install VS Code extension ─────────────────────────────
header "Building and installing extension"

cd "$EXT_DIR"

# Install npm deps
npm install --silent 2>&1 | tail -1
ok "npm dependencies installed"

# Compile TypeScript
npm run compile --silent 2>&1
ok "TypeScript compiled"

# Package as VSIX
npx @vscode/vsce package --no-dependencies --allow-star-activation --allow-missing-repository 2>&1 | grep -E "^( DONE|VSIX)" | head -1
VSIX_FILE=$(ls -t "$EXT_DIR"/*.vsix 2>/dev/null | head -1)
if [[ -z "$VSIX_FILE" ]]; then
    fail "VSIX packaging failed — no .vsix file found"
fi
ok "VSIX packaged: $(basename "$VSIX_FILE")"

# Install extension in all detected editors
for EDITOR_CLI in "${EDITORS[@]}"; do
    "$EDITOR_CLI" --install-extension "$VSIX_FILE" --force 2>&1 | grep -v "^$"
    ok "Extension installed in $EDITOR_CLI"
done

cd "$SCRIPT_DIR"

# ── Step 5: Make scripts executable ─────────────────────────────────────────
header "Setting up scripts"

chmod +x "$SCRIPT_DIR/scripts/explainer.sh"
chmod +x "$SCRIPT_DIR/scripts/tts_server.py"
chmod +x "$SCRIPT_DIR/setup.sh"
ok "All scripts marked executable"

# ── Step 6: Pre-download TTS model ──────────────────────────────────────────
header "Pre-downloading TTS voice model"

echo "  Downloading model (~330 MB on first run)..."
if "$VENV_PYTHON" -c "
from mlx_audio.tts.generate import generate_audio
import tempfile, os
with tempfile.TemporaryDirectory() as d:
    generate_audio(
        text='Setup complete.',
        model='prince-canuma/Kokoro-82M',
        voice='af_heart',
        lang_code='a',
        file_prefix=os.path.join(d, 'test'),
        verbose=False,
    )
" 2>&1 | grep -v "^Fetching\|^$\|INFO\|pip\|spacy\|Collecting\|Downloading\|Installing\|Successfully\|✔" | tail -1; then
    ok "TTS model downloaded and cached"
else
    warn "Model download had issues — will retry on first use"
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   Setup complete!                            ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Skill installed at:${NC} $SCRIPT_DIR"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  1. Reload your editor: ${BLUE}Cmd+Shift+P → 'Developer: Reload Window'${NC}"

# Detect which agents are available and print relevant guidance
DETECTED_AGENTS=()

if [[ "$SCRIPT_DIR" == *"/.claude/skills/"* ]]; then
    DETECTED_AGENTS+=("Claude Code")
elif [[ -d "$HOME/.claude" ]]; then
    DETECTED_AGENTS+=("Claude Code")
fi

if [[ "$SCRIPT_DIR" == *"/.config/agents/skills/"* ]]; then
    DETECTED_AGENTS+=("Amp")
elif [[ -d "$HOME/.config/agents" ]]; then
    DETECTED_AGENTS+=("Amp")
fi

if [[ "$SCRIPT_DIR" == *"/.config/opencode/skills/"* ]]; then
    DETECTED_AGENTS+=("OpenCode")
elif [[ -d "$HOME/.config/opencode" ]]; then
    DETECTED_AGENTS+=("OpenCode")
fi

if [[ "$SCRIPT_DIR" == *"/.codex/skills/"* ]]; then
    DETECTED_AGENTS+=("Codex CLI")
elif [[ -d "$HOME/.codex" ]]; then
    DETECTED_AGENTS+=("Codex CLI")
fi

# Check if skill is already in a known skills directory
IN_SKILLS_DIR=false
if [[ "$SCRIPT_DIR" == *"/skills/explainer"* ]]; then
    IN_SKILLS_DIR=true
fi

if $IN_SKILLS_DIR; then
    echo -e "  2. Use it: ${BLUE}/explainer <feature name>${NC}"
else
    echo -e "  2. Copy the skill to your agent's skills directory:"
    echo ""
    if [[ " ${DETECTED_AGENTS[*]} " =~ " Claude Code " ]]; then
        echo -e "     ${BOLD}Claude Code:${NC}  ${BLUE}cp -r $SCRIPT_DIR ~/.claude/skills/explainer${NC}"
    fi
    if [[ " ${DETECTED_AGENTS[*]} " =~ " Amp " ]]; then
        echo -e "     ${BOLD}Amp:${NC}          ${BLUE}cp -r $SCRIPT_DIR ~/.config/agents/skills/explainer${NC}"
    fi
    if [[ " ${DETECTED_AGENTS[*]} " =~ " OpenCode " ]]; then
        echo -e "     ${BOLD}OpenCode:${NC}     ${BLUE}cp -r $SCRIPT_DIR ~/.config/opencode/skills/explainer${NC}"
    fi
    if [[ " ${DETECTED_AGENTS[*]} " =~ " Codex CLI " ]]; then
        echo -e "     ${BOLD}Codex CLI:${NC}    ${BLUE}cp -r $SCRIPT_DIR ~/.codex/skills/explainer${NC}"
    fi
    # If no agents detected, show all options
    if [[ ${#DETECTED_AGENTS[@]} -eq 0 ]]; then
        echo -e "     ${BOLD}Claude Code:${NC}  ${BLUE}cp -r $SCRIPT_DIR ~/.claude/skills/explainer${NC}"
        echo -e "     ${BOLD}Amp:${NC}          ${BLUE}cp -r $SCRIPT_DIR ~/.config/agents/skills/explainer${NC}"
        echo -e "     ${BOLD}OpenCode:${NC}     ${BLUE}cp -r $SCRIPT_DIR ~/.config/opencode/skills/explainer${NC}"
        echo -e "     ${BOLD}Codex CLI:${NC}    ${BLUE}cp -r $SCRIPT_DIR ~/.codex/skills/explainer${NC}"
    fi
    echo ""
    echo -e "     For rule-based agents (Cursor, Windsurf, Kilo, Roo, Cline),"
    echo -e "     copy ${BLUE}SKILL.md${NC} into your agent's rules directory."
    echo -e "     See the README for details."
    echo ""
    echo -e "  3. Use it: ${BLUE}/explainer <feature name>${NC}"
fi
echo ""
echo -e "  ${BOLD}Modes:${NC}"
echo -e "  • ${GREEN}Walkthrough${NC}  — highlights + voice narration play automatically"
echo -e "  • ${GREEN}Read${NC}         — text explanations in terminal"
echo -e "  • ${GREEN}Podcast${NC}      — single audio file of entire walkthrough"
echo ""
echo -e "  ${BOLD}Voice config:${NC}"
echo -e "  • Change voice: ${BLUE}export TTS_VOICE=am_adam${NC} (male)"
echo -e "  • Change speed: ${BLUE}export TTS_SPEED=1.2${NC} (faster)"
echo -e "  • Available: af_heart, af_bella, af_sarah, am_adam, am_michael, bf_emma, bm_george"
echo ""
