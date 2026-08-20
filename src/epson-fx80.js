/*
 * epson-fx80.js - Epson FX-80 printer emulation (Epson ESC/P protocol)
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 *
 * Reference: Epson FX Series Printer User's Manual Vol 1 (Tutorial) and
 *            Vol 2 (Reference) — Appendixes B and C for control code tables.
 */

import { PrinterBase } from "./printer-base.js";
import { EPSON_FX_ROM } from "./epson-fx80-rom.js";

// Parser states
const S_NORMAL    = 0;
const S_ESC       = 1;
const S_PARAM1    = 2;  // consuming first param byte; _paramCmd holds ESC command
const S_PARAM2    = 3;  // consuming second param byte (ESC %, ESC ?, ESC :)
const S_PARAM3    = 4;  // consuming third param byte (ESC : only)
const S_IMG_MODE  = 5;  // ESC * : density mode byte
const S_IMG_LO    = 6;  // graphics: low byte of column count
const S_IMG_HI    = 7;  // graphics: high byte of column count
const S_IMG_DATA  = 8;  // graphics: consuming 8-bit column bytes
const S_IMG9_D    = 9;  // ESC ^ : density byte
const S_IMG9_LO   = 10; // ESC ^ : lo byte of column count
const S_IMG9_HI   = 11; // ESC ^ : hi byte of column count
const S_IMG9_B1   = 12; // ESC ^ : first byte per column (pins 1-8)
const S_IMG9_B2   = 13; // ESC ^ : second byte per column (pin 9 = bit 0)
const S_VT_LIST   = 14; // ESC B : vertical tab stop list until CHR$(0)
const S_HT_LIST   = 15; // ESC D : horizontal tab stop list until CHR$(0)
const S_ESC_C2    = 16; // ESC C 0 n : form length in inches (second byte)
const S_AMP1      = 17; // ESC & : should-be-zero byte
const S_AMP2      = 18; // ESC & : start character code
const S_AMP3      = 19; // ESC & : end character code; starts char loop
const S_AMP_ATTR  = 20; // ESC & char: attribute byte
const S_AMP_DATA  = 21; // ESC & char: 11 column data bytes
const S_VFU_CH    = 22; // ESC b : VFU channel-number byte (precedes its stop list)

// Bit-reverse table for graphics columns. The Epson head puts the TOP pin in the
// MOST significant bit (bit 7 = pin 1), but the renderer plots bit 0 = top dot, so
// every bit-image column byte is reversed on the way in. This is the wire-format
// counterpart to screen-dump.js's `msbTop` Epson protocol.
const REV8 = (() => {
  const t = new Uint8Array(256);
  for (let b = 0; b < 256; b++) {
    let r = 0;
    for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 1 << (7 - i);
    t[b] = r;
  }
  return t;
})();

// Internal dot scale is owned by PrinterBase (this.dpi, default 480 = LCM of
// 60/120/240). Every DPI-derived pitch lives on the instance, recomputed from
// this.dpi in _recomputeUnits():
//   this._dotV   — 72-dpi vertical row height (9-pin head)
//   this._dotW   — 120-dpi horizontal text dot pitch
//   this._imgWK/L/Z — ESC K/L-Y/Z graphics column widths (60/120/240 dpi)
//   this._starWidths[] — ESC * mode byte → column width (modes 0-6)
//   this._defaultLineHeight (1/6") and this._unit216 (n/216" unit)

// Character pitch → characters per inch
const CPI = { pica: 10, elite: 12, compressed: 137 / 8 };

// ESC R n — international charset index → editor locale key (FX Vol 2 App C).
// Sets the editor has no glyphs for yet (8=Japan, 9=Norway, 10=Denmark II, …)
// fall through to USA until they are transcribed in rom-editor.html.
const EPSON_INTL = ["US", "FR", "DE", "UK", "DK", "SE", "IT", "ES"];


export class EpsonFX80 extends PrinterBase {
  constructor() {
    super();
    this._customChars = new Map();
    this._resetParserState();
    this._resetRenderState();
  }

  // Derive every DPI-dependent pitch from the current internal scale. Called by
  // PrinterBase at construction and on setDpi(); changing this.dpi rescales all
  // text/graphics placement, feeds, and form length through these fields.
  _recomputeUnits() {
    this._dotV       = this.dpi / 72;   // 72-dpi vertical row pitch (9-pin head)
    this._dotW       = this.dpi / 120;  // 120-dpi horizontal text dot pitch
    this._imgWK      = this.dpi / 60;   // ESC K single-density (60 dpi)
    this._imgWL      = this.dpi / 120;  // ESC L/Y double-density (120 dpi)
    this._imgWZ      = this.dpi / 240;  // ESC Z quad-density (240 dpi)
    this._starWidths = [
      this.dpi / 60,   // mode 0 — 60 dpi
      this.dpi / 120,  // mode 1 — 120 dpi
      this.dpi / 120,  // mode 2 — 120 dpi (high-speed, no adjacent dots)
      this.dpi / 240,  // mode 3 — 240 dpi
      this.dpi / 80,   // mode 4 —  80 dpi
      this.dpi / 72,   // mode 5 —  72 dpi
      this.dpi / 90,   // mode 6 —  90 dpi
    ];
    this._defaultLineHeight = this.dpi / 6;   // 1/6" = 12-dot rows
    this._unit216           = this.dpi / 216; // n/216" unit (ESC 3, ESC J, ESC j)
  }

  _resetParserState() {
    this._state       = S_NORMAL;
    this._paramCmd    = 0;
    this._param1Val   = 0;
    this._imgCount    = 0;
    this._imgDotW     = this._imgWK;
    this._img9DotW    = this._imgWK;
    this._img9Byte1   = 0;
    this._ampC1       = 0;
    this._ampC2       = 0;
    this._ampCur      = 0;
    this._ampColsLeft = 0;
    this._ampBuf      = [];
    this._htabPend    = []; // ESC D bytes accumulating until the 0 terminator
    this._vtabPend    = []; // ESC B/b bytes accumulating until the 0 terminator
    this._vtabTarget  = 0;  // VFU channel the pending stop list is being built for
  }

  _resetRenderState() {
    this._pitch      = this._defaultPitch ?? "pica";
    this._expanded   = false;              // ESC W / ESC ! bit5 — continuous enlarged
    this._expandedOneLine = false;         // SO / ESC SO — enlarged for one line only, auto-cancels at the next line break (CR/LF/wrap) or DC4 (Op manual 3-13)
    this._emphasized = false;
    this._dblStrike  = false;
    this._underline  = false;
    this._italic     = false;
    this._proportional = false;            // ESC p / Master Select bit 1
    this._intlSet    = "US";               // ESC R international charset (editor key)
    this._script     = 0;      // 0=none, 1=superscript, 2=subscript
    this._lineHeight = this._defaultLineHeight;
    this._autoLF     = true;               // DIP SW2-1 default ON; manager overrides
    this._leftMargin = 0;                  // ESC l — internal dots
    this.head.leftMargin = 0;
    this._rightMargin = this._printWidthDots(); // ESC Q — defaults to full 8" carriage
    this._htabCols   = [];                 // ESC D stops (columns); empty = every 8
    this._vfu        = Array.from({ length: 8 }, () => []); // ESC B/b — 8 VFU channels of vertical-tab stops; an empty channel makes VT a single LF
    this._vtabChannel = 0;                 // ESC / — active VFU channel for VT (channel 0 at power-on)
    this._skipPerf   = 0;                  // ESC N — lines skipped at each page bottom
    this._halfSpeed  = false;              // ESC s — half-speed (quieter) print, timing only
    this._ramFont    = false;              // ESC % — false=ROM CG active, true=RAM download set
    this._gfxMode    = { 0x4B: 0, 0x4C: 1, 0x59: 2, 0x5A: 3 }; // ESC K/L/Y/Z → ESC * density mode (ESC ? remaps)
    this._xDot       = 0;
    this._yDot       = this._homeYDot();   // power-on head rest, a hair below sheet top
    if (this.paper) this.paper.setFormDots(Math.round(this.defaultPaperLengthInch() * this.dpi));
  }

  reset() {
    super.reset();             // carriage/head kinematics back to home
    this._resetParserState();
    this._resetRenderState();
  }

  receiveByte(byte) {
    const ch = byte & 0x7F; // strip Apple II high bit

    switch (this._state) {
      case S_NORMAL:    this._normal(ch);    break;
      case S_ESC:       this._esc(ch);       break;
      case S_PARAM1:    this._param1(ch);    break;
      case S_PARAM2:    this._param2(ch);    break;
      case S_PARAM3: // ESC : 0 0 0 — third param absorbed; clone ROM CG into download set
        this._copyRomToDownload();
        this._state = S_NORMAL;
        break;

      case S_IMG_MODE:
        this._imgDotW  = this._starWidths[ch & 7] ?? this._imgWL;
        this._imgCount = 0;
        this._state    = S_IMG_LO;
        break;

      case S_IMG_LO:
        this._imgCount = ch;
        this._state    = S_IMG_HI;
        break;

      case S_IMG_HI:
        this._imgCount |= (ch << 8);
        this._state = this._imgCount > 0 ? S_IMG_DATA : S_NORMAL;
        break;

      case S_IMG_DATA:
        // Graphics columns use all 8 bits — feed the RAW byte, never the
        // high-bit-stripped `ch` used for character codes — and reverse Epson's
        // MSB=top wire order into the renderer's bit 0 = top convention.
        this.emit("printDots", {
          byte: REV8[byte & 0xFF], xDot: this._xDot, yDot: this._yDot,
          dotW: this._imgDotW, dotH: this._dotV, color: "black",
        });
        this._xDot += this._imgDotW;
        if (--this._imgCount <= 0) this._state = S_NORMAL;
        break;

      case S_IMG9_D:
        this._img9DotW = ch === 0 ? this._imgWK : this._imgWL;
        this._state    = S_IMG9_LO;
        break;

      case S_IMG9_LO:
        this._imgCount = ch;
        this._state    = S_IMG9_HI;
        break;

      case S_IMG9_HI:
        // Nine-pin column count n = n1 + 256*n2 — same base as ESC K (Op manual
        // 3-53 "refer to ESC K"; ESC K example sends n1=D MOD 256, n2=INT(D/256)).
        this._imgCount += ch * 256;
        this._state = this._imgCount > 0 ? S_IMG9_B1 : S_NORMAL;
        break;

      case S_IMG9_B1:
        // RAW byte (not high-bit-stripped `ch`): bit 7 carries the TOP wire, same
        // as the 8-bit graphics path above. Stripping it would drop pin 1.
        this._img9Byte1 = byte & 0xFF;
        this._state     = S_IMG9_B2;
        break;

      case S_IMG9_B2: {
        // Pins 1-8 from byte1, pin 9 from byte2 bit 7 (≥128) per Vol 2 App B §7.
        // Reverse byte1 (Epson MSB=top) into the renderer's bit 0 = top order, the
        // same REV8 the 8-bit path uses; pin 9 lands at bit 8 (bottom wire).
        const bits9 = REV8[this._img9Byte1] | (((byte >> 7) & 1) << 8);
        this.emit("printDots", {
          byte: bits9, xDot: this._xDot, yDot: this._yDot,
          dotW: this._img9DotW, dotH: this._dotV, color: "black",
        });
        this._xDot += this._img9DotW;
        if (--this._imgCount <= 0) this._state = S_NORMAL;
        else this._state = S_IMG9_B1;
        break;
      }

      case S_VT_LIST:
        if (ch === 0) {
          this._vfu[this._vtabTarget] = this._vtabPend.slice(0, 16).sort((a, b) => a - b);
          this._state = S_NORMAL;
        } else {
          this._vtabPend.push(ch);   // up to 16 stops per channel; extras dropped at terminator
        }
        break;

      case S_VFU_CH:
        // ESC b n — n picks the VFU channel (0-7) the following stop list fills;
        // an out-of-range channel is clamped to 0 so the list is never lost.
        this._vtabTarget = (ch <= 7) ? ch : 0;
        this._vtabPend   = [];
        this._state      = S_VT_LIST;
        break;

      case S_HT_LIST:
        if (ch === 0) {
          this._htabCols = this._htabPend.slice().sort((a, b) => a - b);
          this._state = S_NORMAL;
        } else {
          this._htabPend.push(ch);
        }
        break;

      case S_ESC_C2:
        if (ch > 0) this.paper.setFormDots(ch * this.dpi); // ESC C 0 n — form length in inches
        this._state = S_NORMAL;
        break;

      case S_AMP1:
        this._state = S_AMP2; // absorb must-be-zero byte
        break;

      case S_AMP2:
        this._ampC1 = ch;
        this._state = S_AMP3;
        break;

      case S_AMP3:
        this._ampC2  = ch;
        this._ampCur = this._ampC1;
        if (this._ampCur > this._ampC2) { this._state = S_NORMAL; break; }
        this._ampBuf      = [];
        this._ampColsLeft = 11;
        this._state       = S_AMP_ATTR;
        break;

      case S_AMP_ATTR:
        // attribute byte consumed; we don't track proportional widths
        this._ampBuf      = [];
        this._ampColsLeft = 11;
        this._state       = S_AMP_DATA;
        break;

      case S_AMP_DATA:
        // RAW byte, not high-bit-stripped `ch`, and REV8-reversed — mirrors
        // S_IMG_DATA. Column bytes carry pin data across all 8 bits, and the
        // wire's MSB=top-pin order must flip to the renderer's bit 0 = top.
        this._ampBuf.push(REV8[byte & 0xFF]);
        if (--this._ampColsLeft <= 0) {
          this._customChars.set(this._ampCur, new Uint8Array(this._ampBuf));
          this._ampCur++;
          if (this._ampCur > this._ampC2) this._state = S_NORMAL;
          else this._state = S_AMP_ATTR;
        }
        break;
    }
  }

  _normal(ch) {
    // Apple/SSC end each line with CR+LF; coalesce an LF that arrives right after
    // a CR so the paper feeds once (no blank line between rows). Standalone LF
    // still feeds normally.
    const wasCR = this._lastCR;
    this._lastCR = false;
    switch (ch) {
      case 0x07: break;                           // BEL — ignore
      case 0x08:                                  // BS — backspace
        this._xDot = Math.max(this._leftMargin, this._xDot - this._charAdvance());
        break;
      case 0x09:                                  // HT — horizontal tab
        this._horizontalTab();
        break;
      case 0x0A:                                  // LF — line feed
        this._expandedOneLine = false;            // SO enlarged spans one line only
        if (!(this._autoLF && wasCR)) {           // LF paired with an auto-LF CR is swallowed
          this._yDot += this._lineHeight;
          this.emit("linefeed");
          this._checkSkipPerf();
        }
        break;
      case 0x0B:                                  // VT — vertical tab
        this._verticalTab();
        break;
      case 0x0C:                                  // FF — form feed
        this.formFeed();   // slew to next top-of-form (shared with panel)
        break;
      case 0x0D:                                  // CR — carriage return
        // Whether CR also feeds is the Auto-LF DIP (SW2-1). ON: feed one line and
        // arm CR+LF coalescing (plain text / Applesoft sends CR only). OFF: return
        // the head only, so overprint passes register on the same band.
        this._xDot = this._leftMargin;
        this._expandedOneLine = false;            // SO enlarged spans one line only
        if (this._autoLF) {
          this._yDot += this._lineHeight;
          this._lastCR = true;                    // arm CR+LF coalescing
          this.emit("newline");
          this._checkSkipPerf();
        } else {
          this.emit("carriagereturn");            // head home, no paper feed
        }
        break;
      case 0x0E:                                  // SO — enlarged for one line (auto-cancels at line break)
        this._expandedOneLine = true;
        break;
      case 0x0F:                                  // SI — compressed on (17.16 cpi)
        this._pitch = "compressed";
        break;
      case 0x11: break;                           // DC1 — printer on (ignore)
      case 0x12:                                  // DC2 — compressed off
        if (this._pitch === "compressed") this._pitch = "pica";
        break;
      case 0x13: break;                           // DC3 — printer off (ignore)
      case 0x14:                                  // DC4 — cancel one-line (SO) enlarged
        this._expandedOneLine = false;
        break;
      case 0x18: break;                           // CAN — cancel buffer (ignore)
      case 0x1B:                                  // ESC
        this._state = S_ESC;
        break;
      case 0x7F: break;                           // DEL — ignore
      default:
        if (ch >= 0x20) this._emitChar(ch);
        break;
    }
  }

  _esc(ch) {
    this._state = S_NORMAL; // default: single-byte ESC command

    switch (ch) {
      // ——— No-parameter commands ———
      case 0x0E: this._expandedOneLine = true; break; // ESC SO — same as SO (one-line enlarged), escaped path
      case 0x0F: this._pitch = "compressed";   break; // ESC SI — same as SI (condensed), escaped path
      case 0x23: break;                           // ESC # — accept 8th bit as-is (ignore)
      case 0x30: this._lineHeight = this.dpi / 8;            break; // ESC 0 — 1/8" (9-dot)
      case 0x31: this._lineHeight = this.dpi * 7 / 72;       break; // ESC 1 — 7/72" (7-dot)
      case 0x32: this._lineHeight = this._defaultLineHeight; break; // ESC 2 — 1/6" (default)
      case 0x34: this._italic     = true;               break; // ESC 4 — italic on
      case 0x35: this._italic     = false;              break; // ESC 5 — italic off
      case 0x36: break;                           // ESC 6 — enable chars 128-159 (ignore)
      case 0x37: break;                           // ESC 7 — disable chars 128-159 (ignore)
      case 0x38: break;                           // ESC 8 — paper sensor off
      case 0x39: break;                           // ESC 9 — paper sensor on
      case 0x3C: break;                           // ESC < — one-line unidirectional (ignore)
      case 0x3D: break;                           // ESC = — high bit off (ignore)
      case 0x3E: break;                           // ESC > — high bit on (ignore)
      case 0x40:                                  // ESC @ — full reset
        this._resetRenderState();
        this._resetParserState();
        this._state = S_NORMAL;
        break;
      case 0x45: this._emphasized = true;  break; // ESC E — emphasized on
      case 0x46: this._emphasized = false; break; // ESC F — emphasized off
      case 0x47: this._dblStrike  = true;  break; // ESC G — double-strike on
      case 0x48: this._dblStrike  = false; break; // ESC H — double-strike off
      case 0x4D: this._pitch = "elite";    break; // ESC M — elite on (12 cpi)
      case 0x4F: this._skipPerf = 0;       break; // ESC O — cancel skip-over-perforation
      case 0x50: this._pitch = "pica";     break; // ESC P — elite off → pica
      case 0x54: this._script = 0;         break; // ESC T — cancel super/subscript

      // ——— Tab stop lists ———
      case 0x42: this._vtabPend = []; this._vtabTarget = 0; this._state = S_VT_LIST; break;  // ESC B n... 0 — channel-0 vertical tab stops
      case 0x44: this._htabPend = []; this._state = S_HT_LIST; break;  // ESC D n... 0 (horizontal tab stops)
      case 0x62: this._state = S_VFU_CH; break;                        // ESC b n m... 0 — set VFU channel n's stops

      // ——— ESC * generic graphics (mode byte + count lo + count hi + data) ———
      case 0x2A:
        this._imgCount = 0;
        this._state    = S_IMG_MODE;
        break;

      // ——— Standard graphics commands (count lo + count hi + data) ———
      case 0x4B:                                  // ESC K — single density (60 dpi default)
      case 0x4C:                                  // ESC L — double density (120 dpi default)
      case 0x59:                                  // ESC Y — double density, high-speed
      case 0x5A:                                  // ESC Z — quad density (240 dpi default)
        // Density is the _gfxMode entry for this letter, which ESC ? can remap to
        // any ESC * mode; read through _starWidths so it tracks the current DPI.
        this._imgDotW = this._starWidths[this._gfxMode[ch]];
        this._imgCount = 0; this._state = S_IMG_LO; break;

      // ——— Nine-pin graphics (density + count lo + count hi + pairs of data) ———
      case 0x5E:
        this._imgCount = 0; this._state = S_IMG9_D; break;

      // ——— User-defined character loading ———
      case 0x26: this._state = S_AMP1; break;     // ESC &

      // ——— Single-parameter commands ———
      case 0x21: // ESC ! n — Master Select
      case 0x2D: // ESC - n — underline toggle (0=off, 1=on)
      case 0x2F: // ESC / n — select active VFU channel for VT
      case 0x33: // ESC 3 n — n/216" line spacing
      case 0x41: // ESC A n — n/72" line spacing
      case 0x43: // ESC C n — form length in lines (0 → next byte = inches)
      case 0x49: // ESC I n — print control chars toggle (ignore)
      case 0x4A: // ESC J n — immediate n/216" line feed
      case 0x4E: // ESC N n — skip-over-perforation lines
      case 0x51: // ESC Q n — right margin
      case 0x52: // ESC R n — international charset
      case 0x53: // ESC S n — super/subscript (0=super, 1=sub)
      case 0x55: // ESC U n — unidirectional mode (ignore)
      case 0x57: // ESC W n — continuous expanded (0=off, 1=on)
      case 0x69: // ESC i n — immediate mode FX-80 (ignore)
      case 0x6A: // ESC j n — reverse feed n/216" (FX-80 only)
      case 0x6C: // ESC l n — left margin
      case 0x70: // ESC p n — proportional mode
      case 0x73: // ESC s n — half-speed mode
        this._paramCmd = ch;
        this._state    = S_PARAM1;
        break;

      // ——— Two-parameter commands ———
      case 0x25: // ESC % n1 n2 — select ROM(0)/RAM(1) character set
      case 0x3F: // ESC ? s n — reassign graphics letter s to ESC * density n
        this._paramCmd = ch;
        this._state    = S_PARAM1;
        break;

      // ——— Three-parameter commands ———
      case 0x3A: // ESC : 0 0 0 — copy ROM to RAM (ignore)
        this._paramCmd = ch;
        this._state    = S_PARAM1;
        break;
    }
  }

  _param1(ch) {
    switch (this._paramCmd) {
      case 0x21: { // ESC ! n — Master Select
        // Bit layout per Vol 1 Ch.5 (p.76 Quick Reference Chart):
        // bit 0=elite, bit 1=proportional, bit 2=condensed, bit 3=bold(emph),
        // bit 4=double-strike, bit 5=expanded, bit 6=italic, bit 7=underline
        this._pitch       = (ch & 0x04) ? "compressed" : (ch & 0x01) ? "elite" : "pica";
        this._proportional = !!(ch & 0x02);
        this._emphasized = !!(ch & 0x08);
        this._dblStrike  = !!(ch & 0x10);
        this._expanded   = !!(ch & 0x20);
        this._expandedOneLine = false;       // Master Select fully defines enlarged state; drop any SO one-line override
        this._italic     = !!(ch & 0x40);
        this._underline  = !!(ch & 0x80);
        this._state = S_NORMAL;
        break;
      }
      case 0x2D: // ESC - n
        this._underline = (ch !== 0);
        this._state = S_NORMAL;
        break;
      case 0x2F: // ESC / n — select active VFU channel (0-7) used by VT
        if (ch <= 7) this._vtabChannel = ch;
        this._state = S_NORMAL;
        break;
      case 0x33: // ESC 3 n — n/216"
        this._lineHeight = ch * this._unit216;
        this._state = S_NORMAL;
        break;
      case 0x3A: // ESC : first param → need second
        this._state = S_PARAM2;
        break;
      case 0x3F: // ESC ? s → need n
        this._param1Val = ch;
        this._state = S_PARAM2;
        break;
      case 0x41: // ESC A n — n/72" (n=0-85; >85 treated as 85)
        this._lineHeight = Math.min(ch, 85) * (this.dpi / 72);
        this._state = S_NORMAL;
        break;
      case 0x43: // ESC C n — form length in lines (n=0 → next byte = inches)
        if (ch === 0) {
          this._state = S_ESC_C2;
        } else {
          this.paper.setFormDots(Math.round(ch * this._lineHeight));
          this._state = S_NORMAL;
        }
        break;
      case 0x25: // ESC % n1 → capture source select, need n2
        this._param1Val = ch;
        this._state = S_PARAM2;
        break;
      case 0x49: // ESC I n — ignore
        this._state = S_NORMAL;
        break;
      case 0x4A: // ESC J n — immediate LF
        this._yDot += ch * this._unit216;
        this._state = S_NORMAL;
        break;
      case 0x4E: // ESC N n — skip-over-perforation: skip n lines at each page bottom
        this._skipPerf = ch;
        this._state = S_NORMAL;
        break;
      case 0x51: { // ESC Q n — right margin at column n (current pitch)
        // Per-mode column max (Op manual 3-89): n past the max for the active
        // pitch/size is ignored and the previous margin stays — not clamped. The
        // max is how many columns fit the 8" line at the current cell width
        // (pica 80 / elite 96 / condensed 137, halved when enlarged).
        const eff     = this._colDots() * (this._isExpanded() ? 2 : 1);
        const maxCols = Math.floor(this._printWidthDots() / eff);
        if (ch >= 1 && ch <= maxCols) {
          const r = Math.round(ch * this._colDots());
          if (r > this._leftMargin) this._rightMargin = r;
        }
        this._state = S_NORMAL;
        break;
      }
      case 0x52: // ESC R n — international charset (USA for sets not yet authored)
        this._intlSet = EPSON_INTL[ch] ?? "US";
        this._state = S_NORMAL;
        break;
      case 0x53: // ESC S n — n may be 0/1 or ASCII "0"/"1"; low bit selects
        this._script = (ch & 0x01) ? 2 : 1;
        this._state  = S_NORMAL;
        break;
      case 0x55: // ESC U n — ignore
        this._state = S_NORMAL;
        break;
      case 0x57: // ESC W n
        this._expanded = (ch !== 0);
        this._state    = S_NORMAL;
        break;
      case 0x69: // ESC i n — ignore
        this._state = S_NORMAL;
        break;
      case 0x6A: // ESC j n — reverse feed
        this._yDot  = Math.max(0, this._yDot - ch * this._unit216);
        this._state = S_NORMAL;
        break;
      case 0x6C: // ESC l n — left margin at column n (current pitch)
        this._leftMargin = Math.round(ch * this._colDots());
        this.head.leftMargin = this._leftMargin;
        if (this._xDot < this._leftMargin) this._xDot = this._leftMargin;
        this._state = S_NORMAL;
        break;
      case 0x70: // ESC p n — proportional spacing (0=off, 1=on)
        this._proportional = (ch !== 0);
        this._state = S_NORMAL;
        break;
      case 0x73: // ESC s n — half speed (1/49=on, 0/48=off); affects print timing only
        this._halfSpeed = (ch === 1 || ch === 49);
        this._state = S_NORMAL;
        break;
      default:
        this._state = S_NORMAL;
        break;
    }
  }

  _param2(ch) {
    if (this._paramCmd === 0x25) {
      // ESC % n1 n2 — n1 selects the active CG: 0 = ROM, non-zero = RAM download set.
      this._ramFont = (this._param1Val !== 0);
    } else if (this._paramCmd === 0x3F) {
      // ESC ? s n — point graphics letter s (K/L/Y/Z) at ESC * density mode n (0-6).
      if (this._gfxMode[this._param1Val] !== undefined && ch <= 6) {
        this._gfxMode[this._param1Val] = ch;
      }
    }
    // ESC : needs a third byte; everything else is done after second
    this._state = (this._paramCmd === 0x3A) ? S_PARAM3 : S_NORMAL;
  }

  // DIP SW2-1 Automatic Line Feed, driven by the printer manager (shared toggle).
  setAutoLineFeed(on) { this._autoLF = !!on; }
  getAutoLineFeed()   { return this._autoLF; }

  // Operator panel: Auto-LF (inherited) + power-on pitch. SI/DC2 and ESC M/P
  // still switch pitch live while printing.
  static get SETTINGS() {
    return [
      ...super.SETTINGS,
      { id: "slashedZero", type: "toggle", default: false, label: "Slashed zero",
        hint: "Print 0 as Ø (DIP SW1-2)",
        get: (p) => p.getSlashedZero(),
        set: (p, v) => p.setSlashedZero(v) },
      { id: "pitch", type: "choice", default: "pica", label: "Pitch",
        hint: "Power-on character pitch",
        options: [
          { value: "pica",       label: "Pica · 10 cpi" },
          { value: "elite",      label: "Elite · 12 cpi" },
          { value: "compressed", label: "Compressed · 17 cpi" },
        ],
        get: (p) => p.getDefaultPitch(),
        set: (p, v) => p.setDefaultPitch(v) },
    ];
  }

  // Printable carriage width (8") and one character column at the current pitch.
  _printWidthDots() { return this.dpi * this.carriageWidthInch(); }
  _colDots()        { return this.dpi / CPI[this._pitch]; }

  // HT — advance to the next horizontal tab stop. Explicit stops (ESC D) are
  // columns from the left margin; with none set the default is every 8 columns.
  // A stop at or past the right margin is ignored (the head stays put).
  _horizontalTab() {
    const col = this._colDots();
    let next = null;
    if (this._htabCols.length) {
      for (const c of this._htabCols) {
        const x = this._leftMargin + Math.round(c * col);
        if (x > this._xDot + 0.5) { next = x; break; }
      }
    } else {
      const curCol = Math.round((this._xDot - this._leftMargin) / col);
      next = this._leftMargin + Math.round((Math.floor(curCol / 8) + 1) * 8 * col);
    }
    if (next != null && next <= this._rightMargin) this._xDot = next;
  }

  // VT — advance to the next vertical tab stop in the active VFU channel (ESC /),
  // measured in lines from top-of-form. With no stop below the cursor — or an
  // empty channel — it acts as a single line feed.
  _verticalTab() {
    const stops = this._vfu[this._vtabChannel];
    if (stops.length) {
      for (const ln of stops) {
        const y = this.paper.topOfForm + Math.round(ln * this._lineHeight);
        if (y > this._yDot + 0.5) {
          this._yDot = y; this.emit("linefeed"); this._checkSkipPerf(); return;
        }
      }
    }
    this._yDot += this._lineHeight; this.emit("linefeed"); this._checkSkipPerf();
  }

  // Skip-over-perforation (ESC N): once the cursor reaches the last n lines of a
  // page, slew straight to the next page top so nothing prints across the fold.
  _checkSkipPerf() {
    if (this._skipPerf <= 0) return;
    const bottom = this.paper.nextFormTop(this._yDot, this._effectiveFormDots());
    if (this._yDot > bottom - this._skipPerf * this._lineHeight) this.formFeed();
  }

  // Effective enlarged state = continuous (ESC W / ESC !) OR one-line (SO / ESC SO).
  _isExpanded() { return this._expanded || this._expandedOneLine; }

  _charAdvance() {
    const base = this.dpi / CPI[this._pitch];
    return Math.round(this._isExpanded() ? base * 2 : base);
  }

  // Inked width of a glyph = index of its rightmost non-empty column + 1.
  // Used to advance proportionally; a fully blank glyph (space) reports 1.
  _inkWidth(cols) {
    let w = 0;
    for (let i = 0; i < cols.length; i++) if (cols[i]) w = i + 1;
    return w || 1;
  }

  _emitChar(code) {
    // Same Roman/Italic bitmap in every pitch — proportional is spacing, not a
    // separate font. Fixed pitch advances by the cell width; ESC p / Master
    // Select bit 1 instead advance by the glyph's own inked width plus a blank
    // lead/trail column. A downloaded char (ESC &) overrides the ROM glyph only
    // while the RAM set is selected (ESC % 1); ESC % 0 reverts to the ROM CG.
    let cols, advance;
    const custom = this._ramFont ? this._customChars.get(code) : undefined;
    if (custom) {
      cols = custom; advance = this._charAdvance();
    } else {
      cols = this._romChar(code);
      if (!cols) return;
      if (this._proportional) {
        const w = (this._inkWidth(cols) + 2) * this._dotW;
        advance = Math.round(this._isExpanded() ? w * 2 : w);
      } else {
        advance = this._charAdvance();
      }
    }
    if (!cols) return;

    // Auto-wrap: a glyph that would cross the right margin starts a fresh line
    // first (a hardware CR+LF, independent of the Auto-LF DIP). The leftMargin
    // guard guarantees forward progress so a too-narrow margin can't loop.
    if (this._xDot > this._leftMargin &&
        this._xDot + advance > this._rightMargin) {
      this._xDot   = this._leftMargin;
      this._yDot  += this._lineHeight;
      this._lastCR = false;
      this._expandedOneLine = false;              // SO enlarged spans one line only
      this.emit("newline");
      this._checkSkipPerf();
    }

    this.emit("printChar", {
      cols,
      xDot:      this._xDot,
      yDot:      this._yDot,
      dotW:      this._dotW,
      dotH:      this._dotV,
      color:     "black",
      // Script chars render short (top/bottom of line) and always in
      // Double-Strike — FX Vol.1 Ch.9 pp.116-117 + Quick Reference recap.
      bold:      this._emphasized || this._dblStrike || this._script !== 0,
      underline: this._underline,
      script:    this._script === 1 ? "super" : this._script === 2 ? "sub" : "none",
    });
    this.emit("text", String.fromCharCode(code));
    this._xDot += advance;
  }

  // ESC : — clone the ROM character generator into the download set so a program
  // can redefine a few glyphs (ESC &) yet keep the rest (Op manual 3-59). Printable
  // Roman range only, keyed by 7-bit code exactly as _emitChar reads it. cols.slice()
  // keeps a plain int array — ROM columns carry the 9th-pin bit (0x100) a Uint8Array
  // would truncate.
  _copyRomToDownload() {
    for (let code = 0x20; code <= 0x7F; code++) {
      const cols = EPSON_FX_ROM[code];
      if (cols) this._customChars.set(code, cols.slice());
    }
  }

  // The FX-80 has a single 256-glyph CG ROM: $00–$7F Roman, $80–$FF Italic.
  // ESC 4 / Master Select bit 6 select italic by setting the high bit (ESC 5
  // clears it). receiveByte() has already masked incoming data to 7 bits, so
  // `code` is 0x00–0x7F here and the high bit is ours to add.
  // (International sets — ESC R — are deferred; _intlSet is tracked but every
  // set currently renders from USA until the national glyphs are authored.)
  _romChar(code) {
    const cols = EPSON_FX_ROM[this._italic ? (code | 0x80) : code];
    if (cols && this._slashedZero && code === 0x30) return this._slashZeroCols(cols);
    return cols;
  }

  getCharsPerSecond() { return this._halfSpeed ? 80 : 160; } // FX-80 draft; ESC s halves it

  // ---- Paper-geometry capability (paper-sizes.md §Epson FX-80) ----
  // The FX-80 is the only modelled printer that is LEFT-referenced: the head
  // homes at the paper's left edge, so widening adds paper to the right only and
  // a single right-hand tractor sets the width.
  paperAnchor()      { return "left"; }
  sprocketSymmetry() { return "right-fixed-left"; }

  // Body range (strips off), tractor feed. One range spanning both tractor units
  // the FX-80 accepts: the optional narrow tractor floors at 3.0" body (overall
  // 4.0"), the built-in wide tractor tops at 9.0" body (overall 10"). We don't
  // emulate swapping the accessory — the printer simply feeds 3.0"–9.0" body.
  paperWidthRange() { return { min: 3.0, max: 9.0 }; }

  // Form length: continuous stock 1"–22" via ESC C 0 n; factory default 12"
  // (FX Op manual §1.7, ESC C). 1" forms are real on pin-feed label/card stock.
  paperLengthRange()      { return { min: 1, max: 22 }; }
  defaultPaperLengthInch() { return 12; }

  getName() { return "Epson FX-80"; }
  getId()   { return "epson-fx80"; }
}
