// Max box - enclosure for Max the home assistant (Raspberry Pi 5 + round 4" screen +
// ReSpeaker XVF3800 mic array + Visaton FRS 7 speaker). Parametric OpenSCAD model.
//
// Render one part at a time:  openscad -D 'part="body"' -o body.stl max-box.scad
// Parts: "body", "front", "chamber", "screen_ring", "assembly" (preview with stand-in parts)
//
// IMPORTANT: values marked "MEASURE" are best estimates until measured from the real parts;
// "MEASURED" values come from the parts themselves (see README.md).

part = "assembly";

/* ---------------- Overall shape ---------------- */
W = 142;          // width  (X): the 126 mm screen glass needs this to clear the rounded edges
H = 226;          // height (Z)
D = 120;          // depth  (Y, front face at Y=0)
R = 12;           // edge rounding radius
wall = 2.6;       // shell wall thickness
front_t = 4;      // front panel thickness

/* ---------------- Round screen (Waveshare 4inch DSI LCD (C), 720x720) ---------------- */
screen_glass_d = 126;   // DATASHEET (measured 125.9): outer diameter of the glass/cover
screen_view_d  = 102.3; // MEASURED: visible (active) diameter
screen_pcb     = [85.3, 68.6]; // MEASURED: rectangular board behind the glass, incl. its connector
screen_body_d  = norm(screen_pcb); // board's diagonal: clears it whichever way round it sits
screen_glass_t = 6;     // DATASHEET (measured 5.9): glass thickness (sits in a recess in the front panel)
screen_depth   = 16.8;  // MEASURED: module depth behind the glass (datasheet 11; clearance only)
screen_cz      = H - 77; // centre height of the screen
screen_boss_a  = [35, 145, 215, 325]; // screen ring screw angles (clear of the side tabs and mic board)
screen_boss_r  = screen_glass_d/2 + 6;
screen_boss_h  = 7;     // from the back of the front panel; the ring sits on top of these
lip            = 1.4;   // front lip that holds the glass

/* ---------------- Speaker (Visaton FRS 7, 4 ohm) ---------------- */
spk_frame     = 66.5;   // CONFIRMED: square frame size fits
spk_cutout_d  = 61;     // baffle cutout (datasheet: 60)
spk_pilot     = 2.6;    // M3 self-tapping screws: their heads can't pull through the frame's 4.5 mm slots
spk_hole_sq   = 53;     // DATASHEET (measured 52.5; the holes are 4.5 x 6 slots): square spacing of the 4 mounting holes
spk_depth     = 32;     // mounting depth
spk_seat      = spk_frame + 1; // flat seat on the front panel's back for the whole frame
spk_cz        = 46;     // centre height of the speaker
grille_hole   = 3.0;    // grille hole size
grille_pitch  = 4.4;

/* ---------------- Speaker chamber (sealed, ~0.48 L) ---------------- */
ch_wall = 2.4;
tab_w   = 9;            // side tabs that hold the front panel (chamber must clear them)
// The body's mouth is narrowed by its rounded edges: everything on the front unit stays inside it,
// so the unit slides straight in. Bosses on the body's side walls bridge the gap to the tabs.
tab_in  = R - sqrt(pow(R - wall, 2) - pow(R - front_t, 2)) + 0.4;
ch_w    = W - 2*(tab_in + tab_w) - 2; // clear of the front panel's side tabs
ch_gasket = 1.5;        // compressed foam between the chamber's open edge and the front panel
ch_y0   = front_t + ch_gasket;
ch_ear  = 9;            // screw ears on the chamber's sides (screwed from behind)
ch_ear_z = [40, 72];
ch_z0   = wall + 6;     // bottom of chamber (clears the body's rounded bottom-front edge as it slides in)
ch_z1   = screen_cz - screen_glass_d/2 - 3; // top of chamber (below the screen glass and ring)
ch_d    = 70;           // outer depth (clear of the Pi behind it)

/* ---------------- Raspberry Pi 5 (+ SSD HAT+ and Active Cooler) ---------------- */
pi_l = 85; pi_w = 56;
pi_holes = [[3.5,3.5],[61.5,3.5],[3.5,52.5],[61.5,52.5]]; // board coords (mm)
pi_standoff = 8;        // gap between back wall and board
pi_x0 = wall + 3;       // board left edge (microSD end): close to the wall so the card is reachable
pi_z0 = 40;             // board bottom edge (USB-C power edge faces down)
pi_stack = 30;          // board + Active Cooler (19.7 mm, measured) + room for the optional SSD HAT
sd_z = 28;              // MEASURED (22.3 mm to the slot's edge): microSD slot centre from the board's bottom (USB-C) edge
sd_slot = [9, 18];      // side access slot (depth Y, height Z)

/* ---------------- Mic board (ReSpeaker XVF3800 USB 4-mic array) ---------------- */
mic_board_d = 100.2;    // MEASURED: board diameter
mic_stack   = 15.5;     // MEASURED: board plus parts and speaker cable underneath (7.8 mm board alone)
mic_cy      = D/2 + 5;  // board moved back so the parts underneath clear the screen and its ring
// 3 mounting holes in a triangle, measured 60.1, 60.1 and 40.7 mm apart, all on one circle round the
// board's centre. The hole between the two long sides faces the USB socket on the board's edge, which
// points to the right-hand side (0 degrees): the only side with room for the plug (~18 mm).
mic_tri     = [60.1, 40.7]; // MEASURED: long sides, short side
mic_post_r  = mic_tri[0]^2 / sqrt(4*mic_tri[0]^2 - mic_tri[1]^2); // circle through the 3 holes (~31.9)
mic_post_angles = [0, 2*asin(mic_tri[0]/2/mic_post_r), -2*asin(mic_tri[0]/2/mic_post_r)];
mic_gap     = 4;        // board-to-top gap (fill with a foam ring to seal the mics)
mic_hole_d  = 1.6;      // top perforation
mic_area_d  = 92;

/* ---------------- Buttons (12 mm panel-mount momentary push buttons) ---------------- */
btn_d     = 12.2;           // hole for a 12 mm button (use 16.2 for 16 mm buttons)
btn_body  = [16, 30];       // nut size and depth behind the wall (buttons with a light are longer)
mute_btn  = [W - 26, 23];   // mute: on top, front right corner (X, Y), on the flat and clear of the mic board
power_btn = [W/2, 130];     // power: on the back (X, Z), above the Pi and its cables

/* ---------------- Fasteners ---------------- */
insert_d = 4.2;         // M3 heat-set insert hole
insert_l = 6;
m3 = 3.4;               // M3 clearance
m25_pilot = 2.2;        // M2.5 self-tapping pilot

$fn = 72;
cx = W/2;
cy = D/2;

/* ================= helpers ================= */
module rounded_box(w, d, h, r) {
  hull() for (x = [r, w-r], y = [r, d-r], z = [r, h-r]) translate([x, y, z]) sphere(r);
}

module outer() { rounded_box(W, D, H, R); }
module inner() { translate([wall, wall, wall]) rounded_box(W - 2*wall, D - 2*wall, H - 2*wall, max(R - wall, 1)); }

// Side tabs on the front panel: Z positions; screws go through the body's side walls.
tab_z = [ch_z0 + 14, H - 24];
tab_y = front_t + 8;     // screw axis (Y)

/* ================= BODY ================= */
module body() {
  difference() {
    union() {
      difference() { outer(); inner(); }
      // Pi standoffs on the back wall
      for (h = pi_holes) translate([pi_x0 + h[0], D - wall - pi_standoff, pi_z0 + h[1]])
        rotate([-90, 0, 0]) cylinder(d = 6.5, h = pi_standoff + 0.5);
      // side screw bosses: the screws pass through these into the front panel's tabs
      for (s = [0, 1], z = tab_z) translate([s ? W - tab_in + 0.3 : wall - 0.5, tab_y, z]) rotate([0, 90, 0])
        cylinder(d = 9, h = tab_in - 0.3 - wall + 0.5);
      // Mic posts hanging from the top
      for (a = mic_post_angles) translate([cx + mic_post_r*cos(a), mic_cy + mic_post_r*sin(a), H - wall - mic_gap])
        cylinder(d = 6, h = mic_gap + 0.5);
    }
    // open front
    translate([-1, -1, -1]) cube([W + 2, front_t + 1, H + 2]);
    // Pi screw pilots
    for (h = pi_holes) translate([pi_x0 + h[0], D - wall - pi_standoff - 1, pi_z0 + h[1]])
      rotate([-90, 0, 0]) cylinder(d = m25_pilot, h = pi_standoff);
    // mic post pilots
    for (a = mic_post_angles) translate([cx + mic_post_r*cos(a), mic_cy + mic_post_r*sin(a), H - wall - mic_gap - 1])
      cylinder(d = m25_pilot, h = mic_gap);
    // top perforation over the mic board (hex pattern)
    intersection() {
      translate([cx, mic_cy, H - wall - 1]) cylinder(d = mic_area_d, h = wall + 2);
      for (i = [-12:12], j = [-12:12]) translate([cx + i*4 + (j % 2)*2, mic_cy + j*3.46, H - wall - 1])
        cylinder(d = mic_hole_d, h = wall + 2, $fn = 12);
    }
    // side screws into the front panel tabs (countersunk outside)
    for (s = [0, 1], z = tab_z) translate([s ? W + 1 : -1, tab_y, z]) rotate([0, s ? -90 : 90, 0]) {
      cylinder(d = m3, h = tab_in + 1);
      cylinder(d1 = 6.4, d2 = m3, h = 1.6);
    }
    // rear vents (exhaust, behind the Pi cooler)
    for (i = [0:8]) translate([pi_x0 + 10 + i*8, D - wall - 1, pi_z0 + 8]) hull() {
      rotate([-90, 0, 0]) cylinder(d = 3.2, h = wall + 2, $fn = 16);
      translate([0, 0, 40]) rotate([-90, 0, 0]) cylinder(d = 3.2, h = wall + 2, $fn = 16);
    }
    // bottom vents (intake, rear half)
    for (i = [0:9]) translate([20 + i*10, D - 50, -1]) hull() {
      cylinder(d = 3.2, h = wall + 2, $fn = 16);
      translate([0, 30, 0]) cylinder(d = 3.2, h = wall + 2, $fn = 16);
    }
    // microSD access slot in the left side wall (card sits under the board, at its left end)
    translate([-1, D - wall - pi_standoff + 1.5 - sd_slot[0]/2, pi_z0 + sd_z]) rotate([0, 90, 0])
      hull() for (dz = [-1, 1]) translate([dz*(sd_slot[1] - sd_slot[0])/2, 0, 0]) translate([0, sd_slot[0]/2, 0]) cylinder(d = sd_slot[0], h = wall + 2, $fn = 32);
    // buttons: mute on top, power on the back
    translate([mute_btn[0], mute_btn[1], H - wall - 1]) cylinder(d = btn_d, h = wall + 2);
    translate([power_btn[0], D - wall - 1, power_btn[1]]) rotate([-90, 0, 0]) cylinder(d = btn_d, h = wall + 2);
    // power cable notch at the bottom of the back wall (USB-C from the Pi goes down and out). Wide enough
    // to sit under the Pi's USB-C socket wherever it is along that edge; starts behind the rear feet.
    translate([pi_x0 + 4, D - wall - 6, -1]) cube([36, wall + 8, 9]);
    // rubber feet recesses
    for (x = [16, W - 16], y = [16, D - 16]) translate([x, y, -0.01]) cylinder(d = 10.5, h = 1);
  }
}

/* ================= FRONT PANEL ================= */
module front_panel() {
  difference() {
    union() {
      intersection() { outer(); translate([-1, -1, -1]) cube([W + 2, front_t + 1, H + 2]); }
      // everything behind the panel is trimmed to fit inside the body's rounded front edges
      intersection() {
        translate([wall + 0.3, wall + 0.3, wall + 0.3]) rounded_box(W - 2*wall - 0.6, D - 2*wall - 0.6, H - 2*wall - 0.6, max(R - wall - 0.3, 1));
        union() {
          // side tabs with heat-set insert bosses (screws come in through the body sides)
          for (s = [0, 1], z = tab_z) translate([s ? W - tab_in - tab_w : tab_in, front_t - 0.5, z - 7])
            cube([tab_w, 13, 14]);
          // screen ring bosses
          for (a = screen_boss_a) translate([cx + screen_boss_r*cos(a), front_t - 0.5, screen_cz + screen_boss_r*sin(a)])
            rotate([-90, 0, 0]) cylinder(d = 8, h = screen_boss_h);
          // speaker seat: a flat square the whole frame sits on, so no air leaks round the speaker
          // from its front into the chamber (that would cancel the bass); its screws go into it
          translate([cx - spk_seat/2, front_t - 0.5, spk_cz - spk_seat/2]) cube([spk_seat, 5, spk_seat]);
          // chamber flange bosses
          for (p = chamber_bosses()) translate([p[0], front_t - 0.5, p[1]]) rotate([-90, 0, 0]) cylinder(d = 8, h = ch_boss_top - front_t + 0.5);
        }
      }
    }
    // screen: visible window + recess for the glass from behind
    translate([cx, -1, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_view_d, h = front_t + 2, $fn = 180);
    translate([cx, lip, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_glass_d + 1.2, h = front_t, $fn = 180);
    // speaker opening through the seat, and the grille (hex holes in a thinned area)
    translate([cx, front_t - 1, spk_cz]) rotate([-90, 0, 0]) cylinder(d = spk_cutout_d + 1, h = 7, $fn = 120);
    translate([cx, 1.6, spk_cz]) rotate([-90, 0, 0]) cylinder(d = spk_cutout_d + 3, h = front_t, $fn = 120);
    intersection() {
      translate([cx, -1, spk_cz]) rotate([-90, 0, 0]) cylinder(d = spk_cutout_d - 1, h = 4, $fn = 120);
      for (i = [-9:9], j = [-9:9]) translate([cx + i*grille_pitch + (j % 2)*grille_pitch/2, -1, spk_cz + j*grille_pitch*0.866])
        rotate([-90, 0, 0]) cylinder(d = grille_hole, h = 4, $fn = 6);
    }
    // insert holes
    for (s = [0, 1], z = tab_z) translate([s ? W - tab_in - tab_w - 1 : tab_in - 1, tab_y, z]) rotate([0, 90, 0])
      cylinder(d = insert_d, h = tab_w + 2);
    for (a = screen_boss_a) translate([cx + screen_boss_r*cos(a), front_t, screen_cz + screen_boss_r*sin(a)])
      rotate([-90, 0, 0]) cylinder(d = insert_d, h = insert_l + 2);
    for (dx = [-1, 1], dz = [-1, 1]) translate([cx + dx*spk_hole_sq/2, front_t - 1, spk_cz + dz*spk_hole_sq/2])
      rotate([-90, 0, 0]) cylinder(d = spk_pilot, h = 6);
    for (p = chamber_bosses()) translate([p[0], front_t, p[1]]) rotate([-90, 0, 0]) cylinder(d = insert_d, h = insert_l + 2);
  }
}

/* ================= SPEAKER CHAMBER (sealed box behind the grille) ================= */
// Ear screw positions (X, Z): outside the chamber's side walls, reached from behind with a screwdriver.
function chamber_bosses() = [for (sx = [-1, 1], z = ch_ear_z) [cx + sx*(ch_w/2 + ch_ear/2), z]];
ch_boss_top = ch_y0 + 4; // Y of the front panel's chamber boss tops: the ears sit on them

module chamber() {
  // Built in place: open face towards the front panel (foam gasket between), back wall at Y = ch_y0 + ch_d.
  difference() {
    union() {
      translate([cx - ch_w/2, ch_y0, ch_z0]) cube([ch_w, ch_d, ch_z1 - ch_z0]);
      // ears, with a 45 degree brace behind each so they print without supports (back wall down)
      for (p = chamber_bosses()) hull() {
        translate([p[0], ch_boss_top, p[1]]) rotate([-90, 0, 0]) cylinder(d = 10, h = 5);
        translate([p[0] < cx ? cx - ch_w/2 : cx + ch_w/2 - 1, ch_boss_top, p[1] - 5]) cube([1, 5 + ch_ear, 10]);
      }
    }
    translate([cx - ch_w/2 + ch_wall, ch_y0 - 1, ch_z0 + ch_wall]) cube([ch_w - 2*ch_wall, ch_d - ch_wall + 1, ch_z1 - ch_z0 - 2*ch_wall]);
    // speaker wire hole (seal with hot glue after wiring)
    translate([cx + ch_w/2 - 12, ch_y0 + ch_d - ch_wall - 1, ch_z1 - 12]) rotate([-90, 0, 0]) cylinder(d = 3.5, h = ch_wall + 2);
    // ear screws (M3 x 10 from behind) and room for the screw head and screwdriver
    for (p = chamber_bosses()) translate([p[0], ch_boss_top - 1, p[1]]) rotate([-90, 0, 0]) {
      cylinder(d = m3, h = 7);
      translate([0, 0, 6]) cylinder(d = 6.5, h = 30);
    }
  }
}

function chamber_volume_l() = ((ch_w - 2*ch_wall) * (ch_d - ch_wall + ch_gasket) * (ch_z1 - ch_z0 - 2*ch_wall)) / 1e6;

/* ================= SCREEN RETAINING RING ================= */
// The ring sits on the boss tops; a collar underneath reaches forward to the back of the glass.
ring_t = 3;
ring_seat = front_t - 0.5 + screen_boss_h;          // Y of the boss tops
ring_collar = ring_seat - (lip + screen_glass_t);   // gap from the back of the glass to the boss tops
assert(ring_collar >= 0, "screen glass is thicker than the ring bosses allow: raise screen_boss_h");

module screen_ring() {
  // Built glass side down: collar Z 0..ring_collar, plate above it.
  difference() {
    union() {
      cylinder(d = screen_glass_d - 1, h = ring_collar + 0.01, $fn = 180);
      translate([0, 0, ring_collar]) {
        cylinder(d = screen_glass_d, h = ring_t, $fn = 180); // no wider than the glass: slides past the body's mouth
        for (a = screen_boss_a) hull() {
          cylinder(d = screen_glass_d - 2, h = ring_t, $fn = 180);
          translate([screen_boss_r*cos(a), screen_boss_r*sin(a), 0]) cylinder(d = 10, h = ring_t);
        }
      }
    }
    translate([0, 0, -1]) cylinder(d = screen_body_d + 1, h = ring_collar + ring_t + 2, $fn = 180);
    for (a = screen_boss_a) translate([screen_boss_r*cos(a), screen_boss_r*sin(a), -1]) cylinder(d = m3, h = ring_collar + ring_t + 2);
  }
}

/* ================= ASSEMBLY PREVIEW ================= */
module stand_ins() {
  // screen
  color("#111") translate([cx, lip, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_glass_d, h = screen_glass_t, $fn = 180);
  color("#2a6") translate([cx - screen_pcb[0]/2, lip + screen_glass_t, screen_cz - screen_pcb[1]/2]) cube([screen_pcb[0], screen_depth, screen_pcb[1]]);
  // speaker
  color("#555") translate([cx - spk_frame/2, front_t + 4.5, spk_cz - spk_frame/2]) cube([spk_frame, 4, spk_frame]);
  color("#444") translate([cx, front_t + 8.5, spk_cz]) rotate([-90, 0, 0]) cylinder(d1 = 50, d2 = 30, h = spk_depth - 4);
  // Pi stack
  color("#0a5") translate([pi_x0, D - wall - pi_standoff - 1.6, pi_z0]) cube([pi_l, 1.6, pi_w]);
  color("#999") translate([pi_x0 + 5, D - wall - pi_standoff - pi_stack, pi_z0 + 3]) cube([pi_l - 10, pi_stack - 1.6, pi_w - 6]);
  // buttons
  color("#b33") translate([mute_btn[0], mute_btn[1], H - wall - btn_body[1]]) cylinder(d = btn_body[0], h = btn_body[1]);
  color("#b33") translate([power_btn[0], D - wall - btn_body[1], power_btn[1]]) rotate([-90, 0, 0]) cylinder(d = btn_body[0], h = btn_body[1]);
  // mic board
  color("#36c") translate([cx, mic_cy, H - wall - mic_gap - mic_stack]) cylinder(d = mic_board_d, h = mic_stack, $fn = 120);
}

if (part == "body") rotate([-90, 0, 0]) translate([0, -D, 0]) body();               // print on its back, open front up
else if (part == "front") rotate([90, 0, 0]) front_panel();                           // print face down
else if (part == "chamber") rotate([-90, 0, 0]) translate([0, -(ch_y0 + ch_d), 0]) chamber(); // back wall on the bed
// Test prints: cheap pieces that prove the critical fits before the big parts.
// "screen_test": the front panel's screen area, for the screen, its ring and screws (print face down).
// "fit_test": the front 24 mm of the body, for sliding the front panel in and the side screws.
else if (part == "screen_test") rotate([90, 0, 0]) intersection() {
  front_panel();
  translate([cx, -1, screen_cz]) rotate([-90, 0, 0]) cylinder(r = screen_boss_r + 6, h = 30, $fn = 180);
}
else if (part == "fit_test") rotate([-90, 0, 0]) translate([0, -24, 0]) intersection() {
  body();
  translate([-1, -1, -1]) cube([W + 2, 25, H + 2]);
}
else if (part == "screen_ring") translate([0, 0, ring_collar + ring_t]) rotate([180, 0, 0]) screen_ring(); // flat side down
else if (part == "assembly") {
  echo(str("Speaker chamber volume: ", chamber_volume_l(), " L"));
  color("#e8e4dc") body();
  color("#d8d2c6") translate([0, -25, 0]) front_panel();
  color("#c9c1b2", 0.9) translate([0, -25, 0]) chamber();
  translate([0, -25, 0]) stand_ins();
  color("#c9c1b2") translate([cx, -25 + lip + screen_glass_t, screen_cz]) rotate([-90, 0, 0]) screen_ring();
}
else if (part == "closed") {
  color("#e8e4dc") body();
  color("#d8d2c6") front_panel();
  color("#111") translate([cx, lip, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_glass_d, h = screen_glass_t, $fn = 180);
}
