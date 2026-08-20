/*
 * printer-head.js - Virtual print head (carriage)
 *
 * The one physical thing that puts ink on paper. It has a column position and a
 * travel direction, and it moves at a constant carriage velocity. Every motion
 * costs real wall-clock time = distance / velocity — that single rule is where
 * all horizontal timing comes from (character pitch, graphics density, spacing,
 * carriage return), so nothing else needs fudge factors.
 *
 * Bidirectional printing is real here: a line is buffered, then the head is
 * asked to order its strikes in whichever direction it is currently facing and
 * sweep through them. Glyph columns are absolute, so text reads correctly while
 * the head genuinely travels left->right then right->left on alternate lines.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

export class VirtualHead {
  // pitchDots: internal dots for one pica (10 cpi) character — the unit of
  // carriage travel per char-time. cps: the printer's draft characters/sec,
  // EITHER a fixed number OR a provider function pulled fresh on every velocity
  // read. velocity = pitchDots * cps dots/sec (constant; pitch changes spacing,
  // not carriage speed).
  constructor(pitchDots = 48, cps = 120) {
    this.x          = 0; // current column, internal dots
    this.leftMargin = 0; // carriage return target, internal dots (mirrors printer _leftMargin)
    this.dir = 1; // +1 = travelling left->right, -1 = right->left
    this._pitchDots = pitchDots;
    // Stored as a provider so a quality / bold / colour / half-speed change is
    // reflected at the next motion with no explicit re-arm; the printer installs
    // a live `() => getCharsPerSecond()`. A bare number wraps as a constant.
    this._cps = typeof cps === "function" ? cps : () => cps;
  }

  get velocity() { return this._pitchDots * this._cps(); } // dots/sec

  // Pin the carriage to a fixed cps (wraps it as a constant provider). The base
  // printer normally installs a live provider via the constructor instead, so
  // speed tracks print state automatically; this remains for explicit overrides.
  setCps(cps) { this._cps = () => cps; }

  // Retune the pica advance when the internal dot scale (DPI) changes, so
  // carriage velocity = pitchDots × cps tracks the new resolution. The current
  // column `x` stays put (already in internal dots at the new scale once the
  // model rescales it); only the per-char travel unit changes.
  setPitchDots(pitchDots) { if (pitchDots > 0) this._pitchDots = pitchDots; }

  // Time (ms) for the head to travel from its current column to x.
  travelMs(x) { return Math.abs(x - this.x) / this.velocity * 1000; }

  // Move the head to a column, returning how long that motion took.
  moveTo(x) { const dt = this.travelMs(x); this.x = x; return dt; }

  // Order a line's strikes in the head's current travel direction.
  order(strikes) {
    const out = strikes.slice();
    return this.dir > 0
      ? out.sort((a, b) => a.xDot - b.xDot)
      : out.sort((a, b) => b.xDot - a.xDot);
  }

  // Time (ms) to slew back to the left margin from the current column.
  returnMs() { return Math.abs(this.x - this.leftMargin) / this.velocity * 1000; }

  flip() { this.dir = -this.dir; }            // bidirectional: face the other way
  home() { this.x = this.leftMargin; this.dir = 1; }  // park at left margin

  reset() { this.x = 0; this.leftMargin = 0; this.dir = 1; }
}
