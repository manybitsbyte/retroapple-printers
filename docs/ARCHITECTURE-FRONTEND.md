# Architecture, Part II — The Front End

How a host drives this printer engine and turns its event stream into a live virtual printer: paper, ink, sound, an operator panel, page history, export, agent control. The reference host is **web-a2e**, an Apple //e emulator. Part I (`ARCHITECTURE-BACKEND.md`) covers the engine — parsing, glyphs, head model, event payloads — and this assumes it.

**Paths.** Unprefixed `src/…` = the host repo (`web-a2e`). `pkg/src/…` = this package. The engine files under `web-a2e/src/js/printer/*.js` are byte-identical to `pkg/src/*.js` apart from authorship headers; they are Part I's subject. The a2e-only files are `printer-window.js` (2966 lines), `printer-manager.js`, `printer-page-store.js`, `printer-sound.js`, `print-browser-window.js`, `print-utils.js`, `zip-store.js`.

---

## 1. TL;DR

- A front end owes the engine one thing: **bytes, in order**. Where they came from is the host's problem; the engine neither knows nor cares.
- The engine returns **timed events**, not pixels: `{name, data, dt}` via `setEventSink`, where `dt` is how long the real mechanism would have taken.
- So the host needs a **wall clock** to spread a burst the CPU handed over instantly across real time — `printer-manager.js`, ~420 lines.
- And a **renderer**. Strikes are absolutely positioned in internal dots, so this is coordinate mapping plus an ink model — `printer-window.js`, where all the difficulty lives.
- Paper is a **continuous roll**. Pages are arithmetic on `yDot` (`pkg/src/pagination.js`); a canvas that grows a page at a time with two blank lead pages reads as fanfold.
- **Ink is subtractive and cumulative**: each dot remembers which ribbon bands struck it and how many times. That is overprint colour and double-strike bold.
- Sound is **synthesised per strike** — filtered noise grains on the audio clock, not samples.
- Pages snapshot to **IndexedDB** as PNGs, giving history, PNG/ZIP export, and print/PDF through a hidden iframe.
- A 24-tool **agent surface** includes raw-byte injection that bypasses the CPU — the most useful thing there is for developing a model.
- One byte: `PR#n` → C++ card → `txCallback_` → `EM_ASM` → Worker `postMessage` → `wasmProxy.onPrinterByte` → `PrinterManager.receiveByte` → parser → head model → event sink → scheduler → canvas.

---

## 2. The whole path, end to end

Replace rows 1–7 with whatever produces bytes in your host; rows 8–13 are unchanged.

| # | Where | `path:line` | What happens |
|---|---|---|---|
| 1 | Apple software | — | `PR#1` (parallel) / `CHR$(4)"PR#2"` (serial) redirects `COUT`; firmware writes each byte to card I/O |
| 2 | MMU slot decode | `src/core/mmu/mmu.cpp`, | `$C0nx` → `slots_[slot-1]->writeIO(offset, value)` |
| 3a | Parallel card | `src/core/cards/parallel/parallel_card.cpp`, | `ParallelCard::writeIO`, offset `0x00` → `dataLatch_ = val` |
| 3b | **Parallel emit** | `parallel_card.cpp` | `if (txCallback_) txCallback_(dataLatch_)` |
| 4a | SSC card | `src/core/cards/ssc/ssc_card.cpp` | bit-3-set offsets route to ACIA; `$C0A8` (slot 2) → `acia_.write(0, value)` |
| 4b | **Serial emit** | `src/core/cards/ssc/acia6551.cpp` | `case REG_DATA: txData_ = value; txCallback_(value)` |
| 5 | Emulator shim | `src/core/emulator.cpp` | `setSerialTxCallback`/`setParallelTxCallback` cache the lambda, forward to the card if present; re-applied on card creation at, |
| 6 | WASM boundary | `src/bindings/wasm_interface.cpp` | exports `setSerialTxCallback`/`setParallelTxCallback`; body is `EM_ASM`, **synchronous, one byte per call**: `self.emulator.printer.receiveByte($0)` |
| 7 | Worker shim | `src/js/worker/emulator-worker.js` | `self.emulator.printer = { receiveByte(b){ postMessage({type:'printer-byte', byte:b}) } }` |
| 8 | Protocol | `src/js/worker/rpc-protocol.js` | `MSG_PRINTER_BYTE = 'printer-byte'` |
| 9 | Main thread | `src/js/worker/wasm-proxy.js` | `case MSG_PRINTER_BYTE: this.onPrinterByte(msg.byte)` |
| 10 | Host owner | `src/js/printer/printer-manager.js` | `wasmProxy.onPrinterByte = b => this.receiveByte(b)` |
| 11 | Parser | `printer-manager.js` | `activePrinter.receiveByte(byte)` — control codes, ESC, glyph lookup |
| 12 | Head + sink | `pkg/src/printer-base.js`, | strikes buffer into a line; `_commitLine` orders by travel, `_timed(name,data,dt)` → sink |
| 13 | Scheduler → canvas | `printer-manager.js` | `_enqueue` stamps a release time; `_pump` fires it into `_fire` → window listeners |

The transport is deliberately dumb: no queue, no batching — one structured-clone `postMessage` per byte (`emulator-worker.js`), so a page of graphics is tens of thousands of messages. It works because the engine is cheap per byte and the *scheduler*, not the transport, sets the pace. Both callbacks are installed twice by different owners (C++ at `wasm_interface.cpp` during `init`, JS at `printer-manager.js`/) because the JS registration is fire-and-forget (`wasm-proxy.js`) — the `await`/`try` around it can never observe a WASM-side failure.

---

## 3. Byte sources

Both buses reduce to a byte stream; what differs is what the Apple side must do and how much hardware needs modelling to keep the firmware happy.

| | Parallel (Centronics) | Serial (SSC / 6551 ACIA) |
|---|---|---|
| Card | `src/core/cards/parallel/` | `src/core/cards/ssc/` |
| Drives | Epson FX-80, Apple DMP | ImageWriter I, ImageWriter II |
| Invocation | `PR#1` | `CHR$(4)"PR#2"` under ProDOS |
| Emit point | data-latch write, offset `0x00` | ACIA transmit data register |
| Timing modelled | `kStrobeBusyCycles = 64` (`parallel_card.hpp`) — handshake only | none; `ssc_card.cpp` is a no-op, `STATUS_TDRE` re-asserts immediately (`acia6551.cpp`) |
| DIP | SW1:6 picks the ROM half | `sw1_ = 0x16` (9600 8N1) read back but inert (`ssc_card.hpp`) |

**The parallel ROM address-decode quirk is load-bearing.** The Apple PIC does not poll a status register for the handshake — the card **rewrites ROM address bit 6 from the ACK latch on every instruction fetch** (`parallel_card.cpp`), so the 6502 executes a different byte stream depending on printer busy state. `$C100` runs the code stored at ROM offset `$40`. Reading the ROM flat hangs `PR#1` forever. The card also emits only on the data-latch write, never on a STROBE toggle (`parallel_card.cpp`) — re-emitting there double-printed every byte for strobe-aware drivers.

Neither card knows what a printer is (`src/core/emulator.hpp`); they are generic ports and the printer is entirely downstream in JS. Porting to a non-Apple host needs none of §3 — just call `receiveByte` or `feedBytes`.

---

## 4. `PrinterManager` — the host-side owner

`src/js/printer/printer-manager.js`. Four jobs: choose the model, hold cross-model operator state, fan bytes in, pace events out.

**Models.** `PRINTER_MODELS`, four `{id, name, create}` entries. `setActivePrinter` resets the old model, cancels the queue, re-installs sinks (`_install`), notifies `onPrinterChange`.

**Cross-model state**, all `localStorage`: ribbon `a2e-printer-ribbon`, auto line feed `a2e-printer-autolf`, speed `a2e-printer-speed`. A black-only model coerces a persisted colour ribbon to B/W on install. The speed knob is **inert**: `_loadSpeed` deletes the key and pins 1× because the button is `hidden`; `setPrintSpeed` and `_rescaleSchedule` (re-pitches an in-flight backlog) remain for when it returns.

**Interface gating.** `updateSlots(assignments)` scans the slot config for a `parallel` or `ssc` card; `availableModelIds` maps bus → reachable models. No card, and bytes are dropped at the door.

**Power.** `setPower(false)` cancels queued motion but leaves printed paper alone — a mains switch, not a reset.

**Fan-in.** `receiveByte(byte)` for the live stream, `feedBytes(bytes)` for a bounded host-built block. Both gate on power+interface and arm a 120 ms idle timer that calls `flushLine`, so a trailing line with no terminating CR still prints.

### The scheduler

The head model emits a whole line synchronously; the scheduler spreads it onto the printer's own timeline.

- `_cursor` is the timeline head. `_enqueue` advances it by `evt.dt / _speed` and stamps the release time.
- `_pump` drains everything due, driven by **both** `requestAnimationFrame` and a `setTimeout` fallback (`_scheduleTick`) — rAF near-halts in a backgrounded tab, freezing the paper mid-print with a blank tail.
- Every fire is try/caught: a throwing listener must not strand the pump with `_pumping` stuck true.
- `MAX_LAG_MS = 1500` caps how far ahead of real time a release may be scheduled; without it a warp CPU pushes releases *minutes* out and the paper appears to freeze. `_unclampedFeed` (applied) exempts a burst.
- `drainNow` flushes the backlog synchronously ignoring pacing — for headless capture. `cancelQueued` **discards** it instead; anything that wipes or re-inits the paper must call this first.

**Correction to the usual description of `_unclampedFeed`:** it is not only for screen dumps. `receiveByte` sets it too, so a live 6502 stream also paces at true head speed; the 120 ms idle flush re-clamps once quiet. `MAX_LAG_MS` binds *between* jobs, not during one.

**Model does not persist.** The constructor hardcodes `new ImageWriterII` and no key records the choice. See Trap 1.

---

## 5. The renderer — `printer-window.js`

A `BaseWindow` subclass (id `printer-output`, default 580×480). Organised by concern, not line order.

### 5.1 Canvas and paper model

The paper is **one tall canvas**, not a stack of pages. `_initCanvas` sizes it to `_pageHeightPx * 3` — first sheet plus two blank lead pages, so it reads as fanfold. `_ensureCanvasHeight` grows it in whole-page steps keeping that lead, preserving content via a temp blit, and rejects a non-finite height outright rather than letting a NaN collapse `canvas.height` to 0 and blank the sheet. Browser limits are real and asymmetric — `CANVAS_MAX_H = 32000`, `CANVAS_MAX_AREA = 16000000`; Safari is area-bound and *silently blanks*, hence the draw-and-read-back probe in `canvasFits`. Three stacked canvases: `#pr-canvas` (ink, supersampled), `#pr-perf` (perforations), `#pr-head` (impact flash).

**Supersampling.** `PRINTER_SS` defaults to 3. The paper backing is SS× the logical raster and the context is pre-scaled by SS (`_sizePaperBacking`), so *all draw code stays in logical 120-dpi coordinates*. At 1:1 a pin dot spans 1–2 device px — too few for both a solid core and a round edge; painting at 360/in and downsampling gives both. **Layout and export must read `_logW`/`_logH`, never `canvas.width/height`.**

**Raster.** `_ppi` across (`printer.canvasPxPerInch`, default 120) by `V_RASTER = 72` down — the 9-pin wire pitch. `_vstretch = _ppi/V_RASTER` scales vertical coordinates so an 8×11″ page comes out the right shape. Engine dots map through `_hdotInternal = dpi/_ppi` and `_vdotInternal = dpi/V_RASTER`, so a model may override its `dpi` and everything tracks. `_snapPx` quantises to the 1/SS backing grid, not whole logical pixels — FX-80 `ESC Z` 240 dpi and IW-II 136/144/160 dpi graphics survive; whole-pixel rounding destroyed them.

**Pagination.** `_pageHeightPx` derives page height from the live form length, never a constant. This package now exports the same arithmetic as `pkg/src/pagination.js` (`formDots`, `pageOf`, `yOnPage`, `pageMetrics`, `WIRE_PITCH = 72`); a2e predates the extraction and inlines it, so treat `pagination.js` as canonical for a new host.

### 5.2 Ink

Coordinate map → band accumulation → paint.

`_renderChar(data)` maps a glyph: column x is `zoneOriginPx + xDot/_hdotInternal`. **The head column maps through the printer's base raster, never the glyph's own `dotW`** — dividing by `dotW` inflated proportional strikes by 4/3 and drifted them right. The intra-glyph step comes from `hDensity`. It handles bold (repaint offset one dot), underline (bottom pin fired across the cell at dot pitch, *not* a `fillRect` — that lays 2–3× the ink), double-width, half-height, super/subscript. `_renderDots(data)` maps one graphics column; density governs cursor step, **not** canvas scale, so a 560-dot 72-dpi dump spans 560/72 = 7.78″ and fills the page as real hardware does. Both wrap paint in `save` → `_clipToPaper` → `restore`, so ink past a narrow sheet lands on the roller, never the sprocket strips.

**The ink model** (`_inkDot`): a `Map` keyed on backing-pixel coordinates stores per dot a **4-bit band mask plus a 3-bit strike count** packed in one integer.

| Piece | Line | Behaviour |
|---|---|---|
| `BAND` | | `Y=1, M=2, C=4, K=8` |
| `COLOR_BANDS` | | colour → bands deposited; `ESC K 4-6` secondaries deposit *both* constituents so a later overstrike still mixes right |
| `mixInk(mask)` | | subtractive: Y\|C → green, M\|C → purple, all three → `#3a2a14` |
| `inkColor(mask,count)` | | overstrike darkening — black → `#000`, colour deepens to a 0.6 floor keeping hue; `COLOR_VIVID = 1.25` saturates around luma |
| `_paintDot` | | square = exact footprint (graphics, butts into solid fills); round = a **fixed-diameter** disc `STRIKE.diaPx = 1.9` centred on the cell |

The fixed disc is the physical claim: a pin tip is one size, so draft and NLQ dots are identical and density only changes spacing. `STRIKE.buildup` adds a capped sub-pixel radius bump per overstrike (`bleedPx = 0.12`), saturating at `maxBuild = 3`; at count 1 output is byte-identical to buildup off. `STRIKE` is live-tunable via `setPrinterStrike`, persisted to `a2e-printer-strike`.

One asymmetry worth copying: **text does not inherit a stale band.** Graphics passes accumulate (so DazzleDraw overprints mix), but a text dot landing on a *different* prior band paints its own colour with count reset — a real IW-II prints each colour glyph in one pass, and inheriting a stale black band opaquely blackened glyphs. The map clears at 80 000 entries to bound memory.

### 5.3 The paper UI

`computeLayout(profile, widthInch, lengthInch)` (`pkg/src/printer-paper-geometry.js`) is a pure solver returning canvas-px; the window caches it in `_platen` (`_recomputePlaten`) and holds **no layout math of its own**.

| Field | Meaning |
|---|---|
| `paperLPx` / `paperRPx` | paper **body** edges = ruler 0 … ruler max (the sizer line) |
| `sheetLPx` / `sheetRPx` | full sheet incl. the render-only ½″/side tractor strips |
| `zoneOriginPx` | print column 0 — the fixed carriage span, an ink clip only |
| `tractorPx`, `widthPx`, `heightPx` | strip width, canvas extent |

**Ruler semantics.** Ruler 0 is **body-left — the inner edge of the left tractor strip — not the sheet edge**. The ½″ holed strips are not paper, sit outside the scale, and are dimmed (`_drawTopRuler`): ¼″ ticks, inch labels, green accents on both body edges. The left ruler restarts at 0 on every page so each sheet reads 0…formInches, the shared perforation label suppressed (`_drawLeftRuler`). Green full-height hairlines (`_sizePaperEdges`) line up with those accents. Rulers raster at *display* resolution and are scroll-locked by transform (`_syncRulers`) so labels keep native pixel height instead of CSS squish.

**The paper anchor differs by manufacturer** — one model capability, `paperAnchor`:

| Models | Value | `computeLayout` effect |
|---|---|---|
| C. Itoh — IW-I, IW-II, Apple DMP | `"center"` (`pkg/src/printer-base.js`) | `zoneL = B/2 − C/2`: the fixed 8″ carriage zone is **centred** on the body |
| Epson FX-80 | `"left"` (`pkg/src/epson-fx80.js`) | `zoneL = 0`: print column 0 at body-left |

Get this wrong and every narrow-paper print is offset. (The comment at `printer-window.js` still calls the sheet left-referenced — stale; `computeLayout` is the authority.)

**Sizing.** Six `PAPER_PRESETS` in paper *body* inches, strips off, plus two live drags — the right tractor for width, a handle at the first perforation for form length. Both are non-destructive previews clamped to the model's range and snapped to `GRID_INCH = 0.25`, committing on release via `setPaperWidth`/`setPaperLength`; the gesture design is **§5.6**. Sprocket holes are proportional — ½″ pitch, 4 mm hole = 0.157× strip width (`_styleSprocketHoles`) — so they scale with zoom.

**Head presence.** A red impact box per strike, accumulating and fading independently into a comet tail (`_markHead`/`_headLoop`; capped at 400 boxes, alpha holds 200 ms then steps 0.10 per 20 ms). Plus a draggable head bug in the left gutter (`_updateHeadMarker`) that moves the *paper* — §5.6. `_followHead` pins the head to viewport centre once it crosses, so the paper feeds past a stationary head — which is what a printer looks like.

### 5.4 The operator panel

A slide-out, pinnable in-flow (`a2e-printer-panel-pinned`, `_togglePin`), holding Fit/1:1, Rulers, TOP, FF, LF▲/LF▼, Dump Screen, Clear, and the DIP switches.

DIP switches are **data-driven from the model's static `SETTINGS` getter** (`pkg/src/printer-base.js`) — a flat list of `{id, type, target, default, label, hint, get, set}`. `type` is `toggle` or `choice`; `target: "manager"` routes through `PrinterManager` so the setting is sticky across model swaps (only Auto-LF is). Everything else is per-model, persisted to `a2e-printer-set-${modelId}-${id}` and re-applied on install (`_applyPersistedSettings`). A subclass extends with `[...super.SETTINGS, …]`, so a new model needs no window edit.

**A `choice` row renders a custom dropdown, not a `<select>`** — trigger plus list in the app's header-menu idiom, chevron and ✓ on the active value (`_settingRowHtml`, `_wireDipMenu`) — and it renders **inline inside the panel, not portaled to `document.body`**. That is deliberate: the panel is an overflow-scrolled, CSS-transformed slide-out, so a portaled list clips or retracts with it. One document-level dismiss handler, bound once (`_ensureDipDismiss`).

### 5.5 Other affordances

| Affordance | Note |
|---|---|
| Fit / 1:1 zoom | fit scales to paper width (vertical scroll only); 1:1 pins the CSS box to logical px so the ×SS backing downsamples. Persists to `a2e-printer-fit` |
| Two-axis wheel | vertical scroll is on `feedBg`, horizontal on the inner `.pr-paper`; browsers axis-lock a diagonal gesture, so deltas are dealt manually |
| Toolbar collapse | hides page → ribbon → model selects as the window narrows; power and exports always survive |
| Ruler visibility | persisted; transiently forced on during a width or length drag (§5.6) |
| Theme repaint | `MutationObserver` on `data-theme` re-rasters both rulers (canvas can't read CSS vars) |
| Deferred layout | sizers need a measurable box, which a hidden window never has. Retries deduped by key, run only while visible, give up after `MAX_LAYOUT_RETRIES = 120` frames |
| Error isolation | `_guard` wraps every listener; a throw is counted and surfaced in `getState` rather than killing the pump |

`_canvasMode` comes from `printer.usesPaperCanvas`. All four models return true, so the `<pre>` text path (`_onText`) is vestigial — do not assume it is exercised.

### 5.6 Direct manipulation — three drags, one pattern

The engine ships no UI at all, so this is entirely host work. The framing that makes it tractable: **the engine owns the state and the constraints; the host owns the gesture.** Everything below is `printer-window.js`. The engine's half of the same seam — which setters exist, what each one clamps, and what `computeLayout` hands back to draw against — is Part I **§12a**; read it before writing a drag, because most of what a gesture looks like it needs is already there.

| Gesture | Grab target | Init | Commits |
|---|---|---|---|
| Paper position | the head bug in the left gutter, dragged vertically | `_initHeadDrag` | **live, per move** — `p._yDot = …`, quantised to `_lineFeedDots`; spring auto-feed once the pointer sits past `AUTO_LINES = 8` |
| Paper width | the right tractor strip | `_initWidthDrag` | `setPaperWidth(cand)` **on release**; a 40 px right hot-zone (`EDGE_PX`) auto-advances `GRID_INCH` per 60 ms tick (`tickEdge`) |
| Form length | the handle at the first perforation | `_initLengthDrag` | `setPaperLength(cand)` **on release** |

#### The pattern

1. **Freeze a grab frame on `pointerdown`** — start value, start pointer coordinate, the model's legal range, and the geometry the preview is drawn against. Width captures `startW`/`startX`/`range` plus `startEdgeIn` (paper-right) and `originInGrab` (ruler 0); length captures `startL`/`startY`/`range`; head captures `startYDot`/`startMouseY`/`dotsPerLine`. The sheet re-lays only on release, so a preview drawn against live geometry would drift under the finger.
2. **Preview on `pointermove`; do not commit.** A guide line plus a readout chip, and nothing reaches the engine. Committing per move would re-lay the sheet every frame — `setPaperWidth`/`setPaperLength` each run `_initCanvas` + `_applyFit` + persist. **The head drag is the deliberate exception**: paper position is one number and costs no re-lay, so it applies live.
3. **Snap and clamp before the preview, not after the commit.** Both sizers snap to `GRID_INCH` (¼″) and clamp to the *model's own* range inside `compute` — `paperWidthRange` / `paperLengthRange`, which are model capabilities (IW-II 3.0–9.0″ body, 1–69″ form; `pkg/src/imagewriter-ii.js`). Then **render the constraint**: a whole-inch detent draws the guide solid, a range limit draws it solid *and* prefixes the chip `⊣` (`showGuide`). The operator watches the limit bite while the cursor keeps travelling.
4. **One commit on `pointerup`**, through the public setter — a single re-lay, like reloading stock. Both sizers then `_armTransientHide`.
5. **Convert scale live, never cached.** Zoom, panel pin and window resize all change the display scale mid-gesture, so every move re-reads it:

| Axis | Chain | Where |
|---|---|---|
| Horizontal | `Δclient / (sx · _ppi)` = inches, `sx = rect.width / _logW` | `_rulerScale`, `sxNow`, `compute` |
| Vertical (sizer) | `Δclient / (_ppi · sy)` = inches, `sy = rect.height / _logH` | `syNow`, `compute` |
| Vertical (head) | `Δclient / scale / _vstretch` → ×`_vdotInternal` → ÷`dotsPerLine` = lines | `apply` |

`_vstretch = _ppi / V_RASTER` and `_vdotInternal = dpi / 72` are the two conversions that take a display pixel all the way to an internal dot. Read `_logW`/`_logH`, never `canvas.width/height` — those are the ×SS backing (Trap 11).

#### Rulers

Scroll-locked by transform (`_syncRulers`) and **transient**: the two sizers call `_showTransientRulers` on `pointerdown` even when the operator has them hidden, and `_armTransientHide` starts a 5 s countdown on release. The head drag does not — it needs no scale.

The readout is meaningless without the ruler semantics, so restated: **ruler 0 is body-left, the inner edge of the left tractor strip**, and ruler max is body-right, which *is* the width handle. The width chip prints `edgeIn − originInGrab` — the tick the guide line is sitting over — so the operator sets the value against the scale already in front of them: drop the line on 7 and the chip says 7.

#### The head, specifically

**Dragging the head bug moves the paper, not the carriage.** The marker is the fixed reference and the paper rolls under it, exactly like turning a platen knob; the tooltip says so verbatim and `_followHead` keeps the marker pinned while the sheet scrolls past. The head rests only on whole line boundaries — manual motion rounds to `dotsPerLine` per move, and the fractional creep the spring auto-feed accumulates is snapped off on release.

| Axis | The engine offers | The host implements |
|---|---|---|
| Vertical | the paper position itself: `lineFeedDown(n)` / `lineFeedUp(n)` (`pkg/src/printer-base.js`, declared `types/index.d.ts`), `setTopOfForm`, `formFeed` | a2e writes the **private** `p._yDot` directly |
| Horizontal | `VirtualHead` — `x`, `dir`, `leftMargin`, `moveTo(x) → travel ms`, `travelMs`, `returnMs`, `home`, `flip` (`pkg/src/printer-head.js`) | **nothing.** There is no carriage drag; the only host write to `head.x` is `= 0` in `dumpScreen` |

**Do not copy the `_yDot` poke blindly.** A clean equivalent exists: `lineFeedDown(n)` / `lineFeedUp(n)` move the same cursor by whole lines, clamp at 0, and additionally emit a timed `feed` record so the motion is charged and voiced like a real platen advance. The direct write skips both — arguably right *during* a drag (nobody wants forty feed clicks under the finger), and the reason a dragged head is silent. What has **no** public equivalent is reading back: there is no `yDot` getter and `_lineFeedDots` is private. A host can track paper position from the `yDot` on every strike (`types/index.d.ts`) — it already receives it on every event.

**A horizontal drag would be cosmetic**, which is presumably why none exists. Strikes carry an absolute `xDot`, so moving the carriage changes travel time and the sound of the next sweep, not where ink lands. `moveTo` is not idle — the engine calls it per strike to price each line — but *no host* calls it, and Part I §12a says why one needn't.

---

## 6. Sound

`src/js/printer/printer-sound.js`, 197 lines. Web Audio, **synthesis not samples**.

A dot-matrix impact is a short broadband *noise* click, not a tone — head energy peaks near the printing frequency with a skirt to ~5 kHz and no clean fundamental. So: one ~0.5 s white-noise buffer reused for every grain; per grain a bandpass (1500 Hz, Q 0.9 for a strike) → highpass → gain envelope, 0.8 ms attack and exponential decay over 11 ms. An earlier oscillator version had a pitch, which made it sing "pew".

**Scheduling, not throttling.** Grains are placed on the audio timeline with a 5 ms spacing cursor, so a synchronous burst spreads into a continuous buzz instead of collapsing onto one instant. The cursor is capped at `MAX_AHEAD = 0.20` s ahead of the clock: a dense burst simply *thins* — grains past the window are skipped — rather than running away and leaving the printer silent afterwards.

**Which events voice.** `PrinterManager._onImpact(dots, kind, xDot)` is the hook, called from `pkg/src/printer-base.js` at each event's release time. Only `char` and `dots` voice; intensity is `dots/22` for a glyph and `dots/7` for a graphics column, floored at 0.18. Above 1× playback only one strike in N is voiced, so the buzz keeps its real pitch instead of compressing into a chipmunk whine.

**On `feed` and carriage noise — the code corrects the usual description.** `feed` *does* carry the head's horizontal position: `{sound: "line"|"return", dist: this.head.x}` (`pkg/src/printer-base.js`), and `_fire` forwards `dist` as `_onImpact`'s third argument for feeds. But `_onImpact` **returns early for `feed`/`return`** (`printer-manager.js`), and `PrinterSound.tickReturn(dur, intensity)` — a full carriage-slew model with a descending noise sweep over a lowpassed belt rumble — is **dead code, called from nowhere**. The comment at `printer-manager.js` records why: the sweeps read as a tonal laser "pew" rather than a printer, so they were silenced and the strikes left to carry it. If you re-enable it, `dist` is what scales the sweep.

Volume tracks the host's single main slider by reading its keys directly (`a2e-volume`, `a2e-muted`) plus a per-source `a2e-printer-sounds` toggle, scaled by `BASE_GAIN = 0.34`. The constructor takes a `getSharedContext` *closure*, not a context: a private `AudioContext` would start suspended and stay silent, so the driver's already-unlocked one is strongly preferred.

---

## 7. Page store and export

**Retention.** `printer-page-store.js` — IndexedDB, DB `a2e-printer-pages` v1, store `printerPages`, `keyPath: "id"`, indexes on `jobId` and `savedAt`. API: `savePage`, `getAllPages`, `deletePage`, `deleteJob`, `clearAllPages`, `countPages`. A **job** is the run of output between clears/resets; the record id is `` `${jobId}::${pageIndex}` `` so re-snapshotting a growing job overwrites its pages in place. A record carries the page PNG plus enough to reconstitute the printer: `model`, `modelId`, `ribbon`, `formInches`, `paperWidthInch`, `pxPerInch`, `headXDot`, `headYDot`.

Capture is **debounced** — `_schedulePersist` (`printer-window.js`) fires 1200 ms after printing goes quiet. `_snapshotPages` is pure and synchronous so a caller can snapshot before the canvas is wiped; it crops each page band to the **paper body only** (`paperLPx → paperRPx`, strips dropped) and stores at full ×SS backing density, backing off only if a slice would exceed canvas limits. `_flushAndEndJob` persists and ends the job — on clear, model change, page-size change, and `pagehide`. **There is no pruning**: no cap, no age eviction. Every page is a full-resolution PNG data URL kept forever, and `clearAllPages` / `countPages` are called from nowhere. Add a retention policy in a new host.

**Loading back.** `loadJobToPaper(job)` takes `{jobId, pages:[…]}`, banks the current sheet, restores model → ribbon → paper width/length **from the record** (not from the DIP/ESC-H form setting, which is independent of the paper actually loaded), repaints each PNG at its page band, restores `_yDot`/`_xDot`, and re-adopts `_jobId` so further printing extends the same job. At full density the restore is pixel-exact 1:1, no resampling.

**Export.**

| Path | Line | Output |
|---|---|---|
| PNG (1 page) | `_downloadPng` | `_usedCanvas` → `printer.png` |
| ZIP (n pages) | `_exportPagesZip` | `page-01.png`…`page-NN.png` plus `full.png`, the run joined for banners |
| PDF / real printer | `_downloadPdf` | one full-bleed image per used page → `printPagesViaIframe` |

`_usedPageCount` derives page count from the head's furthest vertical position, not canvas height; `_usedCanvas` crops the two trailing blank feed pages so they never land in an export.

`zip-store.js` is a 76-line dependency-free writer: **STORE only, no deflate** (PNGs are already DEFLATE-compressed), IEEE CRC-32 poly `0xEDB88320`, local header + central directory + EOCD, fixed 1980-01-01 timestamps for deterministic output. `makeZipStore(files) → Blob`.

`print-utils.js` — `printPagesViaIframe(dataUrls, wIn, hIn)` emits `@page { size: ${wIn}in ${hIn}in; margin: 0 }` and one full-bleed `img.page` per sheet with `page-break-after: always`, suppressed on the last. Four mechanics are load-bearing: an iframe not a popup (blockers); `srcdoc` not `document.write` (fires load *after* images decode, so the print isn't blank); a real off-screen size of `8.5in × 11in` at `left:-10000px` (a 0×0 or `visibility:hidden` frame prints blank in some engines); idempotent cleanup on `onafterprint` with a 60 s `setTimeout` fallback.

`print-browser-window.js` (`PrintBrowserWindow`, id `print-browser`) is the history UI: jobs newest-first, thumbnail rows, stacked preview, per-job {Print, Export, Back to printer, Delete} and per-page {Print, Export, Delete}. "Back to printer" is the single call `this._printerWindow?.loadJobToPaper?.(job)` — the only coupling between the two windows.

---

## 8. Agent / MCP control surface

`src/js/agent/printer-tools.js` exports one object `printerTools`, spread into the flat registry at `src/js/agent/agent-tools.js`. 24 tools, all `async`, each taking one `params` object and returning `{success: true, …, message}`. Handles resolve lazily off `window.emulator.{printerWindow, printerManager, windowManager}`.

| Tool | Line | Does |
|---|---|---|
| `printerOpen` / `printerClose` |, | show/hide; capture continues while hidden |
| `printerClear` | | wipe paper, reset glyph state |
| **`printerSendBytes`** | | inject raw bytes — below |
| `printerFeed` / `printerLineFeed` / `printerFormFeed` |, | panel paper motion |
| `printerSetPower` / `printerSetOnline` |, | mains / online |
| `printerSetRibbon` | | `bw` \| `color`, validated against `RIBBONS` |
| `printerSetModel` / `printerSetPageSize` |, | model swap / form length |
| `printerSetup` | | batch apply + read back `{applied, state, options}`; no-arg = pure query |
| `printerSetAutoLineFeed` | | DIP SW2-1 |
| **`printerGetState`** | | below |
| `printerDumpScreen` | | `{threshold?, invert?}` → `dumpScreen` |
| `printerStrike` / `printerSuper` |, | live-tune the ink strike / supersample 1–4 (rebuilds and wipes the canvas) |
| `printerCapturePaper` | | `{imageBase64, width, height}`, no `data:` prefix |
| `printerSetPaperDimensions` | | inches, quantised to ¼″, returns clamped values |
| `printerListHistory` / `printerGetPage` / `printerReloadJob` |, | page-store access |

**`printerSendBytes`** takes `{bytes: number[]}` or `{text: string}` — **not** base64 — and calls `PrinterManager.feedBytes` directly. It bypasses the 6502, the card, and the `PR#`/`CSW` redirect, while still going through the parser, head model and scheduler. That is why it exists: you can verify a glyph, an ESC sequence, or a density mode in one call without booting Apple software. Any host should expose an equivalent.

**`printerGetState`** returns `getState` (`printer-window.js`): `model`, `modelName`, `power`, `online`, `ribbon`, `pageSize`, `canvasMode`, `textLength`, `paperWidthPx`, `paperHeightPx`, `renderErrCount`, `lastRenderError`, `headYDot`, `maxNeeded`, `growCount`. The last four are diagnostics — `lastRenderError` is where a swallowed `_guard` throw surfaces.

**Headless capture** is coordinated one layer down: `capturePaper` calls `printerManager.drainNow` first (`printer-window.js`), because a backgrounded tab freezes the rAF-paced scheduler and the canvas would be blank or stale. Any host with an agent surface needs this drain.

---

## 9. Screen dump, host side

**Two different mechanisms share the name, and they are not two settings of one.** The *printer screen dump* is a host feature: JS reads the emulator's rendered framebuffer and synthesises a graphics byte stream — no Apple software, no disk. The *6502 dump routine* runs on the Apple, reads video **memory**, and sends the printer escape codes and characters. They produce visibly different pages from the same screen, and that is correct. Part I **§14c** is the full comparison; do not go bug-hunting a mismatch between them.

**Host-driven** (`dumpScreen`, `printer-window.js`) reads the live RGBA framebuffer from `window.emulator._lastFramebuffer` — the same buffer the WebGL renderer uploads, filled from the Worker frame message (`main.js`) or the SharedArrayBuffer slot. It picks a builder by model id: `buildScreenDumpImageWriter` (IW-I/II), `buildScreenDumpAppleDMP`, `buildScreenDumpEpson`, or `buildScreenDumpColor` for an IW-II with a colour ribbon. The bytes go through `feedBytes`, so the dump takes the identical parse/render path a real dump utility would. `SCREEN_W = 560`, `SCREEN_H = 384` (`pkg/src/screen-dump.js`). Raster arithmetic is Part I §14 — not repeated here.

Three host-side behaviours matter:

1. **Polarity.** Short click auto-picks; a ≥500 ms hold forces reverse video (`_initDumpButton`). Auto: text mode → `invert=false` (white text becomes black ink); graphics mode → invert only when `litDensity(...) < 0.05`, so a mostly dark picture doesn't print a near-solid black page. Video mode comes from a fire-and-forget cached `_getSoftSwitchState` (bit 0 = TEXT) — cached rather than awaited because an `async dumpScreen` failed silently when the proxy rejected mid-cycle.
2. **Colour dumps force Auto-LF off** for the duration: the colour builder returns the head between passes with bare CRs, and an auto line feed on each would smear the overprint bands.
3. **Margins are zeroed and restored** so a dump always starts at carriage home.

**In-machine** — the authoritative dumps are 6502 routines in `web-a2e/t/*.asm` (24 files): `hgr-dump.asm` (the period `ESC n` / `ESC T 16` / `ESC G "0280"` mono dump), `hgr-dump-color.asm`, `hgr-dump-gray.asm`, `dhgr-dump-color.asm`, `dhgr-dump-gray.asm`, `lr-dump*.asm`, `dlr-dump-color.asm`, plus the `imagewriter_ii_*_s2p.asm` config-byte wrappers. They exercise the card path end-to-end, which the host-side dump does not.

**The assembly is the authority and the JS is the port.** This package's `test/printout/apple-video.js` is the Node-side counterpart, not the source of truth; Part I §14b tables the upstream files with what each is authoritative for, and Part I §14a documents the ordered-dither algorithm (`CKCOL` / `CDENS` / `BAYER`) they share.

**The end-to-end fixture is `examples/screen-to-print/`** in the package repo — a ProDOS disk, volume `SCREEN.TO.PRINT`, of assembled dumps for all four models plus the programs that draw the screens. Boot it, `BLOAD` a `.PLOT`/`.ART` and `CALL 24576` to draw, then `BLOAD` the matching `.BW`/`.COLOR` and `CALL 24576` to print. That drives §2 rows 1–13 for real: the `PR#` redirect, the card, the byte bridge, the scheduler and the canvas, with a byte stream a 6502 actually produced. The ImageWriters expect the SSC in slot 2; the Apple DMP and FX-80 the Apple Parallel Interface Card in slot 1. `examples/screen-to-print/README.md` is the index.

---

## 10. UI integration

| Concern | Where |
|---|---|
| Construction | `src/js/main.js` — `new PrinterManager(this.wasmModule, () => this.audioDriver?.audioContext \|\| null)`. The AudioContext is a **lazy getter closure**, not a live reference |
| Window | `main.js` — `new PrinterWindow(printerManager)`, `.create`, `windowManager.register(...)` |
| Exposure | `main.js` — `this.printerManager` / `this.printerWindow`; what the agent tools reach via `window.emulator` |
| Byte bridge | `main.js` — `printerManager.init`, fire-and-forget, so `PR#n` is captured with the window closed |
| Slot sync | `main.js` — initial `updateSlots(...)` plus `slotConfigWindow.onSlotsApplied` for live re-sync |
| Print Browser | `main.js` — constructed with the printer-window reference, registered |
| Menu | `src/js/ui/ui-controller.js` `btn-printer` → `toggleWindow("printer-output")`; `btn-print-browser`; the `printer-sounds-toggle` |
| Markup | `public/index.html` — menu items only; windows are built in JS by `BaseWindow.create` |
| Registration | `src/js/windows/window-manager.js` — keys by `window.id`, wires `onFocus → bringToFront`, `onStateChange → saveState` |
| Window persistence | `window-manager.js` — one key `a2e-debug-windows` for *all* windows; `base-window.js` persists `{x, y, visible, zIndex}` plus `{width, height}` when resizable |

Printer-owned `localStorage`: `a2e-printer-{ribbon,autolf,speed}` (manager), `a2e-printer-{fit,rulers,panel-pinned,strike,ss}` (window), `a2e-printer-set-${modelId}-${settingId}` (per-model DIP), `a2e-printer-paper-v2-${modelId}` (per-model paper dims), `a2e-printer-sounds` (ui-controller, read by printer-sound). `a2e-printer-pages` is the IndexedDB **database name**, not a localStorage key.

---

## 11. Recreating this in another host

**M** = mandatory for a working printer, **P** = polish.

1. **M — Get a byte stream.** End up calling `printer.receiveByte(b)` in order. Bytes are 8-bit; do not strip the high bit (it carries MSB-set graphics data and international characters).
2. **M — Own one printer instance.** Model switching = reset the old, install sinks on the new, cancel queued events.
3. **M — Install the sinks.** `setEventSink(fn)` for timed strikes/feeds, `on(name, fn)` for `text`/`newline`/`linefeed`/`formfeed`. Do not render directly from the sink — buffer it.
4. **M — Build the wall clock.** Keep a `cursor`; per sink event advance it by `dt` and queue `{name, data, at}`; drain on a frame timer. Without this the whole document appears in one frame. Cap the backlog (`MAX_LAG_MS`) or a fast CPU schedules minutes ahead; exempt bounded host-injected blocks from the cap.
5. **M — Add a timer fallback beside rAF.** A backgrounded tab throttles rAF and the paper freezes mid-print.
6. **M — Guard every render callback.** One throw must not strand the pump.
7. **M — Size the paper.** Ask for `paperProfile` plus current width/length and solve geometry once. Honour `anchor` — centred for C. Itoh, left for the FX-80. Ruler 0 is body-left.
8. **M — Map coordinates.** Pick a raster (a2e: `_ppi` across, 72 down, then vertical stretch). Map `xDot`/`yDot` through the **printer's base dpi**, not the glyph's `dotW`; step glyph columns by `hDensity`. Never treat `feed` as a paper advance.
9. **M — Grow the canvas by pages** and clip ink to the paper body. Reject non-finite heights. Respect browser canvas caps — Safari blanks silently.
10. **M — Ink model.** Per-dot band mask + strike count; subtractive mix for overprint, darkening for overstrike, a fixed-diameter disc for the pin. Reset the count for a text dot landing on a foreign band.
11. **P — Supersample the ink canvas** (×3), downscale in CSS, pre-scale the context so draw code stays logical, and cache the logical dims for layout and export.
12. **P — Sound.** One noise buffer, a bandpassed grain per strike, scheduled on the audio clock with a spacing cursor and an ahead-cap. Reuse the host's unlocked AudioContext.
13. **P — Persist pages.** Debounced snapshots into IndexedDB keyed `jobId::pageIndex`, cropped to the paper body. Add a retention policy — a2e has none.
14. **P — Export.** PNG for one page, ZIP for many, a hidden `srcdoc` iframe with `@page { size: Win Hin; margin: 0 }` for print/PDF.
15. **P — Operator panel + agent surface.** Render DIP switches from the model's static `SETTINGS`; expose raw-byte injection and a `getState`. You will use both constantly while building models.
16. **P — Direct manipulation of the paper.** If you give the operator drag handles, freeze a grab frame on `pointerdown`, preview only, snap and clamp to the *model's* range before drawing the guide, and commit once on `pointerup` through the public setter. §5.6 is the worked pattern. Drive paper position with `lineFeedDown`/`lineFeedUp`, not by writing `_yDot`.

---

## 12. Traps

1. **The model silently reverts to ImageWriter II.** The constructor hardcodes `new ImageWriterII` (`printer-manager.js`) and nothing persists the choice — there is no `a2e-printer-model` key. Every page load and browser reconnect resets it. Check `printerGetState` **before** debugging why output looks wrong.

2. **`formDots = 0` is a display sentinel, and it once returned NaN.** The window parks `printer.paper.formDots = 0` to mean "unset, use the operator's `lengthInch`" (`printer-window.js`). Page-boundary math must never read `paper.formDots` raw — `past/0 → Infinity` propagated into `_yDot` as NaN and blanked the paper from the first form feed on. Use `printer._effectiveFormDots` (`pkg/src/printer-base.js`), as `formFeed` and `nextFormTop(y, override)` (`pkg/src/printer-paper-feed.js`) already do, and as `pkg/src/pagination.js:formDots` exposes publicly.

3. **Injected bytes must be exempt from the lag clamp.** A screen dump or `printerSendBytes` block arrives as one synchronous burst; clamping it races the carriage through every band after ~1.5 s. `_unclampedFeed` (`printer-manager.js`, applied) exempts it. *Correction:* the live CPU stream sets it too, with the 120 ms idle flush re-clamping between jobs — otherwise a few lines paced correctly and the rest snapped out at once.

4. **`feed` is a sound cue, not a paper advance.** `feed.dist` is the head's **horizontal** position (`pkg/src/printer-base.js` et al.), for carriage noise. Integrating it vertically stacks every line on the first; paper position is the absolute `yDot` on each strike. Note `formfeed`'s `dist` *is* vertical — the opposite convention.

5. **Carriage sound is disabled, not missing.** `_onImpact` early-returns for `feed`/`return` (`printer-manager.js`) and `PrinterSound.tickReturn` (`printer-sound.js`) is dead code — the sweeps read as a tonal laser "pew". Re-enabling it, `dist` scales the sweep.

6. **Ruler zero is body-left, not paper-left or sheet-left.** The ½″ holed tractor strips are not paper and sit outside the scale (`printer-window.js`). Ruler max is the body-right edge, which doubles as the paper-sizer handle.

7. **The paper anchor differs by manufacturer.** C. Itoh (IW-I, IW-II, DMP) **centre** the fixed 8″ carriage zone on the body (`pkg/src/printer-base.js`); the FX-80 is left-referenced (`pkg/src/epson-fx80.js`). `computeLayout` (`pkg/src/printer-paper-geometry.js`) is the authority — the comment at `printer-window.js` calling the sheet left-referenced is stale.

8. **Under ProDOS, a bare `PR#n` unhooks BASIC.SYSTEM's CTRL-D vector.** Use `CHR$(4)"PR#n"`. A bare `PR#n` leaves the DOS command hook dangling — later `CHR$(4)` commands fail (`?SYNTAX ERROR IN 65168`, literal `PREFIX` output) and trace spam appears. Only a **cold reboot** recovers; `CALL 1002`, `3D0G` and warm reset all fail. This is BASIC.SYSTEM behaviour, not this codebase's — an operational trap, not something the front end can fix.

9. **Reading the parallel card's ROM flat hangs `PR#1`.** The card rewrites ROM address bit 6 from the ACK latch on every fetch (`parallel_card.cpp`); a flat read executes the wrong path and the firmware busy-waits forever.

10. **Wipe the queue before wiping the canvas.** `cancelQueued` (`printer-manager.js`) discards unreleased events; `drainNow` fires them. Clear, model switch and power-off must use `cancelQueued`, or the old job keeps painting bands onto the fresh sheet — "the top clears, then it prints something different."

11. **Never read `canvas.width/height` for layout or export** — they are the ×SS backing dims. Use the cached `_logW`/`_logH` (`printer-window.js`). `getState` deliberately reports the backing dims as `paperWidthPx`/ `paperHeightPx`; that is a raw diagnostic, not a layout number.

12. **Sizers fail silently on a hidden window.** `getBoundingClientRect` returns zeros under `display:none`, so every ruler/strip sizer needs the deferred-retry path (`_deferLayout`) — bounded, deduped, re-armed by `show` and the resize observer. Unbounded rAF retries burn a layout every frame for the whole session whether or not the window is ever opened.

13. **The DIP dropdown must render inline.** The operator panel is an overflow-scrolled, CSS-transformed slide-out; portaling the option list to `document.body` clips or retracts it (`_wireDipMenu`).

14. **The agent reload path drops the job id.** `printerReloadJob` (`printer-tools.js`) calls `loadJobToPaper({ pages })` with no `jobId`, so `_jobId` becomes `undefined` (`printer-window.js`) and later auto-saves key pages as `undefined::N`. The Print Browser's own path passes `{jobId, pages}` and is unaffected. Latent bug, worth fixing on port.

15. **The playback speed knob is inert.** `_loadSpeed` (`printer-manager.js`) deletes `a2e-printer-speed` and pins 1× because the button is `hidden`. `setPrintSpeed` and `_rescaleSchedule` still work; do not assume a stored value is honoured.

16. **Paper position has a public API; a2e does not use it.** The head drag writes the private `p._yDot` (`printer-window.js`), so it skips the feed timing and the `feed` sound cue that `lineFeedDown(n)` / `lineFeedUp(n)` (`pkg/src/printer-base.js`) emit. Copy the poke and you inherit a silent, uncharged platen. There is still no public *getter* for the position or for `_lineFeedDots` — track paper position from the `yDot` on every strike instead.
