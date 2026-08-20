# retroapple-printers

Headless emulation of the dot-matrix printers that hung off 8-bit Apples: the
**Apple ImageWriter I**, **ImageWriter II**, **Apple DMP**, and the **Epson
FX-80**.

Feed it the byte stream a program actually sent to the printer — escape codes,
graphics, custom fonts and all — and get back an ordered, timed stream of dot
strikes and paper feeds. What you do with those is up to you: paint a canvas,
write a PNG, drive a real plotter, or count dots in a test.

No DOM. No dependencies. No timers. Runs in node, the browser, a worker, or Bun.

```bash
npm install @manybitsbyte/retroapple-printers
```

Three documents go deeper than this page:

| | |
| --- | --- |
| [Integration quickstart](docs/INTEGRATION-QUICKSTART.md) | install to a PNG of a printed page, in about twenty minutes |
| [Architecture, Part I — the engine](docs/ARCHITECTURE-BACKEND.md) | the event contract, the parser, the ROMs, and how to extend any of them |
| [Architecture, Part II — the front end](docs/ARCHITECTURE-FRONTEND.md) | how a host app drives it: byte source, live renderer, sound, export |

## The idea

A real dot-matrix printer is a state machine wrapped around a mechanism. Bytes
change the state; the mechanism turns state into ink. This package models both
halves and stops there — it never decides what the page *looks* like, because
that is the host's job.

```
bytes in ──▶ command parser ──▶ line buffer ──▶ head replay ──▶ event sink
             (ESC/P, C.Itoh)    (per line)      (travel order,   {name, data, dt}
                                                 real timing)
```

The head replay is the part worth knowing about. Strikes are buffered per line,
then replayed in true carriage-travel order, so bidirectional printing is
genuine rather than simulated — and each motion is charged its real wall-clock
cost. That cost arrives as `dt` on every event. Honour it and the output paces
exactly like the hardware; ignore it and you get the same page instantly.

## Quick start

```js
import { createPrinter } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("imagewriter-ii");

// The timed path: strikes and feeds, in travel order, with their motion cost.
printer.setEventSink((e) => {
  if (e.name === "printChar") console.log(`glyph at x=${e.data.xDot} (${e.dt}ms)`);
  // `dist` is the head's x position, NOT a paper distance — it is a sound cue.
  if (e.name === "feed")      console.log(`${e.data.sound} feed, head at x=${e.data.dist}`);
});

// The immediate path: human-readable text, as it is parsed.
printer.on("text", (s) => process.stdout.write(s));

const ESC = 0x1b, CR = 0x0d, LF = 0x0a;
const job = [ESC, 0x21, ...[..."BOLD"].map(c => c.charCodeAt(0)), CR, LF];

for (const byte of job) printer.receiveByte(byte);
printer.flushLine();   // strikes are held until a line terminator
```

`flushLine()` matters: a job that does not end in `CR`/`LF`/`FF` leaves its last
line buffered, and without the flush it never reaches the sink.

## Models

| id | Model | Interface | Notes |
|---|---|---|---|
| `imagewriter-ii` | Apple ImageWriter II | Serial | Draft + NLQ tiers, NLQ proportional bank, four-band colour ribbon, `ESC H` form lengths to ~69″ |
| `imagewriter-i` | Apple ImageWriter I | Serial | Monochrome, standard face |
| `apple-dmp` | Apple DMP (A9M0303, 1982) | Parallel | C. Itoh 8510 lineage; distinct fixed and proportional ROM banks |
| `epson-fx80` | Epson FX-80 | Parallel | ESC/P, 12×9 cell, Roman + Italic in one 256-glyph ROM, `ESC &` custom fonts |

```js
import { PRINTER_MODELS } from "@manybitsbyte/retroapple-printers";
PRINTER_MODELS.forEach(m => console.log(m.id, m.name, m.interface));
```

The three Apple-lineage models share a complete C. Itoh 8510 command core; the
FX-80 is an independent ESC/P implementation.

## Events

Two paths, and both matter. Strikes and feeds are **buffered and timed**, then
released through the sink. Text and line terminators fire **immediately**
through `on()`. They interleave in call order, so a `newline` listener fires
before the strikes that line committed.

**Sink** — `setEventSink(fn)`, receives `{name, data, dt}`. Exactly three names
reach it:

| `name` | `data` |
|---|---|
| `printChar` | `{xDot, yDot, dotW, dotH, cols[], color, bold, underline, script}` — plus `rows`, `hDensity`, `vDensity`, `halfHeight`, `doubleWidth` on the C. Itoh models |
| `printDots` | `{byte, xDot, yDot, dotW, dotH, color}` — one raw graphics column |
| `feed` | `{dist, sound}` — a **sound cue**. `dist` is the head's *horizontal* position, not a paper advance; `sound` is `"line"` or `"return"` |

Strikes are **absolutely positioned**. There is no cursor to track and nothing
accumulates: `xDot` and `yDot` say where the strike goes, in internal dots of
1/`dpi` inch. `dotW` is the width of **one column** and `dotH` the spacing of
**one wire**, so column *i* of a glyph sits at `xDot + i*dotW` and bit *n* of a
column at `yDot + n*dotH`. The two pitches differ — `dotH` is always `dpi/72`,
because the wires are 1/72″ apart on the head.

**Listeners** — `on(name, fn)`: `text`, `newline`, `linefeed`,
`carriagereturn`, `formfeed`, `backspace`. These fire immediately as bytes are
parsed rather than on the timed path, so they interleave with sink records in
call order. Note that `formfeed` also carries a `dist`, and there it really *is*
a vertical distance — the opposite of the sink's `feed`.

A glyph carries no character code. By the time it reaches the sink the glyph
*is* its column data — `cols` is left-to-right dot columns, each a vertical
bitmask with bit 0 as the top wire, running to bit 8 on nine-wire models and
bit 17 across the ImageWriter II's 18-row NLQ cell. The readable character
arrives separately as `text`.

## Rendering a page

The package deliberately ships no renderer. A minimal one is short:

```js
import { pageMetrics, pageOf, yOnPage } from "@manybitsbyte/retroapple-printers";

const m = pageMetrics(printer);          // dpi, form length, sheet size, dot radius

printer.setEventSink((e) => {
  if (e.name !== "printChar" && e.name !== "printDots") return;
  const d = e.data;
  const cols = d.cols ?? [d.byte];
  cols.forEach((col, i) => {
    for (let wire = 0; col >>> wire; wire++) {
      if (!(col & (1 << wire))) continue;
      const yDot = d.yDot + wire * d.dotH;
      setPixel(pageOf(yDot, m.formDots),           // which sheet
               (d.xDot + i * d.dotW) / m.dpi,      // inches across
               yOnPage(yDot, m.formDots) / m.dpi); // inches down that sheet
    }
  });
});
```

Both coordinates are in the same unit — internal dots of 1/`dpi` inch — so
dividing by `dpi` gives inches on both axes and the page comes out the right
shape. Do **not** ignore `yDot` and integrate `feed` instead: `feed.dist` is the
head's horizontal position for sound panning, and treating it as a paper advance
stacks every line on the first one.

## Fonts

Every character-generator ROM is exported, so you can inspect, diff, or edit the
glyphs:

```js
import { roms, ImageWriterII } from "@manybitsbyte/retroapple-printers";

roms.IW2_DRAFT_ROM[0x41];        // 'A', draft tier — 12 columns
roms.IW2_NLQ_PROP_ROM[0x41];     // 'A', NLQ proportional — variable width
roms.EPSON_FX_ROM[0xc1];         // 'A' italic ($80–$FF is the italic half)

new ImageWriterII().getDraftChar(0x41, "DE");   // locale-substituted
```

Locale banks (`_DE`, `_FR`, `_IT`, `_ES`, `_SE`, `_UK`, `_DK`) replace the ten
alternate-language code points a DIP switch selects. In proportional banks the
trailing blank column is the built-in inter-character spacer — part of the
advance, not padding.

## Printing a picture

There is no "draw an image" call, because these machines had none. A picture is
bytes: the program packed eight vertical pixels into a column byte and sent them
through the same port as the text, one band of eight scanlines at a time.
`buildScreenDump*` does that packing for you, in each family's own wire format.

**It takes pixels, and that is the seam.** An emulator has already rendered a
framebuffer, so pixels are the natural place for a host to start. An Apple II has
not — the //e assembles no framebuffer at all. A screen dump running on the
machine reads video memory directly, decodes the layout of whichever mode is on
screen, and sends the ESC codes itself. **If you are reproducing that, the memory
decode is yours to write; the library begins at the point where you have dots.**

`test/printout/apple-video.js` is a worked implementation of exactly that half —
`$400` and `$2000`, both banks, all four graphics modes — so the two routes are
side by side and neither is a mystery.

One fact decides every number in that file, and getting it wrong is subtle
enough to look fine: **the machine has one raster and the modes differ only in
how coarsely they fill it.** Hi-res is 280×192, one dot per pixel. Lo-res is
40×48 *on the same grid* — 40×7 = 280, 48×4 = 192 — so a lo-res block is seven
dots wide and four scanlines tall, not a pixel of its own. Double lo-res is 80
columns across the 560-dot double-res raster, still a seven-dot cell, so its
blocks are half the width of lo-res ones and exactly as tall. The printer has no
modes at all: it takes dots. Lo-res therefore reaches paper as *repeated* dots
filling a 7×4 cell, and any other block size prints a lo-res picture at a
granularity the machine does not have.

**And a known palette is not quantised, it is looked up.**
`buildScreenDumpColor` dithers because it is handed arbitrary RGB and has to
reach colours the ribbon has no band for. A lo-res screen is not that problem: it
has sixteen colours, known before you start. The lo-res example therefore ports
the algorithm out of web-a2e's `t/imagewriter_ii_lr_s2p.asm` — actual 6502 code
that reads GR RAM and streams to an ImageWriter II — and three things in it are
worth knowing before you write your own:

- **`ESC K` selects seven colours, not four.** 0 black, 1 yellow, 2 red, 3 blue,
  4 orange, 5 green, 6 purple. The last three are secondaries the *printer*
  makes by overprinting two ribbon bands, so a cell is one pass with one colour
  selected — never a hand-rolled separation into yellow/magenta/cyan/black.
- **Every colour carries an ink density 0–16**, and a 4×4 ordered Bayer matrix
  turns that into a dot field. Solid hues are 16 and never dither at all; the
  //e's pastels and greys are fractional — light blue, pink and aqua are 8, the
  darker grey 4, white 0 — which is where all the screening comes from.
- **The dither's x phase runs continuously across cells** and resets only at the
  left margin, so the screen does not line up with the cell grid and print as
  visible seams.

```js
import { createPrinter, buildScreenDumpEpson } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("epson-fx80");
for (const b of buildScreenDumpEpson(rgba, width, height, { invert: true })) {
  printer.receiveByte(b);          // ordinary bytes, ordinary parser
}
```

`rgba` is a row-major RGBA framebuffer — four bytes per pixel, any size.

Two things decide what comes out, and both trip people up:

- **`invert`.** A *lit* pixel means ink, because these routines were written to
  dump an Apple II screen, where the ground is black and the drawn pixels glow.
  A bitmap with a white ground wants `invert: true`, or it prints as a
  near-solid page.
- **There is no dither in mono.** `threshold` (default `0x40`) is a single hard
  edge between ink and paper. Only the colour path dithers, because it has to in
  order to reach colours the ribbon has no band for.

**Colour** is the ImageWriter II's four-band ribbon — yellow, magenta, cyan,
black — and every other colour is made the way the printer made it, by striking
the same dot on two passes. That needs two host-side settings first:

```js
printer.setRibbon("color");         // else every pass correctly inks black
printer.setAutoLineFeed(false);     // else each pass advances the paper and
                                    // the overprints come out as stripes
for (const b of buildScreenDumpColor(rgba, w, h)) printer.receiveByte(b);
```

The colour path quantises to the **Apple //e palette**, not to pure RGB. Feed it
`#FF00FF` and the nearest anchor is violet rather than magenta.

## Adding a model

Subclass `CItohPrinter` for another 8510 derivative, or `PrinterBase` for a new
command family:

```js
import { CItohPrinter } from "@manybitsbyte/retroapple-printers";

export class MyPrinter extends CItohPrinter {
  getName() { return "My Printer"; }
  getId()   { return "my-printer"; }
  paperWidthRange() { return { min: 3.0, max: 9.0 }; }
}
```

## See it print

```bash
npm run print                    # one page per model
npm run print -- --examples      # the four capability examples
npm run print -- --all           # both sets
npm run print -- color-graphics  # one job, by name
npm run print -- --list          # what can be run
npm run print -- --dpi 300       # at a different output resolution
npm run print -- --multipage     # a three-page job, one PNG per sheet
```

Writes PNGs to `test/printout/out/`. The **model jobs** are one page each in that
machine's own command set — C. Itoh for the ImageWriters, ESC/P for the FX-80 —
exercising pitches, emphasis, underline and the colour ribbon. The **examples**
take one capability at a time, across whichever model has it:

| example | what it shows |
|---|---|
| `color-graphics` | a bitmap through the four-band ribbon: yellow, magenta and cyan discs whose overlaps must be overprinted to reach orange, green, violet and black |
| `mono-graphics` | one bit per dot — the same ramp at three thresholds, so you watch the edge move, then hard-edged geometry |
| `citoh-font` | glyphs downloaded with `ESC I`, switched in with `ESC '` and back out with `ESC $` |
| `epson-font` | glyphs downloaded with `ESC &` into the RAM set, selected with `ESC %`, with undefined codes still falling through to ROM |
| `hgr-memory` | the machine's own route: hi-res and double hi-res plotted into a 64K bank at real addresses, read back out as columns, and sent as `ESC G` — no framebuffer anywhere. A circle catches interleave errors; a resolution comb catches a swapped aux/main bank |
| `lores-memory` | lo-res and double lo-res out of `$400`, using the 6502 dump routine's own algorithm — `ESC K` colour per cell plus a per-colour ink density screened through an ordered matrix. Cells are 7×4 and 7×4-on-560, so the two pages show the same raster at two granularities |

`test/printout/` is also the worked example of consuming the event stream:

| file | what it shows |
|---|---|
| `paper.js` | the reference renderer — events to a bitmap, ~90 lines |
| `png.js` | a PNG encoder on `node:zlib`, so the demo stays dependency-free |
| `jobs.js` | the per-model jobs, escape codes inline |
| `examples.js` | the capability examples, including bitmap and glyph builders |
| `apple-video.js` | Apple II video memory to printer — the address interleaves, the plot primitives, and the scanline-to-column transpose |
| `print.js` | wiring it together |

Read `paper.js` before writing your own renderer. It documents the four things
about the event stream that are not guessable, and that produce a
plausible-looking mess if you get them wrong: strikes are absolutely positioned
(`xDot`/`yDot`) rather than sequential; `feed` is a *sound* cue whose `dist` is
the head's horizontal position, not a paper advance; `dotW`/`dotH` are the pitch
of one column and one wire respectively, the latter being dpi/72 because the
nine wires sit 1/72″ apart; and pages are arithmetic, not events — see below.

It also carries the ink model, which is worth reading if you plan to draw dots
as discs. You cannot: the wire's own dot is about 0.47 wire pitches in radius
and does not reach the point between four neighbours (0.707), so hard discs that
size put a white lattice through every solid fill — but widen them past 0.707 and
a 50% ordered screen covers ~80% of the paper and grey prints as black. No single
radius satisfies both, because the mechanism is not a disc. Ink wicks: a
saturated core with a fading halo, where four overlapping haloes close a junction
while an isolated dot in a screen stays a discrete mark.

## Pages

**There is no page-break event, and none is needed.** These are tractor-feed
machines: `yDot` runs continuously down an endless roll of fanfold, and a form
feed simply slews it to the next multiple of the form length. So pages fall out
of the coordinate you already have:

```js
import { formDots, pageOf, yOnPage } from "@manybitsbyte/retroapple-printers";

const form = formDots(printer);      // 5280 = 11" at 480 dpi, read live
const page = pageOf(yDot, form);
const y    = yOnPage(yDot, form);    // not yDot % form — see below
```

`yOnPage` is not the remainder operator: `%` keeps the sign of the dividend, so
a reverse feed above top-of-form lands at a negative offset on page −1 instead
of near the bottom of the sheet above.

Two consequences worth designing for, both of which `paper.js` handles:

- **A page can end without a form feed.** Run past the bottom of the form and
  `yDot` crosses into the next sheet on its own. A renderer that only starts a
  new page on `formfeed` silently loses the overflow.
- **A line can straddle the perforation.** Route *dots* to a sheet, not glyphs,
  and a line landing on the boundary prints its upper wires on one sheet and its
  lower wires on the next — which is exactly what the real paper did.

Form length is not fixed: the ImageWriter II sets any length up to ~69″ with
`ESC H`, so read it from the printer rather than assuming 11″.

## Tests

```bash
npm test
```

The suite is **characterization tests**: it pins what the emulation does today,
capturing the full event stream for a job and snapshotting it. Refactoring must
either reproduce the stream exactly or show the difference as a deliberate
snapshot edit. That makes it a safety net for a port to another language as much
as for a change here.

## Provenance

Written by Shawn Bullock, originally inside
[web-a2e](https://github.com/mikedaley/web-a2e) — Mike Daley's browser-based
Apple //e emulator — where it drives the on-screen virtual printer. Mike is
credited throughout in recognition of the project the work grew up in, and
because his characterization tests are what keep this emulation honest.

web-a2e is MIT licensed, and this package carries that license forward with the
original notice retained.

## Licence

MIT — © 2026 Shawn Bullock, © 2026 Mike Daley. See [LICENSE](LICENSE).
