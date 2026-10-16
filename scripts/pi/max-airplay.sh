#!/bin/sh
# Max's AirPlay speaker (shairport-sync). Runs as the desktop user (max-airplay.service), so it
# plays through the same sound system as Max: the mic board's speaker, with its echo cancellation.
# Its settings come from Max (control panel: on/off and the 4-digit code devices must enter) in
# /run/max/airplay.json; max-airplay-config.path restarts this service when they change.
# The code is required: a device asks for it the first time it picks "Max", then remembers it.
SETTINGS=/run/max/airplay.json
CONF="${XDG_RUNTIME_DIR:-/tmp}/max-airplay.conf"
if [ ! -f "$SETTINGS" ]; then
  echo "AirPlay: waiting for Max to start"
  exit 0
fi
umask 077
# Play into the desktop sound system (PipeWire), the same one Max's voice uses, so the music comes
# out of the mic board's speaker. Use the most direct connection this shairport-sync build has
# (its version line lists them): PulseAudio protocol (served by PipeWire), then PipeWire itself,
# then ALSA through PipeWire's or PulseAudio's ALSA plug-in.
# Older builds write the names in capitals ("-PA-"), newer ones in lower case ("-pa-").
BUILD="$(/usr/bin/shairport-sync -V 2>&1 | head -1)"
case "-$(echo "$BUILD" | tr '[:upper:]' '[:lower:]')-" in
  *-pa-*) BACKEND=pa ;;
  *-pw-*) BACKEND=pw ;;
  *) BACKEND=alsa ;;
esac
ALSA_DEVICE=default
if [ "$BACKEND" = alsa ]; then
  if aplay -L 2>/dev/null | grep -qx pipewire; then ALSA_DEVICE=pipewire
  elif aplay -L 2>/dev/null | grep -qx pulse; then ALSA_DEVICE=pulse; fi
fi
if [ "$BACKEND" = alsa ]; then echo "AirPlay: shairport-sync $BUILD; sound via ALSA ($ALSA_DEVICE)"; else echo "AirPlay: shairport-sync $BUILD; sound via $BACKEND"; fi
export BACKEND ALSA_DEVICE
python3 - "$SETTINGS" "$CONF" <<'PY' || exit 0
import json, sys
s = json.load(open(sys.argv[1]))
code = ''.join(c for c in str(s.get('password') or '') if c.isdigit())
if not s.get('enabled'):
    print('AirPlay is off (switched off on the control panel, or Max is locked)')
    sys.exit(1)
if len(code) < 4:
    print('AirPlay stays off: no code set')
    sys.exit(1)
name = ''.join(c for c in str(s.get('name') or 'Max') if c.isalnum() or c in ' -_') or 'Max'
import os
backend = os.environ.get('BACKEND', 'alsa')
device = os.environ.get('ALSA_DEVICE', 'default')
outputs = {
    'pa': 'pa = {\n  application_name = "Max AirPlay (shairport)";\n};',
    'pw': 'pw = {\n  application_name = "Max AirPlay (shairport)";\n};',
    'alsa': f'alsa = {{\n  output_device = "{device}";\n}};',
}
open(sys.argv[2], 'w').write(f'''general = {{
  name = "{name}";
  password = "{code}";
  output_backend = "{backend}";
}};
{outputs[backend]}
metadata = {{
  enabled = "yes";
  include_cover_art = "no";
  pipe_name = "/run/max/airplay-metadata";
}};
''')
PY
exec /usr/bin/shairport-sync -c "$CONF"
