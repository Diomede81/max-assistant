# Max box enclosure

A compact, 3D-printable home for Max: round 4″ face on the front, a sealed speaker below it, the
4-microphone array under a perforated top, and the Raspberry Pi 5 on the back wall.

**Outside size:** 142 mm wide × 120 mm deep × 226 mm tall.

| Assembled | Exploded | X-ray |
| --- | --- | --- |
| ![Assembled](img/assembled.png) | ![Exploded](img/exploded.png) | ![X-ray](img/xray.png) |

An interactive 3D view is in `viewer/index.html` (serve the `viewer` folder and open it). Its `models/` files are the STLs encoded as text; regenerate them after re-exporting with `for p in body front chamber screen_ring; do base64 -w0 stl/$p.stl > viewer/models/$p.stl.b64.txt; done`.

## Parts it is designed for

| Part | Product |
| --- | --- |
| Computer | Raspberry Pi 5 (8 GB) + Active Cooler, running from an official Raspberry Pi A2 microSD card (64 GB). The Raspberry Pi SSD Kit (M.2 HAT+) can be added later: there is room for it. |
| Screen | Waveshare 4inch DSI LCD (C), round 720×720 |
| Microphones / sound | ReSpeaker XVF3800 USB 4-mic array (its built-in 5 W amplifier drives the speaker) |
| Speaker | Visaton FRS 7, 4 Ω (2.5″ full-range) |
| Power | Raspberry Pi 27 W USB-C power supply |
| Buttons | 2 × 12 mm panel-mount momentary push buttons (normally open) with a 3-6 V light, e.g. sourcing map "Momentary Metal Push Button Switch Flat Head 12mm 1NO 3-6V Red LED": power on the back, mute on top. Not 12 V lights: the Pi can't light them |

## Printed parts

| File | What it is | Print orientation |
| --- | --- | --- |
| `stl/body.stl` | Back, sides, top (mic grille) and bottom, open at the front | On its back, open side up |
| `stl/front.stl` | Front panel: screen window, speaker grille, mounting tabs | Face down |
| `stl/chamber.stl` | Sealed speaker box (≈0.49 L) that screws to the back of the front panel by four ears on its sides | Back wall down |
| `stl/screen_ring.stl` | Clamp ring that holds the screen in its recess | Flat |

PLA or PETG, 0.2 mm layers, 3 walls, 20% infill. No supports needed. A matte filament looks best;
print the front panel in a contrasting colour if you like a two-tone look.

## Hardware

- 12 × M3 heat-set inserts: 4 in the front-panel side tabs, 4 for the screen ring, 4 for the speaker
  chamber
- 4 × M3 × 12 mm countersunk screws (side screws for the front panel), 4 × M3 × 10 mm (speaker chamber, through its ears)
  and 4 × M3 × 6 mm (screen ring)
- 11 × M2.5 × 6 mm self-tapping screws: 4 for the Pi, 3 for the mic board, 4 for the speaker (its
  bosses are pilot holes)
- Closed-cell EVA foam strip, single-sided adhesive, about 10 mm wide: **5 mm thick** for the ring
  between the mic board and the top (the gap is 4 mm, so it squashes and seals; keep the 4 mic holes
  clear), and **3 mm thick** for the speaker chamber gasket
- 4 × 10 mm rubber feet
- About 30 cm of speaker wire, a short right-angle USB-A to USB-C cable (mic board to Pi)
- For the buttons: 8 female-to-female jumper wires (15-20 cm; cut one end off each and solder it to a
  button tab, with heat-shrink), and a 2-pin header (2.54 mm) soldered to the Pi's power button
  pads (J2)

## Measure before printing

Some part sizes aren't published in a form I could check, so they were measured from the real parts
with calipers (in mm). If you use different parts, measure them the same way and change the values
marked `MEASURED` at the top of `max-box.scad`.

| Setting | How to measure | Value |
| --- | --- | --- |
| `screen_glass_d` | Screen face up: across the full glass, edge to edge, at a few angles; take the largest | **125.9 mm** (measured) |
| `screen_view_d` | Across the part that shows the picture, not the black border | **102.3 mm** (measured) |
| `screen_pcb` | Screen face down: the board behind the glass, long and short side, including the connector | **85.3 × 68.6 mm** (measured) |
| `screen_glass_t` | Calipers on the very edge of the glass, where it overhangs the board | **5.9 mm** (measured) |
| `screen_depth` | Screen face down: from the back of the glass to the highest point, including the ribbon socket | **16.8 mm** (measured) |
| `mic_board_d` | Across the mic board at its widest (say if it's square) | **100.2 mm** (measured) |
| `mic_stack` | Mic board plus the parts and speaker cable underneath it | **15.5 mm** (measured; board alone 7.8 mm) |
| `mic_tri` | The 3 mounting holes form a triangle: the two long sides and the short side, centre to centre. The hole between the two long sides faces the USB socket | **60.1, 60.1, 40.7 mm** (measured; holes 16.9 mm from the edge) |
| `spk_hole_sq` | Centre-to-centre between two side-by-side speaker holes (tip: left edge of one hole to left edge of the other) | **52.5 mm** (measured: 56.1 outer edge to outer edge) |
| `sd_z` | Pi held with the USB-C socket at the bottom: from that edge up to the middle of the microSD slot | **28 mm** (checked: 22.3 mm to the slot's edge; the access opening is 18 mm tall) |
| `pi_stack` | Pi with the fan fitted, flat on a table: from the underside of the board to the top of the fan | **19.7 mm** (measured); 30 mm allowed for the SSD kit |

Then re-export the parts (below). Printing just the front panel's screen area as a test ring first is
a cheap way to check the screen fit.

## Test prints first

Two small pieces prove the critical fits for a few grams of filament before the big parts:

| Part | What it proves | Print |
| --- | --- | --- |
| `screen_test` | The screen fits its recess and window, and the ring clamps it with its 4 screws | Face down |
| `fit_test` | The front 24 mm of the body: the front panel slides in and the side screws line up | Cut face down |

Export them like the other parts (`-D 'part="screen_test"'`, `-D 'part="fit_test"'`).

## Re-exporting the parts

Install [OpenSCAD](https://openscad.org), then from this folder:

```bash
for p in body front chamber screen_ring; do openscad -D "part=\"$p\"" -o stl/$p.stl max-box.scad; done
python3 stl2bin.py stl/*.stl      # optional: binary STL, about 5x smaller
```

`-D 'part="assembly"'` shows an exploded preview with stand-ins for the electronics. The body and
front panel take a few minutes each to compute because of the grille holes.

## Assembly

1. **Inserts:** press the heat-set inserts into the front panel's side tabs, the four screen-ring
   bosses and the four chamber bosses.
2. **Screen:** lay the screen face down into its recess in the front panel and fix the screen ring over
   it (4 × M3). Connect the ribbon cable to the screen first: on a Pi 5 use the
   one with one narrow and one wide end (wide end into the screen).
3. **Speaker:** screw the speaker to the back of the front panel behind the grille and connect the
   wire. Stick the 3 mm foam gasket around the chamber's open edge, pass the wire out through the
   small hole in the chamber's back, and press the chamber over the speaker. Fix it from behind with
   4 × M3 × 10 mm screws through the ears on its sides (the screwdriver goes in alongside the
   chamber). Seal the wire hole with hot glue: the box must be airtight to sound full.
4. **Pi:** fit the Active Cooler (and the SSD kit, if you have one) and insert the microSD card, then
   screw the Pi to the four posts on the back wall (USB-C power socket facing down). The card can later
   be swapped through the slot in the left side, using a fingernail or tweezers, without opening the box.
5. **Buttons:** fit the mute button through the hole in the top (front right) and the power button
   through the hole in the back, and tighten their nuts from inside.
   Each button has 4 tabs: two for the switch (often marked C and NO) and two for the light (+ and -).

   | Button | Tab | Goes to |
   | --- | --- | --- |
   | Power | switch (both) | the 2-pin header on the Pi 5's J2 pads (either way round) |
   | Power | light + | pin 1 (3.3 V) |
   | Power | light - | pin 6 (ground) |
   | Mute | switch | pin 11 (GPIO 17) and pin 9 (ground), either way round |
   | Mute | light + | pin 13 (GPIO 27) |
   | Mute | light - | pin 14 (ground) |

   - **Power** works like the Pi's own button (see "Adding your own power button" in the Raspberry
     Pi 5 documentation): press to turn on, press to turn off safely, hold to force off. Its light is
     on while the box is on.
   - **Mute:** each press turns the microphone off or back on. While it is off, the button's light
     is on and the face shows "Microphone off".
6. **Mic board:** stick the foam ring to the top of the board, then screw the board to the three posts
   under the top grille (the hole at the point of the triangle, by the USB socket, faces the back). Connect it to the Pi with the right-angle USB cable, and connect the speaker
   wire to the board's speaker socket.
7. **Close:** plug the screen ribbon's narrow end into the Pi's `CAM/DISP 1` connector
   (or `0`: the setup script asks which), slide the front panel in, and fix
   it with the four side screws. Route the USB-C power cable through the notch at the back.

## Design notes

- **Sound:** the speaker sits in its own sealed 0.49 L chamber. Sealed is what gives a small driver
  fuller, tighter sound; a driver loose inside a case sounds thin and boxy.
- **Microphones:** the mic board is foam-sealed to the perforated top and kept away from the speaker
  chamber, so the speaker's vibration and sound reach the mics as little as possible. The XVF3800's
  echo cancellation handles the rest, so "Hey Max" works while he talks or plays music.
- **Cooling:** air comes in through the slots in the base (rear half) and leaves through the slots in
  the back, past the Pi's cooler.
