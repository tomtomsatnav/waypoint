#!/usr/bin/env bash
# E13 on your own machine (macOS or Linux): three arms build the Emberfall MMORPG from the same brief and art for up to 52 hours.
#   autopilot: waypoint autopilot (Fable plans and reviews, cheaper models build, routed by task type), budget $60
#   single:    one Claude Code session (Sonnet) with the brief, until it stops by itself
#   loop:      Claude Code (Sonnet) told "continue" every time it stops
# All three share your Claude plan and pause for its usage limits, resuming after the reset.
#
#   ./run-e13.sh start    set up (first time) and start, or carry on after a reboot; safe to run again
#   ./run-e13.sh status   is it running, time left (no per-arm quality, the review is blind)
#   ./run-e13.sh stop     stop everything (start carries on later)
#   ./run-e13.sh serve    boot the three finished games blind on ports 3101-3103 (done automatically at the end)
#   ./run-e13.sh reveal   which port was which (only after your blind feedback)
set -u
HERE=$(cd "$(dirname "$0")" && pwd); WP=$(cd "$HERE/../.." && pwd)
WORK=${E13_WORK:-$HOME/emberfall-e13}; HOURS=${E13_HOURS:-52}; BUDGET=${E13_BUDGET:-60}
export WAYPOINT_SETTING_SOURCES=project,local   # keep your own Claude Code settings, hooks and CLAUDE.md out of all three arms
export NODE_PATH="$WORK/tools/node_modules"      # so every arm can require('playwright') to test in a real browser
say() { echo "[e13 $(date -u +%H:%M)] $*" >> "$WORK/supervise.log"; }
alive() { pgrep -f "$1" >/dev/null 2>&1; }

setup() {
  mkdir -p "$WORK"
  command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || { echo "Node 18+ is needed (brew install node)"; exit 1; }
  command -v claude >/dev/null || { echo "Claude Code is needed (npm install -g @anthropic-ai/claude-code, then run claude once to log in)"; exit 1; }
  command -v git >/dev/null || { echo "git is needed (xcode-select --install)"; exit 1; }
  claude -p "Reply with the single word ok." --model haiku --max-budget-usd 0.02 --strict-mcp-config --tools "" >/dev/null 2>&1 \
    || { echo "claude -p failed: run claude once and log in with your plan, then try again"; exit 1; }
  if [ ! -d "$WORK/tools/node_modules/playwright" ]; then
    echo "installing Playwright and Chromium into $WORK/tools (once)"
    mkdir -p "$WORK/tools" && (cd "$WORK/tools" && npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1 >/dev/null && npx playwright install chromium) || { echo "Playwright install failed"; exit 1; }
  fi
  for a in autopilot single loop; do
    [ -d "$WORK/$a/.git" ] && continue
    mkdir -p "$WORK/$a" && cp -R "$HERE/seed/." "$WORK/$a/"
    (cd "$WORK/$a" && git init -q && git add -A && GIT_AUTHOR_DATE=2026-11-08T17:00:00Z GIT_COMMITTER_DATE=2026-11-08T17:00:00Z \
      git -c user.name=e13 -c user.email=e13@localhost commit -qm "Brief, UI references and concept art")
    git -C "$WORK/$a" config user.name "e13-$a"; git -C "$WORK/$a" config user.email "e13@localhost"
  done
  [ -f "$WORK/deadline" ] || node -e "console.log(new Date(Date.now() + $HOURS * 3600000).toISOString())" > "$WORK/deadline"
}

ended() { # 0 if the arm has finished for good
  case $1 in
    autopilot) node -e "const s=require('$WORK/autopilot/.git/autopilot/state.json'); process.exit(s.finished ? 0 : 1)" 2>/dev/null ;;
    *) node -e "const s=require('$WORK/$1.baseline.json'); process.exit(['stopped by itself','budget','deadline'].includes(s.end) ? 0 : 1)" 2>/dev/null ;;
  esac
}

launch() { # start any arm that is not running and not finished
  local refs; refs=$(cd "$WORK/autopilot" && ls references/*.png references/art/*.jpg | paste -sd, -)
  if ! ended autopilot && ! alive "waypoint.mjs autopilot (start|resume)"; then
    if [ -f "$WORK/autopilot/.git/autopilot/state.json" ]; then sub=(resume); else sub=(start --brief-file BRIEF.md --references "$refs" --budget-usd "$BUDGET" --hours "$HOURS"); fi
    (cd "$WORK/autopilot" && nohup node "$WP/bin/waypoint.mjs" autopilot "${sub[@]}" --yes >> "$WORK/autopilot.out" 2>> "$WORK/autopilot.err" < /dev/null &)
    say "launched autopilot (${sub[0]})"
  fi
  for a in single loop; do
    if ! ended $a && ! alive "baseline.mjs $WORK/$a "; then
      (nohup node "$HERE/baseline.mjs" "$WORK/$a" $a sonnet "$BUDGET" "$(cat "$WORK/deadline")" >> "$WORK/$a.out" 2>&1 < /dev/null &)
      say "launched $a"
    fi
  done
}

supervise() { # every 5 minutes: relaunch anything that died; at the end, stop the rest and serve the games blind
  while :; do
    now=$(date +%s); dl=$(node -e "console.log(Math.floor(Date.parse('$(cat "$WORK/deadline")')/1000))")
    if [ "$now" -ge "$dl" ] || { ended autopilot && ended single && ended loop; }; then
      say "finished ($( [ "$now" -ge "$dl" ] && echo deadline || echo 'all three ended')); stopping and serving blind"
      stop_arms; "$HERE/blind-serve.sh" start "$WORK" >> "$WORK/supervise.log" 2>&1
      command -v osascript >/dev/null && osascript -e 'display notification "The three games are on ports 3101, 3102 and 3103" with title "Emberfall E13 finished"'
      touch "$WORK/FINISHED"; return
    fi
    launch; sleep "${E13_TICK:-300}"
  done
}

stop_arms() { # the arms, then only the claude sessions working inside $WORK (never your other Claude sessions)
  pkill -f "waypoint.mjs autopilot (start|resume)"; pkill -f "e13/baseline.mjs"; sleep 2
  for pid in $(pgrep -f "claude -p" 2>/dev/null); do
    cwd=$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p'); [ -n "$cwd" ] || cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    case "$cwd" in "$WORK"/*) kill "$pid" 2>/dev/null;; esac
  done; true; }

case "${1:-start}" in
  start)
    setup
    if alive "run-e13.sh _supervise"; then echo "already running; ./run-e13.sh status"; exit 0; fi
    # caffeinate keeps a Mac awake while this runs (plugged in; with the lid closed only in clamshell mode with a display)
    if command -v caffeinate >/dev/null; then nohup caffeinate -ims "$HERE/run-e13.sh" _supervise >> "$WORK/supervise.log" 2>&1 < /dev/null &
    else nohup "$HERE/run-e13.sh" _supervise >> "$WORK/supervise.log" 2>&1 < /dev/null & fi
    sleep 5; echo "started. deadline $(cat "$WORK/deadline"); work in $WORK; log $WORK/supervise.log"; "$HERE/run-e13.sh" status ;;
  _supervise) supervise ;;
  status)
    echo "deadline: $(cat "$WORK/deadline" 2>/dev/null)   now: $(date -u +%FT%TZ)"
    [ -f "$WORK/FINISHED" ] && echo "FINISHED: games on http://localhost:3101 3102 3103"
    alive "run-e13.sh _supervise" && echo "supervisor: running" || echo "supervisor: not running (./run-e13.sh start)"
    for a in autopilot single loop; do ended $a && s=ended || { [ $a = autopilot ] && p="waypoint.mjs autopilot" || p="baseline.mjs $WORK/$a "; alive "$p" && s=running || s=down; }; echo "arm $a: $s"; done
    tail -n 3 "$WORK/supervise.log" 2>/dev/null ;;
  stop) pkill -f "run-e13.sh _supervise"; stop_arms; echo stopped ;;
  serve) "$HERE/blind-serve.sh" start "$WORK" ;;
  reveal) "$HERE/blind-serve.sh" reveal "$WORK" ;;
  *) sed -n 2,13p "$HERE/run-e13.sh" ;;
esac
