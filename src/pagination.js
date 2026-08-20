/*
 * pagination.js - Public page arithmetic for hosts that draw paper
 *
 * These printers emit no page-break event, and none is needed. `yDot` on every
 * strike runs continuously down an endless roll of fanfold; a form feed simply
 * slews it to the next multiple of the form length. Pages are therefore
 * arithmetic on a coordinate the host already has.
 *
 * The arithmetic is three lines, so this module exists for the one value it is
 * hard to get right rather than for the sums: the form length. It is not a
 * constant. The ImageWriter II resets it in software with ESC H (any length up
 * to about 69 inches), the Epson with ESC C, and a host that assumes 11 inches
 * paginates a 3-inch label roll into one enormous sheet with everything crammed
 * at the top. `formDots()` reads the live value the printer is actually running
 * on, falling back to the model's own default for a printer that never tracked
 * one.
 *
 * A dot lands on a page individually rather than a glyph at a time, because a
 * line that straddles a perforation really did print its upper wires on one
 * sheet and its lower wires on the next — see `pageOf`.
 *
 * Written by
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *  Mike Daley <michael_daley@icloud.com>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

/**
 * Live form length in internal dots.
 *
 * Prefer this over the model's default: software can and does change the form,
 * and the default is only right until the first ESC H / ESC C.
 *
 * @param {object} printer  A PrinterBase instance
 * @returns {number} form length in internal dots of 1/printer.dpi inch
 */
export function formDots(printer) {
  const live = printer._effectiveFormDots?.();
  if (Number.isFinite(live) && live > 0) return live;
  return Math.round(printer.defaultPaperLengthInch() * (printer.dpi || 480));
}

/**
 * Which sheet a strike lands on. Page 0 is the first sheet.
 *
 * @param {number} yDot     Absolute vertical position from an event
 * @param {number} formLen  Form length in internal dots, from formDots()
 */
export function pageOf(yDot, formLen) {
  return Math.floor(yDot / formLen);
}

/**
 * Vertical position of a strike within its own sheet, in internal dots.
 *
 * Deliberately not `yDot % formLen`: the remainder operator keeps the sign of
 * the dividend, so a reverse feed above top-of-form would put the dot at a
 * negative offset on page -1 instead of near the bottom of the sheet above.
 */
export function yOnPage(yDot, formLen) {
  return yDot - pageOf(yDot, formLen) * formLen;
}

/**
 * Everything a renderer needs to size a sheet and place a dot on it, read off
 * the printer rather than assumed.
 *
 * `dotRadiusInch` is the one value that is a property of the head rather than
 * of the paper: a wire stamps a fixed-diameter dot regardless of density, so
 * changing the pitch moves dots closer together without making them smaller.
 *
 * This is the WIRE's dot and nothing else: an ImageWriter print wire is about
 * 0.012" across against a 0.0139" pitch, so the struck dot is roughly 0.47
 * pitches in radius. Note what that means — it is smaller than the sqrt(2)/2 =
 * 0.707 needed to reach the middle of any four neighbours, so the bare
 * mechanical dot does NOT tile the plane and a "solid" fill at 72 dpi is not
 * geometrically solid. What closes it on paper is ink wicking outward from each
 * strike, and that belongs to the renderer's ink model rather than here,
 * because it is a property of the ink and the fanfold rather than of the head.
 * Trying to fold the spread into this radius forces a choice between solid
 * fills that are solid and half-tone screens that are not black — see the
 * `Sheet.ink` comment in test/printout/paper.js.
 *
 * @param {object} printer
 * @param {object} [opts]
 * @param {number} [opts.widthInch]  Override the paper width
 * @param {number} [opts.formInch]   Override the form length
 */
export function pageMetrics(printer, opts = {}) {
  const dpi = printer.dpi || 480;
  const form = opts.formInch ? Math.round(opts.formInch * dpi) : formDots(printer);

  return {
    dpi,
    formDots: form,
    formInch: form / dpi,
    widthInch: opts.widthInch ?? printer.defaultPaperWidthInch(),
    tractorMarginInch: printer.tractorMarginInch(),
    wirePitchInch: 1 / WIRE_PITCH,
    dotRadiusInch: (1 / WIRE_PITCH) * 0.47,
  };
}

/** Wires per inch on a nine-pin head. Fixes the physical dot size. */
export const WIRE_PITCH = 72;
