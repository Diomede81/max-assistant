#!/bin/sh
# Makes the ReSpeaker XVF3800 the default microphone and speaker (run as the desktop user,
# by max-audio-defaults.service). Playing through the mic board is what lets its echo
# cancellation remove Max's own voice, so "Hey Max" works while he talks or plays music.
for _ in $(seq 1 60); do
  SINK="$(pactl list short sinks 2>/dev/null | awk 'tolower($2) ~ /xvf|respeaker|xmos|seeed/ {print $2; exit}')"
  SOURCE="$(pactl list short sources 2>/dev/null | awk 'tolower($2) ~ /xvf|respeaker|xmos|seeed/ && $2 !~ /\.monitor$/ {print $2; exit}')"
  if [ -n "$SINK" ] && [ -n "$SOURCE" ]; then
    pactl set-default-sink "$SINK" && pactl set-default-source "$SOURCE"
    echo "Default speaker: $SINK; default microphone: $SOURCE"
    exit 0
  fi
  sleep 2
done
echo "Mic board not found (is the USB cable connected?). Run: pactl list short sinks" >&2
exit 1
