# SCREEN.TO.PRINT — Apple //e screen-dump toolkit

A ProDOS disk of period-style 6502 screen dumps for all four printers this
package emulates, plus the assembly and Applesoft that built them. Vendored
byte-identical from `web-a2e/examples/printer/`.

Why it is here: it produces byte streams a **real Apple** generated. Everything
under `test/` synthesises its input, so a parser or renderer regression can only
be checked against this repo's own snapshots; boot this and the stream comes out
of 6502 code driving an emulated card. The dither those dumps use is
`docs/ARCHITECTURE-BACKEND.md` §14a; their upstream sources are §14b.

| Path | What |
|---|---|
| `screen_to_print.po` | 143360 bytes, 280 ProDOS blocks, volume `SCREEN.TO.PRINT` |
| `source/{imagewriteri,imagewriterii,apple-dmp,epson/fx-80}/` | per-model `.asm` dumps, `.bas` feature tests, and a 40-column `README.txt` |
| `source/common/` | the screen-drawing programs — model-independent |

## Disk layout

Drawing programs sit at the **volume root** and are shared; each model has its own
directory holding only dumps. (The 40-column `README.txt` files say the drawing
programs are "in this folder" — they are not, and the ImageWriter II one still
uses the older `LORES.*` / `DLORES.*` names. The catalog is the authority.)

Root:

| File | Load | Draws |
|---|---|---|
| `LR.PLOT` | `A$6000` | 40×48 lo-res test pattern |
| `LR.ART` | `A$6000` | lo-res kaleidoscope — all 16 colours, page 1 only |
| `DLR.PLOT` | `A$6000` | 80×48 double lo-res test pattern |
| `DLR.ART` | `A$7000` | double lo-res kaleidoscope. **`CALL 28672`**, not 24576 |
| `HGR.ART` | `A$6000` | "castle at sunset", 280×192, six HGR hues |
| `DHGR.ART` | `A$6000` | "Sierra" backdrop, 560×192 |
| `HGR.LINES` | `A$2000` | an 8 KB HGR picture, not code — `BLOAD` and it is on screen |

Per model:

| Directory | `.BW` | `.COLOR` | Also |
|---|---|---|---|
| `IMAGEWRITERII` | LR DLR HGR DHGR | LR DLR HGR DHGR | `VIEW` `README` `TEXT.TEST` |
| `IMAGEWRITERI` | LR DLR HGR DHGR | — | `VIEW` `README` `TEXT.TEST` `MATH.SUM` |
| `APPLE.DMP` | LR DLR HGR DHGR | — | `VIEW` `README` `TEXT.TEST` `MATH.SUM` |
| `EPSON/FX.80` | LR DLR HGR DHGR | — | `VIEW` `README` `TEXT.TEST` |

Naming: `.PLOT` draws a systematic pattern, `.ART` draws a picture, `.BW` /
`.COLOR` dump whatever is on screen. There is no `.GRAY` on the disk — the
halftone dumps ship as `.BW` because that is the ribbon they need; their sources
are the `*-dump-gray.asm` files. `VIEW` is an Applesoft pager for that
directory's `README`; `TEXT.TEST` exercises the model's text modes and custom
font; `MATH.SUM` stacks a summation glyph out of downloaded characters.

`IMAGEWRITERII/{DLR,HGR,DHGR}.BW` are byte-identical to the `IMAGEWRITERI` ones
(verified by hash) — same C. Itoh command stream, so the halftone dumps are
shared. Only `IMAGEWRITERII/LR.BW` differs: it is the 1-bit `lr-dump-bw.asm`
rather than a halftone.

## Hardware each model expects

| Model | Card | Slot | Port | HGR/DHGR `POKE 24582` default |
|---|---|---|---|---|
| ImageWriter I / II | Super Serial Card | 2 | ACIA `$C0A8` | 2 |
| Apple DMP | Apple Parallel Interface Card | 1 | data latch `$C090` | 1 |
| Epson FX-80 | Apple Parallel Interface Card | 1 | data latch `$C090` | 1 |

The LR and DLR dumps hard-code that port; only the HGR and DHGR dumps take a
slot at run time.

The `.COLOR` programs need an ImageWriter II with a colour ribbon in COLOR mode.
`TEXT.TEST` and `MATH.SUM` bypass `COUT` for 8-bit data and poke the port
directly — `49320` (`$C0A8`, SSC slot 2) or `49296` (`$C090`, parallel slot 1).

## Running it

```
] BLOAD LR.PLOT,A$6000
] POKE 9,0 : CALL 24576 draw
] BLOAD IMAGEWRITERII/LR.COLOR,A$6000
] CALL 24576 print
```

Everything loads at `$6000` and runs at `CALL 24576`, except `DLR.ART` (`A$7000`
/ `CALL 28672`) and `HGR.LINES` (data). **The code is relocatable** — no absolute
reference to itself, so the same binary runs at any load address. That is what
keeps it clear of whichever graphics page it is dumping.

| Poke | Applies to | Meaning |
|---|---|---|
| `POKE 9,p` | `LR.PLOT`, `DLR.PLOT`, and every `LR.*`/`DLR.*` dump | page: 0 = one, 1 = two. The two `.ART` kaleidoscopes ignore it |
| `POKE 24579,n` | HGR/DHGR **dumps** | width 0 = 7.8″, 1 = 7.0″, 2 = 5.8″, 3 = 3.5″ (4:3) |
| `POKE 24580,1` | HGR/DHGR dumps | double height |
| `POKE 24581,p` | HGR/DHGR dumps | page: 0 = one, 1 = two |
| `POKE 24582,s` | HGR/DHGR dumps | printer slot |
| `POKE 24579,p` | `HGR.ART`, `DHGR.ART` | page to draw into — **same address, different meaning** |

Double lo-res *displays* only from page 1: `80STORE` banks just the `$0400–$07FF`
window, so there is no aux `$0800` to show. `POKE 9,1` still draws and dumps a
page-2 double lo-res image, because the plot routine writes aux through `RAMWRT`.

On the FX-80, width mode 3 is 240 dpi quad density; the FX-80 cannot fire
adjacent dots, so solids thin to grey in that mode. It is there for the 4:3
aspect, not for coverage.

A dump takes about a minute. The printer paces the output and the emulated one
paces it identically.

## Sources

`source/` mirrors the disk: each model directory holds the `.asm` for that
model's dumps, `source/common/` the drawing programs. The `.PLOT`/`.ART` sources
carry the geometry commentary (interleave, aux/main split, relocatability) worth
reading before porting any of it. `source/*/README.txt` are the on-disk
40-column texts, CR line endings and all — this file supersedes them.
