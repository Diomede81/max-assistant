#!/bin/sh
# Sets the screen's brightness when Max asks (screen menu, voice, control panel). Max runs in a
# container, so he writes the level (5-100) to /run/max/brightness-request; max-brightness.path
# notices and runs this. It tells Max whether the screen supports it in /run/max/backlight.json.
RUN="${MAX_RUN_DIR:-/run/max}"
REQ="$RUN/brightness-request"
[ -f "$REQ" ] || exit 0
PCT="$(head -c 4 "$REQ" | tr -cd '0-9')"
[ -n "$PCT" ] || exit 0
[ "$PCT" -gt 100 ] && PCT=100
[ "$PCT" -lt 5 ] && PCT=5
FOUND=false
BL="${BACKLIGHT_DIR:-/sys/class/backlight}"
for B in "$BL"/*; do
  [ -f "$B/max_brightness" ] || continue
  MAX="$(cat "$B/max_brightness")"
  VAL=$(( (MAX * PCT + 50) / 100 ))
  [ "$VAL" -lt 1 ] && VAL=1
  echo "$VAL" > "$B/brightness" 2>/dev/null && FOUND=true
done
printf '{"supported":%s,"level":%s}\n' "$FOUND" "$PCT" > "$RUN/backlight.json"
chmod 644 "$RUN/backlight.json"
[ "$FOUND" = true ] || logger -t max-brightness "No adjustable screen backlight found (/sys/class/backlight is empty)"
