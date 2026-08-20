/*
 * Type declarations for @manybitsbyte/retroapple-printers
 *
 * Hand-written against the JavaScript implementation. The runtime is plain ES
 * modules; these declarations describe it rather than generate it, so a change
 * to the engine does not silently invalidate them — keep the two in step.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

// ── Events ──────────────────────────────────────────────────────────────────

/**
 * A glyph struck on the paper.
 *
 * Carries no character code: by this point the glyph IS the column data, and
 * the human-readable character arrives separately as a `text` event.
 *
 * Position is ABSOLUTE, in internal dots of 1/`dpi` inch, and both coordinates
 * are needed — there is no cursor to track and nothing accumulates. Column `i`
 * of the glyph sits at `xDot + i * dotW`; bit `n` of a column sits at
 * `yDot + n * dotH`. The two pitches differ: `dotH` is `dpi / 72` because the
 * wires are 1/72" apart on the head, while `dotW` follows the character pitch.
 */
export interface PrintCharEvent {
  /** Horizontal position of the glyph's first column, in internal dots. */
  xDot: number;
  /** Vertical position of the glyph's top wire, in internal dots from page one. */
  yDot: number;
  /** Width of ONE column, in internal dots. Not the width of the glyph. */
  dotW: number;
  /** Spacing of ONE wire, in internal dots. Always dpi/72. */
  dotH: number;
  /** Dot columns, left to right. Bit 0 = top wire. */
  cols: number[];
  /** Ribbon band this glyph was struck through. "black" on a mono ribbon. */
  color?: string;
  /** Struck twice, offset, so the strokes thicken. The renderer lays the second pass. */
  bold?: boolean;
  underline?: boolean;
  /** "none" | "super" | "sub". */
  script?: string;

  /**
   * C. Itoh models only. The Epson emits a nine-wire cell and reports none of
   * these, so a renderer serving both must supply its own defaults — `rows`
   * falls back to 9.
   */
  rows?: number;
  /** Column dot density in dpi, for a host laying out its own raster. */
  hDensity?: number;
  /** Row dot density in dpi. */
  vDensity?: number;
  halfHeight?: boolean;
  doubleWidth?: boolean;
}

/**
 * One raw graphics column, from the bit-image commands.
 *
 * Positioned exactly like a glyph strike, and one column wide.
 */
export interface PrintDotsEvent {
  /** The column bitmask. Bit 0 = top wire; nine-wire models reach bit 8. */
  byte: number;
  xDot: number;
  yDot: number;
  dotW: number;
  dotH: number;
  color?: string;
}

/**
 * A carriage or paper movement that took time.
 *
 * `dist` is NOT how far the paper moved. It is the head's horizontal position
 * when the movement happened, which is what a host needs to pan the carriage
 * sound — vertical position already arrives on every strike as `yDot`.
 * Integrating `dist` as a paper advance stacks every line on the first one.
 */
export interface FeedEvent {
  /** The head's horizontal position, in internal dots. A sound cue, not a distance. */
  dist: number;
  /** "line" — paper advance · "return" — carriage slew back to the left margin. */
  sound: "line" | "return" | (string & {});
}

/**
 * One record from the event sink.
 *
 * `dt` is the wall-clock cost of the motion this record represents, in
 * milliseconds, as charged by the virtual head and paper feed. A host that
 * wants real printer pacing releases records on that timeline; a host that
 * just wants the page can ignore it and consume the stream as fast as it likes.
 */
export type SinkEvent =
  | { name: "printChar"; data: PrintCharEvent; dt?: number }
  | { name: "printDots"; data: PrintDotsEvent; dt?: number }
  | { name: "feed";      data: FeedEvent;      dt?: number };

/**
 * Events delivered through `on()` rather than the sink.
 *
 * These fire immediately as the byte stream is parsed, not on the timed
 * release path, so they interleave with sink records in call order: a
 * `newline` listener fires before the strikes that line committed.
 *
 * Note that `formfeed` carries `{ dist }` too, and there it really IS a
 * vertical distance — the opposite of the sink's `feed`.
 */
export type ListenerEvent =
  | "text"
  | "newline"
  | "linefeed"
  | "carriagereturn"
  | "formfeed"
  | "backspace";

// ── Geometry ────────────────────────────────────────────────────────────────

export interface Range {
  min: number;
  max: number;
}

/** Every dimension a paper view needs, assembled once from the capability methods. */
export interface PaperProfile {
  carriageWidthInch: number;
  tractorMarginInch: number;
  widthRange: Range;
  lengthRange: Range;
  anchor: "left" | "center" | (string & {});
  sprocketSymmetry: "both" | "right-fixed-left" | (string & {});
  usesCanvas: boolean;
  pxPerInch: number;
}

/** Pixel layout produced by `computeLayout`, with body-left as ruler zero. */
/**
 * A quantized paper width. `value` is on the ¼" grid and range-clamped;
 * `snapped` is true only when it also lands on a `STANDARD_WIDTHS_INCH` stock
 * size reachable in that range — a cue for UI emphasis, not a different result.
 */
export interface SnapResult {
  value: number;
  snapped: boolean;
}

export interface PaperLayout {
  paperLPx: number;
  paperRPx: number;
  sheetLPx: number;
  sheetRPx: number;
  zoneOriginPx: number;
  tractorPx: number;
  widthPx: number;
  heightPx: number;
}

/** One entry in a model's operator-panel descriptor. */
export interface PrinterSetting {
  id: string;
  type: "toggle" | "select" | (string & {});
  target: "manager" | "printer" | (string & {});
  label: string;
  hint?: string;
  default?: unknown;
  options?: Array<{ value: unknown; label: string }>;
  get(target: unknown): unknown;
  set(target: unknown, value: unknown): void;
}

// ── Core ────────────────────────────────────────────────────────────────────

/**
 * Abstract base for every printer model.
 *
 * Composes the machine out of virtual mechanisms — carriage, ribbon, paper feed,
 * page geometry — rather than scattered bookkeeping. A subclass parses the byte
 * stream and reports strikes at absolute columns; the base buffers a line, lets
 * the head replay those strikes in true travel order so bidirectional printing
 * is genuine, charges each motion its real wall-clock cost, and hands the timed
 * events to the sink.
 */
export abstract class PrinterBase {
  /** Internal dot density, both axes. 480 unless a model raises it. */
  readonly dpi: number;

  readonly head: VirtualHead;
  readonly ribbon: VirtualRibbon;
  readonly paper: VirtualPaperFeed;

  /** Feed one byte, exactly as it would arrive from the interface card. */
  receiveByte(byte: number): void;

  /**
   * Release a partial line.
   *
   * Strikes are buffered until a line terminator so the head can replay them in
   * travel order, so a job not ending in CR/LF/FF leaves its last line held.
   */
  flushLine(): void;

  reset(): void;

  /**
   * Timed strikes and feeds, in carriage-travel order.
   *
   * Exactly three record names reach the sink: `printChar`, `printDots`, `feed`.
   */
  setEventSink(fn: (event: SinkEvent) => void): void;

  on(event: ListenerEvent | string, fn: (payload: unknown) => void): void;
  off(event: ListenerEvent | string): void;

  /** Per-strike hook for a host driving impact sound. */
  onImpact(fn: (data: unknown) => void): void;

  getName(): string;
  getId(): string;
  getCharsPerSecond(): number;
  isUnidirectional(): boolean;

  setDpi(dpi: number): void;
  setFeedDotsPerSec(v: number): void;

  getDefaultPitch(): string;
  setDefaultPitch(key: string): void;
  getSlashedZero(): boolean;
  setSlashedZero(on: boolean): void;

  setRibbon(kind: "bw" | "color" | (string & {})): void;
  getRibbon(): string;
  supportsColorRibbon(): boolean;

  lineFeedDown(lines?: number): void;
  lineFeedUp(lines?: number): void;
  setTopOfForm(): void;
  formFeed(): void;

  carriageWidthInch(): number;
  tractorMarginInch(): number;
  paperWidthRange(): Range;
  paperLengthRange(): Range;
  defaultPaperWidthInch(): number;
  defaultPaperLengthInch(): number;

  paperAnchor(): "left" | "center" | (string & {});
  sprocketSymmetry(): "both" | "right-fixed-left" | (string & {});
  usesPaperCanvas(): boolean;
  canvasPxPerInch(): number;
  paperProfile(): Readonly<PaperProfile>;

  /** Lazily built horizontal page geometry. A property, not a method. */
  readonly paperGeo: PaperGeometry;

  /**
   * Model-declared settings descriptor, for a host building an operator panel.
   * Static, and a subclass extends it with `[...super.SETTINGS, …]`.
   */
  static readonly SETTINGS: PrinterSetting[];
}

/**
 * The complete C. Itoh 8510 command core.
 *
 * Parser, render state, custom characters, graphics and the correspondence base
 * face all live here; the three Apple-lineage models are thin subclasses that
 * add their own ROM banks and identity.
 */
export abstract class CItohPrinter extends PrinterBase {
  /**
   * Line feed on every carriage return — DIP SW2-1 on the real machines, and
   * ON at power-on.
   *
   * Turn it OFF for anything that overprints, which means anything that strikes
   * the same band more than once: a colour graphics dump returns the head with
   * a bare CR between ribbon passes, and with Auto-LF on those passes come out
   * as separate stripes instead of mixing.
   */
  setAutoLineFeed(on: boolean): void;
  getAutoLineFeed(): boolean;

  /** A glyph downloaded with ESC I, or null. */
  getCustomChar(code: number): { wireTop: boolean; data: Uint8Array } | null;

  /** Draft-tier glyph. Null on models with no draft tier (the I and the DMP). */
  getDraftChar(code: number, locale?: string): number[] | null;
  /** NLQ-tier glyph. Null on models with no NLQ tier. */
  getNLQChar(code: number, locale?: string): number[] | null;
}

// ── Models ──────────────────────────────────────────────────────────────────

export interface PageSize {
  id: string;
  name: string;
  inches: number;
}

/**
 * Apple ImageWriter II.
 *
 * The only model in the family with draft and NLQ font tiers, an NLQ
 * proportional bank, a four-band colour ribbon, and software-selectable form
 * lengths (ESC H, any length to ~69" in 1/144" steps).
 */
export class ImageWriterII extends CItohPrinter {
  static readonly PAGE_SIZES: PageSize[];
  /** Set form length by PAGE_SIZES id. Returns false if unrecognised. */
  setPageSize(id: string): boolean;
  getPageSize(): string;
  /** Draft-tier glyph: 9-bit columns, bit 0 = wire 1. Null if undefined in ROM. */
  getDraftChar(code: number, locale?: string): number[] | null;
  /** NLQ fixed-pitch glyph: 16 columns, up to 18 bits each. */
  getNLQChar(code: number, locale?: string): number[] | null;
  /** NLQ proportional glyph: variable column count, up to 18 bits each. */
  getNLQPropChar(code: number, locale?: string): number[] | null;
}

/** Apple ImageWriter I — monochrome, one correspondence face. */
export class ImageWriterI extends CItohPrinter {
  getCorrChar(code: number, locale?: string): number[] | null;
  getCorrPropChar(code: number, locale?: string): number[] | null;
}

/** Apple Dot Matrix Printer (A9M0303, 1982) — C. Itoh 8510 lineage. */
export class AppleDMP extends CItohPrinter {
  getCorrChar(code: number, locale?: string): number[] | null;
  getCorrPropChar(code: number, locale?: string): number[] | null;
  /** Power-on pitch: proportional-elite instead of pica (a DIP switch). */
  getElitePropDefault(): boolean;
  setElitePropDefault(on: boolean): void;
}

/** Epson FX-80 — ESC/P, 9-pin, 12x9 cell, Roman and Italic in one 256-glyph ROM. */
export class EpsonFX80 extends PrinterBase {}

// ── Mechanisms ──────────────────────────────────────────────────────────────

/**
 * The carriage.
 *
 * Useful on its own: `order()` plus `travelMs()` will tell you how long a line
 * takes to print bidirectionally without printing anything.
 */
export class VirtualHead {
  constructor(pitchDots?: number, cps?: number);
  /** Current position, internal dots. */
  x: number;
  /** Carriage-return target, internal dots. */
  leftMargin: number;
  /** +1 travelling left to right, -1 right to left. */
  dir: 1 | -1;
  /** Dots per second. */
  readonly velocity: number;
  setCps(cps: number): void;
  setPitchDots(pitchDots: number): void;
  /** Cost in ms of travelling to x, without moving. */
  travelMs(x: number): number;
  /** Travel to x, returning the ms it cost. */
  moveTo(x: number): number;
  /** Sort a line's buffered strikes into this sweep's travel order. */
  order<T extends { xDot: number }>(strikes: T[]): T[];
  returnMs(): number;
  flip(): void;
  home(): void;
  reset(): void;
}

/** The ink cartridge: monochrome, or the four-band colour ribbon. */
export class VirtualRibbon {
  constructor(type?: "bw" | "color");
  type: "bw" | "color";
  setType(type: "bw" | "color" | (string & {})): void;
  /** The band actually laid down: the requested colour, or black on a mono ribbon. */
  ink(color?: string): string;
  isColor(): boolean;
}

/** The vertical stepper: paper position, form length, and feed timing. */
export class VirtualPaperFeed {
  constructor(formDots?: number, feedDotsPerSec?: number);
  formDots: number;
  topOfForm: number;
  feedDotsPerSec: number;
  setFeedDotsPerSec(v: number): void;
  /** Cost in ms of advancing this many internal dots. */
  feedMs(dots: number): number;
  setTopOfForm(y: number): void;
  setFormDots(dots: number): void;
  /** The next top-of-form at or after y — what a form feed slews to. */
  nextFormTop(y: number, formDotsOverride?: number): number;
  reset(): void;
}

/** Horizontal page geometry: paper body width and form length, both clamped. */
export class PaperGeometry {
  constructor(widthInch?: number, range?: Range, lengthInch?: number, lengthRange?: Range);
  widthInch: number;
  lengthInch: number;
  /** Set the width, clamped to `range`. Returns the value actually stored. */
  setWidthInch(widthInch: number, range?: Range): number;
  /** Set the form length, clamped to `lengthRange`. Returns the value actually stored. */
  setLengthInch(lengthInch: number, lengthRange?: Range): number;
  /** Re-clamp the current width to a (possibly new) range. Returns the stored value. */
  reclamp(range?: Range): number;
  /** Re-clamp the current length to a (possibly new) range. Returns the stored value. */
  reclampLength(lengthRange?: Range): number;
  toJSON(): { widthInch: number; lengthInch: number };
  /** Restore, re-clamping to the supplied ranges. Returns `this`. */
  load(obj: { widthInch?: number; lengthInch?: number }, range?: Range, lengthRange?: Range): this;
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface PrinterModel {
  id: "imagewriter-ii" | "imagewriter-i" | "epson-fx80" | "apple-dmp" | (string & {});
  name: string;
  /** Which interface the real machine hung off. */
  interface: "serial" | "parallel" | (string & {});
  create(): PrinterBase;
}

export const PRINTER_MODELS: PrinterModel[];

/** Construct a printer by id. Throws if the id is not a known model. */
export function createPrinter(id: string): PrinterBase;

// ── Page arithmetic ─────────────────────────────────────────────────────────

/** Wires per inch on a nine-pin head. Fixes the physical dot size. */
export const WIRE_PITCH: 72;

/**
 * Live form length in internal dots.
 *
 * Not a constant: ESC H on the ImageWriter II sets any length to about 69
 * inches, ESC C does the same on the FX-80. Read it rather than assuming 11.
 */
export function formDots(printer: PrinterBase): number;

/** Which sheet a strike lands on. Page 0 is the first sheet. */
export function pageOf(yDot: number, formLen: number): number;

/**
 * Vertical position of a strike within its own sheet, in internal dots.
 * Handles a reverse feed above top-of-form, which `yDot % formLen` does not.
 */
export function yOnPage(yDot: number, formLen: number): number;

export interface PageMetrics {
  dpi: number;
  formDots: number;
  formInch: number;
  widthInch: number;
  tractorMarginInch: number;
  wirePitchInch: number;
  /** Dot radius in inches. A property of the head — density never changes it. */
  dotRadiusInch: number;
}

/** Everything a renderer needs to size a sheet, read off the printer. */
export function pageMetrics(
  printer: PrinterBase,
  opts?: { widthInch?: number; formInch?: number },
): PageMetrics;

// ── Bitmap → printer graphics ───────────────────────────────────────────────

// These take PIXELS, which is where a host naturally starts because an emulator
// has already rendered a framebuffer. It is not where the machine starts: an
// Apple II assembles no framebuffer, so a screen dump running on it reads video
// memory, decodes that mode's own layout, and emits the ESC codes itself. That
// decode is the host's to write — see test/printout/apple-video.js for a worked
// one covering LORES, DLORES, HGR and DHGR.

export const SCREEN_W: 560;
export const SCREEN_H: 384;

export interface ScreenDumpOptions {
  /**
   * Per-channel lit threshold, 0–255. Default 0x40. The mono path has no
   * dither: this is the single edge between ink and paper.
   */
  threshold?: number;
  /** Cap the column count. Defaults to the full width. */
  maxCols?: number;
  /**
   * Flip which end of the greyscale inks.
   *
   * These routines were written for an Apple //e screen — black ground, lit
   * pixels — so a LIT pixel means ink by default. A bitmap with a white ground
   * wants `true`, or it prints as a near-solid page.
   */
  invert?: boolean;
  /** ImageWriter only: route to the four-band colour separation. */
  color?: boolean;
}

/**
 * Turn an RGBA framebuffer into that machine's own bit-image byte stream.
 *
 * The bytes go in through `receiveByte()` like any other job — there is no
 * "draw an image" call, and this is how period software actually printed a
 * picture. Row-major RGBA, four bytes per pixel.
 */
export function buildScreenDumpImageWriter(
  fb: Uint8ClampedArray | Uint8Array | number[],
  width?: number, height?: number, opts?: ScreenDumpOptions,
): number[];

/** Alias for the ImageWriter mono path. */
export function buildScreenDump(
  fb: Uint8ClampedArray | Uint8Array | number[],
  width?: number, height?: number, opts?: ScreenDumpOptions,
): number[];

export function buildScreenDumpAppleDMP(
  fb: Uint8ClampedArray | Uint8Array | number[],
  width?: number, height?: number, opts?: ScreenDumpOptions,
): number[];

/**
 * Epson FX-80 bit image, ESC * mode 5.
 *
 * The column count goes out as two BINARY bytes, and the parser masks incoming
 * bytes with 0x7F — so a width whose low byte is 128 or more currently loses
 * exactly 128 columns, which spill into the text path. Keep `width & 0xFF`
 * under 128 until that is fixed.
 */
export function buildScreenDumpEpson(
  fb: Uint8ClampedArray | Uint8Array | number[],
  width?: number, height?: number, opts?: ScreenDumpOptions,
): number[];

/**
 * ImageWriter II four-band colour separation, ordered-dithered, with the Y/M/C/K
 * passes overprinting per 8-dot band so secondaries form in ink.
 *
 * Two host-side preconditions, neither expressible in a type:
 *  - `printer.setRibbon("color")`, or every pass correctly inks black.
 *  - `printer.setAutoLineFeed(false)`, or the per-pass carriage returns also
 *    advance the paper and the passes print as separate stripes.
 *
 * Quantises to the Apple //e palette, not to pure RGB — it was written to
 * reproduce a //e screen.
 */
export function buildScreenDumpColor(
  fb: Uint8ClampedArray | Uint8Array | number[],
  width?: number, height?: number, opts?: ScreenDumpOptions,
): number[];

/** Fraction of pixels above the lit threshold. Drives the auto invert choice. */
export function litDensity(
  fb: Uint8ClampedArray | Uint8Array | number[],
  width?: number, height?: number,
): number;

// ── Geometry helpers and constants ──────────────────────────────────────────

export const DEFAULT_DPI: number;
export const DEFAULT_FEED_DOTS_PER_SEC: number;
export const DEFAULT_PAPER_RANGE: Range;
export const DEFAULT_PAPER_WIDTH_INCH: number;
export const DEFAULT_PAPER_LENGTH_RANGE: Range;
export const DEFAULT_PAPER_LENGTH_INCH: number;
export const STANDARD_WIDTHS_INCH: number[];
export const GRID_INCH: number;

export function clampWidthInch(inches: number, range?: Range): number;
export function clampLengthInch(inches: number, range?: Range): number;
export function snapWidthInch(inches: number, range?: Range, grid?: number): SnapResult;
export function computeLayout(
  profile: PaperProfile | Readonly<PaperProfile>,
  widthInch: number,
  lengthInch: number,
): PaperLayout;

// ── ROM banks ───────────────────────────────────────────────────────────────

/**
 * A character-generator bank: character code → dot columns, left to right.
 *
 * A column is a vertical bitmask with bit 0 = top wire. Nine-wire banks reach
 * bit 8, so values exceed 0xFF; the ImageWriter II NLQ banks reach bit 17
 * across an 18-row cell. Proportional banks carry a variable column count per
 * glyph, and the trailing blank column is the built-in inter-character spacer —
 * part of the advance, not padding.
 */
export type RomBank = Record<number, number[] | undefined>;

/**
 * Character-generator ROM banks and their locale siblings, keyed by export name.
 *
 * Locale variants (…_DE, _FR, _IT, _ES, _SE, _UK, _DK) replace the ten
 * DIP-selected alternate-language code points; each family also exports a
 * _LOCALE_MAP and a _LOCALES list. Models resolve these internally, so reach in
 * here to build a glyph editor, diff a bank, or seed a new model.
 */
export const roms: Record<string, RomBank | Record<string, unknown> | string[]>;
