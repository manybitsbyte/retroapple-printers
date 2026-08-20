/*
 * printer-paper-feed.js - Virtual paper feed mechanism (platen / tractor)
 *
 * The vertical stepper that advances the paper past the head. It turns feed
 * distances into wall-clock time and owns the page geometry (form length and
 * the latched top-of-form), but NOT the live paper position — that single
 * vertical cursor lives in the printer model (`_yDot`) so render and mechanism
 * never drift. This unit is a pure calculator: callers pass the current cursor
 * in and get back times / boundaries.
 *
 * Unlike the carriage (whose speed is spec-derived from cps), the feed motor
 * speed is a mechanical estimate — the single timing constant that isn't head
 * motion.
 *
 * Top-of-form: a real dot-matrix printer has no idea where the paper's physical
 * page boundary is. The operator rolls the paper to where they want page top
 * (platen knob / micro line-feed buttons) and that position is latched as
 * top-of-form. A form feed then advances exactly to the next page boundary
 * (top-of-form + form length), not to some absolute origin. Power-on assumes
 * the paper already sits at top-of-form.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import { DEFAULT_DPI, DEFAULT_FEED_DOTS_PER_SEC } from "./printer-units.js";

// Default form length: physical page height in internal dots. 11" fanfold at the
// default scale (= 66 lines at 6 lpi). The owning model overrides this on reset.
const DEFAULT_FORM_DOTS = DEFAULT_DPI * 11;

export class VirtualPaperFeed {
  // feedDotsPerSec is the line-feed stepper speed in internal dots/sec; it must
  // be passed in the SAME dot scale as formDots so feed timing tracks the model's
  // DPI. Both are overridable/retunable (the model owns the scale).
  constructor(formDots = DEFAULT_FORM_DOTS, feedDotsPerSec = DEFAULT_FEED_DOTS_PER_SEC) {
    this.topOfForm      = 0;              // cursor position latched as current page top
    this.formDots       = formDots;       // page height (top-of-form to top-of-form)
    this.feedDotsPerSec = feedDotsPerSec; // vertical feed speed, internal dots/sec
  }

  // Retune the feed-motor speed (internal dots/sec) — e.g. when the model's DPI
  // scale changes, so physical feed timing stays consistent.
  setFeedDotsPerSec(v) { if (v > 0) this.feedDotsPerSec = v; }

  // Wall-clock time for a feed of `dots` (sign-agnostic).
  feedMs(dots) { return Math.abs(dots) / this.feedDotsPerSec * 1000; }

  // Latch a cursor position as top-of-form (operator pressed SET/TOF, or
  // power-on with paper loaded at the tear-off).
  setTopOfForm(y) { this.topOfForm = y; }

  // Set the form length (page height, top-of-form to top-of-form) in internal
  // dots. Driven by ESC H or a host-side page-size selection.
  setFormDots(dots) { if (dots > 0) this.formDots = dots; }

  // The next page boundary at or below cursor `y`. `formDotsOverride` lets the
  // caller supply the effective form length when this unit's own formDots has
  // been parked at 0 — the window's "no ESC H override, track lengthInch"
  // display sentinel. Without it a 0 formDots makes past/0 → Infinity and
  // Infinity*0 → NaN, which poisons the head position and blanks every strike
  // after the first form feed. Always resolves to a positive form length so the
  // result is a finite page boundary.
  nextFormTop(y, formDotsOverride) {
    const fd = (formDotsOverride > 0) ? formDotsOverride
             : (this.formDots > 0 ? this.formDots : DEFAULT_FORM_DOTS);
    const past  = y - this.topOfForm;                 // distance into this page
    const pages = Math.floor(past / fd) + 1;
    return this.topOfForm + pages * fd;
  }

  reset() { this.topOfForm = 0; }
}
