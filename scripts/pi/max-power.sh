#!/bin/sh
# Turns the Max box off or restarts it when Max asks: from the screen's menu, by voice, or from
# the control panel. Max runs in a container, so he leaves a note in /run/max/power-request
# ("poweroff" or "reboot"); max-power.path notices it and runs this. /run is emptied at every
# start, so an old note can never turn the box off later.
F="${MAX_RUN_DIR:-/run/max}/power-request"
[ -f "$F" ] || exit 0
ACTION="$(head -c 20 "$F" | tr -cd 'a-z')"
rm -f "$F"
case "$ACTION" in
  poweroff) logger -t max-power "Turning off (asked by Max)"; exec systemctl poweroff ;;
  reboot)   logger -t max-power "Restarting (asked by Max)"; exec systemctl reboot ;;
  *)        logger -t max-power "Ignored an unknown request: $ACTION" ;;
esac
