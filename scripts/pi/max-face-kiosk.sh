#!/bin/sh
# Shows Max's face full-screen on the box's display (started by max-face.service).
# Waits until Max's face page answers, then runs Chromium in kiosk mode inside "cage",
# a minimal full-screen Wayland compositor. Restarted by systemd if it ever exits.
URL="${MAX_FACE_URL:-http://localhost:8098}"
until curl -fsS -o /dev/null "$URL/health"; do sleep 2; done
BROWSER="$(command -v chromium || command -v chromium-browser)"
# No pointer arrow on Max's face: an invisible pointer theme (made by the setup), both by name and
# as the "default" theme in a pointer folder of its own (some versions of cage only load "default").
if [ -d /usr/share/icons/max-invisible ]; then
  export XCURSOR_THEME=max-invisible XCURSOR_SIZE=24
  export XCURSOR_PATH=/usr/share/icons/max-cursor:/usr/share/icons:/usr/share/pixmaps
fi
exec cage -s -- "$BROWSER" \
  --kiosk --app="$URL" \
  --ozone-platform=wayland \
  --noerrdialogs --disable-infobars --no-first-run --incognito \
  --password-store=basic \
  --disable-features=Translate,TouchpadOverscrollHistoryNavigation \
  --overscroll-history-navigation=0 --disable-pinch \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required
