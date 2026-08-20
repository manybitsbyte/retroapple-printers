/*
 * imagewriter-ii.js - Apple ImageWriter II printer emulation
 *
 * The full C. Itoh 8510 command core (parser, render state, custom characters,
 * graphics, correspondence base face) lives in CItohPrinter. The ImageWriter II
 * is the only model in the family that ADDED the draft and NLQ font tiers, the
 * NLQ proportional bank, the four-band colour ribbon, and selectable form
 * lengths — so it is an additive subclass that wires in those ROMs and that
 * identity. The monochrome ImageWriter I and the Apple DMP subclass CItohPrinter
 * directly and never see these additions.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import { CItohPrinter } from "./citoh-printer.js";
import { IW2_DRAFT_ROM, IW2_DRAFT_ROM_LOCALES } from "./imagewriter-ii-rom-draft.js";
import { IW2_NLQ_FIXED, IW2_NLQ_FIXED_LOCALES } from "./imagewriter-ii-rom-nlq-fixed.js";
import { IW2_NLQ_PROP_ROM, IW2_NLQ_PROP_ROM_LOCALES } from "./imagewriter-ii-rom-nlq-prop.js";

export class ImageWriterII extends CItohPrinter {
  getName() { return "ImageWriter II"; }
  getId()   { return "imagewriter-ii"; }

  // The ImageWriter II is the only model that took a four-band colour ribbon.
  supportsColorRibbon() { return true; }

  // Paper-geometry: same center-anchored C.Itoh handling as the family, but the
  // II's tractor goes a touch narrower — 3.5" pin-to-pin (≈4.0" outer paper) per
  // Appendix D, vs the 4.5" the DMP/IW-I bottom out at. Body range (strips off):
  // overall 4.0"–10" → body 3.0"–9.0".
  paperWidthRange() { return { min: 3.0, max: 9.0 }; }

  // Most flexible form length of the four: ESC H sets any page up to ~69" in
  // 1/144" steps (Tech Ref Table 5-3; ESC H 144 = 1" mailing-label forms). DIP
  // default 11" (66 lines @ 6 lpi).
  paperLengthRange() { return { min: 1, max: 69 }; }

  // Returns draft ROM column data (9-bit: bit 0=wire1 … bit 8=wire9), or null
  getDraftChar(code, locale = "US") {
    if (locale !== "US") {
      const override = IW2_DRAFT_ROM_LOCALES[locale]?.[code];
      if (override) return override;
    }
    return IW2_DRAFT_ROM[code] ?? null;
  }

  // Returns NLQ ROM column data (16 columns, up to 18-bit each: bit 0=wire 1 …
  // bit 17=row 18), or null if this code has no NLQ glyph.
  getNLQChar(code, locale = "US") {
    if (locale !== "US") {
      const override = IW2_NLQ_FIXED_LOCALES[locale]?.[code];
      if (override) return override;
    }
    return IW2_NLQ_FIXED[code] ?? null;
  }

  // Returns NLQ *proportional* column data (variable column count, up to 18-bit
  // each: bit 0 = wire 1 … bit 17 = row 18; trailing blank column = the built-in
  // inter-char spacer), or null if this code has no NLQ proportional glyph. Drives
  // both the rendered shape and the per-glyph advance, printed on the dense NLQ
  // cell (18 rows, 160x144 dpi).
  getNLQPropChar(code, locale = "US") {
    if (locale !== "US") {
      const override = IW2_NLQ_PROP_ROM_LOCALES[locale]?.[code];
      if (override) return override;
    }
    return IW2_NLQ_PROP_ROM[code] ?? null;
  }

  // Selectable FORM LENGTHS, not paper sizes. The ImageWriter II is a
  // continuous-feed printer with a fixed 8" printable width — it has no concept
  // of paper size; only form length is real (DIP SW1-4 picks 11"/12", software
  // sets any length via ESC H). These are honest form lengths, all 8" wide.
  static get PAGE_SIZES() {
    return [
      { id: "form11", name: "11 in (default)", inches: 11 },     // DIP SW1-4 = 11"
      { id: "form12", name: "12 in",           inches: 12 },     // DIP SW1-4 = 12"
      { id: "legal",  name: "14 in (Legal)",   inches: 14 },     // via ESC H
      { id: "a4",     name: "A4 (11.7 in)",    inches: 11.69 },  // via ESC H
    ];
  }

  // Set the form length from a PAGE_SIZES id. Returns true if recognised.
  setPageSize(id) {
    const def = ImageWriterII.PAGE_SIZES.find((p) => p.id === id);
    if (!def) return false;
    this._pageSize = id;
    this.paper.setFormDots(Math.round(def.inches * this.dpi));
    return true;
  }

  getPageSize() { return this._pageSize ?? "form11"; }
}
