#!/bin/sh
# Starts or updates Home Assistant on the Max box when Max asks. Max runs in a container, so he leaves a note
# in /run/max/home-request: "start" (every time Max starts, and when Home Assistant stops answering) or
# "update" (Update now on the control panel's Devices tab: Home Assistant is only ever updated by hand).
# max-home.path notices the note and runs this. Progress goes to /run/max/home.json for the Devices tab.
RUN="${MAX_RUN_DIR:-/run/max}"
F="$RUN/home-request"
[ -f "$F" ] && [ ! -L "$F" ] || { rm -f "$F"; exit 0; }  # a real file only, not a planted link
ACTION="$(head -c 20 "$F" | tr -cd 'a-z')"
rm -f "$F"
CONF=/etc/max/box.conf
grep -q '^MAX_HOME_ASSISTANT=on' "$CONF" 2>/dev/null || exit 0
REPO="$(sed -n 's/^MAX_REPO=//p' "$CONF" | tr -d '"')"
[ -d "$REPO" ] || exit 0
cd "$REPO" || exit 1

# The status file is written in a folder only root can use, then moved in with one rename: Max's container can
# create files in /run/max too, and a root service must never write through a link planted there.
status() {
  mkdir -p /run/max-box && chmod 755 /run/max-box
  TMP="$(mktemp -p /run/max-box)" || return
  printf '{"state":"%s","message":"%s","at":%s000}\n' "$1" "$2" "$(date +%s)" > "$TMP"
  chmod 644 "$TMP"
  mv -fT "$TMP" "$RUN/home.json"
  logger -t max-home "$2"
}
compose() { docker compose -f docker-compose.yml -f docker-compose.pi.yml --profile home "$@"; }

case "$ACTION" in
  start)
    compose up -d homeassistant >/dev/null 2>&1 || logger -t max-home "Couldn't start Home Assistant" ;;
  update)
    status updating "Downloading the new Home Assistant (a few minutes)"
    if ! compose pull -q homeassistant; then
      status failed "Couldn't download the new Home Assistant: check the internet connection and try again."
      exit 1
    fi
    status updating "Restarting Home Assistant with the new version"
    if ! compose up -d homeassistant; then
      status failed "The new Home Assistant didn't start. Details: journalctl -t max-home"
      exit 1
    fi
    docker image prune -f >/dev/null 2>&1  # the old version, to keep space free on the SD card
    status done "Home Assistant updated." ;;
  *) logger -t max-home "Ignored an unknown request: $ACTION" ;;
esac
