# Max box: ordering the print

Everything needed to order the four printed parts from a print service, and the hardware to buy
alongside them.

## Files to upload

All four files are in `stl/`. Units are **millimetres**. Each file is already saved the right way up
for printing: tell the service to keep that orientation, which needs **no supports**.

| File | Part | Size (mm) | Print orientation |
| --- | --- | --- | --- |
| `body.stl` | Main shell: back, sides, top (mic grille), bottom | 142 × 226 × 116 | On its back, open front facing up |
| `front.stl` | Front panel: screen window, speaker grille, screw tabs | 136 × 220 × 16.5 | Face down |
| `chamber.stl` | Sealed speaker box, with 4 screw ears | 126 × 74 × 70 | Back wall down, open side up |
| `screen_ring.stl` | Clamp ring that holds the screen | 126 × 126 × 6.1 | Flat side down, raised collar up |

## Print settings

- **Material:** PLA (PETG also fine). Not resin: too brittle, and the heat-set inserts need a
  thermoplastic.
- **Layer height:** 0.2 mm
- **Walls / perimeters:** 3
- **Infill:** 20%
- **Supports:** none
- **Colour:** any; a matte finish looks best. The front panel can be a contrasting colour.

## Hardware to buy

**Screws and inserts**
- 12 × M3 heat-set inserts (≈5–6 mm long, for a 4.2 mm hole): 4 front-panel side tabs, 4 screen-ring
  posts, 4 speaker-chamber posts
- 4 × M3 × 12 mm countersunk: side screws, body into front panel
- 4 × M3 × 10 mm: speaker chamber ears
- 4 × M3 × 6 mm: screen ring
- 4 × M3 × 8 mm self-tapping pan head: speaker
- 7 × M2.5 × 6 mm self-tapping: Pi (4), mic board (3)

**Cables and parts**
- Raspberry Pi 5 display cable, **200 mm** (22-pin to 15-pin): the screen's own 12 cm cable is too
  short to reach the Pi
- Right-angle USB-C to USB-A cable, short: mic board to Pi (the mic board's socket faces the right-hand side)
- 2 × 12 mm momentary push buttons with a **3–6 V** light (e.g. sourcing map "Momentary Metal Push
  Button Switch Flat Head 12mm 1NO 3-6V Red LED")
- 8 female-to-female jumper wires (some 30 cm, or extensions, for the mute button) and a 2-pin
  2.54 mm header for the Pi's J2 power button pads
- Closed-cell EVA foam strip, adhesive, ~10 mm wide: 5 mm thick (mic board seal) and 3 mm thick
  (speaker chamber gasket)
- 4 × 10 mm rubber feet; ~30 cm speaker wire; heat-shrink

## What was checked before ordering

The design was checked in OpenSCAD with every part modelled at its measured or datasheet size
(screen and speaker from the Waveshare and Visaton drawings, Pi from the Raspberry Pi 5 drawing,
mic board measured):

| Check | Result |
| --- | --- |
| Inside the front unit: chamber, speaker, screen, screen board (either way round), screen posts, ring | No overlaps |
| Parts that rest on each other (chamber ears on posts, speaker on its seat, ring on posts) | Touch only, no overlap |
| Front unit against the body, closed: walls, Pi with cooler and SSD room, mic board, both buttons | No overlaps |
| Front unit sliding in: at 40, 20, 10, 6, 4, 2 mm out and closed | Nothing catches |
| Mic board's USB plug against the walls, Pi and mute button | Clear |
| Every screw can be reached in the assembly order (README) | Yes |
| Every STL file is a closed, correctly oriented solid of the expected size | Yes |

Estimates (not measured from the parts): the screen's 4 back posts were measured from the Waveshare
drawing (~75.6 mm apart, ~8.5 mm across, ~5 mm tall); the ring's holes for them allow ~2 mm all round.
