/*
 * printer-paper-geometry.js - Virtual paper WIDTH state (the page body)
 *
 * The horizontal counterpart to printer-paper-feed.js. That unit owns the page
 * HEIGHT (form length, top-of-form); this one owns the page WIDTH. Both are pure
 * data the owning printer model holds — the model supplies the legal width range,
 * and this object just stores the chosen width and keeps it clamped to whatever
 * range it is handed.
 *
 * "Width" here is the PAPER BODY: the printable sheet between the tractor lines,
 * which is exactly what the operator reads off the ruler. The ½"/side holed
 * sprocket strips are NOT part of this number — they are a render-only given the
 * window adds outside the body (printer.tractorMarginInch()). The printing
 * pipeline never needs them; only the side-rendering does.
 *
 * Feed is always tractor (pin) feed — friction/cut-sheet/roll handling was
 * dropped: every modelled printer is driven as continuous tractor stock. So there
 * is no feed-mode state here; the width range is single-valued per model (the
 * FX-80 still varies its range on the optional-tractor accessory, but that is the
 * model's own toggle, not a feed mode this unit tracks).
 *
 * This unit holds NO range of its own — ranges are model truth (see each model's
 * paperWidthRange()). Callers pass a {min,max} in whenever they set or re-clamp,
 * so a single source of truth (the model) governs the limits.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

// Universal fall-back BODY-width envelope, in inches: the widest min and the
// common max across all four modelled printers, measured as paper body — strips
// off (see .claude/agent/printer/paper-sizes.md). Used only when no model range
// has been supplied yet; every model overrides this with its own paperWidthRange().
export const DEFAULT_PAPER_RANGE = { min: 3, max: 9 };

// Power-on default body width: 8.5" — the body of the ubiquitous 9.5" green-bar
// fanfold once its ½"/side sprocket strips are torn off (an 8.5"×11" page).
// Within every model's body range.
export const DEFAULT_PAPER_WIDTH_INCH = 8.5;

// Paper LENGTH (height) envelope, inches — the form/page length of the loaded
// continuous stock. Fan-fold is physically endless; what the operator and the
// vertical ruler care about is one form, programmable on every model (DIP page
// length, ESC C / ESC H). Fall-back only; each model overrides paperLengthRange().
export const DEFAULT_PAPER_LENGTH_RANGE = { min: 1, max: 22 };

// Power-on default form length: 11" — 66 lines at 6 lpi, the standard fanfold
// page and every model's DIP default.
export const DEFAULT_PAPER_LENGTH_INCH = 11;

// Clamp a length (inches) into a {min,max} range, same defensive shape as
// clampWidthInch.
export function clampLengthInch(lengthInch, range = DEFAULT_PAPER_LENGTH_RANGE) {
  const min = Number.isFinite(range?.min) ? range.min : DEFAULT_PAPER_LENGTH_RANGE.min;
  const max = Number.isFinite(range?.max) ? range.max : DEFAULT_PAPER_LENGTH_RANGE.max;
  const lo = Math.min(min, max), hi = Math.max(min, max);
  const l  = Number.isFinite(lengthInch) ? lengthInch : DEFAULT_PAPER_LENGTH_INCH;
  return Math.min(hi, Math.max(lo, l));
}

// Clamp a width (inches) into a {min,max} range. Tolerates a missing/garbled
// range by falling back to the universal envelope so a bad caller can't NaN the
// geometry.
export function clampWidthInch(widthInch, range = DEFAULT_PAPER_RANGE) {
  const min = Number.isFinite(range?.min) ? range.min : DEFAULT_PAPER_RANGE.min;
  const max = Number.isFinite(range?.max) ? range.max : DEFAULT_PAPER_RANGE.max;
  const lo = Math.min(min, max), hi = Math.max(min, max);
  const w  = Number.isFinite(widthInch) ? widthInch : DEFAULT_PAPER_WIDTH_INCH;
  return Math.min(hi, Math.max(lo, w));
}

// Standard continuous-stationery BODY widths (inches) operators actually printed
// onto — the width drag snaps to whichever of these fall in the active model's
// body range, giving detents at real stock sizes while free widths between still
// work. These are bodies (strips already off): e.g. standard 9.5" fanfold → 8.5"
// body, narrow 4.0" tractor → 3.0" body (see .claude/agent/printer/paper-sizes.md).
export const STANDARD_WIDTHS_INCH = [3.0, 3.5, 4.5, 7.5, 8.0, 8.5, 9.0];

// Width drag quantizes to this grid — a real tractor sets width in discrete
// sprocket-pitch-ish steps, and a ¼" grid gives clean, repeatable sizes.
export const GRID_INCH = 0.25;

// Quantize a dragged width to the ¼" grid, range-clamped. The grid is the snap;
// every drop lands on a quarter inch. `snapped` is flagged true only when the
// quantized width coincides with a STANDARD stock size reachable in `range`, so the
// UI can give those common widths extra emphasis (solid guide + dot) over the plain
// grid detents. Returns { value, snapped }.
export function snapWidthInch(widthInch, range = DEFAULT_PAPER_RANGE, grid = GRID_INCH) {
  const free = clampWidthInch(widthInch, range);
  const quantized = clampWidthInch(Math.round(free / grid) * grid, range);
  const value = Math.round(quantized * 100) / 100;          // kill fp drift (8.5000001)
  const snapped = STANDARD_WIDTHS_INCH.some(
    (s) => Math.abs(value - s) < 1e-6 && clampWidthInch(s, range) === s
  );
  return { value, snapped };
}

// Pure paper-layout solver — the single place sheet/body/zone geometry is
// computed, in canvas-internal pixels. No DOM, no side effects, so the live
// width-drag preview can call it for any candidate width and the window just
// draws the result. Everything is reasoned in inches off a body-left=0 reference,
// then shifted so the leftmost drawn element sits at x=0, then scaled by the
// isotropic display raster (profile.pxPerInch).
//
//   profile      — printer.paperProfile() (carriageWidthInch, tractorMarginInch,
//                  anchor, pxPerInch, …)
//   widthInch    — current PAPER BODY width (PaperGeometry.widthInch)
//   lengthInch   — current form length (PaperGeometry.lengthInch)
//
// Returns canvas-px:
//   paperLPx / paperRPx — body edges = ruler 0 .. ruler max (the paper-sizer line)
//   sheetLPx / sheetRPx — full sheet incl. the ½"/side tractor strips (render only)
//   zoneOriginPx        — print column 0 (fixed carriage span, internal ink clip)
//   tractorPx           — one tractor-strip width
//   widthPx / heightPx  — canvas extent
export function computeLayout(profile, widthInch, lengthInch) {
  const ppi = profile?.pxPerInch || 120;
  const T   = profile?.tractorMarginInch ?? 0.5;
  const C   = profile?.carriageWidthInch ?? 8;
  const B   = Number.isFinite(widthInch) ? widthInch : DEFAULT_PAPER_WIDTH_INCH;
  const L   = Number.isFinite(lengthInch) ? lengthInch : DEFAULT_PAPER_LENGTH_INCH;

  // Inches, body-left = 0. The sheet extends ½" past the body each side (the holed
  // strips). The fixed carriage zone sits per anchor: left-referenced models put
  // print column 0 at the body's left edge; centered models centre the zone on the
  // body (symmetric tractors → body centre == sheet centre, so it's the same).
  const sheetL = -T;
  const sheetR = B + T;
  const zoneL  = (profile?.anchor === "left") ? 0 : (B / 2 - C / 2);
  const zoneR  = zoneL + C;

  const minIn = Math.min(sheetL, zoneL, 0);
  const maxIn = Math.max(sheetR, zoneR, B);
  const off   = -minIn;                          // shift leftmost element to x=0
  const toPx  = (i) => Math.round((i + off) * ppi);

  return {
    paperLPx:     toPx(0),                        // body left  = ruler 0
    paperRPx:     toPx(B),                         // body right = ruler max = sizer line
    sheetLPx:     toPx(sheetL),                    // outer sheet left  (incl. strip)
    sheetRPx:     toPx(sheetR),                    // outer sheet right (incl. strip)
    zoneOriginPx: toPx(zoneL),                     // print column 0 (carriage home)
    tractorPx:    Math.round(T * ppi),             // one tractor-strip width
    widthPx:      Math.round((maxIn - minIn) * ppi),
    heightPx:     Math.round(L * ppi),
  };
}

export class PaperGeometry {
  // The paper BODY width and the form LENGTH (height), both clamped on
  // construction against the supplied ranges (or the universal envelopes until a
  // model range exists). PaperGeometry owns the SHEET DIMENSIONS; the vertical
  // feed motor (printer-paper-feed.js) owns position/timing, not size.
  constructor(widthInch = DEFAULT_PAPER_WIDTH_INCH, range = DEFAULT_PAPER_RANGE,
              lengthInch = DEFAULT_PAPER_LENGTH_INCH, lengthRange = DEFAULT_PAPER_LENGTH_RANGE) {
    this.widthInch  = clampWidthInch(widthInch, range);
    this.lengthInch = clampLengthInch(lengthInch, lengthRange);
  }

  // Set the width, clamped to the supplied range. Returns the clamped value.
  setWidthInch(widthInch, range = DEFAULT_PAPER_RANGE) {
    this.widthInch = clampWidthInch(widthInch, range);
    return this.widthInch;
  }

  // Set the form length, clamped to the supplied range. Returns the clamped value.
  setLengthInch(lengthInch, lengthRange = DEFAULT_PAPER_LENGTH_RANGE) {
    this.lengthInch = clampLengthInch(lengthInch, lengthRange);
    return this.lengthInch;
  }

  // Re-clamp the current width to a (possibly new) range — e.g. after the FX-80
  // optional tractor narrows the legal span, or a persisted value is loaded under
  // a range whose definition has since shifted.
  reclamp(range = DEFAULT_PAPER_RANGE) {
    this.widthInch = clampWidthInch(this.widthInch, range);
    return this.widthInch;
  }

  // Re-clamp the current length to a (possibly new) range.
  reclampLength(lengthRange = DEFAULT_PAPER_LENGTH_RANGE) {
    this.lengthInch = clampLengthInch(this.lengthInch, lengthRange);
    return this.lengthInch;
  }

  // ---- Serialization (consumed by the window's per-printer persistence) ----
  toJSON() { return { widthInch: this.widthInch, lengthInch: this.lengthInch }; }

  // Restore from a plain object, re-clamping to the supplied ranges. Missing
  // fields keep current values. Safe against partial / stale saved state — a
  // legacy `feedMode` key (pre-friction-removal saves) is simply ignored.
  load(obj, range = DEFAULT_PAPER_RANGE, lengthRange = DEFAULT_PAPER_LENGTH_RANGE) {
    if (obj && typeof obj === "object") {
      if (obj.widthInch != null)  this.widthInch  = obj.widthInch;
      if (obj.lengthInch != null) this.lengthInch = obj.lengthInch;
    }
    this.reclamp(range);
    this.reclampLength(lengthRange);
    return this;
  }
}
