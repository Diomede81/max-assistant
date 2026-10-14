#!/usr/bin/env python3
"""Creates the "max-invisible" mouse pointer theme: every pointer is fully transparent.

The face screen runs in "cage", which draws its own pointer arrow in the middle of the screen
until the pointer moves over the page (the page hides it from then on). With this theme as the
pointer theme (XCURSOR_THEME in max-face-kiosk.sh), there is never an arrow on Max's face.

    sudo python3 make-invisible-cursor.py [/usr/share/icons]
"""
import os
import struct
import sys

SIZE = 24
NAMES = ['default', 'left_ptr', 'arrow', 'pointer', 'hand1', 'hand2', 'text', 'xterm', 'ibeam',
         'wait', 'watch', 'progress', 'crosshair', 'grab', 'grabbing', 'move', 'not-allowed',
         'top_left_arrow', 'context-menu', 'help', 'question_arrow']


def xcursor(size):
    """One image of size x size transparent pixels in the Xcursor file format."""
    image_type = 0xFFFD0002
    header = struct.pack('<4sIII', b'Xcur', 16, 0x10000, 1)  # magic, header size, version, entries
    toc = struct.pack('<III', image_type, size, 16 + 12)      # type, nominal size, position
    image = struct.pack('<IIIIIIIII', 36, image_type, size, 1, size, size, 0, 0, 0)
    pixels = b'\x00\x00\x00\x00' * (size * size)              # ARGB, all transparent
    return header + toc + image + pixels


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/icons'
    theme = os.path.join(base, 'max-invisible')
    cursors = os.path.join(theme, 'cursors')
    os.makedirs(cursors, exist_ok=True)
    with open(os.path.join(theme, 'index.theme'), 'w') as f:
        f.write('[Icon Theme]\nName=max-invisible\nComment=Invisible pointer for the Max face screen\n')
    with open(os.path.join(cursors, 'default'), 'wb') as f:
        f.write(xcursor(SIZE))
    for name in NAMES[1:]:
        link = os.path.join(cursors, name)
        if os.path.lexists(link):
            os.remove(link)
        os.symlink('default', link)
    # Some versions of cage ignore XCURSOR_THEME and always load the theme called "default": a
    # separate pointer folder (XCURSOR_PATH in max-face-kiosk.sh) where "default" is this theme.
    # The system's own default pointer, used by everything else, is left alone.
    only = os.path.join(base, 'max-cursor')
    os.makedirs(only, exist_ok=True)
    link = os.path.join(only, 'default')
    if os.path.lexists(link):
        os.remove(link)
    os.symlink(theme, link)
    print(f'Invisible pointer theme: {theme} (also as "default" in {only})')


if __name__ == '__main__':
    main()
