// Max box - enclosure for Max the home assistant (Raspberry Pi 5 + round 4" screen +
// ReSpeaker XVF3800 mic array + Visaton FRS 7 speaker). Parametric OpenSCAD model.
//
// Render one part at a time:  openscad -D 'part="body"' -o body.stl max-box.scad
// Parts: "body", "front", "chamber", "screen_ring", "assembly" (preview with stand-in parts)
//
// IMPORTANT: the screen and mic board sizes below are best estimates. Measure your parts
// when they arrive and adjust the "MEASURE" values before printing (see README.md).

part = "assembly";

/* ---------------- Overall shape ---------------- */
W = 136;          // width  (X)
H = 218;          // height (Z)
D = 120;          // depth  (Y, front face at Y=0)
R = 12;           // edge rounding radius
wall = 2.6;       // shell wall thickness
front_t = 4;      // front panel thickness

/* ---------------- Round screen (Waveshare 4inch DSI LCD (C), 720x720) ---------------- */
screen_glass_d = 108;   // MEASURE: outer diameter of the glass/cover
screen_view_d  = 101.5; // MEASURE: visible (active) diameter
screen_body_d  = 100;   // MEASURE: largest diameter of the module behind the glass (PCB/frame)
screen_glass_t = 2.4;   // MEASURE: glass thickness (sits in a recess in the front panel)
screen_depth   = 12;    // MEASURE: module depth behind the glass (for clearance only)
screen_cz      = H - 80; // centre height of the screen
lip            = 1.4;   // front lip that holds the glass

/* ---------------- Speaker (Visaton FRS 7, 4 ohm) ---------------- */
spk_frame     = 66.5;   // square frame size
spk_cutout_d  = 61;     // baffle cutout (datasheet)
spk_hole_sq   = 56;     // MEASURE: square spacing of the 4 mounting holes
spk_depth     = 32;     // mounting depth
spk_cz        = 46;     // centre height of the speaker
grille_hole   = 3.0;    // grille hole size
grille_pitch  = 4.4;

/* ---------------- Speaker chamber (sealed, ~0.45 L) ---------------- */
ch_wall = 2.4;
tab_w   = 9;            // side tabs that hold the front panel (chamber must clear them)
ch_w    = W - 2*wall - 2*tab_w - 3;
ch_z0   = wall + 2;     // bottom of chamber
ch_z1   = screen_cz - screen_body_d/2 - 4; // top of chamber (below the screen module)
ch_d    = 58;           // outer depth behind the front panel

/* ---------------- Raspberry Pi 5 (+ SSD HAT+ and Active Cooler) ---------------- */
pi_l = 85; pi_w = 56;
pi_holes = [[3.5,3.5],[61.5,3.5],[3.5,52.5],[61.5,52.5]]; // board coords (mm)
pi_standoff = 8;        // gap between back wall and board
pi_x0 = wall + 3;       // board left edge (microSD end): close to the wall so the card is reachable
pi_z0 = 40;             // board bottom edge (USB-C power edge faces down)
pi_stack = 30;          // board + cooler (+ optional SSD HAT) height, for clearance
sd_z = 28;              // MEASURE: microSD slot centre from the board's bottom (USB-C) edge
sd_slot = [9, 18];      // side access slot (depth Y, height Z)

/* ---------------- Mic board (ReSpeaker XVF3800 USB 4-mic array) ---------------- */
mic_board_d = 100;      // MEASURE: board diameter (or width if square)
mic_post_r  = 44;       // MEASURE: radius of the board's mounting holes from its centre
mic_post_angles = [45, 135, 225, 315]; // MEASURE: hole angles
mic_gap     = 4;        // board-to-top gap (fill with a foam ring to seal the mics)
mic_hole_d  = 1.6;      // top perforation
mic_area_d  = 92;

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
tab_z = [ch_z0 + 14, H - 40];
tab_y = front_t + 8;     // screw axis (Y)

/* ================= BODY ================= */
module body() {
  difference() {
    union() {
      difference() { outer(); inner(); }
      // Pi standoffs on the back wall
      for (h = pi_holes) translate([pi_x0 + h[0], D - wall - pi_standoff, pi_z0 + h[1]])
        rotate([-90, 0, 0]) cylinder(d = 6.5, h = pi_standoff + 0.5);
      // Mic posts hanging from the top
      for (a = mic_post_angles) translate([cx + mic_post_r*cos(a), cy + mic_post_r*sin(a), H - wall - mic_gap])
        cylinder(d = 6, h = mic_gap + 0.5);
    }
    // open front
    translate([-1, -1, -1]) cube([W + 2, front_t + 1, H + 2]);
    // Pi screw pilots
    for (h = pi_holes) translate([pi_x0 + h[0], D - wall - pi_standoff - 1, pi_z0 + h[1]])
      rotate([-90, 0, 0]) cylinder(d = m25_pilot, h = pi_standoff);
    // mic post pilots
    for (a = mic_post_angles) translate([cx + mic_post_r*cos(a), cy + mic_post_r*sin(a), H - wall - mic_gap - 1])
      cylinder(d = m25_pilot, h = mic_gap);
    // top perforation over the mic board (hex pattern)
    intersection() {
      translate([cx, cy, H - wall - 1]) cylinder(d = mic_area_d, h = wall + 2);
      for (i = [-12:12], j = [-12:12]) translate([cx + i*4 + (j % 2)*2, cy + j*3.46, H - wall - 1])
        cylinder(d = mic_hole_d, h = wall + 2, $fn = 12);
    }
    // side screws into the front panel tabs (countersunk outside)
    for (s = [0, 1], z = tab_z) translate([s ? W + 1 : -1, tab_y, z]) rotate([0, s ? -90 : 90, 0]) {
      cylinder(d = m3, h = wall + 2);
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
    // power cable notch at the bottom of the back wall (USB-C from the Pi goes down and out)
    translate([pi_x0 + 20, D - wall - 10, -1]) cube([14, wall + 12, 9]);
    // rubber feet recesses
    for (x = [16, W - 16], y = [16, D - 16]) translate([x, y, -0.01]) cylinder(d = 10.5, h = 1);
  }
}

/* ================= FRONT PANEL ================= */
module front_panel() {
  difference() {
    union() {
      intersection() { outer(); translate([-1, -1, -1]) cube([W + 2, front_t + 1, H + 2]); }
      // side tabs with heat-set insert bosses (screws come in through the body sides)
      for (s = [0, 1], z = tab_z) translate([s ? W - wall - tab_w - 0.3 : wall + 0.3, front_t - 0.5, z - 7])
        cube([tab_w, 15, 14]);
      // screen ring bosses
      for (a = [90, 210, 330]) translate([cx + (screen_glass_d/2 + 6)*cos(a), front_t - 0.5, screen_cz + (screen_glass_d/2 + 6)*sin(a)])
        rotate([-90, 0, 0]) cylinder(d = 8, h = 7);
      // speaker screw bosses
      for (dx = [-1, 1], dz = [-1, 1]) translate([cx + dx*spk_hole_sq/2, front_t - 0.5, spk_cz + dz*spk_hole_sq/2])
        rotate([-90, 0, 0]) cylinder(d = 7, h = 5);
      // chamber flange bosses
      for (p = chamber_bosses()) translate([p[0], front_t - 0.5, p[1]]) rotate([-90, 0, 0]) cylinder(d = 8, h = 6);
    }
    // screen: visible window + recess for the glass from behind
    translate([cx, -1, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_view_d, h = front_t + 2, $fn = 180);
    translate([cx, lip, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_glass_d + 0.8, h = front_t, $fn = 180);
    // speaker grille (hex holes in a thinned area)
    translate([cx, 1.6, spk_cz]) rotate([-90, 0, 0]) cylinder(d = spk_cutout_d + 3, h = front_t, $fn = 120);
    intersection() {
      translate([cx, -1, spk_cz]) rotate([-90, 0, 0]) cylinder(d = spk_cutout_d - 1, h = 4, $fn = 120);
      for (i = [-9:9], j = [-9:9]) translate([cx + i*grille_pitch + (j % 2)*grille_pitch/2, -1, spk_cz + j*grille_pitch*0.866])
        rotate([-90, 0, 0]) cylinder(d = grille_hole, h = 4, $fn = 6);
    }
    // insert holes
    for (s = [0, 1], z = tab_z) translate([s ? W - wall - tab_w - 1 : wall - 1, tab_y, z]) rotate([0, 90, 0])
      cylinder(d = insert_d, h = tab_w + 2.6);
    for (a = [90, 210, 330]) translate([cx + (screen_glass_d/2 + 6)*cos(a), front_t, screen_cz + (screen_glass_d/2 + 6)*sin(a)])
      rotate([-90, 0, 0]) cylinder(d = insert_d, h = insert_l + 2);
    for (dx = [-1, 1], dz = [-1, 1]) translate([cx + dx*spk_hole_sq/2, front_t - 1, spk_cz + dz*spk_hole_sq/2])
      rotate([-90, 0, 0]) cylinder(d = m25_pilot, h = 6);
    for (p = chamber_bosses()) translate([p[0], front_t, p[1]]) rotate([-90, 0, 0]) cylinder(d = insert_d, h = insert_l + 2);
  }
}

/* ================= SPEAKER CHAMBER (sealed box behind the grille) ================= */
function chamber_bosses() = [[cx - ch_w/2 + 6, ch_z0 + 6], [cx + ch_w/2 - 6, ch_z0 + 6], [cx - ch_w/2 + 6, ch_z1 - 6], [cx + ch_w/2 - 6, ch_z1 - 6]];

module chamber() {
  // Built in place: open face towards the front panel (Y = front_t), back wall at Y = front_t + ch_d.
  difference() {
    translate([cx - ch_w/2, front_t, ch_z0]) cube([ch_w, ch_d, ch_z1 - ch_z0]);
    translate([cx - ch_w/2 + ch_wall, front_t - 1, ch_z0 + ch_wall]) cube([ch_w - 2*ch_wall, ch_d - ch_wall + 1, ch_z1 - ch_z0 - 2*ch_wall]);
    // speaker wire hole (seal with hot glue after wiring)
    translate([cx + ch_w/2 - 12, front_t + ch_d - ch_wall - 1, ch_z1 - 12]) rotate([-90, 0, 0]) cylinder(d = 3.5, h = ch_wall + 2);
  }
  // corner blocks with screw holes into the front panel's inserts
  difference() {
    for (p = chamber_bosses()) translate([p[0] - 6, front_t, p[1] - 6]) cube([12, 8, 12]);
    for (p = chamber_bosses()) translate([p[0], front_t - 1, p[1]]) rotate([-90, 0, 0]) {
      cylinder(d = m3, h = 10);
      translate([0, 0, 6]) cylinder(d = 6.2, h = 4);
    }
  }
}

function chamber_volume_l() = ((ch_w - 2*ch_wall) * (ch_d - ch_wall) * (ch_z1 - ch_z0 - 2*ch_wall)) / 1e6;

/* ================= SCREEN RETAINING RING ================= */
module screen_ring() {
  ring_od = screen_glass_d + 20;
  difference() {
    union() {
      cylinder(d = screen_glass_d + 4, h = 3, $fn = 180);
      for (a = [90, 210, 330]) hull() {
        cylinder(d = screen_glass_d - 2, h = 3, $fn = 180);
        translate([(screen_glass_d/2 + 6)*cos(a), (screen_glass_d/2 + 6)*sin(a), 0]) cylinder(d = 10, h = 3);
      }
    }
    translate([0, 0, -1]) cylinder(d = screen_body_d + 1, h = 5, $fn = 180);
    for (a = [90, 210, 330]) translate([(screen_glass_d/2 + 6)*cos(a), (screen_glass_d/2 + 6)*sin(a), -1]) cylinder(d = m3, h = 5);
  }
  echo(str("screen ring outer size ~", ring_od, " mm"));
}

/* ================= ASSEMBLY PREVIEW ================= */
module stand_ins() {
  // screen
  color("#111") translate([cx, lip, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_glass_d, h = screen_glass_t, $fn = 180);
  color("#2a6") translate([cx, lip + screen_glass_t, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_body_d, h = screen_depth, $fn = 120);
  // speaker
  color("#555") translate([cx - spk_frame/2, front_t, spk_cz - spk_frame/2]) cube([spk_frame, 4, spk_frame]);
  color("#444") translate([cx, front_t + 4, spk_cz]) rotate([-90, 0, 0]) cylinder(d1 = 50, d2 = 30, h = spk_depth - 4);
  // Pi stack
  color("#0a5") translate([pi_x0, D - wall - pi_standoff - 1.6, pi_z0]) cube([pi_l, 1.6, pi_w]);
  color("#999") translate([pi_x0 + 5, D - wall - pi_standoff - pi_stack, pi_z0 + 3]) cube([pi_l - 10, pi_stack - 1.6, pi_w - 6]);
  // mic board
  color("#36c") translate([cx, cy, H - wall - mic_gap - 1.6]) cylinder(d = mic_board_d, h = 1.6, $fn = 120);
}

if (part == "body") rotate([-90, 0, 0]) translate([0, -D, 0]) body();               // print on its back, open front up
else if (part == "front") rotate([90, 0, 0]) front_panel();                           // print face down
else if (part == "chamber") rotate([-90, 0, 0]) translate([0, -(front_t + ch_d), 0]) chamber(); // back wall on the bed
else if (part == "screen_ring") screen_ring();
else if (part == "assembly") {
  echo(str("Speaker chamber volume: ", chamber_volume_l(), " L"));
  color("#e8e4dc") body();
  color("#d8d2c6") translate([0, -25, 0]) front_panel();
  color("#c9c1b2", 0.9) translate([0, -25, 0]) chamber();
  translate([0, -25, 0]) stand_ins();
  color("#c9c1b2") translate([cx, -25 + lip + screen_glass_t + 0.5, screen_cz]) rotate([-90, 0, 0]) screen_ring();
}
else if (part == "closed") {
  color("#e8e4dc") body();
  color("#d8d2c6") front_panel();
  color("#111") translate([cx, lip, screen_cz]) rotate([-90, 0, 0]) cylinder(d = screen_glass_d, h = screen_glass_t, $fn = 180);
}
