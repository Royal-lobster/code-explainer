# Uninstalling Code Explainer

This guide walks you through completely removing Code Explainer from your system. Each step includes a verification check so you can confirm the removal was successful.

---

## Step 1: Stop Running Processes

Kill the TTS server if it's running.

```bash
# Stop TTS server
python3 ~/.claude/skills/explainer/scripts/tts_server.py --stop 2>/dev/null || true
```

**Verify:**

```bash
# Should print "No TTS process found"
if pgrep -f tts_server.py > /dev/null; then
    echo "WARNING: TTS server still running"
else
    echo "No TTS process found"
fi
```

---

## Step 2: Uninstall the VS Code / Cursor Extension

```bash
# VS Code
code --uninstall-extension srujangurram.code-explainer 2>/dev/null && echo "Removed from VS Code" || echo "Not installed in VS Code"

# Cursor
cursor --uninstall-extension srujangurram.code-explainer 2>/dev/null && echo "Removed from Cursor" || echo "Not installed in Cursor"
```

**Verify:**

```bash
# Should NOT list code-explainer
code --list-extensions 2>/dev/null | grep -i code-explainer || echo "VS Code: clean"
cursor --list-extensions 2>/dev/null | grep -i code-explainer || echo "Cursor: clean"
```

After uninstalling, reload your editor: **Cmd/Ctrl+Shift+P** → **Developer: Reload Window**

---

## Step 3: Remove the Skill Directory

This removes the skill files, Python virtual environment, and TTS model cache.

```bash
rm -rf ~/.claude/skills/explainer
```

**Verify:**

```bash
[ -d ~/.claude/skills/explainer ] && echo "WARNING: directory still exists" || echo "Skill directory removed"
```

---

## Step 4: Clean Up Runtime Files

Remove temporary files created during use.

```bash
rm -f ~/.claude-explainer-port
rm -f ~/.claude-explainer-token
rm -rf ~/.code-explainer
```

**Verify:**

```bash
for f in ~/.claude-explainer-port ~/.claude-explainer-token ~/.code-explainer; do
    [ -e "$f" ] && echo "WARNING: $f still exists" || echo "$f removed"
done
```

---

## All-in-One Script

To remove everything in one go, run this from your terminal:

```bash
#!/bin/bash
set -e

echo "Uninstalling Code Explainer..."

# 1. Stop TTS server
python3 ~/.claude/skills/explainer/scripts/tts_server.py --stop 2>/dev/null || true
echo "  Stopped TTS server"

# 2. Uninstall extension
code --uninstall-extension srujangurram.code-explainer 2>/dev/null && echo "  Removed VS Code extension" || true
cursor --uninstall-extension srujangurram.code-explainer 2>/dev/null && echo "  Removed Cursor extension" || true

# 3. Remove skill directory
rm -rf ~/.claude/skills/explainer
echo "  Removed skill directory"

# 4. Clean up runtime files
rm -f ~/.claude-explainer-port ~/.claude-explainer-token
rm -rf ~/.code-explainer
echo "  Cleaned up runtime files"

echo ""
echo "Done. Reload your editor: Cmd/Ctrl+Shift+P → 'Developer: Reload Window'"
```

---

## What Gets Removed

| Component | Location | Size |
|-----------|----------|------|
| Skill files + venv + TTS model | `~/.claude/skills/explainer/` | ~500 MB |
| VS Code extension | Editor extensions directory | ~1 MB |
| Port/token files | `~/.claude-explainer-port`, `~/.claude-explainer-token` | <1 KB |
| TTS runtime files | `~/.code-explainer/run/` | <1 KB |
