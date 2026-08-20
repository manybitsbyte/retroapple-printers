# Integration quickstart

Install to a PNG of a printed page, in about twenty minutes. Every snippet was
executed; the output shown is what it actually printed. Read this before
`ARCHITECTURE-BACKEND.md` (Part I, the engine) and `ARCHITECTURE-FRONTEND.md`
(Part II, a host driving it) — the reference material underneath.

## What you get, what you supply

| The engine gives you | Reached through |
|---|---|
| Command parsing — C. Itoh 8510 and Epson ESC/P: escape codes, custom fonts, bit-image graphics | `receiveByte(byte)` |
| Glyph rendering — a character code becomes dot columns from the model's own ROM | `printChar.cols` |
| Head and paper mechanics — travel order, bidirectional printing, real motion cost | `VirtualHead`, `VirtualPaperFeed` |
| Positioned strike events — absolute `{xDot, yDot}`, no cursor to track | `setEventSink(fn)` |
| Pagination arithmetic — live form length, sheet index, offset on sheet | `pageMetrics`, `pageOf`, `yOnPage` |
| **You supply** | |
| A **byte source** — whatever produced the bytes an era program sent | required |
| A **renderer** — canvas, PNG, SVG, plotter, dot counter | required |
| **Pacing** — honour `dt` for hardware speed | optional |
| **Persistence** — saved pages, restored paper position | optional |

**No renderer ships, deliberately.** The package models the machine and never
decides what the page *looks* like. See the `Sheet.ink` comment in
`test/printout/paper.js`: one dot radius provably cannot give both solid fills
and legible half-tones, because the real mechanism is ink wicking into fanfold —
a property of the paper, not the printer. Step 3 starts from that renderer.

## Install

ESM only. Zero runtime dependencies. Node ≥ 18, browsers, workers and Bun alike.
No DOM, no timers.

```bash
npm install @manybitsbyte/retroapple-printers
```

A checkout works too — `npm install /path/to/retroapple-printers` links the
package into `node_modules/@manybitsbyte/retroapple-printers`, the layout every
import path on this page assumes.

## Step 1 — bytes to text (2 minutes)

```js
import { createPrinter } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("imagewriter-ii");

let out = "";
printer.on("text", (s) => { out += s; });
printer.on("newline", () => { out += "\n"; });

const ESC = 0x1b, CR = 0x0d, LF = 0x0a;
const job = [ESC, 0x21,...[..."HELLO"].map(c => c.charCodeAt(0)), ESC, 0x22,
...[..." world"].map(c => c.charCodeAt(0)), CR, LF];

for (const b of job) printer.receiveByte(b);
printer.flushLine();
console.log(JSON.stringify(out));
```

Prints `"HELLO world\n"` — the parser working with no rendering at all.
`ESC !` / `ESC "` are bold on/off; `on("text")` fires as bytes are parsed, so
escape codes never appear in it.

## Step 2 — see the strikes

`setEventSink` is the real interface. Attach it and look at the payload.

```js
import { createPrinter } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("imagewriter-ii");

let n = 0;
printer.setEventSink((e) => {
 if (n++ < 3) console.log(e.name, `dt=${e.dt.toFixed(2)}ms`, JSON.stringify(e.data));
});

for (const b of [0x41, 0x42, 0x0d, 0x0a]) printer.receiveByte(b); // "AB" CR LF
printer.flushLine();
```

Prints:

```
printChar dt=0.00ms {"cols":[120,4,18,1,16,1,18,4,120,0,0,0],"xDot":0,"yDot":0,"dotW":4,"dotH":6.666666666666667,"rows":9,"hDensity":120,"vDensity":72,"color":"black","bold":false,"underline":false,"halfHeight":false,"script":"none","doubleWidth":false}
printChar dt=4.00ms {"cols":[65,62,65,8,65,8,65,8,54,0,0,0],"xDot":48,"yDot":0,"dotW":4,"dotH":6.666666666666667,"rows":9,"hDensity":120,"vDensity":72,"color":"black","bold":false,"underline":false,"halfHeight":false,"script":"none","doubleWidth":false}
feed dt=25.00ms {"sound":"line","dist":48}
```

Read it. Units are internal dots of 1/480 inch. `cols` is the glyph, one vertical
bitmask per column, **bit 0 = top wire** — column *i* sits at `xDot + i*dotW`, bit
*n* at `yDot + n*dotH`; `dotH` is `dpi/72` because the wires are 1/72″ apart, a
different pitch from the horizontal one. `dt=4.00ms` is one pica step at the
ImageWriter II's 250 cps. `feed` is a **sound cue** — its `dist` is the head's
*horizontal* position, not a paper advance. Exactly three names reach the sink:
`printChar`, `printDots`, `feed`; full payload table in Part I.

## Step 3 — a page you can look at

The repo ships a complete reference renderer. It is not in the npm tarball
(`files` is `src`, `types`, `README.md`, `LICENSE`), so clone the repo for this
step. Run it first.

```bash
npm run print # one page per model
npm run print -- --list # everything runnable
npm run print -- --examples
```

It writes `imagewriter-ii.png`, `imagewriter-i.png`, `epson-fx80.png` and
`apple-dmp.png` into `test/printout/out/`, reporting each:

```
✓ ImageWriter II 545 bytes → 5878 dots · 12 lines · 1 page(s) of 11.00"
 p1 1275×1650px 5878 dots test/printout/out/imagewriter-ii.png
```

Now take it. `test/printout/paper.js` is MIT reference code, not a private API —
copy it into your project with `test/printout/png.js` (it imports it) and repoint
its one relative import, `"../../src/index.js"` →
`"@manybitsbyte/retroapple-printers"`. Then drive it:

```js
import { createPrinter } from "@manybitsbyte/retroapple-printers";
import { Paper } from "./paper.js";

const printer = createPrinter("imagewriter-ii");
const paper = new Paper(printer, { dpi: 150 });
printer.setEventSink(paper.sink);

const ESC = 0x1b, CR = 0x0d, LF = 0x0a;
const text = (s) => [...s].map((c) => c.charCodeAt(0));

for (const b of [...text("Hello from the ImageWriter II."), CR, LF,
 ESC, 0x21,...text("Bold line."), ESC, 0x22, CR, LF])
 printer.receiveByte(b);
printer.flushLine();
console.log(paper.dots, "dots ->", paper.save((page) => `page-${page}.png`)[0].path);
```

Prints `546 dots -> page-1.png`: a 1275×1650 PNG — a full 8.5″ × 11″ sheet at
150 dpi, two lines of text at the top, the rest blank, because that is what came
out of the printer.

## Step 4 — colour and graphics

Only the ImageWriter II took the four-band ribbon, so gate on
`supportsColorRibbon`. A mono ribbon still *honours* `ESC K` — obeyed, but with
no colour in the cartridge, so it inks black.

```js
import { createPrinter } from "@manybitsbyte/retroapple-printers";
import { Paper } from "./paper.js";

const printer = createPrinter("imagewriter-ii");
if (printer.supportsColorRibbon) printer.setRibbon("color"); // else stays "bw"
const paper = new Paper(printer, { dpi: 150 });
printer.setEventSink(paper.sink);

const num4 = (n) => [...String(n).padStart(4, "0")].map((c) => c.charCodeAt(0));

// A 200-column sine band. Bit 0 is the TOP wire, bit 7 the bottom.
const cols = Array.from({ length: 200 }, (_, x) => {
 let b = 0, top = Math.round(4 + 3.4 * Math.sin((x / 200) * Math.PI * 4));
 for (let w = top; w < 8; w++) b |= 1 << w;
 return b;
});

for (const b of [0x1b, 0x4b, 0x35, // ESC K 5 — green
 0x1b, 0x47,...num4(cols.length),...cols, // ESC G nnnn <data>
 0x0d, 0x0a]) printer.receiveByte(b);
printer.flushLine();
console.log(paper.dots, "dots", paper.save(() => "graphics.png")[0].path);
```

Prints `800 dots graphics.png`: 200 `printDots` events, one per column, each
carrying `color: "green"`, which this renderer inks `#4ca854` — 800 lit wires in
all. Drop the `setRibbon("color")` and the identical bytes report black.

`ESC K n` takes ASCII `'0'`–`'6'`: 0 black, 1 yellow, 2 magenta, 3 cyan, 4–6
orange/green/purple — which the printer makes by overprinting two bands.
`ESC G nnnn` takes a **four-digit ASCII** column count, at the current pitch's
density; `ESC S nnnn` is identical and `ESC g nnn` counts 8-byte groups.

## Step 5 — wire your own byte source

The engine does not care where bytes come from. Push them in order, flush at the end.

```js
import { createPrinter } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("epson-fx80");
printer.on("text", (s) => process.stdout.write(s));
printer.on("newline", () => process.stdout.write("\n"));

/** Whatever produces bytes in your app — a card, a socket, a file — calls this. */
const port = { write: (byte) => printer.receiveByte(byte & 0xff) };

for await (const chunk of ["ESC/P from a byte source.\r\n", "second line\r\n"])
 for (const ch of chunk) port.write(ch.charCodeAt(0));

printer.flushLine(); // commit whatever the last line terminator did not
```

Prints both lines. For a real end-to-end source — emulated Super Serial Card →
worker → printer manager → engine, with live canvas and sound — see Part II.

## Step 6 — multi-page

There is **no page-break event**, and none is needed: `yDot` runs continuously
down an endless roll of fanfold and a form feed slews it to the next multiple of
the form length, so pages are arithmetic on a coordinate you already have.

```js
import { createPrinter, pageMetrics, pageOf, yOnPage } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("imagewriter-ii");
const m = pageMetrics(printer); // { dpi, formDots, formInch, widthInch,... }

const pages = new Set;
let lastY = 0;
printer.setEventSink((e) => {
 if (e.name === "feed") return; // feed carries no yDot
 lastY = e.data.yDot;
 pages.add(pageOf(e.data.yDot, m.formDots));
});

const CR = 0x0d, LF = 0x0a, text = (s) => [...s].map((c) => c.charCodeAt(0));
for (let i = 1; i <= 70; i++)
 for (const b of [...text(`line ${i}`), CR, LF]) printer.receiveByte(b);
printer.flushLine();
console.log(`form ${m.formInch}" = ${m.formDots} dots at ${m.dpi} dpi`);
console.log("pages:", [...pages], "· last strike on page", pageOf(lastY, m.formDots),
 "at", (yOnPage(lastY, m.formDots) / m.dpi).toFixed(2) + '"');
```

Prints:

```
form 11" = 5280 dots at 480 dpi
pages: [ 0, 1 ] · last strike on page 1 at 0.50"
```

Never hardcode 11 inches: the form is software-settable (`ESC H` on the
ImageWriter II, `ESC C` on the FX-80), so read it from `formDots(printer)` or
`pageMetrics(printer)` — a 3″ label roll paginated as 11″ puts the whole job on
one enormous sheet. Both routes onto a new sheet, explicit form feed and running
off the bottom, are shown by `npm run print -- --multipage`.

## Choose your mode

| Mode | `dt` | What changes |
|---|---|---|
| **Offline render** | Ignore it; draw every event as it arrives, save at the end | Finished pages, instantly. This is `test/printout/paper.js`. |
| **Live render** | Accumulate it; release each event at its scheduled time | True hardware pacing — 4 ms per pica step at 250 cps, 25 ms per line feed. Same pixels, real duration. |

## Which model?

| id | Interface | Ribbon | Character |
|---|---|---|---|
| `imagewriter-ii` | Serial | Four-band colour or mono | The standard //c and //e printer: draft + NLQ tiers, NLQ proportional bank, colour screen dumps, `ESC H` forms to ~69″ |
| `imagewriter-i` | Serial | Mono | Its 1983 predecessor: one standard face, no colour |
| `apple-dmp` | Parallel | Mono | Apple DMP (A9M0303, 1982), C. Itoh 8510 lineage, separate fixed and proportional ROM banks |
| `epson-fx80` | Parallel | Mono | The ESC/P machine third-party software targeted: 12×9 cell, Roman + Italic in one 256-glyph ROM, `ESC &` custom fonts |

The three Apple-lineage models share one C. Itoh 8510 command core; the FX-80 is
an independent ESC/P implementation. Enumerate from `PRINTER_MODELS`
(`{id, name, interface, create}`), build with `createPrinter(id)`.

## First-hour mistakes

| Symptom | Cause |
|---|---|
| Sink attached, nothing ever fires | No `flushLine`. A job not ending in CR/LF/FF leaves its last line buffered — measured: 0 events without it, 13 with. |
| Every line lands on top of the first | You integrated `feed` as a vertical advance. `feed.dist` is the head's *horizontal* position, for sound; vertical position is `yDot`, on every strike. |
| Each glyph is a vertical smear | You drew all of `cols` at `xDot`. Column *i* goes at `xDot + i*dotW`, bit *n* at `yDot + n*dotH`. |
| Graphics come out vertically mirrored | Wrong bit order for that manufacturer's *wire format*: C. Itoh `ESC G` takes bit 0 = top wire, Epson `ESC K` takes bit 7 = top. Sink events are always normalised to bit 0 = top. |
| Colour commands do nothing | The loaded ribbon is `"bw"`, so `ESC K` correctly inks black. Call `setRibbon("color")` where `supportsColorRibbon` is true. |
| Output stops at the bottom of page one | You assumed one sheet, or a fixed 11″ form. Allocate sheets from `pageOf(yDot, formDots)`; read the form from `pageMetrics`. |

Fuller trap lists: Part I (engine-side), Part II (host-side).

## Where to go next

- `ARCHITECTURE-BACKEND.md` — Part I, the engine: parser states, the full event contract, mechanism timing, adding a model. §12a is the one to read if your UI lets an operator move the paper or resize the sheet.
- `ARCHITECTURE-FRONTEND.md` — Part II, a real host: byte source, live canvas renderer, sound, export, agent tools.
- `README.md` — the API surface at a glance: models, events, fonts, pictures, pages.
- `examples/screen-to-print/` — a ProDOS disk of period 6502 screen dumps for all
 four models, plus their assembly sources. Where a byte stream a *real* Apple
 generated comes from, rather than one you synthesised; its ordered-dither
 algorithm is Part I §14a.
