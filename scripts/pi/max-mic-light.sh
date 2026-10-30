#!/bin/sh
# Turns the mic board's LED ring (ReSpeaker XVF3800) off or on when Max asks: at night, or from
# the control panel (Settings → Device → Microphone lights). Max runs in a container, so he writes
# "off" or "on" to /run/max/mic-light-request; max-mic-light.path notices and runs this. It uses
# the board maker's own control tool (xvf_host), which you install yourself (docs/PI.md): the ring's
# effect is switched off and its power pin cut so the LEDs are completely dark; "on" restores the
# board's usual light. What happened is written to /run/max/mic-light.json for the control panel.
RUN="${MAX_RUN_DIR:-/run/max}"
REQ="$RUN/mic-light-request"
TOOL_DIR="${XVF_HOST_DIR:-/usr/local/lib/max/xvf_host}"
# A real file only: a link planted by the container (to a system file) is ignored.
[ -f "$REQ" ] && [ ! -L "$REQ" ] || exit 0
WANT="$(head -c 4 "$REQ" | tr -cd 'a-z')"
report() {
  # Written in a folder only root can use, then moved in with one rename (as max-brightness.sh does).
  PRIV=/run/max-box
  mkdir -p "$PRIV" && chmod 755 "$PRIV"
  TMP="$(mktemp "$PRIV/miclight.XXXXXX")" || return
  printf '{"ok":%s,"want":"%s","message":"%s","at":"%s"}\n' "$1" "$WANT" "$(printf '%s' "$2" | tr -d '"\\' | tr '\n' ' ' | cut -c1-300)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP"
  chmod 644 "$TMP"
  mv -fT "$TMP" "$RUN/mic-light.json"
  logger -t max-mic-light "$2"
}
[ -x "$TOOL_DIR/xvf_host" ] || { report false "The board's control tool (xvf_host) is not installed at $TOOL_DIR: the lights stay as they are. docs/PI.md explains how to install it."; exit 0; }
cd "$TOOL_DIR" || exit 0
FAILED=""
run() { OUT="$(./xvf_host "$@" 2>&1)"; RC=$?; [ $RC -eq 0 ] || FAILED="$FAILED xvf_host $* failed (exit $RC): $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-120)."; return $RC; }
# Two ways to dark: the effect off, and the ring's power pin off. Either working is enough; both failing is reported.
case "$WANT" in
  off) run LED_EFFECT 0; A=$?; run GPO_WRITE_VALUE 33 0; B=$?; if [ $A -eq 0 ] || [ $B -eq 0 ]; then report true "Microphone lights off${FAILED:+ (partly:$FAILED)}"; else report false "Could not switch the lights off:$FAILED"; fi ;;
  on)  run GPO_WRITE_VALUE 33 1; A=$?; run LED_EFFECT 4; B=$?; if [ $A -eq 0 ] || [ $B -eq 0 ]; then report true "Microphone lights on${FAILED:+ (partly:$FAILED)}"; else report false "Could not switch the lights on:$FAILED"; fi ;;
  *) exit 0 ;;
esac
