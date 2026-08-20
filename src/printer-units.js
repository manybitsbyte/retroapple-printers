/*
 * printer-units.js - Shared internal coordinate scale for every virtual printer
 *
 * One "internal dot" = 1/DPI inch. EVERYTHING positional in the printer pipeline
 * — character advance, graphics density, alignment, margins, line feed, form
 * length, and the renderer's internal→canvas mapping — is expressed in these
 * units, so the whole chain scales by changing a single number.
 *
 * DPI is the working resolution, deliberately the least common multiple of every
 * dot density the printers use (60/72/80/90/120/144/160/216/240), so each density
 * lands on an integer dot pitch with no rounding. It is NOT a fixed constant: a
 * model may override it (PrinterBase._defaultDpi) for finer densities, and any
 * value derived from it must be RECOMPUTED from `this.dpi` (see _recomputeUnits
 * in each model) rather than capture a module-level constant — that is the whole
 * point of routing the scale through here.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

// Default internal working resolution (dots per inch). LCM of 60,72,80,90,120,
// 144,160,216,240. Overridable per model via PrinterBase._defaultDpi().
export const DEFAULT_DPI = 480;

// Default vertical feed-motor speed, internal dots/sec. A mechanical estimate
// (the one timing constant that isn't head-motion derived). Overridable per
// model via PrinterBase._defaultFeedDotsPerSec(); it is interpreted in the same
// internal-dot scale as DPI, so a model that overrides DPI keeps a consistent
// physical feed speed only if it scales this to match.
export const DEFAULT_FEED_DOTS_PER_SEC = 3200;
