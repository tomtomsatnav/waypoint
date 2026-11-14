#!/usr/bin/env bash
# E13 on your own machine (macOS or Linux): arms build the Emberfall MMORPG from the same brief and art for up to 52 hours.
#   autopilot: waypoint autopilot (research, Fable plans, cheaper models build, Sonnet reviews), budget $60
#   single:    one Claude Code session (Sonnet) with the brief, until it stops by itself
#   loop:      Claude Code (Sonnet) told "continue" every time it stops
#   researched: the autopilot's research step (EXPECTATIONS.md), then exactly the single arm told to read it
# All arms share your Claude plan and pause for its usage limits, resuming after the reset.
#
#   ./run-e13.sh start    set up (first time) and start, or carry on after a reboot; safe to run again
#   ./run-e13.sh status   is it running, time left (no per-arm quality, the review is blind)
#   ./run-e13.sh stop     stop everything (start carries on later)
#   ./run-e13.sh serve    boot the finished games blind on ports 3101 upwards (done automatically at the end)
#   ./run-e13.sh reveal   which port was which (only after your blind feedback)
#
# Settings (environment): E13_WORK (default ~/emberfall-e13), E13_ARMS (default "autopilot single loop"), E13_HOURS (52, or none: run until it ships),
# E13_SEED (the starting repo; default ./seed), E13_BUDGET (60, or none for no spending caps), E13_COMPARE (finished arms' repos, space-separated, to include unchanged in the blind review).
set -u
HERE=$(cd "$(dirname "$0")" && pwd); WP=$(cd "$HERE/../.." && pwd)
WORK=${E13_WORK:-$HOME/emberfall-e13}; HOURS=${E13_HOURS:-52}; BUDGET=${E13_BUDGET:-60}
[ "$HOURS" = none ] && HOURS=87600   # no deadline: runs until it ships (ten years, in practice never)
SEED=${E13_SEED:-$HERE/seed}   # the starting repo: brief and references (E14 uses ../e14/seed)
ARMS=${E13_ARMS:-autopilot single loop}; COMPARE=${E13_COMPARE:-}
export WAYPOINT_SETTING_SOURCES=project,local   # keep your own Claude Code settings, hooks and CLAUDE.md out of every arm
export NODE_PATH="$WORK/tools/node_modules"      # so every arm can require('playwright') to test in a real browser
say() { echo "[e13 $(date -u +%H:%M)] $*" >> "$WORK/supervise.log"; }
alive() { pgrep -f "$1" >/dev/null 2>&1; }
# Everything below is scoped to this run's folder, so two runs on one machine never touch each other's processes.
cwd_of() { local c; c=$(lsof -a -d cwd -p "$1" -Fn 2>/dev/null | sed -n 's/^n//p'); [ -n "$c" ] || c=$(readlink "/proc/$1/cwd" 2>/dev/null); echo "$c"; }
ap_pids() { for pid in $(pgrep -f "waypoint.mjs autopilot (start|resume)" 2>/dev/null); do [ "$(cwd_of "$pid")" = "$WORK/autopilot" ] && echo "$pid"; done; }
ap_alive() { [ -n "$(ap_pids)" ]; }
SUP="run-e13.sh _supervise $WORK\$"      # the supervisor carries its run folder in its command line
has() { case " $ARMS " in *" $1 "*) return 0;; esac; return 1; }
[ -f "$WORK/.arms-run" ] && ARMS=$(cat "$WORK/.arms-run")   # a started run keeps its arms

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
  for a in $ARMS; do
    [ -d "$WORK/$a/.git" ] && continue
    mkdir -p "$WORK/$a" && cp -R "$SEED/." "$WORK/$a/"
    (cd "$WORK/$a" && git init -q && git add -A && GIT_AUTHOR_DATE=2026-11-08T17:00:00Z GIT_COMMITTER_DATE=2026-11-08T17:00:00Z \
      git -c user.name=e13 -c user.email=e13@localhost commit -qm "Brief, UI references and concept art")
    git -C "$WORK/$a" config user.name "e13-$a"; git -C "$WORK/$a" config user.email "e13@localhost"
  done
  local extra=""
  if [ -n "$COMPARE" ] && [ ! -f "$WORK/compared.from" ]; then
    local i=0
    for c in $COMPARE; do
      i=$((i+1)); git clone -q "$c" "$WORK/compared$i" || { echo "could not copy $c"; exit 1; }
      echo "compared$i $c" >> "$WORK/compared.from"
    done
  fi
  [ -f "$WORK/compared.from" ] && extra=$(awk '{print $1}' "$WORK/compared.from" | grep -v '^/' | paste -sd' ' -)
  [ -f "$WORK/.arms-run" ] || echo "$ARMS" > "$WORK/.arms-run"
  [ -f "$WORK/.arms" ] || echo "$ARMS $extra" > "$WORK/.arms"
  [ -f "$WORK/deadline" ] || node -e "console.log(new Date(Date.now() + $HOURS * 3600000).toISOString())" > "$WORK/deadline"
}

ended() { # 0 if the arm has finished for good
  case $1 in
    # a failed plan or review is not the end: resume tries again
    autopilot) node -e "const s=require('$WORK/autopilot/.git/autopilot/state.json'); process.exit(s.finished && !['plan-failed','review-failed'].includes(s.finished) ? 0 : 1)" 2>/dev/null ;;
    *) node -e "const s=require('$WORK/$1.baseline.json'); process.exit(['stopped by itself','budget','deadline'].includes(s.end) ? 0 : 1)" 2>/dev/null ;;
  esac
}
all_ended() { for a in $ARMS; do ended "$a" || return 1; done; return 0; }

launch() { # start any arm that is not running and not finished
  if has autopilot && ! ended autopilot && ! ap_alive; then
    local refs; refs=$(cd "$WORK/autopilot" && ls references/*.png references/*.jpg references/art/*.jpg 2>/dev/null | paste -sd, -)
    if [ -f "$WORK/autopilot/.git/autopilot/state.json" ]; then sub=(resume); else sub=(start --brief-file BRIEF.md --references "$refs" --hours "$HOURS"); [ "$BUDGET" = none ] || sub+=(--budget-usd "$BUDGET"); fi
    (cd "$WORK/autopilot" && nohup node "$WP/bin/waypoint.mjs" autopilot "${sub[@]}" --yes >> "$WORK/autopilot.out" 2>> "$WORK/autopilot.err" < /dev/null &)
    say "launched autopilot (${sub[0]})"
  fi
  for a in single loop researched; do
    has $a || continue
    if ! ended $a && ! alive "baseline.mjs $WORK/$a "; then
      (nohup node "$HERE/baseline.mjs" "$WORK/$a" $a sonnet "$([ "$BUDGET" = none ] && echo 100000 || echo "$BUDGET")" "$(cat "$WORK/deadline")" >> "$WORK/$a.out" 2>&1 < /dev/null &)
      say "launched $a"
    fi
  done
}

push_arms() { # any arm whose repo has a remote "origin" is pushed to it (main), so the work is kept off this machine too
  for a in $ARMS; do
    git -C "$WORK/$a" remote get-url origin >/dev/null 2>&1 || continue
    git -C "$WORK/$a" push -q origin HEAD:main >> "$WORK/push.log" 2>&1 && echo "$(date -u +%FT%TZ) $a pushed $(git -C "$WORK/$a" rev-parse --short HEAD)" >> "$WORK/push.log"
  done; true; }

supervise() { # every 5 minutes: relaunch anything that died; at the end, stop the rest and serve the games blind
  while :; do
    now=$(date +%s); dl=$(node -e "console.log(Math.floor(Date.parse('$(cat "$WORK/deadline")')/1000))")
    if [ "$now" -ge "$dl" ] || all_ended; then
      say "finished ($( [ "$now" -ge "$dl" ] && echo deadline || echo 'all arms ended')); stopping and serving blind"
      stop_arms; push_arms; "$HERE/blind-serve.sh" start "$WORK" >> "$WORK/supervise.log" 2>&1
      command -v osascript >/dev/null && osascript -e 'display notification "The games are ready to play blind from port 3101" with title "Emberfall E13 finished"'
      touch "$WORK/FINISHED"; return
    fi
    launch; push_arms; sleep "${E13_TICK:-300}"
  done
}

stop_arms() { # the arms, then only the claude sessions working inside $WORK (never your other Claude sessions)
  for pid in $(ap_pids); do kill "$pid" 2>/dev/null; done; pkill -f "baseline.mjs $WORK/"; sleep 2
  for pid in $(pgrep -f "claude -p" 2>/dev/null); do
    cwd=$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p'); [ -n "$cwd" ] || cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    case "$cwd" in "$WORK"/*) kill "$pid" 2>/dev/null;; esac
  done; true; }

case "${1:-start}" in
  start)
    setup
    if alive "$SUP"; then echo "already running; ./run-e13.sh status"; exit 0; fi
    # caffeinate keeps a Mac awake while this runs (plugged in; with the lid closed only in clamshell mode with a display)
    if command -v caffeinate >/dev/null; then E13_WORK="$WORK" nohup caffeinate -ims "$HERE/run-e13.sh" _supervise "$WORK" >> "$WORK/supervise.log" 2>&1 < /dev/null &
    else E13_WORK="$WORK" nohup "$HERE/run-e13.sh" _supervise "$WORK" >> "$WORK/supervise.log" 2>&1 < /dev/null & fi
    sleep 5; echo "started. deadline $(cat "$WORK/deadline"); work in $WORK; log $WORK/supervise.log"; E13_WORK="$WORK" "$HERE/run-e13.sh" status ;;
  _supervise) supervise ;;
  status)
    echo "deadline: $(cat "$WORK/deadline" 2>/dev/null)   now: $(date -u +%FT%TZ)"
    [ -f "$WORK/FINISHED" ] && echo "FINISHED: games are being served blind from http://localhost:3101"
    alive "$SUP" && echo "supervisor: running" || echo "supervisor: not running (./run-e13.sh start)"
    for a in $ARMS; do ended $a && s=ended || { if [ $a = autopilot ]; then ap_alive && s=running || s=down; else alive "baseline.mjs $WORK/$a " && s=running || s=down; fi; }; echo "arm $a: $s"; done
    [ -f "$WORK/compared.from" ] && echo "compared with: $(paste -sd';' "$WORK/compared.from")"
    tail -n 3 "$WORK/supervise.log" 2>/dev/null ;;
  stop) pkill -f "$SUP"; stop_arms; echo stopped ;;
  serve) "$HERE/blind-serve.sh" start "$WORK" ;;
  reveal) "$HERE/blind-serve.sh" reveal "$WORK" ;;
  *) sed -n 2,16p "$HERE/run-e13.sh" ;;
esac
