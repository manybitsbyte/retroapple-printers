/*
 * index.js - Public entry point for @manybitsbyte/retroapple-printers
 *
 * The printers are pure state machines. Bytes go in through receiveByte(), and
 * everything the emulation observes about the resulting print job leaves through
 * the event sink as an ordered stream of {name, data, dt} records. There is no
 * DOM, no canvas, no timer and no audio anywhere below this file — a host draws
 * the paper (or writes a PNG, or counts dots) by consuming those events.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

// ── Printer models ──────────────────────────────────────────────────────────
export { ImageWriterII } from "./imagewriter-ii.js";
export { ImageWriterI }  from "./imagewriter-i.js";
export { AppleDMP }      from "./apple-dmp.js";
export { EpsonFX80 }     from "./epson-fx80.js";

// ── Base classes, for hosts adding their own model ──────────────────────────
// PrinterBase supplies the mechanisms and the line/feed pipeline; CItohPrinter
// adds the complete C. Itoh 8510 command core that the three Apple-lineage
// models share. A new C. Itoh derivative subclasses CItohPrinter; anything else
// (a second ESC/P family member, say) subclasses PrinterBase.
export { PrinterBase }   from "./printer-base.js";
export { CItohPrinter }  from "./citoh-printer.js";

// ── Virtual mechanisms ──────────────────────────────────────────────────────
// Exposed because they are independently useful: VirtualHead alone will tell you
// how long a given line takes to print bidirectionally on real hardware.
export { VirtualHead }      from "./printer-head.js";
export { VirtualRibbon }    from "./printer-ribbon.js";
export { VirtualPaperFeed } from "./printer-paper-feed.js";

// ── Paper geometry and units ────────────────────────────────────────────────
export {
  PaperGeometry,
  DEFAULT_PAPER_RANGE,
  DEFAULT_PAPER_WIDTH_INCH,
  DEFAULT_PAPER_LENGTH_RANGE,
  DEFAULT_PAPER_LENGTH_INCH,
  STANDARD_WIDTHS_INCH,
  GRID_INCH,
  clampWidthInch,
  clampLengthInch,
  snapWidthInch,
  computeLayout,
} from "./printer-paper-geometry.js";

export { DEFAULT_DPI, DEFAULT_FEED_DOTS_PER_SEC } from "./printer-units.js";

// ── Page arithmetic ─────────────────────────────────────────────────────────
// These machines emit no page-break event: `yDot` runs continuously down a roll
// of fanfold and a form feed slews it to the next multiple of the form length.
// Pages fall out of arithmetic on that coordinate — but the form length is not
// a constant (ESC H on the ImageWriter II, ESC C on the FX-80), so read it here
// rather than assuming 11 inches.
export {
  formDots,
  pageOf,
  yOnPage,
  pageMetrics,
  WIRE_PITCH,
} from "./pagination.js";

// ── Bitmap → printer graphics ───────────────────────────────────────────────
// Turns an RGBA framebuffer into the bit-image byte stream that machine's own
// parser expects, which is how period software actually printed a picture: the
// bytes go in through receiveByte() like any other job. Colour is the real
// four-band overprint the ImageWriter II ribbon does, not an RGB approximation.
export {
  buildScreenDump,
  buildScreenDumpImageWriter,
  buildScreenDumpAppleDMP,
  buildScreenDumpEpson,
  buildScreenDumpColor,
  litDensity,
  SCREEN_W,
  SCREEN_H,
} from "./screen-dump.js";

// ── Character-generator ROMs ────────────────────────────────────────────────
// Grouped rather than spread across the top level: with locale variants these
// are ~100 names, and almost every host wants the model classes instead. Reach
// in here to build a glyph editor, diff a font bank, or seed a new model.
export * as roms from "./roms.js";

import { ImageWriterII } from "./imagewriter-ii.js";
import { ImageWriterI }  from "./imagewriter-i.js";
import { AppleDMP }      from "./apple-dmp.js";
import { EpsonFX80 }     from "./epson-fx80.js";

/**
 * The models this package emulates, in the order a UI would list them.
 *
 * `create()` is a thunk rather than the class itself so a host can enumerate
 * models without constructing them, and so future models are free to need
 * constructor arguments without changing the shape of this table.
 */
export const PRINTER_MODELS = [
  { id: "imagewriter-ii", name: "ImageWriter II", interface: "serial",   create: () => new ImageWriterII() },
  { id: "imagewriter-i",  name: "ImageWriter I",  interface: "serial",   create: () => new ImageWriterI()  },
  { id: "epson-fx80",     name: "Epson FX-80",    interface: "parallel", create: () => new EpsonFX80()     },
  { id: "apple-dmp",      name: "Apple DMP",      interface: "parallel", create: () => new AppleDMP()      },
];

/**
 * Construct a printer by id.
 *
 * @param {string} id  One of the ids in PRINTER_MODELS
 * @returns {import("./printer-base.js").PrinterBase}
 * @throws {Error} if the id is not a known model
 */
export function createPrinter(id) {
  const model = PRINTER_MODELS.find((m) => m.id === id);
  if (!model) {
    const known = PRINTER_MODELS.map((m) => m.id).join(", ");
    throw new Error(`Unknown printer id "${id}" — expected one of: ${known}`);
  }
  return model.create();
}
