/*
 * printer-base.js - Abstract base class for printer models
 *
 * Composes the printer out of virtual mechanisms instead of scattered
 * bookkeeping:
 *   - VirtualHead       — the carriage: position, direction, travel timing;
 *   - VirtualRibbon     — the ink cartridge: B/W or colour;
 *   - VirtualPaperFeed  — the vertical stepper: paper position, feed timing;
 *   - PaperGeometry     — horizontal page geometry: paper width + feed mode.
 *
 * A subclass parses the byte stream and reports strikes at absolute columns.
 * The base buffers a line, then lets the head replay those strikes in true
 * travel order (so bidirectional printing is genuine), charges each motion its
 * real wall-clock cost, and hands the timed events to a sink (the manager) that
 * releases them at hardware speed.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import { VirtualHead }      from "./printer-head.js";
import { VirtualRibbon }    from "./printer-ribbon.js";
import { VirtualPaperFeed } from "./printer-paper-feed.js";
import { PaperGeometry, DEFAULT_PAPER_RANGE, DEFAULT_PAPER_WIDTH_INCH,
         DEFAULT_PAPER_LENGTH_RANGE, DEFAULT_PAPER_LENGTH_INCH } from "./printer-paper-geometry.js";
import { DEFAULT_DPI, DEFAULT_FEED_DOTS_PER_SEC } from "./printer-units.js";

function popcount(n) {
  let c = 0;
  n &= 0x1FF;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

// Power-on print-head rest, in internal dots below the paper's top edge.
// Zero = head starts flush at the sheet top so printing begins at y=0 with no gap.
const POWER_ON_HEAD_DOTS = 0;

export class PrinterBase {
  constructor() {
    this._listeners = {};
    this._onImpact  = null;
    this._eventSink = null;

    // Internal dot scale (DPI) and feed speed — the single knobs every positional
    // value derives from. A model overrides the defaults via the hooks below;
    // _recomputeUnits() then derives that model's dot pitches from `this.dpi`.
    // Set BEFORE the mechanisms, since head pitch and form length read them.
    this.dpi            = this._defaultDpi();
    this.feedDotsPerSec = this._defaultFeedDotsPerSec();
    this._recomputeUnits();

    // The virtual mechanisms. The head is handed a LIVE cps provider (pulled on
    // every motion) rather than a fixed rate, so quality / bold / colour /
    // half-speed changes retune the carriage automatically — and so the base
    // constructor never samples the subclass getCharsPerSecond() before the
    // subclass state exists (it is only read later, at the first move).
    this.head    = new VirtualHead(this._carriagePicaDots(), () => this.getCharsPerSecond());
    this.ribbon  = new VirtualRibbon("bw");
    // Default form length comes from the paper-length capability (single source);
    // a model overriding defaultPaperLengthInch() (e.g. FX-80 = 12") gets that form
    // at power-on. ESC C / ESC H still retune it live. Methods dispatch to the
    // subclass override even here in the base ctor (defaultPaperLengthInch reads no
    // subclass field), so this is safe before the subclass body runs.
    this.paper   = new VirtualPaperFeed(this.dpi * this.defaultPaperLengthInch(), this.feedDotsPerSec);
    // Horizontal page geometry (paper width + feed mode) is built LAZILY by the
    // `paperGeo` getter, NOT here: its size comes from the per-model capability
    // overrides (defaultPaperWidthInch / paperWidthRange), which must read
    // fully-constructed subclass state. Sizing them from the base constructor —
    // before the subclass body runs — would read undefined fields. First access
    // (renderer / persistence, post-construction) builds and sizes it.
    this._paperGeo = null;

    this._lineBuf = []; // strikes accumulated for the current line
    this._slashedZero = false; // zero-glyph DIP (Epson SW1-2 / DMP SW2-1); a
                               // hardware switch, so it survives a software reset.
  }

  // ---- Operator settings (data-driven; rendered in the printer window panel) ----
  // Each model declares a flat list of friendly settings the operator flips live.
  // These ARE the hardware DIP switches underneath, but the UI shows the plain
  // effect instead of a cryptic switch number. `type` is 'toggle' (boolean,
  // independent) or 'choice' (mutually-exclusive enum with `options`). `target:
  // 'manager'` routes get/set through the shared PrinterManager (cross-model
  // sticky, e.g. Auto-LF); otherwise they act on the active printer. A subclass
  // extends this with `[...super.SETTINGS, …]`.
  static get SETTINGS() {
    return [
      { id: "autoLF", type: "toggle", target: "manager", default: true,
        label: "Auto LF",
        hint: "Line feed on every carriage return (DIP SW2-1)",
        get: (m) => m.getAutoLineFeed(),
        set: (m, v) => m.setAutoLineFeed(v) },
    ];
  }

  // Power-on / default character pitch. Survives a software reset because the
  // model's _resetRenderState re-reads `this._defaultPitch`; the ESC pitch codes
  // still override it at runtime. Pitch keys are the model's own (`this._pitch`).
  getDefaultPitch()    { return this._defaultPitch ?? this._pitch; }
  setDefaultPitch(key) { this._defaultPitch = key; this._pitch = key; }

  // Slashed-zero DIP (Epson SW1-2 / DMP SW2-1): print 0 as Ø. A model that has
  // the switch calls _slashZeroCols() at its zero glyph (code 0x30) when on.
  getSlashedZero()    { return this._slashedZero; }
  setSlashedZero(on)  { this._slashedZero = !!on; }

  // Return a copy of a glyph's column bytes with a forward-slash struck through
  // it (left-bottom → right-top), adapting to the glyph's own width and vertical
  // extent. Column-byte convention: one byte per column, bit 0 = top pin. The
  // source array is never mutated (it's shared ROM data).
  _slashZeroCols(cols) {
    const w = cols.length;
    if (w < 2) return cols;
    let top = Infinity, bot = -1;
    for (const b of cols) {
      for (let r = 0; r < 16; r++) {
        if (b & (1 << r)) { if (r < top) top = r; if (r > bot) bot = r; }
      }
    }
    if (bot < 0) return cols; // blank glyph — nothing to slash
    const out = cols.slice();
    for (let i = 0; i < w; i++) {
      const r = Math.round(bot + (top - bot) * (i / (w - 1)));
      out[i] |= (1 << r);
    }
    return out;
  }

  // ---- Internal dot scale (overridable per model, recomputable at runtime) ----
  // Default working resolution and feed speed. Override in a model that needs a
  // finer scale (e.g. an LQ printer); everything positional follows automatically.
  _defaultDpi()            { return DEFAULT_DPI; }
  _defaultFeedDotsPerSec() { return DEFAULT_FEED_DOTS_PER_SEC; }

  // Derive every DPI-dependent quantity from `this.dpi`. PrinterBase keeps none;
  // models override to recompute their dot pitches (DOT_W/DOT_V, platen width,
  // graphics column widths, …). Called once at construction and again on setDpi().
  _recomputeUnits() {}

  // Change the internal scale at runtime: recompute the model's units, retune the
  // carriage pica advance and the feed speed, rescale the form length, then reset
  // render state so margins/line-height/cursor are re-derived at the new scale.
  setDpi(dpi) {
    if (!(dpi > 0) || dpi === this.dpi) return;
    this.dpi = dpi;
    this._recomputeUnits();
    this.head?.setPitchDots(this._carriagePicaDots());
    this.paper?.setFormDots(Math.round(this.defaultPaperLengthInch() * this.dpi));
    if (typeof this._resetRenderState === "function") this._resetRenderState();
    // Carriage cps needs no re-arm: the head pulls it fresh on the next motion.
  }

  // Retune the feed-motor speed (internal dots/sec) without touching DPI.
  setFeedDotsPerSec(v) {
    if (!(v > 0)) return;
    this.feedDotsPerSec = v;
    this.paper?.setFeedDotsPerSec(v);
  }

  on(event, fn) { this._listeners[event] = fn; }
  off(event)    { delete this._listeners[event]; }

  // Impact hook: fired (dotCount, kind, xDot) at strike release time (not parse
  // time) so sound is correctly paced. kind: 'char' | 'dots' | 'line' |
  // 'return'. Zero dotCount = head moved, no strike (a space) → stay silent.
  onImpact(fn) { this._onImpact = fn; }

  // The manager installs a sink to pace timed events against the wall clock.
  // Each event is {name, data, dt}; dt = ms of head/paper motion before it.
  // Without a sink (tests/headless), events fire in order immediately.
  setEventSink(fn) { this._eventSink = fn; }

  // ---- Ribbon cartridge ----
  setRibbon(kind)  { this.ribbon.setType(kind); }
  getRibbon()      { return this.ribbon.type; }

  // Per-side tractor-margin width in inches — the holed sprocket strip outside
  // the paper body. RENDER-ONLY: the print pipeline never reads this; only the
  // window draws the strips and the outer sheet from it. Encodes the rule that
  // paper has its outside tractor lines as a given — needed only to render them
  // on the sides, never to print. Default ½"; a model overrides if its strip
  // differs. Carried in paperProfile so the view gets it with everything else.
  tractorMarginInch() { return 0.5; }

  // Whether a colour ribbon cartridge can be loaded. Only the ImageWriter II
  // ever shipped a four-band colour ribbon; the IW-I and Epson FX-80 are
  // black-only. The UI hides the colour option for models that return false.
  supportsColorRibbon() { return false; }
  _inkColor(color) { return this.ribbon.ink(color); }

  // ---- Carriage spec (overridable per model) ----
  _carriagePicaDots() { return this.dpi / 10; }      // pica advance (1/10"), internal dots
  _carriageVelocity() { return this.head.velocity; } // dots/sec
  isUnidirectional()  { return false; }              // default: bidirectional

  // Fixed carriage print span in inches — the head's hard travel limit and the
  // ink-clip width (print column 0 .. carriageWidthInch). The C.Itoh family and
  // the FX-80 are all 8". DISTINCT from paper width: paper is the variable sheet
  // (paperWidthRange, what the ruler shows); the carriage is this fixed zone the
  // sheet sits under. Single source: the print pipeline (_platenDots /
  // _printWidthDots) AND the window/profile both read this — no literal *8.
  carriageWidthInch() { return 8; }

  // ---- Paper-geometry capability API (per-model truth; numbers from
  // .claude/agent/printer/paper-sizes.md) ----
  // The model states its own width limits and anchor habit; the PaperGeometry
  // unit and the renderer read these. Base supplies the common case (centered,
  // both sprockets symmetric, universal envelope); each model overrides only what
  // differs (notably the FX-80, which is left-anchored with a single moving right
  // tractor and narrower ranges). Feed is always tractor — no feed-mode param.

  // Legal paper BODY width {min,max} in inches — the printable sheet between the
  // tractor lines (what the ruler shows), strips off. NOT the outer sheet; the
  // window adds tractorMarginInch()/side when rendering. Single source for the
  // width-drag bounds and the ruler span.
  paperWidthRange() { return DEFAULT_PAPER_RANGE; }

  // Power-on paper BODY width (inches), clamped into the active range at boot.
  defaultPaperWidthInch() { return DEFAULT_PAPER_WIDTH_INCH; }

  // Legal paper LENGTH (form/page height) {min,max} in inches. Continuous tractor
  // stock is endless; this is the programmable form length the operator sets (DIP
  // page length, ESC C / ESC H) and the vertical ruler reads. Single source for
  // the page-height extent.
  paperLengthRange() { return DEFAULT_PAPER_LENGTH_RANGE; }

  // Power-on form length (inches), clamped into the active length range at boot.
  defaultPaperLengthInch() { return DEFAULT_PAPER_LENGTH_INCH; }

  // Where the paper sits under the fixed carriage print zone: 'left' (column 1 at
  // the sheet's left edge — FX-80) or 'center' (paper centered on the zone — C.Itoh
  // family; the ImageWriter I manual ch.2 step 8 has the operator slide both
  // sprockets to centre the stock on the 8" line marked by the two red rings).
  // Consumed by computeLayout() to position the sheet under the zone.
  paperAnchor() { return "center"; }

  // How dragging a sprocket strip resizes paper: 'both' (symmetric, paper stays
  // centered, ΔW = 2×drag — both C.Itoh tractors slide on the square shaft) or
  // 'right-fixed-left' (left tractor pinned at column 1, right tractor moves,
  // ΔW = drag — FX-80). Consumed by the window's _initWidthDrag.
  sprocketSymmetry() { return "both"; }

  // Whether the model paints dots on the paper canvas (vs. a text-only view).
  // Every modelled dot-matrix printer does; lets the window decide the canvas UI
  // from a capability instead of a hardcoded id list.
  usesPaperCanvas() { return true; }

  // Canvas display raster, pixels per inch — ISOTROPIC (same X and Y): one inch of
  // paper is this many canvas px in both axes, so page geometry (edges, ruler,
  // page height) is square. This is the LAYOUT scale only. It is NOT the dot
  // aspect: a 9-wire dot's 1/72" vertical pitch is stretched to fill the 120-px/in
  // canvas at paint time (the renderer's VSTRETCH), and horizontal density is the
  // dot→canvas mapping off this.dpi — both separate from this layout raster.
  // Printer-owned so a future model with a different display scale adapts.
  canvasPxPerInch() { return 120; }

  // ---- The printer↔view contract -------------------------------------------
  // ONE frozen descriptor carrying every dimension the paper/ruler/tractor/head
  // view needs, assembled from the capability methods above. The window consumes
  // this once when the printer is set, instead of calling eight getters from many
  // places (which is how dimensions drifted out of sync). A model can override an
  // individual method (the normal path) or this whole assembler. NOTE: dpi is NOT
  // here — internal density stays its own live channel (setDpi/_recomputeUnits).
  paperProfile() {
    return Object.freeze({
      carriageWidthInch: this.carriageWidthInch(),  // fixed ink-clip / head-travel span
      tractorMarginInch: this.tractorMarginInch(),  // render-only ½"/side sprocket strip
      widthRange:        this.paperWidthRange(),     // legal paper BODY width {min,max}
      lengthRange:       this.paperLengthRange(),    // legal form length {min,max}
      anchor:            this.paperAnchor(),         // 'left' | 'center'
      sprocketSymmetry:  this.sprocketSymmetry(),    // 'both' | 'right-fixed-left'
      usesCanvas:        this.usesPaperCanvas(),
      pxPerInch:         this.canvasPxPerInch(),     // isotropic layout raster (px/in)
    });
  }

  // Lazily-built horizontal page geometry. Deferred out of the constructor so the
  // per-model capability overrides (defaultPaperWidthInch / paperWidthRange) read
  // fully-initialised subclass state instead of undefined mid-construction. Built
  // once on first access and sized to this model's power-on width clamped to its
  // own range; persistence (task 1.5) later loads a saved width over the top.
  get paperGeo() {
    if (!this._paperGeo) {
      const geo = new PaperGeometry();
      geo.setWidthInch(this.defaultPaperWidthInch(), this.paperWidthRange());
      geo.setLengthInch(this.defaultPaperLengthInch(), this.paperLengthRange());
      this._paperGeo = geo;
    }
    return this._paperGeo;
  }

  // ===== Input side: subclasses call emit() during parsing =====
  emit(event, data) {
    switch (event) {
      case "printChar":
      case "printDots":
        // Buffer the strike at its absolute column; the head decides the order.
        this._lineBuf.push({ event, data, xDot: data?.xDot | 0 });
        return;
      case "newline":
      case "linefeed":
      case "carriagereturn":
        this._fire(event, data);     // text-view listeners (no-op in canvas mode)
        this._commitLine(event, data);
        return;
      case "formfeed":
        this._fire(event, data);
        this._commitLine("formfeed", data);
        return;
      default:
        this._fire(event, data);     // 'text' and any other passthrough
    }
  }

  // ===== Commit a buffered line: the head sweeps its strikes in travel order =====
  _commitLine(kind, data) {
    const buf = this._lineBuf;
    this._lineBuf = [];

    for (const s of this.head.order(buf)) {
      const dt = this.head.moveTo(s.xDot); // travel to the strike, timed
      this._timed(s.event, s.data, dt);
    }

    if (kind === "flush") return; // partial line (idle flush): no paper feed yet
    this._commitFeed(kind, data);
  }

  _commitFeed(kind, data) {
    if (kind === "carriagereturn") {
      // CR with Auto-LF off: the paper does NOT advance — the next pass
      // overprints this same band. In UNIDIRECTIONAL mode the head slews back
      // to the left margin (charge the return travel, no paper feed). In the
      // power-on BIDIRECTIONAL default the head stays put and just flips travel,
      // so the overprint pass sweeps back the other way with no wasted return
      // slew — genuine back-and-forth, the way a colour dump actually prints.
      if (this.isUnidirectional()) {
        const returnMs = this.head.returnMs();
        this._timed("feed", { sound: "return", dist: this.head.x }, returnMs);
        this.head.home();
      } else {
        this.head.flip();
      }
      return;
    }

    if (kind === "formfeed") {
      // The model has already slewed the cursor; `dist` is how far it moved.
      const ejectMs  = this.paper.feedMs(data?.dist | 0);
      const returnMs = this.head.returnMs();
      this._timed("feed", { sound: "return", dist: this.head.x }, ejectMs + returnMs);
      this.head.home();
      return;
    }

    const feedMs = this.paper.feedMs(this._lineFeedDots());

    if (kind === "linefeed") {
      // LF: paper down only. Head neither returns nor reverses.
      this._timed("feed", { sound: "line", dist: this.head.x }, feedMs);
      return;
    }

    // CR (newline): feed paper, then either slew home (unidirectional) or just
    // flip travel direction (bidirectional — the head stays put and prints the
    // next line back the other way).
    if (this.isUnidirectional()) {
      const returnMs = this.head.returnMs();
      this._timed("feed", { sound: "return", dist: this.head.x }, feedMs + returnMs);
      this.head.home();
    } else {
      this._timed("feed", { sound: "line", dist: this.head.x }, feedMs);
      this.head.flip();
    }
  }

  // Vertical dots advanced per line feed. Subclasses with a line height track it.
  _lineFeedDots() { return (typeof this._lineHeight === "number") ? this._lineHeight : 80; }

  // Print-head home: where the head rests vertically at power-on (internal dots).
  _homeYDot() { return POWER_ON_HEAD_DOTS; }

  // ---- Operator panel: manual paper positioning ----
  // These drive the one vertical cursor (`_yDot`) the model renders from, so the
  // platen buttons move the paper exactly like a line feed from the host would.

  // Advance the paper `lines` line-heights (paper moves down past the head).
  lineFeedDown(lines = 1) {
    const dots = lines * this._lineFeedDots();
    this._yDot = (this._yDot | 0) + dots;
    this._timed("feed", { sound: "line", dist: this.head.x }, this.paper.feedMs(dots));
  }

  // Reverse-feed the paper `lines` line-heights (platen knob backward).
  lineFeedUp(lines = 1) {
    const dots = lines * this._lineFeedDots();
    this._yDot = Math.max(0, (this._yDot | 0) - dots);
    this._timed("feed", { sound: "line", dist: this.head.x }, this.paper.feedMs(dots));
  }

  // Latch the current paper position as top-of-form (SET/TOF button).
  setTopOfForm() { this.paper.setTopOfForm(this._yDot | 0); }

  // Slew to the next page's top-of-form. Shared by the host FF byte and the
  // panel Form Feed button, so both honour the latched top-of-form.
  formFeed() {
    const fromY = this._yDot | 0;
    this._xDot = 0;
    this._yDot = this.paper.nextFormTop(fromY, this._effectiveFormDots());
    this.emit("formfeed", { dist: this._yDot - fromY });
  }

  // Effective form length in dots for page-boundary math: the feed unit's own
  // formDots when a program set one (ESC H), otherwise derived from the
  // operator's form length (paperGeo.lengthInch). The window parks
  // paper.formDots at 0 as an "unset" sentinel so its page-height readout tracks
  // lengthInch; resolving it here keeps the form feed in step with that display
  // and stops a /0 NaN from killing _yDot (and every strike after the first form
  // feed). Used by formFeed() and the FX-80 skip-over-perforation check.
  _effectiveFormDots() {
    return this.paper.formDots > 0
      ? this.paper.formDots
      : Math.round(this.dpi * (this.paperGeo?.lengthInch ?? this.defaultPaperLengthInch()));
  }

  // Commit any partial (un-terminated) line so trailing output still prints.
  flushLine() { if (this._lineBuf.length) this._commitLine("flush"); }

  // ===== Output side: a timed event, deferred to the sink or fired now =====
  _timed(name, data, dt) {
    if (this._eventSink) this._eventSink({ name, data, dt });
    else                 this._fire(name, data);
  }

  // Notify listeners + the impact hook. Called by the manager's scheduler at
  // the event's release time.
  _fire(event, data) {
    if (this._onImpact) {
      if (event === "printChar") {
        this._onImpact(this._countCharDots(data), "char", data?.xDot | 0);
      } else if (event === "printDots") {
        this._onImpact(popcount(data?.byte | 0), "dots", data?.xDot | 0);
      } else if (event === "feed") {
        this._onImpact(0, data?.sound === "return" ? "return" : "line", data?.dist | 0);
      }
    }
    if (this._listeners[event]) this._listeners[event](data);
  }

  // Total pins that fire for one glyph (sum of set dots across columns),
  // weighted up for bold (double-strike) and underline (extra wire).
  _countCharDots(data) {
    if (!data || !data.cols) return 0;
    let dots = 0;
    for (const c of data.cols) dots += popcount(c);
    if (data.bold)      dots = Math.round(dots * 1.6);
    if (data.underline) dots += data.cols.length;
    return dots;
  }

  // Called for every byte received from the card
  receiveByte(byte) {}

  reset() {
    this.head.reset();
    this.paper.reset();
    this._lineBuf = [];
  }

  // Hardware print rate in characters per second (pica draft).
  getCharsPerSecond() { return 120; }

  getName() { return "Printer"; }
  getId()   { return "base"; }
}
