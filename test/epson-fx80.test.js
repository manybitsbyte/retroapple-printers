/*
 * epson-fx80.test.js - Golden tests for the Epson FX-80 emulation
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import { EpsonFX80 } from "../src/epson-fx80.js";
import { bytes, capture, summarise, CR, LF, FF, SI, SO, ESC } from "./harness.js";

/** A fresh printer per case — these are stateful machines. */
function fx80() {
  return new EpsonFX80();
}

function run(data) {
  return summarise(capture(fx80(), bytes(...data)));
}

describe("EpsonFX80 — text", () => {
  it("prints a plain line terminated by CR LF", () => {
    expect(run(["HELLO", CR, LF])).toMatchSnapshot();
  });

  it("advances the head one pica per character", () => {
    // Column positions are the load-bearing part here: each glyph must land a
    // fixed advance further right than the last.
    const events = capture(fx80(), bytes("ABCD", CR, LF));
    const columns = events
      .filter((e) => e.name === "printChar")
      .map((e) => e.data.xDot);
    expect(columns).toMatchSnapshot();
  });

  it("strips the Apple II high bit from character codes", () => {
    // The card delivers ASCII with bit 7 set; "HI" and "HI"|0x80 must print
    // identically.
    const plain = run(["HI", CR, LF]);
    const highBit = run([0xc8, 0xc9, CR, LF]);
    expect(highBit).toEqual(plain);
  });
});

describe("EpsonFX80 — character attributes", () => {
  it("ESC E turns on emphasized (bold)", () => {
    expect(run([ESC, "E", "AB", CR, LF])).toMatchSnapshot();
  });

  it("ESC F cancels emphasized", () => {
    expect(run([ESC, "E", "A", ESC, "F", "B", CR, LF])).toMatchSnapshot();
  });

  it("ESC - 1 turns on underline, ESC - 0 turns it off", () => {
    expect(run([ESC, "-", 1, "A", ESC, "-", 0, "B", CR, LF])).toMatchSnapshot();
  });

  it("ESC 4 turns on italic, ESC 5 cancels it", () => {
    expect(run([ESC, "4", "A", ESC, "5", "B", CR, LF])).toMatchSnapshot();
  });
});

describe("EpsonFX80 — pitch", () => {
  it("SI selects condensed and SO selects one-line enlarged", () => {
    expect(run([SI, "AB", CR, LF, SO, "CD", CR, LF])).toMatchSnapshot();
  });

  it("condensed narrows the per-character advance", () => {
    const advance = (data) => {
      const cols = capture(fx80(), bytes(...data))
        .filter((e) => e.name === "printChar")
        .map((e) => e.data.xDot);
      return cols[1] - cols[0];
    };
    expect(advance(["AB", CR, LF])).toBeGreaterThan(advance([SI, "AB", CR, LF]));
  });
});

describe("EpsonFX80 — line spacing and paper motion", () => {
  it("ESC 0 / ESC 1 / ESC 2 select 1/8in, 7/72in and 1/6in feeds", () => {
    expect(run([ESC, "0", "A", CR, LF, ESC, "1", "B", CR, LF, ESC, "2", "C", CR, LF]))
      .toMatchSnapshot();
  });

  it("form feed ejects the page", () => {
    expect(run(["A", CR, LF, FF])).toMatchSnapshot();
  });

  it("CR without LF does not feed the paper", () => {
    // Auto-LF off: the next pass overprints the same band.
    const feeds = capture(fx80(), bytes("A", CR, "B", CR, LF))
      .filter((e) => e.name === "feed")
      .map((e) => e.data.sound);
    expect(feeds).toMatchSnapshot();
  });
});

describe("EpsonFX80 — bit-image graphics", () => {
  it("ESC K emits one dot column per data byte", () => {
    // ESC K n1 n2 <n1+256*n2 columns>. Four columns with distinct pin patterns.
    expect(run([ESC, "K", 4, 0, 0x01, 0x81, 0xff, 0x00, CR, LF])).toMatchSnapshot();
  });

  it("ESC K reverses Epson MSB-is-top into renderer bit-0-is-top order", () => {
    // 0x01 has only the LSB set on the wire, which is the BOTTOM pin, so the
    // renderer must see it at bit 7. This is the wire-order convention that a
    // reimplementation is most likely to get backwards.
    const dots = capture(fx80(), bytes(ESC, "K", 1, 0, 0x01, CR, LF))
      .filter((e) => e.name === "printDots")
      .map((e) => e.data.byte);
    expect(dots).toEqual([0x80]);
  });

  it("ESC ^ nine-pin graphics carries pin 9 from the second byte", () => {
    // Pins 1-8 from byte1, pin 9 from bit 7 of byte2 — pin 9 lands at bit 8.
    const dots = capture(fx80(), bytes(ESC, "^", 0, 1, 0, 0x00, 0x80, CR, LF))
      .filter((e) => e.name === "printDots")
      .map((e) => e.data.byte);
    expect(dots).toEqual([0x100]);
  });

  it("a zero-length graphics run consumes no data bytes", () => {
    // ESC K 0 0 must return to normal parsing, so "AB" prints as text.
    expect(run([ESC, "K", 0, 0, "AB", CR, LF])).toMatchSnapshot();
  });
});
