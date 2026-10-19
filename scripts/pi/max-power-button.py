#!/usr/bin/env python3
"""
Max box power button on the 40-pin header.

A press shuts the box down safely. It works whatever the desktop does with power keys: the Pi's own
power button is handled by the desktop, which ignores a second power button, so this service watches
the pin itself. To turn the box on again, unplug and replug the power (the Pi starts by itself).
A button soldered to the Pi 5's J2 pads instead needs no service: it works like the Pi's own button.

Wiring: one switch tab to GPIO 3 (pin 5), the other to ground (pin 6). No resistor needed.

Runs as root under systemd (max-power-button.service). Uses gpiozero (python3-gpiozero).
Settings (environment): MAX_POWER_GPIO (3).
"""
import os
import signal
import subprocess
import sys

from gpiozero import Button

PIN = int(os.environ.get('MAX_POWER_GPIO', '3'))


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def power_off():
    log('Power button pressed: turning off')
    subprocess.run(['systemctl', 'poweroff'], check=False)


def main():
    button = Button(PIN, pull_up=True, bounce_time=0.05)
    button.when_pressed = power_off
    log(f'Power button ready on GPIO {PIN}')
    signal.pause()


if __name__ == '__main__':
    main()
