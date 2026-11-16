#!/usr/bin/env bash
# Make a clean copy of the waypoint framework to share: the code, its tests, the dashboard and a README, without this
# repository's experiments, results, references or history. Usage: export-framework.sh <empty or new folder>
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); WP=$(cd "$HERE/../.." && pwd)
DEST=${1:?usage: export-framework.sh <new folder>}
[ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && { echo "$DEST is not empty"; exit 1; }
mkdir -p "$DEST"
git -C "$WP" archive HEAD bin lib test scripts package.json .gitignore | tar -x -C "$DEST"
rm -rf "$DEST/scripts/export"
cp "$HERE/README.md" "$DEST/README.md"
grep -qx '.waypoint/' "$DEST/.gitignore" 2>/dev/null || printf '.waypoint/\n' >> "$DEST/.gitignore"
# Nothing from the experiments may come along.
if grep -rIl -E 'experiments/|HANDOFF\.md|Gloamreach|Emberfall|E1[34][a-d]?\b' "$DEST" --exclude-dir=.git | grep -v '^$'; then
  echo "export check: the files above still mention the experiments"; exit 1; fi
(cd "$DEST" && git init -q && git add -A && git -c user.name=waypoint -c user.email=waypoint@localhost commit -qm "waypoint: an autopilot for Claude Code")
echo "exported to $DEST ($(git -C "$DEST" ls-files | wc -l | tr -d ' ') files)"
echo "to put it on GitHub: cd $DEST && gh repo create waypoint-framework --private --source . --push"
