#!/usr/bin/env python3
"""
Max box power button.

A press asks Max to show Turn off / Restart on his screen (a second press while that shows turns off,
after the usual few seconds to change your mind). Holding it for 3 seconds turns the box off straight
away, in case Max or the screen isn't responding.

Wiring, either:
- the Pi 5's J2 pads (its power button connection; a locking header pushed into the holes needs no
  solder): the button also turns the box ON, like the Pi's own button. This service watches the Pi's
  power key (the "pwr_button" input device), which J2 and the Pi's own button share.
- or GPIO 3 (pin 5) and ground (pin 6): the same, except it can't turn a Pi 5 on (unplug and replug).

The press goes to Max through the folder the box shares with him: the time of each press is written to
/run/max/power-button, which Max reads. setup.sh tells the system to ignore the power key itself, so a
press asks instead of turning off straight away.

Runs as root under systemd (max-power-button.service). Uses gpiozero (python3-gpiozero).
Settings (environment): MAX_RUN_DIR (/run/max), MAX_POWER_GPIO (3).
"""
import os
import signal
import struct
import subprocess
import sys
import threading
import time

from gpiozero import Button

RUN_DIR = os.environ.get('MAX_RUN_DIR', '/run/max')
PIN = int(os.environ.get('MAX_POWER_GPIO', '3'))
HOLD_S = 3
EV_KEY, KEY_POWER = 1, 116
EVENT = struct.Struct('llHHi')  # struct input_event: time (2 longs), type, code, value


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def ask_max():
    try:
        os.makedirs(RUN_DIR, exist_ok=True)
        with open(os.path.join(RUN_DIR, 'power-button'), 'w') as f:
            f.write(f'{int(time.time() * 1000)}\n')
        log('Power button pressed: asking Max (turn off or restart?)')
    except OSError as err:
        log(f'Could not tell Max about the power button: {err}')


def power_off():
    log(f'Power button held for {HOLD_S} s: turning off')
    subprocess.run(['systemctl', 'poweroff'], check=False)


def power_key_device(devices='/proc/bus/input/devices'):
    """The Pi 5's power key (its own button and J2), e.g. /dev/input/event5; None if there isn't one."""
    try:
        text = open(devices).read()
    except OSError:
        return None
    for block in text.split('\n\n'):
        if 'Name="pwr_button"' not in block:
            continue
        for line in block.splitlines():
            if line.startswith('H: Handlers='):
                for handler in line.split('=', 1)[1].split():
                    if handler.startswith('event'):
                        return '/dev/input/' + handler
    return None


def watch_power_key(path):
    hold = None
    with open(path, 'rb') as f:
        while True:
            data = f.read(EVENT.size)
            if len(data) < EVENT.size:
                return
            _, _, kind, code, value = EVENT.unpack(data)
            if kind != EV_KEY or code != KEY_POWER:
                continue
            if value == 1:  # pressed
                ask_max()
                hold = threading.Timer(HOLD_S, power_off)
                hold.start()
            elif value == 0 and hold:  # released before 3 s
                hold.cancel()
                hold = None


def main():
    button = Button(PIN, pull_up=True, bounce_time=0.05, hold_time=HOLD_S)
    button.when_pressed = ask_max
    button.when_held = power_off
    log(f'Power button ready on GPIO {PIN}')
    key = power_key_device()
    if key:
        threading.Thread(target=watch_power_key, args=(key,), daemon=True).start()
        log(f'Power button ready on the Pi\'s power key ({key}: its own button and J2)')
    signal.pause()


if __name__ == '__main__':
    main()
