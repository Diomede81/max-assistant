#!/usr/bin/env python3
"""
Max box mute button.

Each press of the button on top of the box turns the microphone off or back on. While it is
off, this service keeps a note in /run/max/muted: Max (in his container) hears only silence,
so nothing wakes him and no sound leaves the box, and his face shows "Microphone off".
The choice survives a restart (kept in /var/lib/max/muted).

Wiring: one leg of a momentary push button to GPIO 17 (pin 11), the other to ground (pin 9).
No resistor needed: the Pi's own pull-up is used. A button with a built-in light (3-6 V) can show
when the microphone is off: light + to GPIO 27 (pin 13), light - to ground (pin 14).

Runs as root under systemd (max-mute-button.service). Uses gpiozero (python3-gpiozero).
Settings (environment): MAX_RUN_DIR (/run/max), MAX_MUTE_GPIO (17), MAX_MUTE_LED_GPIO (27, "off" for none).
"""
import os
import signal
import stat
import sys
import tempfile

from gpiozero import LED, Button

RUN_DIR = os.environ.get('MAX_RUN_DIR', '/run/max')
PIN = int(os.environ.get('MAX_MUTE_GPIO', '17'))
LED_PIN = os.environ.get('MAX_MUTE_LED_GPIO', '27')
NOTE = os.path.join(RUN_DIR, 'muted')
SAVED = '/var/lib/max/muted'
light = None
# The note goes into the folder Max shares with the box (/run/max), where Max's container can create
# files too, including links pointing at system files. A root service must never write through such a
# link: the file is written in a folder only root can use, then moved in with one rename, which replaces
# whatever is at that name (a planted link included) and never follows it. (As max-power-button.py.)
PRIVATE_DIR = '/run/max-box'


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def put_shared(run_dir, name, text):
    os.makedirs(PRIVATE_DIR, mode=0o755, exist_ok=True)
    st = os.lstat(PRIVATE_DIR)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise OSError('%s is not a private folder' % PRIVATE_DIR)
    fd, tmp = tempfile.mkstemp(dir=PRIVATE_DIR)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(text)
        os.chmod(tmp, 0o644)
        os.makedirs(run_dir, exist_ok=True)
        os.replace(tmp, os.path.join(run_dir, name))
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def set_muted(muted):
    try:
        if muted:
            put_shared(RUN_DIR, os.path.basename(NOTE), 'mute button\n')
        elif os.path.lexists(NOTE):
            os.remove(NOTE)  # removes a planted link itself, never what it points at
    except OSError as err:
        log(f'Could not update {NOTE}: {err}')
    try:  # root's own folder, not shared with Max
        if muted:
            os.makedirs(os.path.dirname(SAVED), exist_ok=True)
            with open(SAVED, 'w') as f:
                f.write('mute button\n')
        elif os.path.exists(SAVED):
            os.remove(SAVED)
    except OSError as err:
        log(f'Could not update {SAVED}: {err}')
    if light:
        light.value = muted


def toggle():
    muted = not os.path.exists(NOTE)
    set_muted(muted)
    log('Microphone off' if muted else 'Microphone on')


def main():
    global light
    if LED_PIN != 'off':
        light = LED(int(LED_PIN))  # the button's light: on while the microphone is off
    set_muted(os.path.exists(SAVED))  # /run is emptied at every start: restore the last choice
    button = Button(PIN, pull_up=True, bounce_time=0.05)
    button.when_pressed = toggle
    log(f'Mute button ready on GPIO {PIN} (microphone {"off" if os.path.exists(NOTE) else "on"})')
    signal.pause()


if __name__ == '__main__':
    main()
