#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/../vscode-extension"

cd "$EXT_DIR"

echo "Building extension..."
npm run compile -- --minify

echo "Packaging extension..."
npx @vscode/vsce package --no-dependencies

VSIX=$(ls -t *.vsix | head -1)

echo "Installing $VSIX..."
code --install-extension "$VSIX" --force

echo "Done. Reload VS Code to pick up changes."
