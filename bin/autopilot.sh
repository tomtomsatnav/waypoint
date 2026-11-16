#!/usr/bin/env bash
# Run the waypoint autopilot on a project until it is done, and keep it running: it relaunches the autopilot if it stops
# (a crash, a reboot followed by `start` again), pauses for plan usage and carries on, pushes to the project's `origin`
# remote every few minutes, and keeps a Mac awake while it runs. Works on a new project (a brief and an empty repo) or on
# one already under way (the planner surveys what is there and continues).
#
# In the project's folder (a git repository):
#   autopilot.sh start --brief-file BRIEF.md [--references a.png,b.jpg] [--budget-usd 60] [--hours 72] [--weekly 0.95]
#   autopilot.sh start --brief "what the project should become"
#   autopilot.sh start                     carry on a run that exists (after a stop or a reboot)
#   autopilot.sh status                    running or not, where it is
#   autopilot.sh log                       follow the autopilot's log
#   autopilot.sh note "btw ..." [--urgent] tell it something while it runs (no text: list notes and replies)
#   autopilot.sh discord <webhook url> | test | off
#   autopilot.sh dashboard [--lan]         the dashboard for this project (prints its private link)
#   autopilot.sh stop
# Set WAYPOINT_PROJECT to use another folder than the current one.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); WP=$(cd "$HERE/.." && pwd)
PROJ=$(cd "${WAYPOINT_PROJECT:-$PWD}" && pwd)
AP="$PROJ/.git/autopilot"
TOOLS="${WAYPOINT_TOOLS:-$HOME/.waypoint/tools}"
export NODE_PATH="$TOOLS/node_modules${NODE_PATH:+:$NODE_PATH}"   # so the tester and the builders can require('playwright')
SUP="autopilot.sh _supervise $PROJ\$"
say() { mkdir -p "$AP"; echo "[supervise $(date -u +%H:%M)] $*" >> "$AP/supervise.log"; }
cwd_of() { local c; c=$(lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p'); [ -n "$c" ] || c=$(readlink "/proc/$1/cwd" 2>/dev/null); echo "$c"; }
ap_pids() { for pid in $(pgrep -f "waypoint.mjs autopilot (start|resume)" 2>/dev/null); do [ "$(cwd_of "$pid")" = "$PROJ" ] && echo "$pid"; done; }
running() { [ -n "$(ap_pids)" ]; }
ended() { node -e "const s=require('$AP/state.json'); process.exit(s.finished && !['plan-failed','review-failed'].includes(s.finished) ? 0 : 1)" 2>/dev/null; }

check() {
  git -C "$PROJ" rev-parse --git-dir >/dev/null 2>&1 || { echo "$PROJ is not a git repository (git init, then commit what is there)"; exit 1; }
  git -C "$PROJ" rev-parse HEAD >/dev/null 2>&1 || { echo "the repository has no commits yet: commit the brief (and anything else) first"; exit 1; }
  command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || { echo "Node 18 or newer is needed"; exit 1; }
  command -v claude >/dev/null || { echo "Claude Code is needed (npm install -g @anthropic-ai/claude-code, then run claude once and log in)"; exit 1; }
  if [ ! -d "$TOOLS/node_modules/playwright" ]; then
    echo "installing Playwright and Chromium into $TOOLS (once; the tester plays the project in a real browser)"
    mkdir -p "$TOOLS" && (cd "$TOOLS" && npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1 >/dev/null && npx playwright install chromium) || { echo "Playwright install failed"; exit 1; }
  fi
}

launch() { # start or resume the autopilot in the background, once
  running && return 0
  local args=("$@")
  if [ -f "$AP/state.json" ]; then sub=(resume "${args[@]}"); else sub=(start "${args[@]}"); fi
  (cd "$PROJ" && nohup node "$WP/bin/waypoint.mjs" autopilot "${sub[@]}" --yes >> "$AP/autopilot.out" 2>> "$AP/autopilot.err" < /dev/null &)
  say "launched autopilot (${sub[0]})"
}

push() { git -C "$PROJ" remote get-url origin >/dev/null 2>&1 || return 0
  git -C "$PROJ" push -q origin "HEAD:$(git -C "$PROJ" symbolic-ref --short HEAD 2>/dev/null || echo main)" >> "$AP/push.log" 2>&1 && echo "$(date -u +%FT%TZ) pushed $(git -C "$PROJ" rev-parse --short HEAD)" >> "$AP/push.log"; true; }

supervise() {
  while :; do
    if ended; then say "finished ($(node -e "console.log(require('$AP/state.json').finished)"))"; push
      command -v osascript >/dev/null && osascript -e "display notification \"$(basename "$PROJ") is finished\" with title \"waypoint autopilot\""
      return; fi
    launch; push; sleep "${WAYPOINT_TICK:-300}"
  done
}

cmd=${1:-status}; [ $# -gt 0 ] && shift
case "$cmd" in
  start)
    check; mkdir -p "$AP"
    args=(); weekly=""
    while [ $# -gt 0 ]; do case "$1" in
      --weekly) weekly="$2"; shift 2 ;;
      *) args+=("$1"); shift ;;
    esac; done
    if [ ! -f "$AP/state.json" ]; then
      printf '%s\n' "${args[@]:-}" | grep -qE '^--brief(-file)?$' || { echo 'a new run needs --brief-file <file> or --brief "<text>" (what the project should become)'; exit 1; }
      printf '%s\n' "${args[@]:-}" | grep -q '^--hours$' || args+=(--hours 87600)   # no deadline unless asked: done is done
    fi
    [ -n "$weekly" ] && args+=(--weekly-ceiling "$weekly")
    if alive_sup=$(pgrep -f "$SUP" 2>/dev/null) && [ -n "$alive_sup" ]; then echo "already running here; autopilot.sh status"; exit 0; fi
    launch "${args[@]+"${args[@]}"}"
    if command -v caffeinate >/dev/null; then WAYPOINT_PROJECT="$PROJ" nohup caffeinate -ims "$HERE/autopilot.sh" _supervise "$PROJ" >> "$AP/supervise.log" 2>&1 < /dev/null &
    else WAYPOINT_PROJECT="$PROJ" nohup "$HERE/autopilot.sh" _supervise "$PROJ" >> "$AP/supervise.log" 2>&1 < /dev/null & fi
    sleep 3; "$HERE/autopilot.sh" status ;;
  _supervise) supervise ;;
  status)
    [ -f "$AP/state.json" ] || { echo "no autopilot run in $PROJ (autopilot.sh start --brief-file BRIEF.md)"; exit 0; }
    pgrep -f "$SUP" >/dev/null && echo "supervisor: running" || echo "supervisor: not running (autopilot.sh start carries on)"
    running && echo "autopilot: running" || { ended && echo "autopilot: finished" || echo "autopilot: not running"; }
    (cd "$PROJ" && node "$WP/bin/waypoint.mjs" autopilot status | head -4)
    tail -n 3 "$AP/autopilot.log" 2>/dev/null ;;
  log) tail -n 40 -f "$AP/autopilot.log" ;;
  note|discord) (cd "$PROJ" && node "$WP/bin/waypoint.mjs" autopilot "$cmd" "$@") ;;
  dashboard) pkill -f "dashboard.mjs $PROJ" 2>/dev/null; nohup node "$WP/bin/dashboard.mjs" "$PROJ" "$@" > "$AP/dashboard.log" 2>&1 < /dev/null & sleep 2; cat "$AP/dashboard.log" ;;
  stop) pkill -f "$SUP"; for pid in $(ap_pids); do kill "$pid" 2>/dev/null; done; sleep 2
    for pid in $(pgrep -f "claude -p" 2>/dev/null); do case "$(cwd_of "$pid")" in "$PROJ"|"$PROJ"/*) kill "$pid" 2>/dev/null;; esac; done; echo stopped ;;
  *) sed -n 2,20p "$HERE/autopilot.sh" ;;
esac
