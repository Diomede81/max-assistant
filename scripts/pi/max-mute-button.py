#!/usr/bin/env python3
"""
Max box mute button.

Each press of the button on top of the box turns the microphone off or back on. While it is
off, this service keeps a note in /run/max/muted: Max (in his container) hears only silence,
so nothing wakes him and no sound leaves the box, and his face shows "Microphone off".
The choice survives a restart (kept in /var/lib/max/muted).

Wiring: one leg of a momentary push button to GPIO 17 (pin 11), the other to ground (pin 9).
No resistor needed: the Pi's own pull-up is used.

Runs as root under systemd (max-mute-button.service). Uses gpiozero (python3-gpiozero).
Settings (environment): MAX_RUN_DIR (/run/max), MAX_MUTE_GPIO (17).
"""
import os
import signal
import sys

from gpiozero import Button

RUN_DIR = os.environ.get('MAX_RUN_DIR', '/run/max')
PIN = int(os.environ.get('MAX_MUTE_GPIO', '17'))
NOTE = os.path.join(RUN_DIR, 'muted')
SAVED = '/var/lib/max/muted'


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def set_muted(muted):
    for path in (NOTE, SAVED):
        try:
            if muted:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w') as f:
                    f.write('mute button\n')
            elif os.path.exists(path):
                os.remove(path)
        except OSError as err:
            log(f'Could not update {path}: {err}')


def toggle():
    muted = not os.path.exists(NOTE)
    set_muted(muted)
    log('Microphone off' if muted else 'Microphone on')


def main():
    set_muted(os.path.exists(SAVED))  # /run is emptied at every start: restore the last choice
    button = Button(PIN, pull_up=True, bounce_time=0.05)
    button.when_pressed = toggle
    log(f'Mute button ready on GPIO {PIN} (microphone {"off" if os.path.exists(NOTE) else "on"})')
    signal.pause()


if __name__ == '__main__':
    main()
