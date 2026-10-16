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
open(sys.argv[2], 'w').write(f'''general = {{
  name = "{name}";
  password = "{code}";
  output_backend = "alsa";
}};
alsa = {{
  output_device = "default";
}};
metadata = {{
  enabled = "yes";
  include_cover_art = "no";
  pipe_name = "/run/max/airplay-metadata";
}};
''')
PY
exec /usr/bin/shairport-sync -c "$CONF"
