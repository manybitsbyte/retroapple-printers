/*
 * apple-video.js - Apple II video memory → printer, the way the machines did it
 *
 * The library ships `buildScreenDump*`, and those take RGBA pixels. That is the
 * HOST's route: an emulator has already rendered a framebuffer, so the shortest
 * honest path to paper is to pack those pixels into the printer's bit-image
 * format.
 *
 * It is not the machine's route, and the difference matters if you are building
 * anything faithful. A screen dump running ON an Apple II has no framebuffer to
 * read, because the //e never assembles one — it has $400/$800 for text and
 * lo-res, $2000/$4000 for hi-res, a second 64K bank for the double modes, and
 * all of it is laid out for the video scanner's convenience rather than the
 * programmer's. So the dump program reads video RAM, decodes that mode's bit
 * layout itself, transposes eight scanlines into one column byte, and sends
 * ESC G with the columns behind it. The Grappler ROM, Print Shop and every
 * screen-dump listing in a magazine all do precisely that.
 *
 * This file is that missing half, written out so the seam is impossible to
 * miss: the library ends at bytes, and the memory space is yours to wire in.
 * Both routes are here, because both are legitimate —
 *
 *   hgrColumnBands()   memory → column bytes → ESC G     no framebuffer at all
 *   loresRGBA()        memory → RGBA → buildScreenDumpColor    reuse the shipped one
 *
 * Everything below reads and writes REAL addresses in a real 64K bank, so the
 * arithmetic is the arithmetic a 6502 routine performs. Nothing here is a
 * simplification of the layout.
 *
 * --- One raster, four granularities ------------------------------------------
 *
 * The thing to hold on to, because it decides every number in this file: the
 * machine has ONE raster and the modes differ only in how coarsely they fill it.
 *
 *   HGR     280x192   1 dot per pixel
 *   LORES   40x48     each block is 7 dots wide and 4 scanlines tall
 *   DHGR    560x192   the double-res raster, 1 dot per pixel
 *   DLORES  80x48     each block is 7 dots wide on the 560 raster, so HALF the
 *                     width of a lo-res block — which is the whole of what the
 *                     "double" buys you
 *
 * 40 x 7 = 280 and 48 x 4 = 192: lo-res is not a smaller picture, it is the same
 * picture drawn with a fat brush. And the printer has no modes whatsoever — it
 * takes a raster of dots and prints it. So lo-res reaches paper as REPEATED
 * dots filling a 7x4 cell, never as a grid of its own with some invented block
 * size. Pick the block size freely and you have quietly printed a lo-res image
 * at hi-res granularity, with cells that match no Apple geometry.
 *
 * Vertical doubling is the one liberty taken here, and it is the //e's own: its
 * framebuffer is 560x384, every mode line-doubled into it. Doubling hi-res on
 * both axes and the double modes on the vertical only lands all four on that
 * same 560x384 field, which at the printer's 72 dpi square graphics grid is
 * 7.78in x 5.33in — near enough a full page, and near enough the proportions of
 * the tube. Period dump programs often printed the native raster instead and
 * accepted the squash; pass xScale/yScale of 1 for that.
 *
 * Written by
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * SPDX-License-Identifier: MIT
 */

// ── Memory ──────────────────────────────────────────────────────────────────

const ESC = 0x1b;

/** A bare 64K bank. Two of these (main + aux) are a 128K //e. */
export const bank = () => new Uint8Array(0x10000);

/**
 * Base address of a text/lo-res row.
 *
 * The famous three-way interleave: the 24 rows are stored as three groups of
 * eight, and consecutive rows are $80 apart rather than adjacent. This is not
 * an encoding anybody chose for software's benefit — it falls out of the video
 * counter's address generation, and it is why every Apple II program that
 * touches the screen carries a base-address table.
 */
export function textRowBase(row, page = 1) {
  return (page === 2 ? 0x0800 : 0x0400) + (row & 7) * 0x80 + (row >> 3) * 0x28;
}

/**
 * Base address of a hi-res scanline.
 *
 * The same interleave with a third level on top: within a row group the eight
 * scanlines are $400 apart, which is why a HGR page is 8K for 7.7K of pixels
 * and why the eight "holes" of unused RAM exist between the lines.
 */
export function hgrRowBase(row, page = 1) {
  return (page === 2 ? 0x4000 : 0x2000)
    + (row & 7) * 0x0400
    + ((row >> 3) & 7) * 0x80
    + (row >> 6) * 0x28;
}

// ── Plotting into video memory ──────────────────────────────────────────────
// These are the Applesoft primitives (HPLOT, PLOT) doing what they really do:
// setting one bit or one nibble at a computed address.

/** HPLOT. 280×192, seven pixels per byte, LSB leftmost. */
export function hplot(main, x, y, page = 1) {
  if (x < 0 || x > 279 || y < 0 || y > 191) return;
  // Bit 7 is the half-dot palette shift, never a pixel — so a mono dump, which
  // cares only about which dots are lit, ignores it entirely. That is exactly
  // why mono screen dumps of colour HGR pictures come out looking right.
  main[hgrRowBase(y, page) + ((x / 7) | 0)] |= 1 << (x % 7);
}

/** Double hi-res plot. 560×192 across both banks. */
export function dhplot({ main, aux }, x, y, page = 1) {
  if (x < 0 || x > 559 || y < 0 || y > 191) return;
  const group = (x / 7) | 0;
  // AUX supplies the left seven dots of each 14-dot cell and MAIN the right —
  // aux first, which is the ordering people get backwards. Get it wrong and a
  // picture still appears, just with every 14-dot cell mirrored down the
  // middle, which is subtle enough to look like a font problem.
  const b = (group & 1) ? main : aux;
  b[hgrRowBase(y, page) + (group >> 1)] |= 1 << (x % 7);
}

/** PLOT. 40×48 blocks, two per byte: low nibble on top. */
export function plot(main, x, y, color, page = 1) {
  if (x < 0 || x > 39 || y < 0 || y > 47) return;
  const a = textRowBase(y >> 1, page) + x;
  if (y & 1) main[a] = (main[a] & 0x0f) | ((color & 15) << 4);
  else       main[a] = (main[a] & 0xf0) | (color & 15);
}

/** Double lo-res plot. 80×48; aux holds the even columns. */
export function dplot({ main, aux }, x, y, color, page = 1) {
  if (x < 0 || x > 79 || y < 0 || y > 47) return;
  const b = (x & 1) ? main : aux;
  const a = textRowBase(y >> 1, page) + (x >> 1);
  if (y & 1) b[a] = (b[a] & 0x0f) | ((color & 15) << 4);
  else       b[a] = (b[a] & 0xf0) | (color & 15);
}

// ── Memory → column bytes (the machine's own route) ──────────────────────────

/**
 * Read hi-res memory and transpose it into printer column bytes.
 *
 * This is the whole trick of a dot-matrix screen dump, and it is a transpose:
 * the screen is stored in horizontal scanlines, the head prints in vertical
 * columns of eight wires. So the routine walks the picture in horizontal bands
 * eight scanlines deep and, for each of the columns across, samples those eight
 * scanlines into the eight bits of one byte.
 *
 * @param {Uint8Array} main   a 64K bank with a HGR page in it
 * @param {object} [opts]
 * @param {1|2} [opts.page=1]   HGR page 1 ($2000) or 2 ($4000)
 * @param {number} [opts.xScale=2] @param {number} [opts.yScale=2]
 *   Dot replication. The defaults put the 280×192 raster onto the //e's own
 *   560×384 framebuffer geometry, which every other decoder here targets too.
 * @returns {number[][]}  one array of column bytes per 8-dot band
 */
export function hgrColumnBands(main, opts = {}) {
  const page = opts.page ?? 1;
  const xs = Math.max(1, opts.xScale ?? 2);
  const ys = Math.max(1, opts.yScale ?? 2);
  const W = 280 * xs, H = 192 * ys;

  const lit = (x, y) => {
    const sx = (x / xs) | 0, sy = (y / ys) | 0;
    return (main[hgrRowBase(sy, page) + ((sx / 7) | 0)] >> (sx % 7)) & 1;
  };

  const bands = [];
  for (let y = 0; y < H; y += 8) {
    const cols = new Array(W);
    for (let x = 0; x < W; x++) {
      let c = 0;
      // Bit 0 is the TOP wire on a C. Itoh head. (An Epson head is the other
      // way up — bit 7 on top — which is the single most common reason a
      // ported dump routine prints everything vertically mirrored.)
      for (let r = 0; r < 8 && y + r < H; r++) if (lit(x, y + r)) c |= 1 << r;
      cols[x] = c;
    }
    bands.push(cols);
  }
  return bands;
}

/**
 * The same for double hi-res: 560 dots across, read from both banks.
 *
 * Horizontally this is ALREADY the doubled raster, so only the vertical wants
 * replicating — which is exactly what the //e does to get its 560×384 frame.
 * Scaling both axes here would make the picture twice as wide as the hi-res one
 * for no reason, since both cover the same screen.
 */
export function dhgrColumnBands({ main, aux }, opts = {}) {
  const page = opts.page ?? 1;
  const xs = Math.max(1, opts.xScale ?? 1);
  const ys = Math.max(1, opts.yScale ?? 2);
  const W = 560 * xs, H = 192 * ys;

  const lit = (x, y) => {
    const sx = (x / xs) | 0, sy = (y / ys) | 0;
    const group = (sx / 7) | 0;
    const b = (group & 1) ? main : aux;
    return (b[hgrRowBase(sy, page) + (group >> 1)] >> (sx % 7)) & 1;
  };

  const bands = [];
  for (let y = 0; y < H; y += 8) {
    const cols = new Array(W);
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let r = 0; r < 8 && y + r < H; r++) if (lit(x, y + r)) c |= 1 << r;
      cols[x] = c;
    }
    bands.push(cols);
  }
  return bands;
}

/**
 * Wrap bands of column bytes in the C. Itoh graphics protocol.
 *
 * This is the part the user's question is really about — "sending ESC codes of
 * the pixel data from each screen section". There is no image command and no
 * handshake; a picture is a run of these, one per eight scanlines:
 *
 *   ESC n              72 dpi horizontal, so the dot grid is square
 *   ESC T 1 6          feed 16/144" = 8/72", exactly one band, so they butt up
 *   per band:
 *     ESC G d d d d    graphics, column count as four ASCII digits
 *     <count bytes>    one byte per column, bit 0 = top wire
 *     CR LF            return the head and drop one band
 *   ESC N  ESC A       back to pica text and 6 lines per inch
 *
 * Note the count is ASCII here. The Epson sends it as two binary bytes instead,
 * which is a real hardware difference and not a detail worth papering over.
 */
export function citohBandStream(bands) {
  const out = [ESC, 0x6e, ESC, 0x54, 0x31, 0x36];
  for (const cols of bands) {
    const n = String(cols.length).padStart(4, "0");
    out.push(ESC, 0x47, ...[...n].map((c) => c.charCodeAt(0)), ...cols, 0x0d, 0x0a);
  }
  out.push(ESC, 0x4e, ESC, 0x41);
  return out;
}

// ── Memory → RGBA (the route that reuses the shipped screen dump) ────────────

/**
 * The //e's 16 lo-res colours (src/core/types.hpp LORES_COLORS).
 *
 * These are the same anchors `buildScreenDumpColor` quantises to, which is the
 * point: decode lo-res memory with this table and every block lands exactly on
 * a gamut point, so solid areas print solid instead of dithering into a
 * crosshatch. Feeding the colour dump arbitrary RGB is what makes it stipple.
 */
export const LORES_COLORS = [
  [0x00, 0x00, 0x00], [0xe3, 0x1e, 0x60], [0x60, 0x4e, 0xbd], [0xff, 0x44, 0xfd],
  [0x00, 0xa3, 0x60], [0x9c, 0x9c, 0x9c], [0x14, 0xcf, 0xfd], [0xd0, 0xc3, 0xff],
  [0x60, 0x72, 0x03], [0xff, 0x6a, 0x3c], [0x9c, 0x9c, 0x9c], [0xff, 0xa0, 0xd0],
  [0x14, 0xf5, 0x3c], [0xd0, 0xdd, 0x8d], [0x72, 0xff, 0xd0], [0xff, 0xff, 0xff],
];

function paint(px, W, x0, y0, bw, bh, rgb) {
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      const o = (y * W + x) * 4;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 0xff;
    }
  }
}

/**
 * Decode a lo-res page into an RGBA framebuffer.
 *
 * For a COLOUR dump prefer `loresColorStream` below, which separates the known
 * palette instead of quantising it. This function is the bridge to the shipped
 * `buildScreenDump*` — useful when the target has no colour ribbon or no C. Itoh
 * command set (an FX-80, say). Be aware of what it costs: those take a single
 * threshold and count a pixel as ink if ANY channel clears it, which is right
 * for a lit-on-black hi-res screen and hopeless at telling sixteen saturated
 * colours apart — a lo-res page thresholds to a near-solid slab. A real mono
 * lo-res dump maps each colour to its own fill pattern; a threshold cannot.
 *
 * The block size is NOT a free parameter. A lo-res block is 7 dots wide and 4
 * scanlines tall on the same 280×192 raster hi-res uses — 40×7 and 48×4 — so
 * the defaults here are that cell on the //e's line-doubled framebuffer: 14×8.
 * Any other number prints a lo-res picture at a granularity the machine does
 * not have, and the giveaway is blocks that are too near square. Real ones are
 * emphatically wider than tall.
 *
 * @returns {{px: Uint8Array, w: number, h: number}}
 */
export function loresRGBA(main, opts = {}) {
  const page = opts.page ?? 1, bw = opts.blockW ?? 14, bh = opts.blockH ?? 8;
  const w = 40 * bw, h = 48 * bh;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 40; x++) {
      const byte = main[textRowBase(y >> 1, page) + x];
      const c = (y & 1) ? (byte >> 4) & 15 : byte & 15;
      paint(px, w, x * bw, y * bh, bw, bh, LORES_COLORS[c]);
    }
  }
  return { px, w, h };
}

/**
 * The same for double lo-res: 80 columns, aux holding the even ones.
 *
 * 80 columns across the 560-dot double-res raster is still a 7-dot cell — the
 * blocks are half as WIDE as lo-res ones and exactly as tall. That is the only
 * difference between the modes, and it is what the picture should show.
 */
export function dloresRGBA({ main, aux }, opts = {}) {
  const page = opts.page ?? 1, bw = opts.blockW ?? 7, bh = opts.blockH ?? 8;
  const w = 80 * bw, h = 48 * bh;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 80; x++) {
      const b = (x & 1) ? main : aux;
      const byte = b[textRowBase(y >> 1, page) + (x >> 1)];
      const c = (y & 1) ? (byte >> 4) & 15 : byte & 15;
      paint(px, w, x * bw, y * bh, bw, bh, LORES_COLORS[c]);
    }
  }
  return { px, w, h };
}


// ── Lo-res in colour: the 6502 dump routine's own algorithm ─────────────────
//
// Ported from web-a2e's `t/imagewriter_ii_lr_s2p.asm` and `t/dlr-dump-color.asm`,
// which are the real thing: 6502 code that reads GR RAM and streams to an
// ImageWriter II over the SSC. Three things in it are worth stating, because
// each one is easy to reinvent badly:
//
//  1. ESC K selects one of SEVEN colours, not four. 0=black 1=yellow 2=red
//     3=blue 4=orange 5=green 6=purple. The last three are secondaries the
//     PRINTER makes for itself by overprinting two ribbon bands. So a cell is
//     one pass with one colour selected, never a hand-rolled separation into
//     yellow/magenta/cyan/black passes.
//  2. Every colour carries an ink density 0..16, not just grey. The //e's
//     pastels and greys are fractional — light blue, pink and aqua are 8, the
//     darker grey is 4 — and a 4x4 ordered Bayer matrix turns that density into
//     a dot field. Solid hues are 16 and never dither at all.
//  3. The x dither phase runs CONTINUOUSLY across cells and resets only at the
//     left margin, so the screen does not line up with the cell grid and print
//     as visible seams.
//
// The tables below are the assembly's CKCOL, CDENS and BAYER, verbatim.

/** ESC K ribbon index per lo-res colour. 0xFF = white, i.e. no ink at all. */
const CKCOL = [
  0x00, 0x02, 0x03, 0x06, 0x05, 0x00, 0x03, 0x03,
  0x04, 0x04, 0x00, 0x02, 0x05, 0x01, 0x05, 0xFF,
];

/** Ink density 0..16 per lo-res colour. 16 = solid, 0 = bare paper. */
const CDENS = [
  0x10, 0x10, 0x10, 0x10, 0x10, 0x08, 0x10, 0x08,
  0x10, 0x10, 0x04, 0x08, 0x10, 0x10, 0x08, 0x00,
];

/** The 4×4 ordered matrix, flat — the same one src/screen-dump.js screens with. */
const BAYER = [
  0x00, 0x08, 0x02, 0x0A,
  0x0C, 0x04, 0x0E, 0x06,
  0x03, 0x0B, 0x01, 0x09,
  0x0F, 0x07, 0x0D, 0x05,
];

/**
 * Emit a colour cell dump: one ESC K + ESC G per cell, one CR LF per row.
 *
 * Each cell is `cellW` dot columns of a single ribbon colour, screened to its
 * density. The row ends with CR to commit the band and LF to feed the eight
 * dots — which needs Auto-LF off, or the CR feeds as well and every row prints
 * twice as far down the page as it should.
 *
 * @param {number} cols    cells across (40 lo-res, 80 double)
 * @param {number} cellW   dot columns per cell
 * @param {number} rows    GR rows (48)
 * @param {(row: number, col: number) => number} colorAt  the //e colour 0..15
 */
export function citohCellStream(cols, cellW, rows, colorAt) {
  const out = [ESC, 0x6e, ESC, 0x54, 0x31, 0x36];   // ESC n, ESC T 16
  const count = String(cellW).padStart(4, "0");

  for (let row = 0; row < rows; row++) {
    let phase = 0;                    // BCOL — reset at the left margin only
    for (let c = 0; c < cols; c++) {
      const idx = colorAt(row, c) & 15;
      const k = CKCOL[idx], density = CDENS[idx];

      // White skips the ribbon select and relies on density 0 to print nothing,
      // exactly as the assembly does — one fewer escape per blank cell.
      if (k !== 0xFF) out.push(ESC, 0x4b, 0x30 + k);

      out.push(ESC, 0x47);
      for (const ch of count) out.push(ch.charCodeAt(0));

      for (let dc = 0; dc < cellW; dc++) {
        let byte = 0;
        // Bit 0 is the top wire. The matrix row is the wire index mod 4 and the
        // column is the running x phase, which is what makes the screen an even
        // field rather than stripes.
        for (let wire = 0; wire < 8; wire++) {
          if (BAYER[(wire & 3) * 4 + phase] < density) byte |= 1 << wire;
        }
        out.push(byte);
        phase = (phase + 1) & 3;
      }
    }
    out.push(0x0d, 0x0a);
  }

  out.push(ESC, 0x4b, 0x30, ESC, 0x4e, ESC, 0x41);
  return out;
}

/**
 * Lo-res memory straight to a colour dump.
 *
 * `cellW` is 14 here — 40 × 14 = 560, the double-res raster, which is what the
 * double lo-res routine's own 80 × 7 arithmetic gives. (The 6502 lo-res dump
 * ships 13 instead, which keeps a line inside 7.25" of paper at the cost of
 * narrowing the picture by a twentieth.)
 */
export function loresColorStream(main, opts = {}) {
  const page = opts.page ?? 1;
  return citohCellStream(40, opts.cellW ?? 14, 48, (row, col) => {
    const byte = main[textRowBase(row >> 1, page) + col];
    return (row & 1) ? (byte >> 4) & 15 : byte & 15;
  });
}

/** Double lo-res: 80 cells of 7 dots, aux holding the even columns. */
export function dloresColorStream({ main, aux }, opts = {}) {
  const page = opts.page ?? 1;
  return citohCellStream(80, opts.cellW ?? 7, 48, (row, col) => {
    const b = (col & 1) ? main : aux;
    const byte = b[textRowBase(row >> 1, page) + (col >> 1)];
    return (row & 1) ? (byte >> 4) & 15 : byte & 15;
  });
}
