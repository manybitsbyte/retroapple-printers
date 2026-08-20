# Architecture — Part I: the engine

`@manybitsbyte/retroapple-printers`. Companion: `docs/ARCHITECTURE-FRONTEND.md`
(the Apple //e host — card wiring, scheduler, canvas, UI).

For an agent integrating this engine or rebuilding it for another
machine/printer pair. Every number here is cited or derived. Paths are
repo-relative; `file:NN` means read that line.

---

## 1. TL;DR

- Four dot-matrix printers as **state machines**: Apple ImageWriter II,
 ImageWriter I, Apple DMP (all C. Itoh 8510) and Epson FX-80 (ESC/P).
- **In**: one byte at a time, as the interface card delivers it (`receiveByte`).
 **Out**: an ordered stream of `{name, data, dt}` through one sink.
- Data model, one sentence: **every strike carries its own absolute
 `{xDot, yDot}` in internal dots of 1/`dpi` inch; nothing accumulates and
 nothing is drawn.**
- Zero dependencies, pure ES modules, Node ≥18 and browsers alike. Below `src/`:
 no DOM, no canvas, no timers, no audio, no I/O.
- It does **not** render (`test/printout/paper.js` is the reference renderer,
 deliberately outside `src/`) and does **not** read machine memory
 (`test/printout/apple-video.js`, likewise).
- It **does** model mechanism: carriage travel, bidirectional print order, feed
 timing, ribbon colour gating, DIP-switch operator settings.
- Pages are **arithmetic**, not events (`src/pagination.js`). Form length is
 software-settable — read it, never assume 11 inches.
- `npm test` pins the whole event stream as characterization snapshots: that
 stream is the contract a port or refactor must reproduce.

---

## 2. The mental model

**The engine is a machine simulation, not a renderer. Bytes in, positioned
strike events out.** Everything else follows from this.

A `printChar` event is not "draw this glyph". It is "the nine wires struck this
column pattern, at this absolute position on an endless roll of paper, having
cost this much carriage time to reach". What ink looks like, how it spreads, what
a page is made of and when it appears on screen are all the consumer's problem.

Because positions are emitted rather than pixels: no output raster is baked in
(the same stream serves 150 dpi, 300 dpi or vector); no cursor is implied, so
right-to-left bidirectional strikes land correctly; nothing is composited, so
overprint stays real subtractive ink in the host; and with no timers, tests run
at full speed while a live host paces on `dt`.

```
receiveByte(b) → parser state machine → emit("printChar"|"printDots", {absolute pos})
 → PrinterBase buffers the line printer-base.js
 line terminator → head.order(buf) sort by travel dir printer-head.js
 → head.moveTo(x) charge wall-clock ms printer-head.js
 → sink({name, data, dt}) printer-base.js
```

Buffer-then-sweep (`src/printer-base.js`) is what makes bidirectional
printing genuine rather than cosmetic: the subclass reports strikes in parse
order at absolute columns, and the head replays them in true travel order.

---

## 3. File map

| File | Ln | Role |
|---|---|---|
| **core** | | |
| `src/printer-base.js` | 477 | `PrinterBase`: mechanisms, line buffer, feed/commit pipeline, event sink, paper capability API |
| `src/citoh-printer.js` | 926 | `CItohPrinter`: the whole C. Itoh 8510 core — parser, render state, graphics, custom chars, base corr face |
| `src/epson-fx80.js` | 792 | `EpsonFX80`: complete ESC/P parser + render state; subclasses `PrinterBase` directly |
| **models** | | |
| `src/imagewriter-ii.js` | 95 | Additive subclass of `CItohPrinter`: draft + NLQ tiers, NLQ-prop bank, colour ribbon, `ESC H` forms |
| `src/imagewriter-i.js` | 94 | II minus the II-only codes; single corr face, own fixed + prop ROMs |
| `src/apple-dmp.js` | 135 | II minus later additions; own ROMs, `ESC 1`–`6` micro-space, inverted prop densities |
| **mechanisms / geometry** | | |
| `src/printer-head.js` | 71 | `VirtualHead`: column, direction, velocity, travel time, strike ordering |
| `src/printer-ribbon.js` | 24 | `VirtualRibbon`: b/w vs four-band colour; gates every requested ink |
| `src/printer-paper-feed.js` | 74 | `VirtualPaperFeed`: feed timing, form length, top-of-form. Pure calculator — holds **no** paper position |
| `src/printer-paper-geometry.js` | 202 | `PaperGeometry`, width/length clamping, standard stock widths, `computeLayout` |
| `src/printer-units.js` | 31 | `DEFAULT_DPI`, `DEFAULT_FEED_DOTS_PER_SEC` — the two scale knobs |
| `src/pagination.js` | 104 | Pure page arithmetic for hosts that draw paper |
| **ROMs** — `code → [column bitmasks]`, bit 0 = top wire | | |
| `src/imagewriter-ii-rom-{draft,standard-fixed,standard-prop,nlq-fixed,nlq-prop}.js` | 252–285 ea | `IW2_DRAFT_ROM` 12×9 · `IW2_STANDARD_FIXED` 8×9 (the shared 8510 base face) · `IW2_STANDARD_PROP` var×9 · `IW2_NLQ_FIXED` 16 col × 16/18 rows · `IW2_NLQ_PROP_ROM` var×18 |
| `src/imagewriter-i-rom-standard-{fixed,prop}.js` | 235 ea | `IW1_STANDARD_FIXED` 8×9 / `IW1_STANDARD_PROP` var×9 |
| `src/apple-dmp-rom.js` | 420 | `DMP_STANDARD_FIXED` 8×9 / `DMP_STANDARD_PROP` var×9 |
| `src/epson-fx80-rom.js` | 268 | `EPSON_FX_ROM` — one 256-glyph bank, 12×9; $00–$7F Roman / $80–$FF Italic |
| `src/roms.js` | 34 | Re-exports every bank under one namespace |
| **public API** | | |
| `src/screen-dump.js` | 382 | RGBA framebuffer → that model's own bit-image byte stream (the *host* route) |
| `src/index.js` | 122 | The public surface. Read this first |
| `types/index.d.ts` | — | Hand-written declarations; the event payload docs live here |
| **outside `src/` — deliberately not shipped** | | |
| `test/printout/paper.js` | 285 | Reference renderer: events → PNG sheets, plus the ink model |
| `test/printout/apple-video.js` | 444 | Reference //e side: video RAM → column bytes → ESC codes |
| `test/printout/{jobs,examples,print,png}.js` | — | Sample jobs, capability examples, CLI, dependency-free PNG encoder |
| `test/harness.js` | 162 | `bytes` / `capture` / `summarise` for the characterization tests |
| `examples/screen-to-print/` | 50 files | Vendored //e toolkit disk + its 6502/Applesoft sources — where a *real* Apple-generated byte stream comes from (§14b) |

---

## 4. The public contract

`src/index.js`, in the file's own grouping:

| Export | Note |
|---|---|
| `ImageWriterII`, `ImageWriterI`, `AppleDMP`, `EpsonFX80` | the models |
| `PrinterBase`, `CItohPrinter` | extend these to add a model |
| `VirtualHead`, `VirtualRibbon`, `VirtualPaperFeed` | usable standalone — the head alone will time a line |
| `PaperGeometry`, `computeLayout`, `clampWidthInch`, `clampLengthInch`, `snapWidthInch`, `STANDARD_WIDTHS_INCH`, `GRID_INCH`, `DEFAULT_PAPER_*` | horizontal page state + layout solver |
| `DEFAULT_DPI`, `DEFAULT_FEED_DOTS_PER_SEC` | `src/printer-units.js,31` |
| `formDots`, `pageOf`, `yOnPage`, `pageMetrics`, `WIRE_PITCH` | page arithmetic (§12) |
| `buildScreenDump*`, `litDensity`, `SCREEN_W`(560), `SCREEN_H`(384) | bitmap → bit-image bytes |
| `roms` | namespace; ~100 bank names, not flattened |
| `PRINTER_MODELS`, `createPrinter(id)` | enumeration and construction |

`PRINTER_MODELS` (`src/index.js`) is `{id, name, interface, create}` in UI
order: `imagewriter-ii` (serial), `imagewriter-i` (serial), `epson-fx80`
(parallel), `apple-dmp` (parallel). `create` is a thunk so a host can list models
without constructing them. `createPrinter` throws with the known-id list on a
miss.

### The `PrinterBase` surface an integrator touches

| Member | Semantics |
|---|---|
| `receiveByte(byte)` | one byte as the card delivered it, **overridden per model**; high-bit handling is the model's |
| `flushLine` | commit an unterminated line. **Not optional** — otherwise trailing output is lost |
| `setEventSink(fn)` | the timed path. With no sink, events fire immediately in order |
| `on(name, fn)` / `off(name)` | immediate path; **one listener per name**, a later `on` replaces |
| `onImpact(fn)` | `(dotCount, kind, xDot)` at strike *release* time; `kind` ∈ `char`/`dots`/`line`/`return`. Sound hook |
| `setRibbon(k)` / `getRibbon` | `"color"` \| `"bw"`; anything not `"color"` normalises to `"bw"` |
| `supportsColorRibbon` | true only on `ImageWriterII` |
| `setAutoLineFeed(on)` / `getAutoLineFeed` | per-model DIP SW2-1; survives software reset |
| `setDefaultPitch(k)` / `getDefaultPitch` | power-on pitch, re-read by `_resetRenderState` |
| `setSlashedZero(on)` / `getSlashedZero` | DIP; the model slashes code `0x30` |
| `setDpi(n)` / `setFeedDotsPerSec(n)` | rescale the whole coordinate system at runtime |
| `formFeed`, `lineFeedDown(n)`, `lineFeedUp(n)`, `setTopOfForm` | operator panel buttons, same path as host bytes — §12a |
| `paperGeo`, `paperProfile` | sheet size, and one frozen descriptor of every dimension a paper view needs — §12a |
| `static SETTINGS` | operator panel data: `{id, type:'toggle'\|'choice', label, hint, get, set}` |
| `reset` | render + parser state only; DIP-like flags and downloaded glyphs survive |
| `getName`, `getId`, `getCharsPerSecond`, `dpi` | identity and live rate |

`SETTINGS` entries may carry `target: 'manager'`, routing get/set through
a *host-supplied* cross-model manager. **No such class ships here** — supply one
or drive the printer directly.

---

## 5. The event stream

The load-bearing section. Declared in `types/index.d.ts`.

### Sink events — `setEventSink(fn)`, records are `{name, data, dt}`

| name | field | unit / meaning |
|---|---|---|
| `printChar` | `cols` | column bitmasks, left→right; **bit 0 = top wire** |
| | `xDot`, `yDot` | absolute position of column 0 / top wire, internal dots |
| | `dotW` | width of **one column** — not the glyph |
| | `dotH` | spacing of **one wire** — always `dpi/72` |
| | `color` | ink after the ribbon gate; `"black"` on mono |
| | `bold`, `underline` | attributes the *renderer* realises (below) |
| | `script` | `"none"` \| `"super"` \| `"sub"` |
| | `rows`, `hDensity`, `vDensity`, `halfHeight`, `doubleWidth` | **C. Itoh only**; the FX-80 omits them — default `rows` to 9 |
| `printDots` | `byte` | one graphics column; bit 0 = top wire, bit 8 reachable on nine-pin |
| | `xDot`, `yDot`, `dotW`, `dotH`, `color` | as above |
| `feed` | `dist` | **the head's horizontal position** — a sound cue, not a distance |
| | `sound` | `"line"` (paper advance) \| `"return"` (carriage slew home) |
| all | `dt` | ms of head/paper motion charged *before* this record |

### Listener events — `on(name, fn)`, fire immediately during parsing

`text` (one decoded character), `newline`, `linefeed`, `carriagereturn`,
`formfeed`, `backspace`. They interleave with sink records in call order: a
`newline` listener fires *before* the strikes that line committed
(`src/printer-base.js` fires, then commits).

### The four facts that are not guessable

1. **Strikes are absolutely positioned, not sequential.** Nothing accumulates;
 there is no cursor to track. Column `i` sits at `xDot + i*dotW`, bit `n` of a
 column at `yDot + n*dotH`. In the default bidirectional mode, alternate lines
 arrive right-to-left.
2. **`feed` is a sound cue, not a movement.** Its `dist` is `head.x`
 (`src/printer-base.js`); vertical position already arrives on every
 strike. Integrating it stacks the whole job on line one. *Exception:* the
 **listener** `formfeed` event's `dist` genuinely is a vertical distance
 (`src/printer-base.js`) — same word, opposite meaning, different channel.
3. **`dotW` and `dotH` are different pitches, each per-unit.** `dotH` is `dpi/72`
 because the nine wires sit 1/72" apart — fixed by the head. `dotW` follows the
 character pitch or graphics density in force, so it changes mid-job.
4. **There is no page-break event, and none is needed.** `yDot` runs continuously
 down endless fanfold; a form feed slews it to the next multiple of the form
 length. Pages are arithmetic (§12), and a line straddling a perforation really
 does print its upper wires on one sheet and its lower wires on the next — so
 route **dots** to a sheet, never glyphs.

`test/printout/paper.js` states all four at source. Read it before writing a
renderer.

`bold` and `underline` are *reported, not realised*: bold means the head made a
second hammer pass offset by a fraction of a column; underline means the wire
fired on every column one row below the box. The engine already charged the
carriage (bold halves cps); laying the extra ink is the renderer's job
(`test/printout/paper.js`).

---

## 6. Internal coordinate system

One **internal dot** = 1/`printer.dpi` inch. Every positional quantity — advance,
graphics density, margins, tabs, line feed, form length — is in these units.

`DEFAULT_DPI = 480` (`src/printer-units.js`), chosen so the printers'
densities divide it exactly and nothing is rounded at parse time. It only half
does. 480 = 2^5·3·5, which is exact for the 60-family — 60, 80, 120, 160, 240 —
and inexact for the 72-family: 480/72 ≈ 6.67, 480/90 ≈ 5.33, 480/144 ≈ 3.33,
480/216 ≈ 2.22. The header comment at `src/printer-units.js` lists both
families and calls 480 their LCM; the true LCM of that set is 4320 (2^5·3^3·5).
`test/printout/paper.js` repeats the claim and then states `dotH` is "≈6.67"
three lines later.

Nothing is broken by this — the vertical wire pitch is 1/72", so it was always
going to be fractional against a 60-family scale, and every consumer already
works in floating point. But do not assume integer dot pitches, and do not treat
480 as a magic number that makes rounding impossible.

- **Nothing is ever rounded to output pixels.** The engine has no idea what
 resolution you will draw at; convert with `xDot / dpi` inches at the last step.
- **`dpi` is per-instance and mutable.** `setDpi` (`src/printer-base.js`)
 reruns `_recomputeUnits`, retunes the carriage pica advance, rescales the form
 length and resets render state. A model may override `_defaultDpi`.
- **Never capture a module-level pitch.** Derived values live on the instance and
 are recomputed from `this.dpi` — `src/citoh-printer.js`,
 `src/epson-fx80.js`.
- **Feed speed** is `DEFAULT_FEED_DOTS_PER_SEC = 3200` internal dots/sec
 (`src/printer-units.js`) — a mechanical estimate, the one timing constant not
 derived from carriage motion. It is in the same dot scale as `dpi`, so a model
 overriding `dpi` must scale it to keep physical feed speed constant.

---

## 7. Command parsing

Both parsers are the same shape: an integer `_state`, a `switch` in
`receiveByte`, one case per parameter-collection mode. No tokenizer, no
lookahead, no escape sequence ever buffered as a string.

```js
// shape only — src/citoh-printer.js
receiveByte(byte) {
 const ch = this._includeEighth ? byte : (byte & 0x7F);
 switch (this._state) {
 case S_NORMAL: /* control codes; ESC → S_ESC; else this._emitChar(code) */ break;
 case S_ESC: this._state = S_NORMAL; this._handleEsc(ch); break;
 case S_NUM: /* accumulate ASCII digit; on the last → _dispatchNum */ break;
 // …
 }
}
```

Graphics and custom-character data use the **raw** byte, never the
high-bit-stripped `ch` — all eight bits are pin data (`src/citoh-printer.js`,
`src/epson-fx80.js`).

C. Itoh has 14 states (`src/citoh-printer.js`); Epson has 23
(`src/epson-fx80.js`), including the five-phase `ESC &` download and the
two-byte-per-column `ESC ^` nine-pin path.

| Concern | C. Itoh | Epson |
|---|---|---|
| ESC dispatch | `_handleEsc` `citoh-printer.js` | `_esc` `epson-fx80.js` |
| Deferred params | `_beginNum`/`_dispatchNum` / | `_param1`/`_param2` / |
| Pitch → cpi | `CPI` (8 pitches) | `CPI` (3 pitches) |
| Pitch → graphics dpi | `GFX_DENSITY` | `_starWidths[]` (`ESC *` modes 0–6) |
| Colour index → ink | `COLORS` | — (mono) |

Subclasses override individual codes by intercepting `_handleEsc` before `super`:
`IW1_IGNORED_ESC` (`src/imagewriter-i.js`), `DMP_IGNORED_ESC`
(`src/apple-dmp.js`). Consuming the byte matters — an unhandled ESC letter
would print as text.

### Printer state, reset by `_resetRenderState`

| Group | C. Itoh `citoh-printer.js` | Epson `epson-fx80.js` |
|---|---|---|
| Pitch | 8 keys incl. two proportional | pica/elite/compressed + `_proportional` |
| Quality | `draft`\|`corr`\|`nlq` + the draft-incompatibility rule | none (one face, Roman/Italic) |
| Attributes | bold, underline, halfHeight, script, doubleWidth | emphasized, dblStrike, underline, italic, script, expanded (+ one-line SO) |
| Spacing | `_lineHeight`, `_propSpacing`, `_pendingDotSpace`, `_feedDir` | `_lineHeight` (n/216, n/72, fixed) |
| Page | form dots, `_leftMargin`, `_htabCols` | form dots, `_leftMargin`, `_rightMargin`, `_htabCols`, 8 VFU channels, `_skipPerf` |
| Font | `_customFont`, `_mouseText`, custom map | `_ramFont`, custom map, `_intlSet` |
| Colour / motion | `_color`; `_unidirectional`, `_crBeforeLF` | —; `_halfSpeed` |

**DIP-like flags survive a software reset**, as on hardware: auto-LF,
slashed-zero, software-select enable, 8th-data-bit, paper-out sensor, and (C.
Itoh) the downloaded character set (`src/citoh-printer.js`).

---

## 8. Model differences that matter

| Aspect | C. Itoh (IW-I, IW-II, DMP) | Epson FX-80 |
|---|---|---|
| Base class | `CItohPrinter` (shared parser) | `PrinterBase` directly |
| Graphics cmd | `ESC G`/`ESC S` (4-digit ASCII count), `ESC g` (3-digit count of 8-byte groups), `ESC V` (repeat column) | `ESC K/L/Y/Z`, `ESC * <mode>`, `ESC ^` (nine-pin) |
| Count form | **ASCII decimal**, leading zeros may be spaces (`0x20`→0) | **two binary bytes**, `n = nL + 256·nH` |
| **Top wire bit** | **bit 0** — raw byte used as-is | **bit 7** — every column passes `REV8` on the way in (`epson-fx80.js`) |
| Density | follows the **character pitch**, `GFX_DENSITY` 72–160 dpi | independent of pitch; `ESC *` mode 0–6 = 60/120/120/240/80/72/90 dpi, and `ESC ? s n` remaps the K/L/Y/Z letters |
| Colour ribbon | IW-II only; `ESC K 0`–`6` | none — `color` always `"black"` |
| Font download | `ESC I`, then `<key><width-code><cols…>` per glyph, CTRL-D to end. Width code `'A'..'P'` = 1..16 cols bit 0 = top, `'a'..'p'` = same shifted one wire down. `ESC -`/`ESC +` cap the cell at 8/16 cols and clear the set. `ESC '`/`ESC *` select the low/high custom set, `ESC $` off | `ESC & 0 <first> <last>`, then per char an attribute byte + **exactly 11** column bytes (MSB top). `ESC % 1 0` selects RAM, `ESC % 0 0` ROM; `ESC : 0 0 0` clones ROM→RAM first |
| Custom advance | the **width code is the escapement**, at the pitch's graphics density (`citoh-printer.js`) | the fixed cell advance |
| Proportional | separate ROM banks, per-glyph column counts; the trailing blank column is part of the advance | same bitmap; inked width + 2 (`_inkWidth`, `epson-fx80.js`) |
| Line spacing | `ESC A` 6 lpi, `ESC B` 8 lpi, `ESC T nn` = n/144" | `ESC 0` 1/8", `ESC 1` 7/72", `ESC 2` 1/6", `ESC A n` n/72", `ESC 3 n` n/216" |
| Form length | `ESC H nnnn` = n/144"; IW-II 1–69" | `ESC C n` lines / `ESC C 0 n` inches; 1–22", **default 12"** |
| Paper anchor | `center` on the 8" carriage zone, both sprockets move | `left`, `right-fixed-left` (`epson-fx80.js`) |
| Draft cps | draft 250 / corr 180 / NLQ 45, halved on bold or non-black (`citoh-printer.js`); IW-I and DMP force `corr` and report 120 (60 bold) | 160; `ESC s` halves to 80 (`epson-fx80.js`) |
| Reset / right margin | `ESC c`; none (auto-wrap at the 8" platen) | `ESC @`; `ESC Q n`, out-of-range **ignored, not clamped** (`epson-fx80.js`) |

Within the C. Itoh family the differences are narrow and additive:

| | IW-II | IW-I | Apple DMP |
|---|---|---|---|
| Font tiers | draft / corr / NLQ (+NLQ-prop) | forced `corr` | forced `corr` |
| Colour ribbon | yes | no | no |
| Power-on pitch | pica | **elite** (DIP SW1-6/7) | pica, or elite-proportional on DIP SW2-5 |
| Ignored ESC | — | `w W x y z m M &` | those plus `e s c g u` |
| Own extras | `ESC H` 1–69" forms, `PAGE_SIZES` | own fixed + prop ROMs | `ESC 1`–`6` one-shot micro-space; `ESC p`=160 dpi / `ESC P`=144 dpi, the **inverse** of the IW-II assignment (`apple-dmp.js`) |
| Body width | 3.0–9.0" | 3.5–9.0" | 3.5–9.0" |

---

## 9. Graphics and dot bands

A graphics command becomes one `printDots` event **per column**, each with its
own `xDot`; the parser advances `_xDot += dotW` between them
(`src/citoh-printer.js`, `src/epson-fx80.js`). A "band" is not a
concept the engine holds — it is eight wires' worth of dots the *sender* chose to
pack into one byte.

- **C. Itoh**: the graphics dot width *is* the pitch's density,
 `_gfxDotW = dpi / GFX_DENSITY[pitch]` (; table at, extended 72 →
 propElite 160 dpi). This is why a screen dump sends `ESC n` first: 72 dpi makes
 the dot grid square against the 1/72" wire pitch.
- **Epson**: density comes from the command. `ESC *` takes an explicit mode byte;
 `ESC K/L/Y/Z` are shorthands `ESC ? s n` can remap. `ESC ^` sends
 **two bytes per column** — pins 1–8 in the first (reversed), pin 9 from bit 7 of
 the second, landing at bit 8.

### The colour model

`ESC K n` selects one of **seven** inks (`src/citoh-printer.js`):

| n | ink | how |
|---|---|---|
| 0 / 1 / 2 / 3 | black / yellow / magenta / cyan | a physical ribbon band (manuals call magenta "red", cyan "blue") |
| 4 / 5 / 6 | orange / green / purple | **the printer overprints** Y+M / Y+C / M+C for you |

A sender selects a colour and prints once; it does not hand-roll a separation.
The ribbon is the physical gate: `VirtualRibbon.ink` (`src/printer-ribbon.js`)
maps every request to `"black"` unless a colour cart is loaded — so `ESC K 3` on a
mono machine is *honoured* and inks black.

Two colour strategies exist in the tree, and they are not the same thing:

- `buildScreenDumpColor` (`src/screen-dump.js`) dithers to a gamut anchored on
 the //e's own 16 colours (`COLOUR_POINTS`, `BAYER4`,
 `DITHER_AMP` 36), then emits **four primary passes** (`ESC K` 1/2/3/0)
 per 8-dot band separated by a bare `CR` so they overprint. Requires Auto-LF
 **off**, or each `CR` also feeds and the passes come out as stripes. Polarity
 auto-picks: under 5% lit (`litDensity`, `LIT_THRESH` 48) it inverts so a
 sparse screen leaves white paper.
- `citohCellStream` (`test/printout/apple-video.js`), the port of the real
 6502 routine — **one `ESC K` of the seven per cell**, plus a per-colour ink
 density screened through a 4×4 Bayer matrix.

Both are legitimate; the second is what period software did — and they are two
different mechanisms, not two settings of one (§14c).

---

## 10. Fonts and ROMs

A bank is a plain object: `code → array of column values, left to right`. A
column is a vertical bitmask, **bit 0 = top wire**. Nine-wire banks reach bit 8
(descender), so values exceed `0xFF`; NLQ reaches bit 17 and exceeds `0xFFFF`. A
`Uint8Array` would truncate them — hence `cols.slice` in
`_copyRomToDownload` (`src/epson-fx80.js`). Cell shapes are in the §3 ROM rows.

Proportional banks carry their own **trailing blank column(s)**: the built-in
inter-character gap, part of the escapement, not padding.

Each bank has locale siblings `_DE _FR _IT _ES _SE _UK _DK` replacing the ten
alternate-language code points (`$23 $40 $5B–$5D $60 $7B–$7E`), plus `_LOCALES`
and a `_LOCALE_MAP` of `[locale, code]` pairs.

### Binding a bank to a model

`CItohPrinter` stubs the tiers it lacks to `null`, so the II is an *additive*
subclass rather than the parent of the I:

| Hook | Base | Overridden by |
|---|---|---|
| `getDraftChar` / `getNLQChar` / `getNLQPropChar` | `null` | `ImageWriterII` |
| `getCorrChar` | `IW2_STANDARD_FIXED` | IW-I, DMP (own bank, falling back to `super`) |
| `getCorrPropChar` | `IW2_STANDARD_PROP` | IW-I, DMP |

Fixed-cell selection order is `getGlyph`: custom set (if `ESC '`/`ESC *`
active **and** the code is defined) → the `_effectiveQuality` bank → the
slashed-zero overlay at `0x30`. NLQ falls back to corr for codes it lacks. The
*proportional* face is chosen separately in `_emitChar` because it
also drives the advance.

`_effectiveQuality` encodes two hardware rules: super/subscript forces
`corr` from draft **or** NLQ; bold / half-height / double-width / proportional
force `corr` from draft. IW-I and DMP hard-override it to `corr`, which is what
makes their swallowed `ESC a/m/M` inert.

A downloaded glyph is stored raw and converted on read (`_customGlyph`):
`(byte & 0xFF) << shift`, `shift` = 1 for a lowercase width code (wires 2–9).
Undefined codes fall through to the ROM face — which is why an Epson `ESC &` set
can redefine three glyphs and leave the other 250 alone.

---

## 11. Timing and mechanics

Every horizontal timing number comes from one rule: **time = distance /
velocity**, with `velocity = pitchDots × cps` dots/sec (`src/printer-head.js`).
No fudge factors anywhere.

- `pitchDots` is the pica advance, `dpi/10` internal dots (`printer-base.js`).
- `cps` is a **live provider** installed at construction (`printer-base.js`),
 so a quality / bold / colour / half-speed change retunes the carriage at the
 next motion with no re-arm.
- `travelMs(x)` and `returnMs` (`printer-head.js,65`) are the only two
 horizontal time sources; vertical is `feedMs(dots) = |dots|/feedDotsPerSec×1000`
 (`printer-paper-feed.js`).

`head.order(strikes)` (`printer-head.js`) sorts the buffered line ascending or
descending by `xDot` per `dir`; `_commitFeed` (`printer-base.js`) then decides
the line end:

| Situation | Head | `feed` sound | Charged |
|---|---|---|---|
| CR + auto-LF, bidirectional | `flip` — stays put, faces back | `line` | feed |
| CR + auto-LF, unidirectional (`ESC >`) | `home` | `return` | feed + return slew |
| CR, auto-LF off, bidirectional | `flip` — next pass overprints the same band | *(none)* | — |
| CR, auto-LF off, unidirectional | `home` | `return` | return slew |
| LF alone | unchanged | `line` | feed |
| Form feed | `home` | `return` | eject + return |

`dt` is the motion charged *before* its record. A **real-time host** releases
records on that timeline — that is what makes the on-screen printer run at true
hardware speed and paces `onImpact` sound. An **offline host** ignores `dt`
entirely and consumes as fast as it likes; the pages are identical
(`test/printout/paper.js`).

---

## 12. Pagination

`src/pagination.js` — four pure functions and one constant. It exists for the
value that is hard to get right, the live form length, not for the sums.

| Export | Note |
|---|---|
| `formDots(printer)` | live form length in internal dots; prefers `printer._effectiveFormDots`, else the model default |
| `pageOf(yDot, formLen)` | `floor(yDot / formLen)`; page 0 is the first sheet |
| `yOnPage(yDot, formLen)` | `yDot - pageOf(…)·formLen` — **deliberately not `%`**, whose sign follows the dividend, so a reverse feed above top-of-form would land at a negative offset on page −1 |
| `pageMetrics(printer, {widthInch, formInch})` | `{dpi, formDots, formInch, widthInch, tractorMarginInch, wirePitchInch, dotRadiusInch}`, all read off the printer |
| `WIRE_PITCH` | `72` — wires per inch on a nine-pin head |

**Endless fanfold.** There is no page object and no page-break event. A form feed
calls `paper.nextFormTop(y, formDots)` (`src/printer-paper-feed.js`) =
`topOfForm + (floor((y-topOfForm)/fd)+1)·fd`, relative to a *latched* top-of-form
— a real machine has no idea where the perforation is; the operator rolls the
paper and presses SET/TOF, and power-on assumes it is already there.

`_effectiveFormDots` (`src/printer-base.js`) resolves `paper.formDots` when
a program set one (`ESC H` / `ESC C`) and otherwise derives from the operator's
`paperGeo.lengthInch`. A host that parks `formDots` at 0 as an "unset" sentinel
**must** go through it: a bare 0 makes `nextFormTop` return `NaN`, poisoning
`_yDot` and every strike after the first form feed.

**`dotRadiusInch` is the wire's dot and nothing else** — `(1/WIRE_PITCH) × 0.47`
(`src/pagination.js`), ~0.47 wire pitches, per the stated basis of a ~0.012"
wire against a 0.0139" pitch. It does **not** include ink spread; that belongs to
the renderer (§13) because it is a property of the ink and the fanfold, not of
the head.

---

## 12a. Host-driven positioning

The engine ships no UI (§13), but it owns every value a direct-manipulation
interface mutates and every rule that constrains one. A host implementing
draggable paper is **not** writing geometry: it converts pointer pixels to
inches, calls one setter, and redraws. Legality, snapping, layout and page
arithmetic are already here. `ARCHITECTURE-FRONTEND.md` §5.6 documents the
gesture side; this is what it calls.

| Gesture | Engine call | The engine does | The host does |
|---|---|---|---|
| roll the paper | `lineFeedDown(n)` / `lineFeedUp(n)` | move the vertical cursor `n` line heights, charge `paper.feedMs`, emit a `feed` record | convert drag distance to whole lines |
| resize the sheet | `snapWidthInch(w, range)` → `paperGeo.setWidthInch(v, range)` | quantize and clamp to this model's legal stock | drag → inches, redraw from `computeLayout` |
| set the form length | `clampLengthInch(l, range)` → `paperGeo.setLengthInch(l, range)` | clamp; `_effectiveFormDots` then follows on its own | drag → inches, redraw |
| move the carriage | `head.moveTo(x)` / `head.travelMs(x)` | travel and return the ms it cost / price a move without making it | everything — and see below before bothering |

**`lineFeedDown` / `lineFeedUp` are the public paper cursor**, and the reason a
host never needs to reach inside for one. They move in whole line heights (the
model's current `_lineFeedDots`), and both charge feed time and emit
`feed {sound: "line"}` — so a dragged platen costs and sounds exactly like a line
feed the host's byte stream asked for, where poking a cursor directly gives
silent, instantaneous paper. `lineFeedUp` clamps at zero; `lineFeedDown`
deliberately does not, because fanfold has no end and there is no page boundary
to stop at (§12). `setTopOfForm()` latches wherever the operator dragged to —
that is the SET/TOF button, and it is what makes a later `formFeed()` land where
they expect.

**There is no position getter.** Vertical position arrives on every strike as
`yDot`; keep the last one. Sheet size *is* readable — `paperGeo.widthInch` and
`.lengthInch`.

**Four scales, and the setters take only one of them.**

| Scale | Source | Used for |
|---|---|---|
| display px | your element's client size | pointer events only |
| layout px | `canvasPxPerInch()` (isotropic, 120 by default) and every `computeLayout` field | drawing sheet, rulers, guides |
| **inches** | `paperGeo`, all width/length setters, all ranges | **the operator's scale — every setter in this section** |
| internal dots | `dpi` (§6) | `xDot` / `yDot` / `head.x`, nothing else |

A drag is display px → layout px → inches → setter. Only the strike stream and
the carriage speak dots.

**`computeLayout(profile, widthInch, lengthInch)` is the whole solver.** Pure and
DOM-free, so a live preview may call it once per pointer move against a candidate
width and simply draw the result. Feed it the frozen `printer.paperProfile()`. It
returns body edges (`paperLPx` = ruler 0, `paperRPx` = ruler max = the sizer
line), the full sheet including the ½″ sprocket strips, `zoneOriginPx` = print
column 0, and the canvas extent. `anchor` places the fixed carriage zone on the
body: `left` puts column 0 at the body's left edge, `center` centres the carriage
span on the body.

**The width snap is a grid, not a magnet.** `snapWidthInch` quantizes every drop
to `GRID_INCH` (¼″); the `snapped` flag it returns says only that the result
coincides with a `STANDARD_WIDTHS_INCH` stock size reachable in this model's
range — a cue for extra emphasis in the UI, not a different quantization.

**Persistence is two calls.** `paperGeo.toJSON()` and
`.load(obj, range, lengthRange)`, where `load` re-clamps: a 9″ sheet saved under
one model restores legal under a narrower one. `reclamp` / `reclampLength` do the
same after a model swap or an option that narrows the span.

**Carriage x is exposed, but a host has no reason to drive it.** `moveTo` is how
the engine prices its own work: `_commitLine` sorts a line's buffered strikes
into travel order and travels to each `xDot`, and the ms that returns *is* that
strike's `dt`. Nothing exposes it as an operator gesture, and a host that moved
the head between lines would change only sound and animation — every strike
carries an absolute `xDot`, so the next commit travels there regardless and no
ink lands anywhere new. `travelMs` prices a move without making it, which is why
`order()` plus `travelMs()` can tell you how long a line takes to print without
printing it.

Two traps specific to this surface:

- Driving length through `paper.setFormDots()` instead of
  `paperGeo.setLengthInch()` pins the form against a program's `ESC H` and
  desyncs the operator's readout. Leave `formDots` at 0 unless a program set it —
  and read §12 on why 0 must never reach `nextFormTop`.
- Re-clamping in the host duplicates rules that differ per model. The ranges are
  `paperWidthRange()` and `paperLengthRange()`; pass them to the setter and let
  it decide.

---

## 13. The seam: rendering is NOT shipped

There is no renderer in `src/`, and that is the point: emitting positioned
strikes instead of pixels is what lets one engine serve a 60 fps canvas, a 300
dpi PNG and a headless test with no shared code and no compromise.

A consumer must supply: a sheet allocator keyed on `pageOf(yDot, formDots)`
(sheets appear as paper advances, and one may receive no ink); the internal-dot →
pixel mapping `(xDot/dpi + marginInch) × outDpi`; column expansion (column `i` at
`xDot + i·dotW`, bit `n` at `yDot + n·dotH`); the bold second pass and underline
run; and an ink model. `test/printout/paper.js` is the reference — `Sheet`,
`Paper`, the sink.

**Its ink model, and why a disc fails.** A wire's dot is ~0.47 wire pitches in
radius, which does not reach the point where four neighbours meet — that is
√2/2 ≈ 0.707 pitches away — so a hard disc that size leaves a white lattice
through every solid fill. Widen it past 0.707 and solids close, but a 50% ordered
screen now covers ~80% of the paper and grey prints near-black. No single radius
satisfies both, because the mechanism is not a disc: ink **wicks**. `Sheet.ink`
(`test/printout/paper.js`) lays a saturated core of radius `dotRadiusInch` and
a linearly-fading halo out to `INK_SPREAD = 1.9×` that — the halo's edge
at ~0.9 pitches, past the junction, so four overlapping haloes close it while an
isolated screen dot keeps only its core and stays a discrete mark. The spread
factor is a property of the *stock*, so it lives in the renderer.

Compositing is **darken-only, per channel**: overprint on paper is
subtractive, so laying yellow over cyan must never lift the red channel back up.

---

## 14. The other seam: source material is NOT shipped

`src/screen-dump.js` takes an **RGBA framebuffer**. That is the *host's* route,
not the in-machine one (§14c separates them) — an emulator has already rendered
pixels, so packing them into bit-image bytes is the shortest honest path. (One
scanner, `scanBandColumns`, plus a frozen per-head protocol descriptor:
`CITOH_BASE`, `EPSON_FX`. The four
fields that differ *are* the hardware demarcations — graphics command, count
form, top-dot bit, band line feed.)

It is not the *machine's* route. A screen dump running on an Apple //e has no
framebuffer, because the //e never assembles one. The dump program reads video
RAM, decodes that mode's layout, transposes eight scanlines into one column byte,
and sends `ESC G` with the columns behind it. `test/printout/apple-video.js` is
that missing half.

**One raster; the modes differ only in how coarsely they fill it:**

| Mode | Grid | Cell on the raster |
|---|---|---|
| HGR | 280×192 | 1 dot per pixel |
| LORES | 40×48 | **7 dots × 4 scanlines** — because 40×7 = 280 and 48×4 = 192 |
| DHGR | 560×192 | 1 dot per pixel |
| DLORES | 80×48 | **7 dots** on the 560 raster — half a lo-res block's width, same height |

Lo-res is not a smaller picture; it is the same picture drawn with a fat brush,
and the printer has no modes at all — it takes dots. Pick a block size freely and
you have printed lo-res at a granularity the machine does not have; the giveaway
is cells too near square. Real ones are emphatically wider than tall.

Also load-bearing there: `textRowBase`/`hgrRowBase` are the
three-way interleave, straight out of the video counter's address generation.
`dhplot` — **aux supplies the left seven dots** of each 14-dot cell, main
the right; reversed, the picture still appears with every cell mirrored down the
middle, which reads like a font bug. `hplot` ignores bit 7, the half-dot
palette shift, which is exactly why mono dumps of colour HGR come out right.

The colour tables `CKCOL`, `CDENS`, `BAYER` are ported verbatim from
the real 6502 routines. That algorithm is §14a; its upstream sources are §14b.

---

## 14a. The ordered dither

`citohCellStream` (`test/printout/apple-video.js`) and the 6502 it is ported
from. Per cell: **pick one of the seven `ESC K` inks for that colour, then screen
that colour's fixed ink density through a 4×4 ordered Bayer matrix.** It is not a
photographic dither — nothing is measured off the image and nothing diffuses. The
density is a constant per palette entry, so the output is a pure function of
`(colour, wire, x)`.

Three 16-entry tables, indexed by the //e lo-res colour. Authority:
`web-a2e/t/imagewriter_ii_lr_s2p.asm`, duplicated verbatim
in `t/dlr-dump-color.asm`, and in the vendored
`examples/screen-to-print/source/imagewriterii/lr-dump-color.asm`,.
JS port: `apple-video.js`,. Every copy checked — identical.

| # | //e colour | `CKCOL` | `ESC K` ink | `CDENS` | coverage |
|---|---|---|---|---|---|
| 0 | black | `$00` | black | 16 | solid |
| 1 | magenta | `$02` | red | 16 | solid |
| 2 | dark blue | `$03` | blue | 16 | solid |
| 3 | purple | `$06` | purple | 16 | solid |
| 4 | dark green | `$05` | green | 16 | solid |
| 5 | grey 1 | `$00` | black | 8 | ½ |
| 6 | medium blue | `$03` | blue | 16 | solid |
| 7 | light blue | `$03` | blue | 8 | ½ |
| 8 | brown | `$04` | orange | 16 | solid |
| 9 | orange | `$04` | orange | 16 | solid |
| 10 | grey 2 | `$00` | black | 4 | ¼ |
| 11 | pink | `$02` | red | 8 | ½ |
| 12 | light green | `$05` | green | 16 | solid |
| 13 | yellow | `$01` | yellow | 16 | solid |
| 14 | aqua | `$05` | green | 8 | ½ |
| 15 | white | `$FF` | *none* | 0 | bare |

`CKCOL` `$FF` is white: no `ESC K` is emitted at all and the cell relies on
density 0 to print nothing — one fewer escape per blank cell
(`apple-video.js`, asm). The matrix holds 0–15, each exactly once,
so density 16 beats every threshold (a solid hue **never** dithers) and density 0
loses to all of them.

```js
// shape only — apple-video.js; asm imagewriter_ii_lr_s2p.asm
for (let wire = 0; wire < 8; wire++) // bit 0 = top wire
 if (BAYER[(wire & 3) * 4 + phase] < density) byte |= 1 << wire;
phase = (phase + 1) & 3; // per DOT, not per cell
```

### The three things that are easy to get wrong

1. **`ESC K` selects seven inks; it is not a four-pass separation.** 0 black,
 1 yellow, 2 red, 3 blue, 4 orange, 5 green, 6 purple — the printer overprints
 4–6 itself from the four-band ribbon. A cell is *one* pass with one ink
 selected. Hand-separating into Y/M/C/K passes is a different algorithm
 (`buildScreenDumpColor`, §9) and not what period software did.
2. **Every colour carries a density, not just the greys.** Five of the sixteen are
 fractional — grey 1, light blue, pink and aqua at 8, grey 2 at 4. Special-casing
 "the greys" silently drops the three pastels.
3. **The x phase runs continuously across cells, resetting only at the left
 margin** (asm, `apple-video.js`). Cell width is 13 dots for lo-res
 (`CW`, `imagewriter_ii_lr_s2p.asm`) and 7 for double lo-res
 (`dlr-dump-color.asm`) — neither a multiple of 4 — so a per-cell reset would
 give every cell the identical dot pattern and print as a vertical seam every
 `CW` columns. Vertically the phase is `wire & 3` and a band is eight wires, two
 whole tiles, so it stays continuous down the page with no extra state.

### 14a.1 It is a test oracle

The algorithm is a pure function with no error term and no neighbour dependence,
so its output is **fixed and predictable** — a port of it is *verified*, not
eyeballed. Cheapest checks first:

| Check | Expected | A failure means |
|---|---|---|
| Lit fraction of a uniform field of colour `c` | exactly `CDENS[c]/16`; only 0, ¼, ½, 1 occur. Measured over colours 15/10/5/13: `0.0000 / 0.2500 / 0.5000 / 1.0000` | wrong table, or the threshold sense flipped |
| A solid hue (density 16) | every data byte `0xFF` — zero bare paper, no lattice | comparison is `<=` / `>=`, or the density was read as 15 |
| A fractional density (8) | an even 50% screen | near-black with holes = inverted comparison; stripes or a checker = the Bayer index is transposed |
| Same video RAM through the JS port and through the 6502 routine | byte-identical streams — same tables, same loop | the port drifted |
| Consecutive same-colour cells at a fractional density | **differ**, because `CW mod 4 ≠ 0` | identical cells = the phase was reset per cell; shows as a seam every `CW` columns |

A lattice inside a *solid* is not a dither bug — density 16 emits `0xFF` and
cannot leave a gap. It is the renderer's ink model (§14a.2).

`npm run print -- lores-memory` (`test/printout/examples.js`) drives
`loresColorStream` and `dloresColorStream` through the real parser and the
reference renderer end to end, and exits non-zero on a page with no dots.
Baseline: 103235 bytes → 361223 dots over two 11″ pages at 150 dpi.

### 14a.2 The renderer's half

An ordered screen only reads correctly if the ink model is right, so a dither
regression and an ink regression look alike. The relation, restated from §13
because this is where it bites:

- the wire's dot is `(1/72) × 0.47` inch, ~0.47 wire pitches
 (`src/pagination.js`, basis at);
- four neighbours meet at √2/2 ≈ 0.707 pitches, which that disc does not reach —
 so a hard disc of the real size lattices every solid fill;
- widen it past 0.707 and solids close, but a 50% screen now covers ~80% of the
 paper and density 8 prints near-black.

`test/printout/paper.js` resolves it with a saturated core of `dotRadiusInch` plus
a linearly-fading wick halo out to `INK_SPREAD = 1.9×` (applied,
reasoning at). The halo edge lands at ~0.89 pitches, past the junction, so
four overlapping haloes close a solid while an isolated screen dot keeps only its
core and stays a discrete mark. Validate the ink model on a density-16 field
*before* blaming the dither for a fractional one.

---

## 14b. Upstream: the 6502 dump sources

**The authoritative dump algorithms are 6502 assembly in `web-a2e`, not JS.**
`test/printout/apple-video.js` is a port of them; `src/screen-dump.js` is a
different route entirely (RGBA in, §14). Where the two disagree, the assembly
wins.

24 files match `web-a2e/t/*.asm`. The ones worth opening:

| Upstream `t/…` | Ln | Authoritative for |
|---|---|---|
| `imagewriter_ii_lr_s2p.asm` | 313 | LORES → IW-II, mono **and** colour behind one config byte. Home of `CKCOL`/`CDENS`/`BAYER` (§14a) |
| `lr-dump-color.asm` / `lr-dump.asm` | 192 / 121 | LORES colour / LORES 1-bit mono, single-purpose |
| `dlr-dump-color.asm` | 221 | DLORES colour: aux = left cell, main = right; `CW` = 7 |
| `hgr-dump.asm` | 223 | the period mono HGR dump — `ESC n`, `ESC T 16`, `ESC G "0280"` |
| `hgr-dump-bw.asm` | 200 | HGR mono with a run-time slot byte |
| `hgr-dump-color.asm` | 399 | HGR NTSC six-hue classifier → ribbon overprint |
| `hgr-dump-gray.asm` | 454 | the same classifier → one grey per hue (`GRAY`), then Bayer |
| `dhgr-dump-color.asm` | 489 | DHGR colour; `DENS`, the eight IW-II graphics pitches |
| `dhgr-dump-gray.asm` | 417 | DHGR per-colour ink density (`INK`) — a 16-entry density table like `CDENS`, fitted for DHGR |
| `imagewriter_ii_{hgr,dhr,dlr}_s2p.asm` | 492 / 493 / 246 | merged wrappers: page, slot and ink mode in one config byte |
| `hgr-scene.asm` · `dhgr-sierra.asm` · `lr-kaleido.asm` · `dlr-kaleido.asm` | 231 / 627 / 108 / 135 | the pictures the dumps print |
| `dhgr-promote-p2.asm` | 67 | copy DHGR page 1 → page 2 in both banks, for page-2 dump tests |

`t/` is working scratch as well as authority, so earlier drafts survive under
older names — `lowres-print-routine-color.asm` and `lores-test-bw.asm` are
byte-identical to each other, and the latter is misnamed: it is the *colour*
dump. Prefer the `lr-` / `dlr-` / `hgr-` / `dhgr-` names.

`examples/screen-to-print/source/` is the other half of the relationship: the
curated, per-model, shipped subset, vendored into this repo. Some files are
byte-identical to their upstream counterpart (`imagewriterii/dhgr-dump-gray.asm`,
`imagewriterii/hgr-scene.asm`; `common/lr-art.asm` = `t/lr-kaleido.asm`,
`common/dlr-art.asm` = `t/dlr-kaleido.asm`); others diverged when they were
parameterised per model — printer slot, `POKE 9` page select, C. Itoh vs ESC/P.
The dither tables are identical in every copy.

### The toolkit disk

`examples/screen-to-print/screen_to_print.po` — 143360 bytes, 280 ProDOS blocks,
volume `SCREEN.TO.PRINT` — carries the assembled dumps for all four models plus
the programs that draw the screens. Its value here is **provenance**: booting it
on an emulated //e yields a byte stream a real Apple generated, rather than one
this repo synthesised, so a parser or renderer change can be checked against
period output instead of against its own snapshot.
`examples/screen-to-print/README.md` is the index.
---

## 14c. Two things are called "screen dump"

They are different mechanisms with different outputs, and conflating them wastes
an afternoon. §14 is the first, §14a/§14b the second; this is the disambiguation.

| | **Printer screen dump** (host feature) | **6502 dump routine** (in-machine) |
|---|---|---|
| Runs | in the host, in JS | on the Apple, as 6502 code |
| Reads | the emulator's **rendered screen** — an RGBA framebuffer | LR/DLR/HGR/DHGR **memory**, decoding the layout itself |
| Code | `src/screen-dump.js`, shipped | `web-a2e/t/*.asm` (§14b), ported to `test/printout/apple-video.js` |
| Emits | every pixel as a graphics dot — `ESC G` / `ESC *` bit-image, nothing else | escape codes chosen per cell: `ESC K` + the density tables for graphics (§14a), and **characters** for text |
| Needs the toolkit disk | no | yes, or your own port of it |
| Purpose | photograph what is on the CRT | give an Apple program real print capability |

Four consequences:

1. **The same screen yields visibly different pages, and that is correct.** The
 host route runs through the emulator's video decoder and a host rasteriser;
 the machine route runs through the Apple's own reading of memory plus the
 printer's built-in fonts and colour model. Two pipelines, two pages. Finding
 that they differ is not a defect to chase.
2. **The host dump requires none of the 6502 code.** It works with no disk
 inserted and no Apple software running — `dumpScreen`
 (`web-a2e/src/js/printer/printer-window.js`) reads a framebuffer the
 renderer already holds and feeds the bytes straight in.
3. **The machine route is the one to copy if you are adding printing to an Apple
 II program.** That is what it is for, and what period software did.
4. **Text is the sharpest illustration.** The host dump has no text path at all:
 `scanBandColumns` (`src/screen-dump.js`) is the only place pixels are read
 and every protocol descriptor emits graphics commands, so on-screen text
 prints as photographed //e pixels at the dump's 72 dpi in the //e's own cell.
 The 6502 route sends character codes and lets the printer's ROM font draw
 them, so the same text lands at printer resolution in the printer's typeface —
 and picks up pitch, quality tier and proportional spacing for free.

Colour does not change the split: `buildScreenDumpColor` still photographs
pixels, dithering them to the //e gamut and separating into four overprint passes
(§9), while the machine route picks one of seven inks per cell (§14a). Same
distinction, different dithers.

---

## 15. Extending it

**Add a printer model.**
1. Parent: `CItohPrinter` for another 8510 derivative, else `PrinterBase`.
2. New `src/<model>.js`; implement `getName`, `getId`.
3. Override the capabilities that differ — `supportsColorRibbon`,
 `paperWidthRange`, `paperLengthRange`, `defaultPaperLengthInch`, `paperAnchor`,
 `sprocketSymmetry`, `carriageWidthInch`, `getCharsPerSecond`.
4. C. Itoh derivative: suppress absent codes with an `IGNORED_ESC` `Set` checked
 at the top of `_handleEsc` before `super` (`src/imagewriter-i.js`). New
 family: write `_resetParserState`, `_resetRenderState`, `_recomputeUnits`,
 `receiveByte`, `_emitChar`.
5. Bind ROMs via the `get*Char` hooks (§10); add `static get SETTINGS` as
 `[...super.SETTINGS, …]` for DIP switches.
6. Register in `PRINTER_MODELS` (`src/index.js`) with the right `interface`,
 re-export at, declare in `types/index.d.ts`.
7. Add a job in `test/printout/jobs.js` and a snapshot `describe` in `test/`.

**Add a command to an existing model.**
1. Find the dispatch: `_handleEsc` (`citoh-printer.js`) or `_esc`
 (`epson-fx80.js`).
2. No parameter → act in the `case`. One parameter byte → set `_paramCmd`,
 `_state = S_PARAM1`, handle it in that switch.
3. ASCII-decimal parameter (C. Itoh) → `_beginNum(cmd, digits)` plus a `case` in
 `_dispatchNum`. Binary (Epson) → `_param1`/`_param2`/`_param3`.
4. A new multi-byte mode needs a new `S_*` constant, a `case` in `receiveByte`,
 and its accumulators cleared in `_resetParserState`.
5. Model-specific behaviour → override just that byte in the subclass before
 delegating to `super`.
6. Add a snapshot test, run `npm run test:update` once, and **read the diff** —
 that diff is the review.

**Add a ROM / font bank.**
1. New `src/<model>-rom-<face>.js`; header states columns, rows and which bit is
 the top wire.
2. Export `NAME = {code: [cols…]}` for US, plus `NAME_<LOCALE>`, `NAME_LOCALES`
 and `NAME_LOCALE_MAP`.
3. Bit 0 = top wire; nine-wire values exceed `0xFF` and NLQ exceed `0xFFFF`, so
 plain JS arrays, never typed arrays.
4. Proportional banks: include the trailing blank column(s) — they are the
 escapement.
5. Re-export from `src/roms.js`, and override the matching
 `get*Char(code, locale)` hook: `NAME_LOCALES[locale]?.[code]`, then the US
 base, then `super`.
6. Existing banks are hand-authored via `rom-editor.html` and represent
 substantial manual work: extend additively, never regenerate over them.

---

## 16. Integrating it

```js
import { createPrinter, pageMetrics } from "@manybitsbyte/retroapple-printers";

const printer = createPrinter("imagewriter-ii");
if (printer.supportsColorRibbon) printer.setRibbon("color");
printer.setAutoLineFeed(false); // DIP switches, before the job
printer.onImpact((dots, kind, x) => sound(dots, kind, x)); // optional

const paper = new MyRenderer(pageMetrics(printer));
printer.setEventSink(({ name, data, dt }) => paper.accept(name, data, dt));
printer.on("text", (s) => transcript.push(s)); // optional

for (const b of byteStream) printer.receiveByte(b);
printer.flushLine;
```

- **Node and browser are the same code.** Pure ESM, zero runtime deps,
 `"sideEffects": false`, `engines.node >= 18`. No build step.
- **One byte at a time.** There is no `write(buffer)`; the parser is a state
 machine and a byte is its unit.
- **`flushLine` is not optional** for a job that does not end in CR/LF.
- **Order matters**: install the sink before feeding bytes, and set the ribbon
 before any `ESC K` — the ribbon gates ink at strike time.
- **A picture goes in as bytes.** `buildScreenDump*` turns an RGBA buffer into
 that model's bit-image stream, which you then feed through `receiveByte` like
 anything else. There is deliberately no "draw an image" call.

---

## 17. Testing

```bash
npm test # vitest run — 2 files, 51 tests
npm run test:watch
npm run test:update # re-record snapshots; READ THE DIFF
npm run print # one page per model → test/printout/out/*.png
npm run print -- --examples # capability examples
npm run print -- --all
npm run print -- --list
npm run print -- color-graphics # one job by name
npm run print -- --dpi 300
npm run print -- --multipage # three-page job, one PNG per sheet
```

`vitest.config.js` pins `environment: "node"` — a DOM dependency in a module
under test is a smell, not a reason to add jsdom.

**What the tests pin is the event stream itself.** `capture`
(`test/harness.js`) installs a sink, subscribes to all six listener events,
feeds the bytes, calls `flushLine`, and returns one array in call order — so the
snapshot preserves the real interleaving of the immediate and timed paths.
`summarise` condenses each record to one line (`char x=… w=… cols=…`,
`dots 0b… x=… w=…`, `feed <sound> dist=…`) so a regression cannot hide in a
verbose diff. Numbers round to 4 places (`roundDeep`) because pitches come from
divisions like `dpi/107` and would otherwise fail on float noise. These are
**characterization** tests: a refactor or a port must reproduce the stream exactly
or show the difference as a deliberate snapshot edit. A handful assert semantics
instead, and those are what catch a reimplementation — high-bit stripping equals
plain ASCII, pica advance > condensed advance, NLQ `rows` differs from draft, and
`ESC K` on a mono cart yields `"black"` where a colour cart does not
(`test/citoh.test.js`).

`npm run print` proves the whole pipeline: period-accurate byte streams → the
real parsers → `paper.js` → PNGs, exiting non-zero if a job produced no dots.
Baseline at 150 dpi: IW-II 545 bytes → 5878 dots; IW-I 351 → 4285; FX-80
702 → 5732 on a 12" form; DMP 356 → 4409. Legible pages mean the chain works.

---

## 18. Traps

1. **Integrating `feed` as a vertical advance.** `feed.dist` is `head.x`, a sound
 cue; vertical position arrives on every strike as `yDot`. Integrate it and the
 job stacks on line one. The **listener** `formfeed` event's `dist` *is* a
 vertical distance — same word, opposite meaning, different channel.
2. **Assuming strikes are sequential.** They are absolutely positioned and, in
 bidirectional mode, arrive right-to-left on alternate lines. Any cursor you
 keep will be wrong.
3. **Wrong bit order per family.** C. Itoh bit 0 = top wire; Epson bit 7 = top
 pin. The FX-80 parser normalises inbound (`REV8`), so the *event* stream is
 uniformly bit-0-top — but a **sender** (dump routine, font downloader) must
 speak the target's wire order. Wrong = everything vertically mirrored, which
 looks like a font problem.
4. **Assuming `ESC K` is a four-colour separation.** It selects one of **seven**
 inks and the printer overprints the secondaries itself.
5. **Assuming a mono ribbon means the colour command was ignored.** It was
 honoured and resolved to black by `VirtualRibbon.ink`. Call
 `setRibbon("color")` first or a colour assertion asserts nothing.
6. **Colour overprint with Auto-LF on.** The bare `CR` between band passes also
 feeds, so the passes come out as stripes instead of mixing.
7. **Inventing geometry constants.** A lo-res cell is 7 × 4 because 40×7 = 280 and
 48×4 = 192; `dotH` is `dpi/72` because the wires sit 1/72" apart. Derive from
 the hardware relation or cite the code — never choose.
8. **Drawing dots as hard discs.** Below 0.707 wire pitches a solid fill keeps a
 white lattice; above it a 50% screen prints near-black. Model the wick (§13).
9. **Skipping `flushLine`.** A job with no trailing CR/LF renders empty.
10. **Assuming an 11" form.** `ESC H` (IW-II, to ~69") and `ESC C` (FX-80, default
 **12"**) change it live. Call `formDots(printer)`.
11. **Using `yDot % formLen`.** `%` keeps the dividend's sign, so a reverse feed
 above top-of-form lands on page −1. Use `yOnPage`.
12. **Starting a new page only on `formfeed`.** Running past the bottom of the
 form crosses into the next sheet with no event. Allocate from `pageOf`.
13. **Routing whole glyphs to a sheet.** A line on the perforation prints its
 upper wires on one sheet and its lower wires on the next. Route dots.
14. **Parking `paper.formDots` at 0 as an "unset" sentinel, then doing page math
 directly.** `nextFormTop` returns `NaN` and every strike after the first form
 feed vanishes. Go through `_effectiveFormDots`.
15. **Reading `printChar` fields the FX-80 never sends** — `rows`, `hDensity`,
 `vDensity`, `halfHeight`, `doubleWidth` are C. Itoh only. Default `rows` to 9.
16. **Treating `dotW` as the glyph width.** It is one column; glyph width is
 `cols.length × dotW`, and the *advance* is neither — it is the pitch cell, the
 proportional width, or the custom width code.
17. **Rendering `bold`/`underline` as a style.** They are mechanical (a second
 offset hammer pass; a wire firing below the box). Reported, not realised.
18. **Stripping bit 7 from graphics or custom-character data.** All eight bits are
 pin data; the parsers deliberately use the raw `byte` there, not `ch`.
19. **Capturing a module-level pitch constant.** DPI-derived values live on the
 instance and are recomputed by `_recomputeUnits`, so a captured constant
 silently survives `setDpi` — and note `DEFAULT_DPI` does *not* divide every
 density exactly (480/72, /90, /107, /136, /144, /216 are fractional, §6), so
 keep consumer arithmetic in float.
20. **Expecting a `PrinterManager`.** `SETTINGS` entries with `target: 'manager'`
 and two JSDoc lines in `src/screen-dump.js` name a host class this package does
 not ship.
