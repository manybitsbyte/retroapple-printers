/*
 * apple-dmp.js - Apple Dot Matrix Printer emulation
 *
 * The Apple Dot Matrix Printer (1982, A2M0058) is Apple's first dot-matrix
 * printer — a rebadged C. Itoh 8510. The ImageWriter family (1983+) descends
 * from the same C. Itoh command set, so the DMP is faithfully modelled as the
 * ImageWriter II minus its later additions: no colour ribbon, no NLQ tier, no
 * half-height / super-subscript, no MouseText. A single black 9-wire head prints
 * one fixed face (rom-editor.html → DMP_STANDARD_FIXED, 8 columns × 9 wires).
 *
 * Screen dumps target this head via screen-dump.js → buildScreenDumpAppleDMP
 * (C. Itoh ESC G, 72 dpi, single black ribbon — no colour passes).
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
import {
  DMP_STANDARD_FIXED,
  DMP_STANDARD_FIXED_LOCALES,
  DMP_STANDARD_PROP,
  DMP_STANDARD_PROP_LOCALES,
} from "./apple-dmp-rom.js";

// ESC bytes the IW-II understands but the DMP has no hardware for. Consumed
// (so a stray parameter never prints as text) and otherwise ignored — matching
// the manual's rule that an unrecognised code after ESCAPE is dropped with it
// (any parameter bytes then print as ordinary text, exactly like real iron).
//   w/W  half-height            x/y/z  super/subscript
//   m/M  correspondence/NLQ     &      MouseText character map
//   e    semicondensed 13.4 cpi (not one of the DMP's seven pitches, App B)
//   s    ESC s n prop spacing   (the DMP spelling is ESC 1…6, handled below)
//   c    software reset         (DMP resets only via the INPUT.PRIME line)
//   g    ESC g nnn graphics     (DMP has ESC G / ESC V only, Appendix B)
//   u    ESC u nnn add tab stop (DMP tabbing is ESC ( / ESC ) / ESC 0 only)
const DMP_IGNORED_ESC = new Set([0x77, 0x57, 0x78, 0x79, 0x7A, 0x6D, 0x4D, 0x26, 0x65,
                                 0x73, 0x63, 0x67, 0x75]);

export class AppleDMP extends CItohPrinter {
  getName() { return "Apple DMP"; }
  getId()   { return "apple-dmp"; }

  // Single black ribbon — the DMP never had a colour cartridge.
  supportsColorRibbon() { return false; }

  // Power-on default pitch (DMP Reference §12 / DIP SW2-5). The DMP powers up at
  // Pica 10 cpi UNLESS DIP switch 2-5 is closed, which makes the power-on face
  // Elite Proportional (ESC P, 144 dpi). Live ESC P / ESC N still override at
  // runtime (handled by the shared CItoh _handleEsc). The setting is exposed as a
  // toggle; ON pins _defaultPitch to 'propElite', OFF restores the Pica default.
  // _resetRenderState re-reads _defaultPitch, so the choice takes effect at every
  // reset / power-on. propElite is a valid pitch the render path already maps
  // (_gfxDotW → ESC P elite-proportional at 144 dpi).
  getElitePropDefault() { return this.getDefaultPitch() === "propElite"; }
  setElitePropDefault(on) { this.setDefaultPitch(on ? "propElite" : "pica"); }

  // Operator panel: the shared Auto-LF / default-pitch settings PLUS the DMP's
  // DIP SW2-5 power-on-pitch toggle. The inherited 'pitch' choice (fixed pitches)
  // is dropped here so the two don't fight over _defaultPitch — the DMP's
  // documented power-on choice is exactly Pica vs elite-proportional (§12).
  static get SETTINGS() {
    return [
      ...super.SETTINGS.filter((s) => s.id !== "pitch"),
      { id: "elitePropDefault", type: "toggle", default: false,
        label: "Prop.",
        hint: "Power-on Elite Proportional pitch (DIP SW2-5)",
        get: (p) => p.getElitePropDefault(),
        set: (p, v) => p.setElitePropDefault(v) },
    ];
  }

  // Drop the IW-II-only style/font ESC codes; defer everything else to the II.
  // ESC 1…ESC 6 ($31–$36): insert 1–6 extra dots of space between the two
  // adjacent characters (DMP Reference, "Elite Character Spacing"). A ONE-SHOT
  // micro-space, not a mode — the manual requires a code after every character
  // to space a whole line, and consecutive codes accumulate (real iron caps one
  // gap at 128 dots). Documented for the proportional pitches only; in a fixed
  // pitch the code is consumed with no effect, like real hardware.
  _handleEsc(ch) {
    if (DMP_IGNORED_ESC.has(ch)) return;
    if (ch >= 0x31 && ch <= 0x36) {
      if (this._proportional) this._xDot += Math.round((ch - 0x30) * this._gfxDotW());
      return;
    }
    super._handleEsc(ch);
  }

  // One print font (no draft/correspondence/NLQ tiers): force the correspondence
  // path so getGlyph routes through getCorrChar below and the swallowed ESC
  // a/m/M font-select commands stay inert.
  _effectiveQuality() { return "corr"; }

  // Render from the DMP's own 8×9 character ROM when a glyph has been authored
  // (rom-editor.html → DMP_STANDARD_FIXED). Codes not yet transcribed fall back
  // to the IW-II correspondence ROM so the printer stays usable.
  getCorrChar(code, locale = "US") {
    if (locale !== "US") {
      const override = DMP_STANDARD_FIXED_LOCALES[locale]?.[code];
      if (override) return override;
    }
    return DMP_STANDARD_FIXED[code] || super.getCorrChar(code, locale);
  }

  // Proportional face (ESC p / ESC P). Each glyph carries its own column count
  // and a built-in trailing blank — _emitChar reads this to drive both the shape
  // and the per-glyph carriage advance. Render from the DMP's own proportional
  // ROM; a code with no proportional glyph falls back to the fixed cell (null →
  // _emitChar uses getGlyph). The DMP has no NLQ-proportional bank, so the II's
  // getNLQPropChar path never fires (quality is forced to 'corr' above).
  getCorrPropChar(code, locale = "US") {
    if (locale !== "US") {
      const override = DMP_STANDARD_PROP_LOCALES[locale]?.[code];
      if (override) return override;
    }
    return DMP_STANDARD_PROP[code] ?? null;
  }

  // Proportional / graphics column pitch. DMP Appendix E rates pica-proportional
  // (ESC p) at 160 dpi and elite-proportional (ESC P) at 144 dpi — the inverse of
  // the ImageWriter II's assignment for the same two pitch names. Override only
  // those two; every fixed pitch keeps the shared graphics density.
  _gfxDotW() {
    if (this._pitch === "propPica")  return this.dpi / 160;  // ESC p — pica-prop
    if (this._pitch === "propElite") return this.dpi / 144;  // ESC P — elite-prop
    return super._gfxDotW();
  }

  // Rated 120 cps pica, bidirectional (DMP Owner's Manual). Boldface costs a
  // second hammer pass, halving the carriage rate like the real printer.
  getCharsPerSecond() {
    return this._bold ? 60 : 120;
  }
}
