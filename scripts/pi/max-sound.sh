#!/bin/sh
# Max's speaker tuning (control panel: Settings > Device > Speaker sound). Runs as the desktop user
# (max-sound.service); max-sound-config.path restarts it when Max writes a new choice to
# /run/max/sound.json.
#   flat  - the sound as it is, straight to the mic board.
#   warm  - fuller: more low notes, softer harsh frequencies (music).
#   voice - clearer speech: less boom, more presence.
# Tuned sound plays through a small equaliser (a PipeWire filter-chain) into the mic board, so its
# echo cancellation still hears exactly what the speaker plays. The volume stays where it was.
SETTINGS=/run/max/sound.json
CONF="${XDG_RUNTIME_DIR:-/tmp}/max-sound.conf"
TUNED=max_tuned

board_sink() { pactl list short sinks 2>/dev/null | awk 'tolower($2) ~ /xvf|respeaker|xmos|seeed/ {print $2; exit}'; }
volume_of() { pactl get-sink-volume "$1" 2>/dev/null | grep -o '[0-9]*%' | head -1; }
# Moves every stream (Max's voice, radio, AirPlay...) to a speaker, except the equaliser's own output.
move_all() {
  pactl -f json list sink-inputs 2>/dev/null | python3 -c '
import json, sys
for s in json.load(sys.stdin):
    if s.get("properties", {}).get("node.name") != "max_tuned.output":
        print(s["index"])' 2>/dev/null | while read -r i; do pactl move-sink-input "$i" "$1" 2>/dev/null; done
}

TONE=flat
if [ -f "$SETTINGS" ]; then
  TONE="$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1])).get("tone"); print(t if t in ("warm","voice") else "flat")' "$SETTINGS" 2>/dev/null || echo flat)"
fi

BOARD=""
for _ in $(seq 1 60); do
  BOARD="$(board_sink)"
  [ -n "$BOARD" ] && break
  sleep 2
done
if [ -z "$BOARD" ]; then
  echo "Speaker sound: mic board not found (is the USB cable connected?)"
  exit 0
fi

if [ "$TONE" = flat ]; then
  pactl set-default-sink "$BOARD"
  move_all "$BOARD"
  echo "Speaker sound: flat"
  exit 0
fi

umask 077
python3 - "$TONE" "$BOARD" "$CONF" <<'PY' || exit 0
import sys
tone, board, path = sys.argv[1:4]
# (type, Hz, Q, dB). Tuned for a small 2.5-3" full-range speaker in a closed box: the high-pass
# keeps the cone from straining on notes it can't play, which also makes it louder before it distorts.
PRESETS = {
    'warm': [('bq_highpass', 90, 0.7, 0), ('bq_lowshelf', 180, 0.7, 4), ('bq_peaking', 3000, 1.0, -3), ('bq_highshelf', 9000, 0.7, -1.5)],
    'voice': [('bq_highpass', 140, 0.7, 0), ('bq_peaking', 300, 1.0, -3), ('bq_peaking', 2800, 1.0, 2.5), ('bq_highshelf', 9000, 0.7, -1.5)],
}
bands = PRESETS[tone]
nodes = '\n'.join(
    f'          {{ type = builtin name = eq{i} label = {kind} control = {{ "Freq" = {hz:.1f} "Q" = {q:.2f} "Gain" = {db:.1f} }} }}'
    for i, (kind, hz, q, db) in enumerate(bands))
links = '\n'.join(f'          {{ output = "eq{i}:Out" input = "eq{i + 1}:In" }}' for i in range(len(bands) - 1))
open(path, 'w').write(f'''context.properties = {{ log.level = 0 }}
context.spa-libs = {{
  audio.convert.* = audioconvert/libspa-audioconvert
  support.*       = support/libspa-support
}}
context.modules = [
  {{ name = libpipewire-module-rt args = {{ nice.level = -11 }} flags = [ ifexists nofail ] }}
  {{ name = libpipewire-module-protocol-native }}
  {{ name = libpipewire-module-client-node }}
  {{ name = libpipewire-module-adapter }}
  {{ name = libpipewire-module-filter-chain
    args = {{
      node.description = "Max speaker (tuned)"
      media.name = "Max speaker (tuned)"
      filter.graph = {{
        nodes = [
{nodes}
        ]
        links = [
{links}
        ]
      }}
      audio.channels = 2
      audio.position = [ FL FR ]
      capture.props = {{
        node.name = "max_tuned"
        media.class = Audio/Sink
      }}
      playback.props = {{
        node.name = "max_tuned.output"
        node.passive = true
        target.object = "{board}"
        node.target = "{board}"
        node.dont-reconnect = true
        stream.dont-remix = true
      }}
    }}
  }}
]
''')
PY

ORIGINAL="$(volume_of "$BOARD")"
pipewire -c "$CONF" &
PID=$!
# Stopped (a new choice, or the box shutting down): the volume and the speaker go back to the board.
restore() {
  V="$(volume_of "$TUNED")"
  pactl set-sink-volume "$BOARD" "${V:-${ORIGINAL:-60%}}"
  pactl set-default-sink "$BOARD"
  move_all "$BOARD"
}
trap 'restore; kill $PID 2>/dev/null; wait $PID 2>/dev/null; exit 0' TERM INT

for _ in $(seq 1 20); do
  pactl list short sinks 2>/dev/null | awk '{print $2}' | grep -qx "$TUNED" && break
  sleep 0.5
done
if ! pactl list short sinks 2>/dev/null | awk '{print $2}' | grep -qx "$TUNED"; then
  echo "Speaker sound: the equaliser didn't start; playing flat"
  kill $PID 2>/dev/null
  pactl set-default-sink "$BOARD"
  exit 1
fi
# The volume moves to the tuned speaker (what Max's volume control changes); the board runs at full.
[ -n "$ORIGINAL" ] && pactl set-sink-volume "$TUNED" "$ORIGINAL"
pactl set-sink-volume "$BOARD" 100%
pactl set-default-sink "$TUNED"
move_all "$TUNED"
echo "Speaker sound: $TONE"
wait $PID
# The equaliser stopped on its own: back to the board at the volume it had.
pactl set-sink-volume "$BOARD" "${ORIGINAL:-60%}"
pactl set-default-sink "$BOARD"
move_all "$BOARD"
exit 1
