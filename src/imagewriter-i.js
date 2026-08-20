/*
 * imagewriter-i.js - Apple ImageWriter I printer emulation
 *
 * The ImageWriter I (1983) is the monochrome predecessor of the ImageWriter II.
 * Its ESC command letters are identical to the II's — the II is a backward-
 * compatible superset that ADDED the four-band colour ribbon, half-height,
 * super/subscript, the NLQ font, ESC a font select, and MouseText. So the I is
 * faithfully modelled as the II minus those additions, at a single slower
 * print speed. Everything else (pitches, graphics, custom characters, line
 * spacing, bidirectional logic seek, auto-LF) is shared.
 *
 * Reference: Imagewriter I User's Manual - Part I (Apple). Distilled command /
 * spec cheatsheet alongside this file in IW1-protocols.md.
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
import { IW1_STANDARD_FIXED, IW1_STANDARD_FIXED_LOCALES } from "./imagewriter-i-rom-standard-fixed.js";
import { IW1_STANDARD_PROP, IW1_STANDARD_PROP_LOCALES } from "./imagewriter-i-rom-standard-prop.js";

// ESC bytes the IW-II understands but the IW-I has no hardware for. Consumed
// (so a stray parameter never prints as text) and otherwise ignored.
//   w/W  half-height            x/y/z  super/subscript
//   m/M  correspondence/NLQ     &      MouseText character map
// ESC a (font select) and ESC K (colour) DO carry a trailing parameter byte;
// those fall through to super so the byte is swallowed by the S_PARAM1 state,
// but they have no visual effect (single black font — see the overrides below).
const IW1_IGNORED_ESC = new Set([0x77, 0x57, 0x78, 0x79, 0x7A, 0x6D, 0x4D, 0x26]);

export class ImageWriterI extends CItohPrinter {
  getName() { return "ImageWriter I"; }
  getId()   { return "imagewriter-i"; }

  // Black ribbon only — the IW-I never had a colour cartridge.
  supportsColorRibbon() { return false; }

  // Power-on default pitch is Elite (12 cpi), not Pica — DIP SW1-6 closed,
  // SW1-7 open (manual Ch.4). Everything else matches the II's render reset.
  _resetRenderState() {
    this._defaultPitch ??= "elite";
    super._resetRenderState();
  }

  // Drop the IW-II-only style/font ESC codes; defer everything else to the II.
  _handleEsc(ch) {
    if (IW1_IGNORED_ESC.has(ch)) return;
    super._handleEsc(ch);
  }

  // The IW-I has a single print font (no draft/correspondence/NLQ tiers). It
  // renders from the 8-column correspondence ROM, whose 8-wide x 9-tall grid
  // matches the IW-I's documented standard-character matrix (Appendix D: eight
  // columns, rightmost blank) — unlike the II draft ROM's 12 columns. Forcing a
  // single quality also makes the swallowed ESC a/m/M font-select commands inert.
  _effectiveQuality() { return "corr"; }

  // Render from the IW-I's own 7×8 character ROM when a glyph has been authored
  // (rom-editor.html → IW1_STANDARD_FIXED). The model forces 'corr' quality, so getGlyph
  // routes here; any code not yet transcribed falls back to the IW-II
  // correspondence ROM so the printer stays usable while the font is built.
  getCorrChar(code, locale = "US") {
    if (locale !== "US") {
      const override = IW1_STANDARD_FIXED_LOCALES[locale]?.[code];
      if (override) return override;
    }
    const glyph = IW1_STANDARD_FIXED[code];
    if (glyph) return glyph;
    return super.getCorrChar(code, locale);
  }

  // Proportional pitch (ESC p/P) renders from the IW-I's own variable-width
  // proportional ROM (rom-editor.html → IW1_STANDARD_PROP). Drives both shape and
  // per-glyph advance via the inherited _emitChar proportional path. Codes not
  // yet transcribed fall back to the IW-II correspondence-proportional ROM.
  getCorrPropChar(code, locale = "US") {
    if (locale !== "US") {
      const override = IW1_STANDARD_PROP_LOCALES[locale]?.[code];
      if (override) return override;
    }
    const glyph = IW1_STANDARD_PROP[code];
    if (glyph) return glyph;
    return super.getCorrPropChar(code, locale);
  }

  // Single mechanical speed: 120 cps at 10 cpi (manual Appendix E), 72 lpm.
  // No quality tiers and no colour, so neither slows it; boldface still costs a
  // second hammer pass, so it halves the carriage rate like the real printer.
  getCharsPerSecond() {
    return this._bold ? 60 : 120;
  }
}
