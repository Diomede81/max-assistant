#!/usr/bin/env python3
"""The Pi 5's power button, while the box is on (run by max-power-button.service, as root).

  - A short press asks Max to put "Turn off / Restart" on his screen: it leaves a note in
    /run/max/power-button, which Max picks up within a second.
  - Held for 5 seconds, the box turns off straight away (a clean shutdown).

The service runs under systemd-inhibit (handle-power-key), so the system doesn't act on the button
itself while this runs. If it stops, the system's own handling comes back: a press turns the box
off safely. Pressing the button while the box is off turns it on (that's the Pi's firmware).
"""
import os
import select
import struct
import subprocess
import sys
import time

RUN_DIR = os.environ.get('MAX_RUN_DIR', '/run/max')
NOTE = os.path.join(RUN_DIR, 'power-button')
HOLD_S = float(os.environ.get('MAX_POWER_HOLD_S', '5'))
KEY_POWER = 116
EV_KEY = 1
# struct input_event on 64-bit Linux: struct timeval (2 x long), __u16 type, __u16 code, __s32 value
EVENT = struct.Struct('llHHi')


def log(msg):
    print(msg, flush=True)


def has_power_key(event_dir):
    """Whether this input device has a power key (its key capability bitmap includes KEY_POWER)."""
    try:
        with open(os.path.join(event_dir, 'device', 'capabilities', 'key')) as f:
            words = f.read().split()
    except OSError:
        return False
    # The bitmap is printed as hex words, most significant first, each the size of a long.
    bits = 64 if struct.calcsize('l') == 8 else 32
    for i, word in enumerate(reversed(words)):
        if i * bits <= KEY_POWER < (i + 1) * bits:
            return bool(int(word, 16) >> (KEY_POWER - i * bits) & 1)
    return False


def find_button():
    """The Pi's power button ('pwr_button'), else any input device with a power key."""
    base = '/sys/class/input'
    events = sorted(e for e in os.listdir(base) if e.startswith('event')) if os.path.isdir(base) else []
    named = []
    for e in events:
        try:
            with open(os.path.join(base, e, 'device', 'name')) as f:
                name = f.read().strip()
        except OSError:
            continue
        if name == 'pwr_button':
            return '/dev/input/' + e
        if has_power_key(os.path.join(base, e)):
            named.append('/dev/input/' + e)
    return named[0] if named else None


def ask_max():
    try:
        os.makedirs(RUN_DIR, exist_ok=True)
        tmp = NOTE + '.tmp'
        with open(tmp, 'w') as f:
            f.write(str(int(time.time() * 1000)))
        os.rename(tmp, NOTE)
        log('Power button pressed: asking on the screen')
    except OSError as e:
        log('Could not ask Max (%s)' % e)


def power_off():
    log('Power button held for %g s: turning off' % HOLD_S)
    subprocess.run(['logger', '-t', 'max-power', 'Turning off (power button held)'])
    subprocess.run(['systemctl', 'poweroff'])


def main():
    dev = None
    for _ in range(30):
        dev = find_button()
        if dev:
            break
        time.sleep(2)
    if not dev:
        log('No power button found; the system handles it')
        sys.exit(0)  # not a failure: nothing to watch (the inhibitor ends with us)
    log('Watching the power button (%s): press = ask on the screen, hold %g s = turn off' % (dev, HOLD_S))
    fd = os.open(dev, os.O_RDONLY)
    pressed_at = None
    while True:
        timeout = None if pressed_at is None else max(0.0, pressed_at + HOLD_S - time.monotonic())
        ready, _, _ = select.select([fd], [], [], timeout)
        if not ready:
            # Still held after HOLD_S seconds.
            pressed_at = None
            power_off()
            continue
        data = os.read(fd, EVENT.size * 64)
        for i in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _, _, etype, code, value = EVENT.unpack_from(data, i)
            if etype != EV_KEY or code != KEY_POWER:
                continue
            if value == 1 and pressed_at is None:  # down (2 = auto-repeat, ignored)
                pressed_at = time.monotonic()
            elif value == 0 and pressed_at is not None:  # up before the hold time: a short press
                pressed_at = None
                ask_max()


if __name__ == '__main__':
    main()
