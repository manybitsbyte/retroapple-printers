/*
 * jobs.js - Sample print jobs, one per model
 *
 * These are byte streams exactly as a program of the era would have sent them:
 * escape codes inline with the text, no abstraction over the wire format. The
 * point is to exercise each machine's own command set, not a lowest common
 * denominator — so the ImageWriter jobs speak C. Itoh and the FX-80 job speaks
 * ESC/P, and they look different because the printers were different.
 *
 * Written by
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *  Mike Daley <michael_daley@icloud.com>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

export const ESC = 0x1b, CR = 0x0d, LF = 0x0a, FF = 0x0c, SO = 0x0e, SI = 0x0f;

/** Build a byte array from strings, numbers and nested arrays. */
export function bytes(...parts) {
  const out = [];
  for (const p of parts) {
    if (typeof p === "string") for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
    else if (Array.isArray(p)) out.push(...bytes(...p));
    else out.push(p & 0xff);
  }
  return out;
}

/** A line of text followed by CR LF. */
const line = (...parts) => bytes(...parts, CR, LF);
/** A blank line. */
const blank = () => bytes(CR, LF);

// ── C. Itoh / ImageWriter command set ───────────────────────────────────────
// Pitch:     ESC n extended · ESC N pica · ESC E elite · ESC Q condensed
// Emphasis:  ESC ! bold on · ESC " bold off
// Underline: ESC X on · ESC Y off
// Colour:    ESC K <n> selects a ribbon band on the ImageWriter II
const IW = {
  extended: [ESC, "n"], pica: [ESC, "N"], elite: [ESC, "E"], condensed: [ESC, "Q"],
  boldOn: [ESC, "!"], boldOff: [ESC, '"'],
  ulOn: [ESC, "X"], ulOff: [ESC, "Y"],
  color: (n) => [ESC, "K", 0x30 + n],
};

// ── Epson ESC/P command set ─────────────────────────────────────────────────
// Emphasis: ESC E emphasized on · ESC F off · ESC G double-strike · ESC H off
// Italic:   ESC 4 on · ESC 5 off
// Underline:ESC - 1 on · ESC - 0 off
// Width:    SO double-width (one line) · SI condensed · DC2 cancel condensed
// Graphics: ESC K <lo> <hi> <data…>  single density, 60 dpi
const FX = {
  emphOn: [ESC, "E"], emphOff: [ESC, "F"],
  dstrikeOn: [ESC, "G"], dstrikeOff: [ESC, "H"],
  italicOn: [ESC, 0x34], italicOff: [ESC, 0x35],
  ulOn: [ESC, "-", 1], ulOff: [ESC, "-", 0],
  condensed: [SI], condensedOff: [0x12],
  graphics: (data) => [ESC, "K", data.length & 0xff, (data.length >> 8) & 0xff, ...data],
};

/**
 * A filled sine wave as nine-pin bit-image data.
 *
 * Each byte is one vertical column of wires — bit 0 is the top wire — so a
 * shape is built by deciding, per column, which wires fire. Filling from the
 * curve down to the bottom wire makes it read as a solid graphic rather than a
 * hairline, which is the point: proving the bit-image path is as real as the
 * character path.
 */
function wave(width = 300) {
  const out = [];
  for (let x = 0; x < width; x++) {
    const top = Math.round(4 + 3.6 * Math.sin((x / width) * Math.PI * 6));
    let col = 0;
    for (let wire = top; wire < 9; wire++) col |= 1 << wire;
    out.push(col);
  }
  return out;
}

const RULE = "=".repeat(60);

/** ImageWriter II — the flagship: pitches, emphasis, and the colour ribbon. */
function imagewriterII() {
  return [
    ...line(IW.boldOn, "  APPLE IMAGEWRITER II", IW.boldOff),
    ...line("  ", RULE.slice(0, 40)),
    ...blank(),
    ...line(IW.pica,      "Pica      10 cpi  ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.elite,     "Elite     12 cpi  ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.condensed, "Condensed 15 cpi  ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.extended,  "Extended   9 cpi  ABCDEFGHIJKLM abcdefg"),
    ...blank(),
    ...line(IW.pica, "Normal   ", IW.boldOn, "Bold   ", IW.boldOff, IW.ulOn, "Underlined", IW.ulOff),
    ...blank(),
    ...line("Four-band colour ribbon:"),
    ...line(IW.color(1), "yellow  ", IW.color(2), "magenta  ", IW.color(3), "cyan  ",
            IW.color(0), "black"),
    ...blank(),
    ...line(IW.color(0), "The quick brown fox jumps over the lazy dog."),
    ...line("Pack my box with five dozen liquor jugs. 0123456789"),
    ...line("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
  ];
}

/** ImageWriter I — monochrome, standard face only. */
function imagewriterI() {
  return [
    ...line(IW.boldOn, "  APPLE IMAGEWRITER I", IW.boldOff),
    ...line("  ", RULE.slice(0, 40)),
    ...blank(),
    ...line(IW.pica,      "Pica      ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.elite,     "Elite     ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.condensed, "Condensed ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...blank(),
    ...line(IW.pica, "Normal   ", IW.boldOn, "Bold   ", IW.boldOff, IW.ulOn, "Underlined", IW.ulOff),
    ...blank(),
    ...line("The quick brown fox jumps over the lazy dog."),
    ...line("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
  ];
}

/** Apple DMP — C. Itoh 8510 lineage, 1982. */
function appleDMP() {
  return [
    ...line(IW.boldOn, "  APPLE DOT MATRIX PRINTER", IW.boldOff),
    ...line("  ", RULE.slice(0, 40)),
    ...blank(),
    ...line(IW.pica,      "Pica      ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.elite,     "Elite     ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(IW.condensed, "Condensed ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...blank(),
    ...line(IW.pica, "Normal   ", IW.boldOn, "Bold   ", IW.boldOff, IW.ulOn, "Underlined", IW.ulOff),
    ...blank(),
    ...line("The quick brown fox jumps over the lazy dog."),
    ...line("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
  ];
}

/** Epson FX-80 — ESC/P, including a bit-image graphic. */
function epsonFX80() {
  return [
    ...line(FX.emphOn, "  EPSON FX-80", FX.emphOff),
    ...line("  ", RULE.slice(0, 40)),
    ...blank(),
    ...line("Pica      ABCDEFGHIJKLM abcdefghijklm 0123456789"),
    ...line(FX.condensed, "Condensed ABCDEFGHIJKLM abcdefghijklm 0123456789", FX.condensedOff),
    ...blank(),
    ...line("Normal  ", FX.emphOn, "Emphasized  ", FX.emphOff,
            FX.dstrikeOn, "Double-strike", FX.dstrikeOff),
    ...line(FX.italicOn, "Italic - the high half of the ROM", FX.italicOff),
    ...line(FX.ulOn, "Underlined", FX.ulOff),
    ...blank(),
    ...line("Bit-image graphics, ESC K single density:"),
    ...line(FX.graphics(wave())),
    ...blank(),
    ...line("The quick brown fox jumps over the lazy dog."),
    ...line("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
  ];
}

export const JOBS = {
  "imagewriter-ii": { title: "ImageWriter II", build: imagewriterII },
  "imagewriter-i":  { title: "ImageWriter I",  build: imagewriterI },
  "apple-dmp":      { title: "Apple DMP",      build: appleDMP },
  "epson-fx80":     { title: "Epson FX-80",    build: epsonFX80 },
};

/**
 * A three-page job, for `npm run print -- --multipage`.
 *
 * Two ways of reaching a new sheet, deliberately both:
 *
 *   - page 1 ends with an explicit FORM FEED, which slews the paper to the next
 *     top-of-form however far down the page the last line landed;
 *   - page 2 ends by simply running off the bottom — 70 line feeds against a
 *     66-line form — because nothing about a page boundary is special. `yDot`
 *     just keeps counting and crosses into the next sheet on its own.
 *
 * A renderer that handles the first but not the second will silently lose the
 * overflow, which is the mistake this job exists to catch.
 */
export function multipage() {
  const out = [];

  out.push(...line("  PAGE ONE - ended by an explicit form feed"));
  out.push(...line("  ", RULE.slice(0, 44)));
  for (let i = 1; i <= 8; i++) out.push(...line(`  line ${i} of page one`));
  out.push(FF);

  out.push(...line("  PAGE TWO - runs off the bottom with no form feed"));
  out.push(...line("  ", RULE.slice(0, 44)));
  // 66 lines is an 11" form at 6 lpi; go past it so the overflow lands on p3.
  for (let i = 1; i <= 70; i++) out.push(...line(`  line ${i} of page two`));

  out.push(...line("  PAGE THREE - the overflow, reached without a form feed"));
  out.push(...line("  ", RULE.slice(0, 44)));
  for (let i = 1; i <= 6; i++) out.push(...line(`  line ${i} of page three`));

  return out;
}
