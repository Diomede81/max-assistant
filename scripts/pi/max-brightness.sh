#!/bin/sh
# Sets the screen's brightness when Max asks (screen menu, voice, control panel). Max runs in a
# container, so he writes the level (5-100) to /run/max/brightness-request; max-brightness.path
# notices and runs this. It tells Max whether the screen supports it in /run/max/backlight.json.
RUN="${MAX_RUN_DIR:-/run/max}"
REQ="$RUN/brightness-request"
# A real file only: a link planted by the container (to a system file) is ignored.
[ -f "$REQ" ] && [ ! -L "$REQ" ] || exit 0
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
# Written in a folder only root can use, then moved in with one rename: a link planted at
# /run/max/backlight.json is replaced, never followed (the container can write in /run/max).
PRIV=/run/max-box
mkdir -p "$PRIV" && chmod 755 "$PRIV"
TMP="$(mktemp "$PRIV/backlight.XXXXXX")" || exit 1
printf '{"supported":%s,"level":%s}\n' "$FOUND" "$PCT" > "$TMP"
chmod 644 "$TMP"
mv -fT "$TMP" "$RUN/backlight.json"
[ "$FOUND" = true ] || logger -t max-brightness "No adjustable screen backlight found (/sys/class/backlight is empty)"
