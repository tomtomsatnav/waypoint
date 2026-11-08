#!/usr/bin/env bash
# Boot the three finished E13 arms blind on ports 3101-3103 in a random order (macOS or Linux).
# The mapping is written to <work>/.blind-map.json and not printed until "reveal".
# Usage: blind-serve.sh start|stop|reveal <work dir>
set -u
cmd=${1:-start}; WORK=${2:-$HOME/emberfall-e13}; M=$WORK/.blind-map.json
killport() { for pid in $(lsof -ti "tcp:$1" 2>/dev/null); do kill "$pid" 2>/dev/null; done; }
case "$cmd" in
  stop) for p in 3101 3102 3103; do killport $p; done; exit 0 ;;
  reveal) cat "$M"; exit 0 ;;
esac
[ -f "$M" ] || node -e "
  const a = ['autopilot', 'single', 'loop'];
  for (let i = a.length - 1; i > 0; i--) { const j = require('crypto').randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  require('fs').writeFileSync('$M', JSON.stringify({ 3101: a[0], 3102: a[1], 3103: a[2] }, null, 2));"
for p in 3101 3102 3103; do
  killport $p
  a=$(node -e "console.log(require('$M')['$p'])"); d=$WORK/blind/$p; rm -rf "$d"; mkdir -p "$d"
  git -C "$WORK/$a" archive HEAD | tar -x -C "$d"           # committed code only: no history, no autopilot state
  ( cd "$d" && npm install --no-audit --no-fund > "$WORK/blind/$p.install.log" 2>&1
    node -e "process.exit(require('./package.json').scripts?.build ? 0 : 1)" 2>/dev/null && npm run build >> "$WORK/blind/$p.install.log" 2>&1
    PORT=$p nohup npm start > "$WORK/blind/$p.log" 2>&1 < /dev/null & )
done
sleep 25
for p in 3101 3102 3103; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/")
  if [ "$code" = 200 ]; then echo "port $p: up  http://localhost:$p"
  else echo "port $p: not answering (HTTP $code); the game may ignore PORT: see $WORK/blind/$p.log"; fi
done
