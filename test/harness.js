/*
 * harness.js - Golden-test harness for the JS printer emulation
 *
 * The printers are pure state machines: bytes go in via receiveByte(), and the
 * emulation's entire observable output leaves through the event sink as an
 * ordered stream of {name, data, dt} records. PrinterBase.setEventSink() is
 * documented as the headless path ("Without a sink, events fire in order
 * immediately"), so capturing there gets the full behaviour with no DOM, no
 * canvas and no scheduler.
 *
 * These are characterization tests: they pin what the code does today so that
 * refactoring — or a future port out of JavaScript — has to reproduce it
 * exactly, or show the difference as a deliberate snapshot edit.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

/**
 * Build a byte array from a mix of strings and numeric literals.
 *
 *   bytes("HI", CR, LF)            → [72, 73, 13, 10]
 *   bytes(ESC, "E", "Bold")        → [27, 69, 66, 111, 108, 100]
 *
 * Strings contribute their char codes; numbers are emitted verbatim; nested
 * arrays are flattened so callers can splice in generated graphics data.
 */
export function bytes(...parts) {
  const out = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (let i = 0; i < part.length; i++) out.push(part.charCodeAt(i));
    } else if (Array.isArray(part)) {
      out.push(...bytes(...part));
    } else {
      out.push(part & 0xff);
    }
  }
  return out;
}

// Common control codes, named so the test bodies read like a print job.
export const NUL = 0x00;
export const BS = 0x08;
export const HT = 0x09;
export const LF = 0x0a;
export const VT = 0x0b;
export const FF = 0x0c;
export const CR = 0x0d;
export const SO = 0x0e;
export const SI = 0x0f;
export const ESC = 0x1b;

/**
 * Round every number in a structure to `places` decimals.
 *
 * Timings (dt) and dot pitches are computed from divisions like dpi/10 and
 * carriage velocities, so they carry floating-point noise that would otherwise
 * make snapshots fail for reasons unrelated to behaviour.
 */
function roundDeep(value, places) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value;
    const f = 10 ** places;
    // +0 normalises -0, which serialises differently from 0.
    return Math.round(value * f) / f + 0;
  }
  if (Array.isArray(value)) return value.map((v) => roundDeep(v, places));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = roundDeep(value[key], places);
    }
    return out;
  }
  return value;
}

// Events that PrinterBase.emit() passes straight to _fire() rather than
// buffering into the line. These never reach the event sink, so the harness has
// to subscribe to them separately to see the whole picture.
const PASSTHROUGH_EVENTS = [
  "text",
  "newline",
  "linefeed",
  "carriagereturn",
  "formfeed",
  "backspace",
];

/**
 * Feed a byte stream to a printer and return its normalised event stream.
 *
 * The emulation has two output paths and both matter:
 *   - strikes and feeds are buffered, ordered by the head, and released through
 *     the event sink with a travel time (dt);
 *   - text and line-terminator notifications fire immediately through the
 *     listener path.
 * Both are captured into one array in call order, so the snapshot preserves the
 * real interleaving (a "newline" listener call happens before the strikes that
 * line committed).
 *
 * @param {object} printer  A PrinterBase subclass instance
 * @param {number[]} data   Bytes as they would arrive from the interface card
 * @param {object} [opts]
 * @param {number} [opts.places=4]  Decimal places to round numbers to
 * @returns {Array<{name: string, data: *, dt?: number}>}
 */
export function capture(printer, data, opts = {}) {
  const places = opts.places ?? 4;
  const events = [];

  printer.setEventSink((event) => events.push(roundDeep(event, places)));

  for (const name of PASSTHROUGH_EVENTS) {
    printer.on(name, (payload) => events.push(roundDeep({ name, data: payload }, places)));
  }

  for (const byte of data) printer.receiveByte(byte);

  // Strikes buffered on the current line are only committed on a line
  // terminator; without this a job not ending in CR/LF would snapshot as empty.
  printer.flushLine();

  return events;
}

/**
 * Condense an event stream to a compact, human-reviewable form.
 *
 * Full event records are verbose enough that a real regression can hide in the
 * diff. This keeps the shape of the job — what struck the paper, in what order,
 * at which column — which is what these tests are actually asserting about.
 */
export function summarise(events) {
  return events.map((e) => {
    const d = e.data || {};
    switch (e.name) {
      case "printChar": {
        // printChar carries no character code — the glyph is the column data,
        // and the readable character arrives separately as a "text" event.
        const attrs = [
          d.bold ? "bold" : null,
          d.italic ? "italic" : null,
          d.underline ? "underline" : null,
          d.script && d.script !== "none" ? d.script : null,
        ].filter(Boolean);
        return `char x=${d.xDot} w=${d.dotW} cols=${(d.cols || []).length}` +
          (attrs.length ? ` [${attrs.join(",")}]` : "");
      }
      case "printDots":
        return `dots 0b${(d.byte ?? 0).toString(2).padStart(9, "0")} x=${d.xDot} w=${d.dotW}`;
      case "feed":
        return `feed ${d.sound} dist=${d.dist}`;
      case "text":
        return `text ${JSON.stringify(String(e.data ?? ""))}`;
      default:
        return e.name;
    }
  });
}
