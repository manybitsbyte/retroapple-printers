/*
 * examples.js - Worked examples: graphics in colour and mono, and custom fonts
 *
 * `jobs.js` prints one page per model to show that machine's own command set.
 * These are the other axis — one capability at a time, across the models that
 * have it, written to be read as much as run:
 *
 *   color-graphics   ImageWriter II · a bitmap through the four-band ribbon
 *   mono-graphics    Epson FX-80    · a bitmap through ESC/P bit-image
 *   citoh-font       ImageWriter II · downloaded glyphs, ESC I / ESC '
 *   epson-font       Epson FX-80    · downloaded glyphs, ESC & / ESC %
 *   hgr-memory       ImageWriter II · HGR and DHGR read out of video RAM
 *   lores-memory     ImageWriter II · LORES and DLORES read out of video RAM
 *
 * The first four start from an RGBA bitmap and hand it to `buildScreenDump*`,
 * which emits the bit-image protocol that machine's parser actually expects —
 * there is no "draw an image" call, only bytes.
 *
 * The last two start one step further back, at $2000 and $400, because that is
 * where a screen dump running on the machine itself starts. A //e assembles no
 * framebuffer, so a real dump program decodes the mode's own memory layout and
 * sends ESC codes with the pixel data of each 8-scanline band behind them. See
 * `apple-video.js`; that is the half the library does not ship, and the half a
 * host has to wire in.
 *
 * Written by
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *  Mike Daley <michael_daley@icloud.com>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import {
  buildScreenDumpColor,
  buildScreenDumpEpson,
} from "../../src/index.js";
import { bytes, ESC, CR, LF } from "./jobs.js";

const FF = 0x0c;
import {
  bank, hplot, dhplot, plot, dplot,
  hgrColumnBands, dhgrColumnBands, citohBandStream,
  loresColorStream, dloresColorStream,
} from "./apple-video.js";

const line = (...parts) => bytes(...parts, CR, LF);
const blank = () => bytes(CR, LF);

// ── Bitmaps ─────────────────────────────────────────────────────────────────

/** A blank RGBA canvas with a paper-white ground, plus a put/fill helper. */
function canvas(w, h) {
  const px = new Uint8Array(w * h * 4).fill(0xff);
  return {
    w, h, px,
    set(x, y, r, g, b) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const o = (y * w + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    },
    get(x, y) {
      const o = (y * w + x) * 4;
      return [px[o], px[o + 1], px[o + 2]];
    },
  };
}

/**
 * The Apple //e palette, which is what the colour dump is calibrated against.
 *
 * `buildScreenDumpColor` quantises to these anchors, not to pure RGB — it was
 * written to reproduce a //e screen. Feed it pure #FF00FF and the nearest
 * anchor is violet, not magenta, and the dump comes out a plausible-looking
 * shade wrong. Feed it these and every pixel resolves exactly.
 */
const IIE = {
  yellow:  [208, 221, 141],
  magenta: [255, 160, 208],
  cyan:    [20,  207, 253],
  orange:  [255, 106, 60 ],   // what yellow over magenta makes
  green:   [20,  245, 60 ],   // yellow over cyan
  violet:  [255, 68,  253],   // magenta over cyan
  black:   [0,   0,   0  ],   // all three
};

/**
 * Three overlapping discs — the ribbon's whole gamut on one page.
 *
 * The ImageWriter II ribbon has four physical bands: yellow, magenta, cyan and
 * black. It has no orange, green or violet band, and makes those by striking
 * the same dot on two passes. This image asks for all seven by geometry alone:
 * where two discs cross it names the colour those two bands overprint to, and
 * the dump has to work out that it needs two passes to get there.
 *
 * Regions are looked up rather than blended, because ink is not arithmetic —
 * yellow over cyan is a specific pigment result, not the product of two RGB
 * triples, and the //e anchors above are where the printer actually lands.
 *
 * The bare paper around the discs comes out with a faint cyan stipple. That is
 * not this image: `buildScreenDumpColor` dithers with a Bayer jog of up to −36
 * before quantising, which drops pure white to about 219 grey — nearer the //e
 * light-blue anchor than white — so 2 of every 16 white pixels ink. It never
 * showed on the screen dumps the routine was written for, whose ground is
 * black. The frame is kept tight to the discs for that reason.
 */
function subtractiveVenn(w = 240, h = 248) {
  const c = canvas(w, h);
  const r = 78;
  // Centres on an equilateral triangle of side r, which is the arrangement
  // where all seven regions exist and none swallows another.
  const cx = w / 2, cy = h / 2, k = r / Math.sqrt(3);
  const discs = [
    { x: cx,               y: cy - k        },  // bit 1 — yellow
    { x: cx + k * 0.866,   y: cy + k * 0.5  },  // bit 2 — magenta
    { x: cx - k * 0.866,   y: cy + k * 0.5  },  // bit 4 — cyan
  ];
  // Index by membership mask: 1=Y, 2=M, 4=C.
  const REGION = [
    null,        IIE.yellow, IIE.magenta, IIE.orange,
    IIE.cyan,    IIE.green,  IIE.violet,  IIE.black,
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mask = 0;
      for (let i = 0; i < 3; i++) {
        const dx = x - discs[i].x, dy = y - discs[i].y;
        if (dx * dx + dy * dy <= r * r) mask |= 1 << i;
      }
      const ink = REGION[mask];
      if (ink) c.set(x, y, ink[0], ink[1], ink[2]);
    }
  }
  return c;
}

/**
 * A left-to-right greyscale ramp.
 *
 * The mono path has no dither at all — `buildMono` takes a hard 1-bit
 * threshold, so a smooth ramp comes out as one clean edge wherever the ramp
 * crosses that threshold. Printing the same ramp at three thresholds is
 * therefore the whole story of the mono knob: the edge moves, nothing else
 * changes. (Dithering only exists on the colour path, which needs it to reach
 * secondaries.)
 *
 * The width is 376 rather than a round 400 to dodge a live parser bug: ESC/P
 * sends the bit-image column count as two BINARY bytes, but `epson-fx80.js`
 * masks every incoming byte with 0x7F before dispatch, so a low count byte of
 * 128 or more loses exactly 128. At 400 columns the low byte is 144, the
 * printer reads 272, and the remaining 128 columns of image spill into the text
 * path as garbage characters. 376 keeps the low byte at 120. The C. Itoh models
 * send the same count as four ASCII digits and are unaffected.
 */
function greyRamp(w = 376, h = 32) {
  const c = canvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 255 - Math.round((x / (w - 1)) * 255);
      c.set(x, y, v, v, v);
    }
  }
  return c;
}

/**
 * Hard-edged geometry: a filled disc, a ring, diagonals and a fine checker.
 *
 * Where the ramp shows what one bit costs you, this shows what it buys — at the
 * head's own resolution a 1-bit shape is exact, with no dither noise along an
 * edge that was never grey in the first place.
 */
function shapes(w = 376, h = 96) {
  const c = canvas(w, h);
  const ink = (x, y) => c.set(x, y, 0, 0, 0);
  const cy = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Filled disc.
      let dx = x - 60, dy = y - cy;
      if (dx * dx + dy * dy <= 40 * 40) { ink(x, y); continue; }
      // Ring.
      dx = x - 160;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 40 * 40 && d2 >= 28 * 28) { ink(x, y); continue; }
      // Diagonal hatch.
      if (x >= 220 && x < 290 && ((x + y) % 8 < 2)) { ink(x, y); continue; }
      // One-pixel checker — the finest pattern the head can resolve.
      if (x >= 300 && x < 370 && ((x + y) & 1) === 0) ink(x, y);
    }
  }
  return c;
}

// ── Custom characters ───────────────────────────────────────────────────────

/**
 * Turn ASCII art into dot columns.
 *
 * Rows read top to bottom; any non-space is a lit dot. Both machines want one
 * byte per COLUMN, not per row, because the head fires a vertical slice of
 * wires at a time — so this transposes.
 *
 * The two families disagree on which end of the byte the top wire lives at:
 * C. Itoh puts it in bit 0, Epson in bit 7. Getting this backwards prints every
 * glyph upside down, which is the single easiest mistake to make here.
 */
function colsFromArt(rows, { msbTop = false } = {}) {
  const width = Math.max(...rows.map((r) => r.length));
  const out = [];
  for (let x = 0; x < width; x++) {
    let col = 0;
    for (let y = 0; y < rows.length && y < 8; y++) {
      if ((rows[y][x] ?? " ") !== " ") col |= 1 << (msbTop ? 7 - y : y);
    }
    out.push(col);
  }
  return out;
}

/** Eight columns, eight wires — the C. Itoh download cell. */
const GLYPHS_8 = {
  invader: [
    "  #  #  ",
    "   ##   ",
    "  ####  ",
    " ###### ",
    "########",
    "# #### #",
    "# #  # #",
    "  #  #  ",
  ],
  heart: [
    " ##  ## ",
    "########",
    "########",
    "########",
    " ###### ",
    "  ####  ",
    "   ##   ",
    "        ",
  ],
  apple: [
    "     #  ",
    "    ##  ",
    " ## ##  ",
    "########",
    "########",
    "########",
    " ###### ",
    "  #  #  ",
  ],
  arrow: [
    "   #    ",
    "   ##   ",
    "########",
    "########",
    "########",
    "   ##   ",
    "   #    ",
    "        ",
  ],
};

/** Eleven columns — the Epson ESC & download cell. */
const GLYPHS_11 = {
  invader: [
    "   #   #   ",
    "    # #    ",
    "   #####   ",
    "  ## # ##  ",
    " ######### ",
    " # ##### # ",
    " # #   # # ",
    "   ## ##   ",
  ],
  wave: [
    "           ",
    "  ##    ## ",
    " #  #  #  #",
    "#    ##    ",
    "           ",
    "  ##    ## ",
    " #  #  #  #",
    "#    ##    ",
  ],
  chip: [
    " # # # # # ",
    "###########",
    "#         #",
    "# ####### #",
    "# ####### #",
    "#         #",
    "###########",
    " # # # # # ",
  ],
};

/**
 * C. Itoh download: `ESC I`, then <key><width-code><columns…> per glyph, ended
 * with CTRL-D. The width code is a LETTER giving the column count — 'A'..'P'
 * for 1..16 columns with the data's bit 0 on the top wire, 'a'..'p' for the
 * same shifted one wire down. `ESC -` caps the cell at 8 columns and clears the
 * set; `ESC +` raises the cap to 16.
 */
function citohDownload(defs) {
  const out = [ESC, 0x2D, ESC, 0x49];              // ESC -  (8-col cell, clear), ESC I
  for (const [code, art] of defs) {
    const cols = colsFromArt(art);                 // bit 0 = top wire
    out.push(code, 0x40 + cols.length, ...cols);   // key, width code 'A'+n-1, data
  }
  out.push(0x04);                                  // CTRL-D — end of download
  return out;
}

/**
 * Epson download: `ESC & 0 <first> <last>`, then per character one attribute
 * byte followed by exactly 11 column bytes, top pin in bit 7. `ESC % 1 0`
 * switches the printer over to the RAM set; `ESC % 0 0` puts the ROM back.
 */
function epsonDownload(first, arts) {
  const out = [ESC, 0x26, 0x00, first, first + arts.length - 1];
  for (const art of arts) {
    const cols = colsFromArt(art, { msbTop: true });
    while (cols.length < 11) cols.push(0);
    out.push(0x8b, ...cols.slice(0, 11));          // attribute byte, then 11 columns
  }
  return out;
}

// ── The four jobs ───────────────────────────────────────────────────────────

/**
 * Auto-LF must be OFF for a colour dump, and that is a real constraint rather
 * than a quirk of this library.
 *
 * A colour band is printed by sweeping the same 8-dot strip once per ribbon
 * colour and returning the head with a bare CR between passes, so the passes
 * land on top of each other and secondaries form in ink. With Auto-LF on, every
 * one of those CRs also advances the paper: the passes stop overlapping and
 * come out as separate stripes of flat colour, one under the other. On a real
 * ImageWriter II this is a DIP switch, which is why it is set on the printer
 * here and not sent as a byte.
 */
function colorSetup(printer) {
  printer.setAutoLineFeed(false);
}

/** ImageWriter II — a colour bitmap through the four-band ribbon. */
function colorGraphics() {
  const img = subtractiveVenn();
  return [
    ...line(ESC, "!", "  IMAGEWRITER II - COLOUR GRAPHICS", ESC, '"'),
    ...line("  ", "=".repeat(40)),
    ...blank(),
    ...line("Yellow, magenta and cyan discs. Every other colour"),
    ...line("below is an OVERPRINT: two ribbon passes on one dot."),
    ...blank(),
    ...buildScreenDumpColor(img.px, img.w, img.h, { invert: false }),
    ...blank(),
    ...line(ESC, "K", 0x31, "yellow ", ESC, "K", 0x32, "magenta ",
            ESC, "K", 0x33, "cyan ", ESC, "K", 0x30, "black"),
  ];
}

/** Epson FX-80 — one bit per dot, and the threshold that decides which. */
function monoGraphics() {
  const ramp = greyRamp();
  const geo  = shapes();

  // `invert: true` because a LIT pixel means ink. The routine was written for
  // an Apple //e screen, whose ground is black and whose drawn pixels glow; a
  // bitmap with a white ground wants the opposite sense or it prints as a
  // near-solid page.
  const dump = (img, threshold) =>
    buildScreenDumpEpson(img.px, img.w, img.h, { invert: true, threshold });

  const out = [
    ...line(ESC, "E", "  EPSON FX-80 - MONOCHROME GRAPHICS", ESC, "F"),
    ...line("  ", "=".repeat(40)),
    ...blank(),
    ...line("There is no grey and no dither in the mono path: each"),
    ...line("dot is on or off, decided by one threshold. The same"),
    ...line("black-to-white ramp, printed at three of them -"),
    ...line("only the edge moves."),
    ...blank(),
  ];

  for (const t of [0x30, 0x60, 0x90]) {
    out.push(...line(`  threshold 0x${t.toString(16).toUpperCase()}`));
    out.push(...dump(ramp, t));
    out.push(...blank());
  }

  out.push(...line("What one bit buys: edges that were never grey."));
  out.push(...blank());
  out.push(...dump(geo, 0x40));
  out.push(...blank());
  out.push(...line("Disc, ring, hatch, and a one-dot checker."));
  return out;
}

/** ImageWriter II — download four glyphs and print them. */
function citohCustomFont() {
  const defs = [
    [0x61, GLYPHS_8.invader],   // 'a'
    [0x62, GLYPHS_8.heart],     // 'b'
    [0x63, GLYPHS_8.apple],     // 'c'
    [0x64, GLYPHS_8.arrow],     // 'd'
  ];
  return [
    ...line(ESC, "!", "  IMAGEWRITER II - CUSTOM CHARACTERS", ESC, '"'),
    ...line("  ", "=".repeat(40)),
    ...blank(),
    ...line("Four glyphs downloaded onto a b c d with ESC I."),
    ...line("ROM font, so a b c d are still letters:"),
    ...line("    abcd abcd abcd"),
    ...blank(),
    ...citohDownload(defs),
    ...line("ESC ' switches to the downloaded set - same bytes:"),
    ...line("    ", ESC, "'", "abcd abcd abcd", ESC, "$"),
    ...blank(),
    ...line("ESC $ puts the ROM back:"),
    ...line("    abcd abcd abcd"),
    ...blank(),
    ...line("Mixed in a line: ", ESC, "'", "a", ESC, "$", " invader  ",
            ESC, "'", "b", ESC, "$", " heart  ",
            ESC, "'", "c", ESC, "$", " apple"),
  ];
}

/** Epson FX-80 — download three glyphs into the RAM character set. */
function epsonCustomFont() {
  const arts = [GLYPHS_11.invader, GLYPHS_11.wave, GLYPHS_11.chip];
  return [
    ...line(ESC, "E", "  EPSON FX-80 - CUSTOM CHARACTERS", ESC, "F"),
    ...line("  ", "=".repeat(40)),
    ...blank(),
    ...line("Three glyphs downloaded onto p q r with ESC &."),
    ...line("ROM character set, so p q r are still letters:"),
    ...line("    pqr pqr pqr"),
    ...blank(),
    ...epsonDownload(0x70, arts),                  // 'p','q','r'
    ...line("ESC % 1 selects the RAM set - same bytes:"),
    ...bytes("    ", ESC, "%", 1, 0, "pqr pqr pqr", ESC, "%", 0, 0, CR, LF),
    ...blank(),
    ...line("ESC % 0 puts the ROM back:"),
    ...line("    pqr pqr pqr"),
    ...blank(),
    ...line("Undefined codes fall through to ROM even in RAM mode:"),
    ...bytes("    ", ESC, "%", 1, 0, "pqr ABC xyz", ESC, "%", 0, 0, CR, LF),
  ];
}

// ── Example 5 · straight out of video memory, mono ──────────────────────────
//
// Nothing here builds a bitmap. The picture is plotted into a 64K bank at the
// real addresses, then read back out as printer columns — the route a screen
// dump on the machine itself has no choice but to take.

/** A HGR test card: frame, circle, hatch and a sine trace. */
function hgrScene(main) {
  for (let x = 4; x < 276; x++) { hplot(main, x, 4); hplot(main, x, 187); }
  for (let y = 4; y < 188; y++) { hplot(main, 4, y); hplot(main, 275, y); }

  // A circle, because a circle is unforgiving: any mistake in the scanline
  // interleave shows up as the ring breaking into eight displaced arcs.
  const cx = 86, cy = 96, r = 62;
  for (let a = 0; a < 1600; a++) {
    const t = (a / 1600) * Math.PI * 2;
    hplot(main, Math.round(cx + r * Math.cos(t)), Math.round(cy + r * Math.sin(t)));
    hplot(main, Math.round(cx + (r - 14) * Math.cos(t)), Math.round(cy + (r - 14) * Math.sin(t)));
  }

  // 45° hatch inside a box: one dot per 6, which at 280 across is about as fine
  // as HGR gets before the artefact colours would take over on a real monitor.
  for (let y = 20; y < 90; y++) {
    for (let x = 170; x < 262; x++) if (((x + y) % 6) === 0) hplot(main, x, y);
  }
  for (let x = 168; x < 264; x++) { hplot(main, x, 18); hplot(main, x, 92); }
  for (let y = 18; y < 93; y++) { hplot(main, 168, y); hplot(main, 263, y); }

  // A sine trace along the bottom third.
  for (let x = 10; x < 270; x++) {
    hplot(main, x, Math.round(155 + 24 * Math.sin((x - 10) / 18)));
  }
}

/** A DHGR resolution comb: eight blocks of vertical lines, pitch 1 to 8. */
function dhgrComb(mem) {
  for (let x = 0; x < 560; x++) { dhplot(mem, x, 0); dhplot(mem, x, 191); }
  for (let y = 0; y < 192; y++) { dhplot(mem, 0, y); dhplot(mem, 559, y); }

  // The comb is the test. DHGR interleaves aux and main every seven dots, so a
  // wrong bank order does not look wrong in the abstract — it shows up here as
  // the finer blocks losing their regular pitch while the coarse ones survive.
  for (let blk = 0; blk < 8; blk++) {
    const x0 = 18 + blk * 68, pitch = blk + 1;
    for (let x = x0; x < x0 + 58; x += pitch) {
      for (let y = 22; y < 96; y++) dhplot(mem, x, y);
    }
  }

  for (let x = 20; x < 540; x++) {
    dhplot(mem, x, Math.round(145 + 30 * Math.sin((x - 20) / 26)));
    dhplot(mem, x, Math.round(145 - 30 * Math.sin((x - 20) / 26)));
  }
}

function hgrFromMemory() {
  const main = bank();
  hgrScene(main);

  const dh = { main: bank(), aux: bank() };
  dhgrComb(dh);

  return bytes(
    blank(),
    line("HI-RES, READ FROM $2000"),
    line("280x192, ONE DOT PER PIXEL, DOUBLED TO 560x384"),
    blank(),
    citohBandStream(hgrColumnBands(main)),
    FF,
    blank(),
    line("DOUBLE HI-RES, READ FROM $2000 IN BOTH BANKS"),
    line("560x192 NATIVE - AUX SUPPLIES THE LEFT SEVEN DOTS"),
    line("ALREADY DOUBLE WIDTH, SO ONLY THE VERTICAL REPEATS"),
    blank(),
    citohBandStream(dhgrColumnBands(dh)),
  );
}

// ── Example 6 · straight out of video memory, colour ────────────────────────
//
// The other route: decode video RAM into RGBA and hand that to the screen dump
// the library already ships. Worth doing this way for the colour modes, because
// the four-band separation and its dithering are real work you would otherwise
// be reimplementing.

function loresArt(main) {
  // All sixteen colours across the top, so every gamut anchor is on the page.
  for (let x = 0; x < 40; x++) {
    const c = Math.floor((x * 16) / 40);
    for (let y = 0; y < 8; y++) plot(main, x, y, c);
  }
  // A white separator. Uninitialised lo-res memory is colour 0 — black — which
  // is right for a screen and wrong for paper, where it prints as a solid bar.
  for (let x = 0; x < 40; x++) for (let y = 8; y < 10; y++) plot(main, x, y, 15);

  // Concentric diamonds in five hues the ribbon reaches by overprinting.
  for (let y = 10; y < 48; y++) {
    for (let x = 0; x < 40; x++) {
      const d = Math.abs(x - 20) + Math.abs(y - 29);
      plot(main, x, y, [9, 13, 12, 6, 3][d % 5]);
    }
  }
}

function dloresArt(mem) {
  for (let x = 0; x < 80; x++) {
    const c = Math.floor((x * 16) / 80);
    for (let y = 0; y < 8; y++) dplot(mem, x, y, c);
  }
  for (let x = 0; x < 80; x++) {
    for (let y = 8; y < 10; y++) dplot(mem, x, y, 15);
    for (let y = 24; y < 26; y++) dplot(mem, x, y, 15);
  }
  // Single-column alternation: this is 80 columns or it is nothing. Read the
  // aux bank wrongly and these collapse into 40 double-width stripes.
  for (let x = 0; x < 80; x++) {
    for (let y = 10; y < 24; y++) dplot(mem, x, y, (x & 1) ? 15 : 1);
  }
  for (let x = 0; x < 80; x++) {
    for (let y = 26; y < 48; y++) dplot(mem, x, y, (((x >> 1) + (y >> 1)) & 1) ? 6 : 13);
  }
}

function loresFromMemory() {
  const main = bank();
  loresArt(main);

  const dl = { main: bank(), aux: bank() };
  dloresArt(dl);

  return bytes(
    blank(),
    line("LO-RES, READ FROM $400"),
    line("40x48 BLOCKS, TWO PER BYTE, LOW NIBBLE ON TOP"),
    line("EACH BLOCK IS 7 DOTS WIDE BY 4 SCANLINES - THE"),
    line("SAME RASTER HI-RES USES, PAINTED WITH A FAT BRUSH"),
    line("SIXTEEN KNOWN COLOURS: ESC K PICKS THE HUE AND A"),
    line("DENSITY TABLE SCREENS THE PASTELS AND THE GREYS"),
    blank(),
    loresColorStream(main),
    FF,
    blank(),
    line("DOUBLE LO-RES, READ FROM $400 IN BOTH BANKS"),
    line("80x48 BLOCKS - AUX HOLDS THE EVEN COLUMNS"),
    line("STILL A 7-DOT CELL, ON THE 560 RASTER: HALF THE"),
    line("WIDTH OF A LO-RES BLOCK, EXACTLY THE SAME HEIGHT"),
    blank(),
    dloresColorStream(dl),
  );
}

export const EXAMPLES = {
  "color-graphics": { title: "IW-II colour graphics", model: "imagewriter-ii", build: colorGraphics, setup: colorSetup },
  "mono-graphics":  { title: "FX-80 mono graphics",   model: "epson-fx80",    build: monoGraphics },
  "citoh-font":     { title: "IW-II custom font",     model: "imagewriter-ii", build: citohCustomFont },
  "epson-font":     { title: "FX-80 custom font",     model: "epson-fx80",    build: epsonCustomFont },
  "hgr-memory":     { title: "HGR/DHGR from memory",  model: "imagewriter-ii", build: hgrFromMemory,   setup: colorSetup },
  "lores-memory":   { title: "LORES/DLORES from mem", model: "imagewriter-ii", build: loresFromMemory, setup: colorSetup },
};
