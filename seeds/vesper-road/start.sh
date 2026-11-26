#!/bin/bash
# Starts the waypoint autopilot on this project. Run it once from this folder: ./start.sh
cd "$(dirname "$0")" || exit 1
[ -d .git ] || { git init -q && git add -A && git commit -qm "Brief and references"; }
exec "${WAYPOINT:-$HOME/waypoint}/bin/autopilot.sh" start --brief-file BRIEF.md --references references/country-summer-road-and-stream.jpg,references/country-winter-snow.jpg,references/crowd-sprites-in-wheat.jpg,references/fields-edge-and-hedges.jpg,references/fields-trampled-wheat.jpg,references/fields-wheat-and-farmhouse.jpg,references/fields-wheat-wide.jpg,references/portrait-helm-1.jpg,references/portrait-helm-2.jpg,references/sprites-figures-closeup.jpg,references/ui-panel-character-2.jpg,references/ui-panel-character.jpg,references/ui-panel-orders.jpg,references/village-autumn-floating-numbers.jpg,references/village-autumn-house.jpg,references/village-square-and-smithy.jpg,references/village-summer-1.jpg,references/village-summer-2.jpg
