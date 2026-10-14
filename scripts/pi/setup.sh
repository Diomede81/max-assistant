#!/usr/bin/env bash
# Max box setup for a Raspberry Pi 5 running Raspberry Pi OS (64-bit, Bookworm or later).
#
# Run once, from the max-assistant folder on the Pi:
#     sudo ./scripts/pi/setup.sh
#
# It is safe to run again (after updates, or to change the screen type). What it does:
#   1. Installs Docker, the sound system (PipeWire), the kiosk browser and NetworkManager tools
#   2. Names the box "max" (reachable as max.local on your network)
#   3. Sets up sound so the ReSpeaker mic board is the default microphone and speaker
#   4. Configures the round screen and shows Max's face full-screen at boot
#   5. Installs WiFi setup mode (the "Max-Setup" network with a QR code on the face)
#   6. Builds and starts Max (and the Spotify speaker if enabled in .env)
#
# Options (environment variables):
#   MAX_SCREEN=dsi|hdmi|none   which round screen is fitted (asked if not set)
#   MAX_DSI_PORT=0|1           Pi 5: which display connector the screen's ribbon is in (asked if not set)
#   MAX_HOSTNAME=max           network name of the box
#   MAX_SKIP_START=1           install everything but don't build/start Max yet
#
# Your answers (screen, connector, user, name) are remembered in /etc/max/box.conf, so running it
# again, and the automatic updates (scripts/pi/max-update.py), never need to ask.
set -euo pipefail

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo ./scripts/pi/setup.sh"
BOX_CONF=/etc/max/box.conf
# A saved answer, or nothing (never an error: on the first run there's no file yet).
saved() { [ -f "$BOX_CONF" ] && sed -n "/^$1=/{s/^$1=//p;q}" "$BOX_CONF" || true; }
# The updater runs this as root, naming the user in MAX_USER.
USER_NAME="${SUDO_USER:-${MAX_USER:-}}"
[ -n "$USER_NAME" ] && [ "$USER_NAME" != root ] || die "Run with sudo from your normal user account (not as root)."
USER_ID="$(id -u "$USER_NAME")"
USER_GID="$(id -g "$USER_NAME")"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$REPO/docker-compose.yml" ] || die "Run this from inside the max-assistant folder."
[ "$(uname -m)" = aarch64 ] || warn "This is meant for 64-bit Raspberry Pi OS (aarch64); continuing anyway."
grep -q 'Raspberry Pi 5' /proc/device-tree/model 2>/dev/null || warn "This doesn't look like a Raspberry Pi 5; continuing anyway."
. /etc/os-release
CONFIG_TXT=/boot/firmware/config.txt; [ -f "$CONFIG_TXT" ] || CONFIG_TXT=/boot/config.txt

SCREEN="${MAX_SCREEN:-$(saved MAX_SCREEN)}"
if [ -z "$SCREEN" ]; then
  echo "Which screen is fitted?  1) round DSI (ribbon cable)   2) round HDMI   3) none"
  read -r -p "Choose 1, 2 or 3 [1]: " choice </dev/tty || choice=1
  case "${choice:-1}" in 2) SCREEN=hdmi ;; 3) SCREEN=none ;; *) SCREEN=dsi ;; esac
fi

# ---------------------------------------------------------------- 1. packages
say "Installing system packages (this takes a few minutes)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
CHROMIUM=chromium; apt-cache show chromium >/dev/null 2>&1 || CHROMIUM=chromium-browser
apt-get install -y -q ca-certificates curl git python3 network-manager avahi-daemon \
  pipewire pipewire-pulse wireplumber pulseaudio-utils cage "$CHROMIUM" fonts-noto-color-emoji
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker,audio,video,render,input "$USER_NAME" || true

# ---------------------------------------------------------------- 2. name on the network
NAME="${MAX_HOSTNAME:-$(saved MAX_HOSTNAME)}"; NAME="${NAME:-max}"
if [ "$(hostname)" != "$NAME" ]; then
  say "Naming the box \"$NAME\" (reachable as $NAME.local)"
  hostnamectl set-hostname "$NAME"
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$NAME/" /etc/hosts || true
  grep -q "127.0.1.1" /etc/hosts || echo -e "127.0.1.1\t$NAME" >> /etc/hosts
fi

# ---------------------------------------------------------------- 3. sound
say "Setting up sound (PipeWire, mic board as default)"
loginctl enable-linger "$USER_NAME"   # sound runs at boot, without anyone logging in
install -m 755 "$REPO/scripts/pi/max-audio-defaults.sh" /usr/local/bin/max-audio-defaults
install -D -m 644 "$REPO/scripts/pi/systemd/max-audio-defaults.service" /etc/systemd/user/max-audio-defaults.service
USER_SYSTEMCTL=(sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$USER_ID" systemctl --user)
sleep 2
"${USER_SYSTEMCTL[@]}" daemon-reload || true
"${USER_SYSTEMCTL[@]}" enable --now pipewire pipewire-pulse wireplumber || warn "Could not start PipeWire yet; it starts after a reboot."
"${USER_SYSTEMCTL[@]}" enable max-audio-defaults.service || true

# ---------------------------------------------------------------- 4. screen + face
say "Setting up the screen ($SCREEN)"
sed -i '/# max-box screen/,+1d' "$CONFIG_TXT"
if [ "$SCREEN" = dsi ]; then
  # Waveshare 4inch DSI LCD (C), round 720x720. A Pi 5 has two display connectors
  # (CAM/DISP 0 and CAM/DISP 1): the line must name the one the ribbon cable is in.
  PORT_SUFFIX=""
  if grep -qi "raspberry pi 5" /proc/device-tree/model 2>/dev/null; then
    PORT="${MAX_DSI_PORT:-$(saved MAX_DSI_PORT)}"
    if [ -z "$PORT" ]; then
      echo "Which connector is the screen's ribbon cable in? It's printed next to it on the Pi:"
      echo "  0) CAM/DISP 0     1) CAM/DISP 1"
      read -r -p "Choose 0 or 1 [1]: " PORT </dev/tty || PORT=1
    fi
    DSI_PORT="${PORT:-1}"
    case "${PORT:-1}" in 0) PORT_SUFFIX=",dsi0" ;; *) PORT_SUFFIX=",dsi1" ;; esac
  fi
  printf '# max-box screen\ndtoverlay=vc4-kms-dsi-waveshare-panel,4_0_inchC%s\n' "$PORT_SUFFIX" >> "$CONFIG_TXT"
fi
if [ "$SCREEN" != none ]; then
  install -m 755 "$REPO/scripts/pi/max-face-kiosk.sh" /usr/local/bin/max-face-kiosk
  python3 "$REPO/scripts/pi/make-invisible-cursor.py" /usr/share/icons
  sed "s/__USER__/$USER_NAME/" "$REPO/scripts/pi/systemd/max-face.service" > /etc/systemd/system/max-face.service
  systemctl disable getty@tty1.service 2>/dev/null || true
  systemctl set-default graphical.target
  systemctl enable max-face.service
  # Raspberry Pi OS with desktop: its desktop (started by a display manager) would take the screen
  # instead of the face. Switch it off at boot; nothing is uninstalled.
  for DM in lightdm gdm3 sddm; do
    if systemctl is-enabled "$DM.service" >/dev/null 2>&1; then
      systemctl disable "$DM.service"
      DESKTOP_OFF="$DM"
    fi
  done
  [ -n "${DESKTOP_OFF:-}" ] && warn "The desktop no longer starts at boot, so the screen shows Max's face. To get the desktop back: sudo systemctl enable $DESKTOP_OFF && sudo reboot"
  # Never blank the console underneath the face.
  CMDLINE=/boot/firmware/cmdline.txt; [ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
  grep -q 'consoleblank=0' "$CMDLINE" || sed -i 's/$/ consoleblank=0/' "$CMDLINE"
else
  systemctl disable max-face.service 2>/dev/null || true
fi

# ---------------------------------------------------------------- 4b. boot screen
# Max's face (or your own logo: put a PNG called boot-logo.png in the max-assistant folder)
# while the box starts and shuts down, instead of raspberries and scrolling text.
if [ "$SCREEN" != none ] && [ "${MAX_BOOT_LOGO:-on}" != off ]; then
  say "Setting up the boot screen"
  LOGO="$REPO/boot-logo.png"; [ -f "$LOGO" ] || LOGO="$REPO/scripts/pi/boot/logo.png"
  if [ "$(head -c 8 "$LOGO" | od -An -tx1 | tr -d ' \n')" != 89504e470d0a1a0a ]; then
    warn "$LOGO is not a PNG picture; using Max's face instead."
    LOGO="$REPO/scripts/pi/boot/logo.png"
  fi
  command -v plymouth-set-default-theme >/dev/null 2>&1 || apt-get install -y -q plymouth plymouth-themes
  THEME_DIR=/usr/share/plymouth/themes/max
  install -d "$THEME_DIR"
  install -m 644 "$REPO/scripts/pi/boot/max.plymouth" "$REPO/scripts/pi/boot/max.script" "$THEME_DIR/"
  install -m 644 "$LOGO" "$THEME_DIR/logo.png"
  # No rainbow square from the firmware, no raspberries or blinking cursor from Linux.
  grep -q '^disable_splash=1' "$CONFIG_TXT" || echo 'disable_splash=1' >> "$CONFIG_TXT"
  CMDLINE=/boot/firmware/cmdline.txt; [ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
  for OPT in quiet splash logo.nologo vt.global_cursor_default=0; do
    grep -qw -- "$OPT" "$CMDLINE" || sed -i "s/\$/ $OPT/" "$CMDLINE"
  done
  # Rebuilds the start-up files with the new theme (takes a minute).
  plymouth-set-default-theme -R max >/dev/null || warn "Could not apply the boot screen; the box starts as before."
  echo "  Boot screen: $( [ "$LOGO" = "$REPO/boot-logo.png" ] && echo 'your boot-logo.png' || echo "Max's face" )"
fi

# ---------------------------------------------------------------- 5. WiFi setup mode
say "Installing WiFi setup mode"
install -D -m 755 "$REPO/scripts/pi/max-wifi-setup.py" /usr/local/lib/max/max-wifi-setup.py
install -m 644 "$REPO/scripts/pi/systemd/max-wifi.service" /etc/systemd/system/max-wifi.service
# Shared folder between the WiFi service and Max (status for the face, requests from the screen).
echo "d /run/max 0775 $USER_NAME $USER_NAME -" > /etc/tmpfiles.d/max.conf
systemd-tmpfiles --create /etc/tmpfiles.d/max.conf
# While the setup network is up, answer every web address with the setup page (captive portal).
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
echo "address=/#/10.42.0.1" > /etc/NetworkManager/dnsmasq-shared.d/max-captive.conf
systemctl daemon-reload
systemctl enable --now max-wifi.service

# ---------------------------------------------------------------- 5b. turning off / on
say "Installing turn off / restart and screen brightness (screen menu, voice, control panel, power button)"
install -D -m 755 "$REPO/scripts/pi/max-power.sh" /usr/local/lib/max/max-power.sh
install -m 644 "$REPO/scripts/pi/systemd/max-power.path" /etc/systemd/system/max-power.path
install -m 644 "$REPO/scripts/pi/systemd/max-power.service" /etc/systemd/system/max-power.service
# The Pi 5's own power button: a short press turns the box off safely (pressed again, it starts).
mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandlePowerKey=poweroff\nHandlePowerKeyLongPress=poweroff\n' > /etc/systemd/logind.conf.d/max-power-key.conf
install -D -m 755 "$REPO/scripts/pi/max-brightness.sh" /usr/local/lib/max/max-brightness.sh
install -m 644 "$REPO/scripts/pi/systemd/max-brightness.path" /etc/systemd/system/max-brightness.path
install -m 644 "$REPO/scripts/pi/systemd/max-brightness.service" /etc/systemd/system/max-brightness.service
systemctl daemon-reload
systemctl enable --now max-power.path max-brightness.path

# ---------------------------------------------------------------- SD card care
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=50M\n' > /etc/systemd/journald.conf.d/max.conf
systemctl restart systemd-journald || true

# ---------------------------------------------------------------- 6. Max
cd "$REPO"
if [ ! -f .env ]; then
  cp .env.example .env
  chown "$USER_NAME:$USER_NAME" .env
  warn "Created .env from the example. Copy your real .env from your Mac (see docs/PI.md), then run this script again."
  MAX_SKIP_START=1
fi
set_env() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
set_env MAX_UID "$USER_ID"
set_env MAX_GID "$USER_GID"
grep -q '^CONTROL_PANEL_URL=' .env || set_env CONTROL_PANEL_URL "http://$NAME.local:8099"
grep -q '^PANEL_PASSWORD=.\+' .env || warn "PANEL_PASSWORD is not set in .env. On the box the control panel is reachable from your home network, so set one."
grep -q '^COMPOSE_PROFILES=' .env || set_env COMPOSE_PROFILES max
# Every "docker compose" command on the box includes the Pi settings (sound, control panel on the
# home network), so a plain "docker compose up -d" can't lock the control panel to the box itself.
set_env COMPOSE_FILE docker-compose.yml:docker-compose.pi.yml

if [ "${MAX_SKIP_START:-}" != 1 ]; then
  say "Building and starting Max (the first build takes 10-15 minutes on a Pi 5)"
  docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --build
fi

# ---------------------------------------------------------------- 7. updates
say "Installing updates from GitHub (control panel: Settings, Updates)"
mkdir -p /etc/max
cat > "$BOX_CONF" <<CONF
# Written by scripts/pi/setup.sh: the answers it was given, reused by updates.
MAX_USER=$USER_NAME
MAX_REPO=$REPO
MAX_SCREEN=$SCREEN
MAX_DSI_PORT=${DSI_PORT:-$(saved MAX_DSI_PORT)}
MAX_HOSTNAME=$NAME
CONF
install -D -m 755 "$REPO/scripts/pi/max-update.py" /usr/local/lib/max/max-update.py
for UNIT in max-update.path max-update.service max-version.service; do
  install -m 644 "$REPO/scripts/pi/systemd/$UNIT" "/etc/systemd/system/$UNIT"
done
systemctl daemon-reload
systemctl enable --now max-update.path
systemctl enable max-version.service
python3 /usr/local/lib/max/max-update.py version || true

say "Done."
echo "  Control panel: http://$NAME.local:8099   Face (on the box): http://localhost:8098"
echo "  Logs: cd $REPO && docker compose logs -f max"
echo "  Hold the screen for 2 seconds for the menu: volume, brightness, Turn off, Restart, WiFi setup."
echo "  Turn on: the Pi's power button."
echo "  WiFi setup also starts by itself if the box is offline for a minute."
[ "$SCREEN" = dsi ] && echo "  Reboot now to activate the screen: sudo reboot"
exit 0
