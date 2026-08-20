/*
 * paper.js - Turn a printer's event stream into sheets of paper
 *
 * This is the reference renderer: the piece the library deliberately does NOT
 * ship, written out in full so the shape of the job is obvious.
 *
 * Four things about the event stream are worth stating, because none of them
 * are guessable and getting any one wrong produces a plausible-looking mess:
 *
 *   1. Strike events are POSITIONED, not sequential. Both `printChar` and
 *      `printDots` carry an absolute {xDot, yDot} in internal dots of 1/dpi inch
 *      (dpi is 480 by default — the least common multiple of every density the
 *      machines use, so nothing lands on a fractional pitch). There is no cursor
 *      to track: draw each strike where it says it is.
 *
 *   2. `feed` is a SOUND cue, not a movement. Its `dist` is the head's
 *      horizontal position, used to time the carriage noise — it is emphatically
 *      not how far the paper moved. Integrating it as a vertical advance stacks
 *      every line on top of the first. Paper position is already in `yDot`.
 *
 *   3. `dotW` is the width of ONE column and `dotH` the spacing of ONE wire, so
 *      column i of a glyph sits at xDot + i*dotW, and bit N of a column sits at
 *      yDot + N*dotH. dotH is dpi/72 (≈6.67) because the nine wires are 1/72"
 *      apart on the head, which is a different pitch from the horizontal one.
 *
 *   4. There is NO page-break event, and none is needed. `yDot` runs
 *      continuously down an endless roll of fanfold; a form feed simply jumps it
 *      to the next multiple of the form length. Pages are therefore arithmetic —
 *      page = floor(yDot / formDots), y-on-page = yDot % formDots — which is
 *      exactly how tractor-feed paper behaves, perforations and all. A line that
 *      straddles a perforation really does print half on each sheet, so dots are
 *      routed to a sheet individually rather than per glyph.
 *
 * Written by
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *  Mike Daley <michael_daley@icloud.com>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import { encodePNG } from "./png.js";
import { writeFileSync } from "node:fs";
import { pageMetrics, pageOf, yOnPage } from "../../src/index.js";

/** Ribbon band colours as RGB. A monochrome ribbon only ever reports black. */
const INK = {
  black:   [0x1a, 0x18, 0x16],
  yellow:  [0xf2, 0xc2, 0x2c],
  magenta: [0xd8, 0x3c, 0x84],
  cyan:    [0x30, 0xa8, 0xc8],
  orange:  [0xe8, 0x72, 0x2c],
  green:   [0x4c, 0xa8, 0x54],
  purple:  [0x8c, 0x4c, 0x9c],
};

/**
 * How far ink wicks past the struck dot, as a multiple of the wire's radius.
 *
 * 1.9 puts the halo's outer edge at about 0.9 wire pitches, comfortably past
 * the 0.707 where four neighbours meet — so a solid fill closes — while the
 * saturated core stays near 0.47, so a half-tone screen keeps discrete marks
 * instead of flooding. Absorbent fanfold wicks more than coated paper; this is
 * the one number here that is a property of the stock rather than the machine.
 */
const INK_SPREAD = 1.9;

/** One physical sheet: a bitmap plus the ability to ink a dot on it. */
class Sheet {
  constructor(w, h, outDpi) {
    this.w = w;
    this.h = h;
    this.outDpi = outDpi;
    this.dots = 0;

    // Warm off-white; pure #fff reads as a screen rather than a page.
    this.rgb = new Uint8Array(w * h * 3).fill(0xf7);
    for (let i = 2; i < this.rgb.length; i += 3) this.rgb[i] = 0xf0;
  }

  /**
   * Ink a dot at a pixel centre: a solid core, and a halo where the ink wicked.
   *
   * A hard disc cannot describe what a nine-pin printer does to paper, and the
   * failure is not subtle. The wire's own dot is about 0.47 wire pitches in
   * radius, which does NOT reach the point between four neighbours (0.707), so
   * a hard disc that size leaves a white lattice through every solid fill.
   * Widen it past 0.707 and solids close up, but now half-tones break: place a
   * plane-tiling disc on half the positions of a 50% ordered screen and it
   * covers about 80% of the paper, so grey prints as near-black. Both are wrong
   * and no single radius fixes both, because the real mechanism is not a disc.
   *
   * Ink wicks. Each strike puts a saturated core down and a fading halo around
   * it, and the halo is what closes the gaps — where four dots meet, four
   * haloes overlap and the junction goes dark, while an isolated dot in a
   * screen keeps its core and stays a discrete mark. That is the behaviour
   * modelled here, and it is why the same ink model gives solid solids and
   * grey greys with no tuning per picture.
   */
  ink(px, py, rCore, rEdge, color) {
    const [ir, ig, ib] = INK[color] ?? INK.black;
    const x0 = Math.max(0, Math.floor(px - rEdge)), x1 = Math.min(this.w - 1, Math.ceil(px + rEdge));
    const y0 = Math.max(0, Math.floor(py - rEdge)), y1 = Math.min(this.h - 1, Math.ceil(py + rEdge));
    const fade = Math.max(1e-6, rEdge - rCore);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - px, dy = y - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > rEdge) continue;
        const a = d <= rCore ? 1 : (rEdge - d) / fade;

        const o = (y * this.w + x) * 3;
        // Darken only, per channel. Laying yellow over cyan must not lift the
        // red channel back up: overprint on paper is subtractive, so an
        // overstruck dot can only ever get darker.
        this.rgb[o]     = Math.min(this.rgb[o],     this.rgb[o]     * (1 - a) + ir * a);
        this.rgb[o + 1] = Math.min(this.rgb[o + 1], this.rgb[o + 1] * (1 - a) + ig * a);
        this.rgb[o + 2] = Math.min(this.rgb[o + 2], this.rgb[o + 2] * (1 - a) + ib * a);
      }
    }
    this.dots++;
  }

  /**
   * Always the full sheet.
   *
   * Cropping to the ink would be a lie about the artefact: a page with three
   * lines on it is still a whole piece of paper, and the blank tail is the part
   * that came out of the printer blank. Trimming it also makes pages of one job
   * different sizes, which no real stack of paper ever is.
   */
  toPNG() {
    return { buf: encodePNG(this.rgb, this.w, this.h), w: this.w, h: this.h };
  }
}

/**
 * The continuous roll. Allocates sheets on demand as the paper advances.
 */
export class Paper {
  /**
   * @param {object} printer  A PrinterBase instance (for dpi and page geometry)
   * @param {object} [opts]
   * @param {number} [opts.dpi=150]          Output resolution of the PNGs
   * @param {number} [opts.widthInch]        Paper width; defaults to the model's own
   * @param {number} [opts.formInch]         Form length; defaults to the model's own
   * @param {number} [opts.marginInch=0.25]  Left inset, so column 0 is not flush
   * @param {number} [opts.maxSheets=50]     Runaway guard
   */
  constructor(printer, opts = {}) {
    this.printer = printer;
    this.outDpi = opts.dpi ?? 150;
    this.marginInch = opts.marginInch ?? 0.25;
    this.maxSheets = opts.maxSheets ?? 50;

    // Everything about the paper is read off the printer, never assumed: a model
    // may run a finer internal DPI, and the form length is software-settable
    // (ESC H on the ImageWriter II, ESC C on the FX-80).
    const m = pageMetrics(printer, { widthInch: opts.widthInch, formInch: opts.formInch });
    this.dpi       = m.dpi;
    this.widthInch = m.widthInch;
    this.formDots  = m.formDots;
    this.formInch  = m.formInch;
    this.dotRadiusInch = m.dotRadiusInch;

    this.sheetW = Math.round(this.widthInch * this.outDpi);
    this.sheetH = Math.round(this.formInch * this.outDpi);

    /** @type {Map<number, Sheet>} page index → sheet, allocated lazily */
    this.sheets = new Map();
    this.dots = 0;
    this.clipped = 0;   // dots that fell past maxSheets
  }

  _sheet(page) {
    let s = this.sheets.get(page);
    if (!s) {
      s = new Sheet(this.sheetW, this.sheetH, this.outDpi);
      this.sheets.set(page, s);
    }
    return s;
  }

  /** Ink one dot. Coordinates are internal dots from the top of the FIRST page. */
  _dot(xDot, yDot, color) {
    const page = pageOf(yDot, this.formDots);
    if (page < 0 || page >= this.maxSheets) { this.clipped++; return; }

    const px = (xDot / this.dpi + this.marginInch) * this.outDpi;
    const py = (yOnPage(yDot, this.formDots) / this.dpi) * this.outDpi;

    // The wire's dot comes off the head (density moves dots closer together, it
    // never makes them smaller). The halo is the ink's, not the printer's, so
    // the spread factor lives here in the renderer.
    const rCore = this.dotRadiusInch * this.outDpi;
    const rEdge = rCore * INK_SPREAD;

    this._sheet(page).ink(px, py, rCore, rEdge, color);
    this.dots++;
  }

  /** Paint one column bitmask: bit N is N wire-pitches below yDot. */
  _column(mask, xDot, yDot, dotH, color) {
    if (!mask) return;
    for (let wire = 0; mask >>> wire; wire++) {
      if (mask & (1 << wire)) this._dot(xDot, yDot + wire * dotH, color);
    }
  }

  /**
   * The event sink. Hand this to printer.setEventSink().
   *
   * `dt` is ignored: we want the finished pages, not a paced animation. A live
   * renderer would release these on the dt timeline instead, which is what makes
   * the on-screen version print at true hardware speed.
   */
  sink = (e) => {
    const d = e.data || {};
    switch (e.name) {
      case "printChar": {
        const cols = d.cols || [];
        cols.forEach((col, i) =>
          this._column(col, d.xDot + i * d.dotW, d.yDot, d.dotH, d.color));

        // Bold is an OVERPRINT on real hardware: the head makes a second hammer
        // pass offset by a fraction of a column, so the strokes thicken rather
        // than change shape. (The emulation halves the carriage speed for it,
        // which is why bold text really did print slower.) The event reports the
        // attribute; laying down the extra pass is the renderer's job.
        if (d.bold) {
          cols.forEach((col, i) =>
            this._column(col, d.xDot + i * d.dotW + d.dotW / 2, d.yDot, d.dotH, d.color));
        }

        // Underline likewise: the wire fires on every column of the cell, one
        // row below the character box, so it runs unbroken through the spaces.
        if (d.underline) {
          const yUnder = d.yDot + (d.rows ?? 9) * d.dotH;
          const width = Math.max(1, cols.length) * d.dotW;
          for (let x = 0; x < width; x += Math.max(1, d.dotW / 2)) {
            this._dot(d.xDot + x, yUnder, d.color);
          }
        }
        break;
      }

      case "printDots":
        this._column(d.byte ?? 0, d.xDot, d.yDot, d.dotH, d.color);
        break;

      // "feed" is a sound cue — its `dist` is the head's horizontal position,
      // not a paper advance. Vertical position already arrives on every strike.
      default:
        break;
    }
  };

  /** Number of sheets that received ink. */
  get pageCount() { return this.sheets.size; }

  /**
   * Write every sheet out, each a full page.
   *
   * Sheets are emitted for the whole span the paper travelled, not just the ones
   * that happened to receive ink — a blank page in the middle of a job is a real
   * page that really came out of the printer, and skipping it would renumber
   * everything after it.
   *
   * @param {(page: number, total: number) => string} namer  Path for page N (1-based)
   * @returns {Array<{path: string, page: number, w: number, h: number, dots: number}>}
   */
  save(namer) {
    const inked = [...this.sheets.keys()];
    const last = inked.length ? Math.max(...inked) : 0;
    const total = last + 1;

    const out = [];
    for (let page = 0; page <= last; page++) {
      const sheet = this._sheet(page);          // materialises a blank page if needed
      const { buf, w, h } = sheet.toPNG();
      const path = namer(page + 1, total);
      writeFileSync(path, buf);
      out.push({ path, page: page + 1, w, h, dots: sheet.dots });
    }
    return out;
  }
}
