#!/bin/bash
# Double-click to open the waypoint launcher in your browser (macOS). Keep this window open while you use the launcher;
# closing it does not stop any build.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "waypoint needs Node.js 18 or newer: https://nodejs.org (then double-click this again)"; read -r -p "Press Return to close"; exit 1; }
command -v claude >/dev/null || echo "Note: Claude Code is not installed yet (npm install -g @anthropic-ai/claude-code, then run claude once and log in)."
exec node bin/app.mjs --open
