/*
 * citoh.test.js - Golden tests for the C.Itoh-family printers
 *                 (Apple DMP, ImageWriter I, ImageWriter II)
 *
 * All three share CItohPrinter's command parser and differ in ROM font, ribbon
 * support and default metrics, so the suite runs the shared behaviour across
 * every model and then pins each model's own characteristics.
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
import { AppleDMP } from "../src/apple-dmp.js";
import { ImageWriterI } from "../src/imagewriter-i.js";
import { ImageWriterII } from "../src/imagewriter-ii.js";
import { bytes, capture, summarise, CR, LF, FF, ESC } from "./harness.js";

const MODELS = [
  ["AppleDMP", () => new AppleDMP()],
  ["ImageWriterI", () => new ImageWriterI()],
  ["ImageWriterII", () => new ImageWriterII()],
];

function run(make, data) {
  return summarise(capture(make(), bytes(...data)));
}

describe.each(MODELS)("%s — shared C.Itoh behaviour", (name, make) => {
  it("prints a plain line terminated by CR LF", () => {
    expect(run(make, ["HELLO", CR, LF])).toMatchSnapshot();
  });

  it("strips the Apple II high bit from character codes", () => {
    expect(run(make, [0xc8, 0xc9, CR, LF])).toEqual(run(make, ["HI", CR, LF]));
  });

  it("ESC ! turns bold on and ESC \" turns it off", () => {
    expect(run(make, [ESC, "!", "A", ESC, '"', "B", CR, LF])).toMatchSnapshot();
  });

  it("ESC X starts underline and ESC Y stops it", () => {
    expect(run(make, [ESC, "X", "A", ESC, "Y", "B", CR, LF])).toMatchSnapshot();
  });

  it("ESC x / ESC y / ESC z select superscript, subscript and normal", () => {
    expect(run(make, [ESC, "x", "A", ESC, "y", "B", ESC, "z", "C", CR, LF]))
      .toMatchSnapshot();
  });

  it("pitch commands change the per-character advance", () => {
    // ESC N pica (10 cpi) must advance further than ESC q condensed (15 cpi).
    const advance = (data) => {
      const cols = capture(make(), bytes(...data))
        .filter((e) => e.name === "printChar")
        .map((e) => e.data.xDot);
      return cols[1] - cols[0];
    };
    expect(advance([ESC, "N", "AB", CR, LF]))
      .toBeGreaterThan(advance([ESC, "q", "AB", CR, LF]));
  });

  it("ESC A and ESC B select 6 and 8 lines per inch", () => {
    expect(run(make, [ESC, "A", "A", CR, LF, ESC, "B", "B", CR, LF]))
      .toMatchSnapshot();
  });

  it("ESC > selects unidirectional printing, which slews the head home", () => {
    // Bidirectional (the default) flips travel instead of returning, so the
    // feed sound differs — 'return' vs 'line'.
    const sounds = (data) =>
      capture(make(), bytes(...data))
        .filter((e) => e.name === "feed")
        .map((e) => e.data.sound);
    expect(sounds([ESC, ">", "AB", CR, LF])).toMatchSnapshot();
    expect(sounds([ESC, "<", "AB", CR, LF])).toMatchSnapshot();
  });

  it("form feed ejects the page", () => {
    expect(run(make, ["A", CR, LF, FF])).toMatchSnapshot();
  });

  it("ESC M selects the NLQ font, changing the cell row count", () => {
    // NLQ cells are 18 rows against 9 for draft — a reimplementation that keeps
    // one cell height would pass the text tests and fail here.
    const rows = (data) =>
      capture(make(), bytes(...data))
        .filter((e) => e.name === "printChar")
        .map((e) => e.data.rows);
    expect(rows([ESC, "M", "A", CR, LF])).toMatchSnapshot();
  });
});

describe("model identity and metrics", () => {
  it.each(MODELS)("%s reports stable name, id and dpi", (name, make) => {
    const p = make();
    expect({
      name: p.getName(),
      id: p.getId(),
      dpi: p.dpi,
      cps: p.getCharsPerSecond(),
      colorRibbon: p.supportsColorRibbon(),
    }).toMatchSnapshot();
  });
});

describe("ImageWriter II — colour ribbon", () => {
  it("supports a colour ribbon where the earlier models do not", () => {
    expect(new ImageWriterII().supportsColorRibbon()).toBe(true);
    expect(new ImageWriterI().supportsColorRibbon()).toBe(false);
    expect(new AppleDMP().supportsColorRibbon()).toBe(false);
  });

  it("ESC K n selects the ribbon colour band when a colour cart is loaded", () => {
    // ESC K n takes ASCII '0'-'6'. The ribbon is the physical gate: with the
    // default b/w cart every band maps to black, so the cart must be swapped
    // first or this asserts nothing.
    const colorOf = (ribbon, n) => {
      const p = new ImageWriterII();
      p.setRibbon(ribbon);
      return capture(p, bytes(ESC, "K", n, "A", CR, LF))
        .filter((e) => e.name === "printChar")
        .map((e) => e.data.color);
    };

    // Each selectable band must resolve to a distinct ink on a colour cart.
    const bands = ["0", "1", "2", "3", "4", "5", "6"].map((n) => colorOf("color", n));
    expect(bands.flat()).toMatchSnapshot();

    // A black cart overrides the selection — colour data still prints black.
    expect(colorOf("bw", "1")).toEqual(["black"]);
    expect(colorOf("color", "1")).not.toEqual(["black"]);
  });
});
