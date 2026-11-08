#!/usr/bin/env bash
# Install aos-orch (the guard waypoint runs as its finish line) at the commit waypoint is pinned to.
# Pinned rather than `npm link`: a link follows whatever is checked out in aos-orchestrator, so a change there would silently
# move waypoint's finish line between runs and results would stop being comparable. Bump the pin deliberately, in
# package.json ("aosOrchestrator"), and re-run the experiments that depend on verify.
# Usage: scripts/install-aos-orch.sh [install dir] [bin dir]
#   default install dir: ~/.local/share/waypoint/aos-orchestrator-<short sha>; default bin dir: ~/.local/bin
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
read -r repo commit < <(node -e "const p=require('$here/package.json').aosOrchestrator; console.log(p.repo, p.commit)")
dest=${1:-$HOME/.local/share/waypoint/aos-orchestrator-${commit:0:12}}
bindir=${2:-$HOME/.local/bin}
if [ ! -d "$dest/.git" ]; then
  mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" remote add origin "$repo"
  git -C "$dest" fetch -q --depth 1 origin "$commit"
  git -C "$dest" checkout -q FETCH_HEAD
fi
have=$(git -C "$dest" rev-parse HEAD)
[ "$have" = "$commit" ] || { echo "install-aos-orch: $dest is at $have, not the pinned $commit" >&2; exit 1; }
mkdir -p "$bindir"
cat > "$bindir/aos-orch" <<EOF
#!/usr/bin/env bash
exec node "$dest/orchestrator/bin/aos-orch.mjs" "\$@"
EOF
chmod +x "$bindir/aos-orch"
echo "aos-orch ${commit:0:12} installed: $bindir/aos-orch -> $dest"
command -v bwrap >/dev/null || echo "note: bubblewrap (bwrap) is not installed; aos-orch verify fails closed without it on Linux (apt-get install bubblewrap)"
case ":$PATH:" in *":$bindir:"*) ;; *) echo "note: $bindir is not on PATH";; esac
