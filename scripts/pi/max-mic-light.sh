#!/bin/sh
# Turns the mic board's LED ring (ReSpeaker XVF3800) off or on when Max asks: at night, or from
# the control panel (Settings → Device → Microphone lights). Max runs in a container, so he writes
# "off" or "on" to /run/max/mic-light-request; max-mic-light.path notices and runs this. It uses
# the board maker's own control tool (xvf_host), which you install yourself (docs/PI.md): it cuts
# the ring's power pin so the LEDs are completely dark, and restores the board's usual light.
RUN="${MAX_RUN_DIR:-/run/max}"
REQ="$RUN/mic-light-request"
TOOL_DIR="${XVF_HOST_DIR:-/usr/local/lib/max/xvf_host}"
# A real file only: a link planted by the container (to a system file) is ignored.
[ -f "$REQ" ] && [ ! -L "$REQ" ] || exit 0
WANT="$(head -c 4 "$REQ" | tr -cd 'a-z')"
[ -x "$TOOL_DIR/xvf_host" ] || { logger -t max-mic-light "xvf_host is not installed: the microphone lights stay as they are (docs/PI.md explains how to install it)"; exit 0; }
cd "$TOOL_DIR" || exit 0
case "$WANT" in
  off) ./xvf_host GPO_WRITE_VALUE 33 0 >/dev/null 2>&1 && logger -t max-mic-light "Microphone lights off" ;;
  on)  ./xvf_host GPO_WRITE_VALUE 33 1 >/dev/null 2>&1 && ./xvf_host LED_EFFECT 4 >/dev/null 2>&1 && logger -t max-mic-light "Microphone lights on" ;;
  *) exit 0 ;;
esac
