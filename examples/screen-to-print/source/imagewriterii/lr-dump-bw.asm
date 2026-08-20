; ===========================================================================
; LORES (GR) SCREEN DUMP, BLACK & WHITE  ->  ImageWriter II via Super Serial
; Card, fully relocatable 65C02.
;
; THE AUTHENTIC PATH: this 6502 code reads lo-res graphics RAM, transposes
; each colour row to a row of vertical dot columns, and streams genuine
; ImageWriter bit-image graphics (ESC n / ESC T / ESC G) one byte at a time to
; the Super Serial Card's ACIA. Every byte waits on the transmitter-empty bit
; (TDRE) first, so output is paced at the real serial baud rate exactly as on
; hardware -- no host-side framebuffer trick, no flooding. The same program
; runs on a real Apple //e + SSC + ImageWriter II and prints the identical
; page. Companion to common/lr-plot.asm, which lays down the test
; screen this routine prints.
;
; POSITION-INDEPENDENT: the routine contains no absolute reference to its own
; code. It uses relative branches, zero-page scratch (fixed regardless of load
; address), the indirect read (BASL),Y, and absolute access only to FIXED
; addresses that do not move with the code: the monitor BASCALC ($FBC1) and
; known-RTS ($FF58) entries, and the SSC ACIA registers ($C0A8-$C0AB). The
; inline TDRE polls bloat each row past a relative branch's 127-byte reach, so
; the once-per-row loop-back can't be a branch; instead the code self-locates
; (JSR $FF58 pushes our run-time PC, the ROM RTS pops it, we read it off the
; stack page) and long-jumps back by pushing a run-time pointer (ROWVEC) and
; RTS-ing to it. The TDRE wait itself is INLINED before every data write (a JSR
; to a private PUT routine would be an absolute self-reference and would not
; relocate). The assembled bytes run unchanged at ANY load address; the default
; ORG below ($6000) is only where this build lands. Re-assemble with a different
; ORG, or load the same binary elsewhere and CALL it there -- identical.
;
; --- SERIAL HANDSHAKE (authentic pacing) -------------------------------------
; The routine programs the 6551 (9600 baud, 8N1, transmitter on) and polls TDRE
; (status register $C0A9, bit 4) before EVERY data-register write. On real
; hardware the transmitter holds each byte for one character time at the
; programmed baud, so the dump prints at true serial speed instead of instantly.
; The emulated 6551 models the same TDRE shift timing, so the on-screen head
; paces identically. Re-programming an already-PR#2-configured SSC is harmless.
;
; --- SLOT --------------------------------------------------------------------
; Targets the Super Serial Card in SLOT 2 (ACIA at $C0A8-$C0AB). For a card in
; slot 1 use $C098-$C09B and re-assemble; the I/O addresses are fixed, so this
; does not affect relocatability.
;
; --- PAGE (same convention as common/lr-plot.asm) -----------------
;   POKE 9,0 : CALL <load addr>   -> dump lo-res PAGE 1 ($0400-$07FF, default)
;   POKE 9,1 : CALL <load addr>   -> dump lo-res PAGE 2 ($0800-$0BFF)
; LORES line bases come from BASCALC (page-1 only); page 2 is reached by adding
; $04 to BASL+1 after each BASCALC call -- itself relocation-safe (zero page).
;
; --- OUTPUT GEOMETRY ---------------------------------------------------------
; Each of the 48 colour rows prints as one 8-dot-high ESC G band. Every inked
; cell (colour 1..15) prints as a solid CW-dot-wide black block; colour 0 is
; bare paper. 40 cells * 13 dots = 520 dots ~= 7.2" at 72 dpi, square dots,
; true 4:3 GR aspect. ESC T 16 sets a 16/144" = exactly-8-dot line pitch so the
; bands butt seamlessly.
;
; --- INLINE SEND MACRO (by hand) ---------------------------------------------
; Each "send" below is the same 5-instruction block: spin on TDRE, then write
; the byte. The data byte is staged in zero page (OUT) first so the poll, which
; destroys A, never loses it. The poll's back-branch uses a per-site label.
; ===========================================================================

ACIA    EQU $C0A8        ; SSC slot 2 ACIA transmit data register (write = TX)
STATUS  EQU $C0A9        ; SSC slot 2 ACIA status register (read); bit 4 = TDRE
CMD     EQU $C0AA        ; SSC slot 2 ACIA command register
CTRL    EQU $C0AB        ; SSC slot 2 ACIA control register
BASCALC EQU $FBC1        ; monitor: A = text line 0..23 -> BASL/BASH line base
KNOWNRTS EQU $FF58       ; monitor's fixed "known RTS" -- JSR here to read our PC
BASL    EQU $28          ; lo-res/text line base, set by BASCALC

GROW    EQU $06          ; current GR row, 0..47
COL     EQU $07          ; current column, 0..39
OUT     EQU $08          ; byte staged for the next paced send (poll clobbers A)
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2 (POKE before CALL)
SELF    EQU $0E          ; (2) run-time base = address of ANCHOR-1
ROWVEC  EQU $10          ; (2) run-time (ROWLP-1) for the row RTS long back-jump

CW      EQU $0D          ; 13 dot columns per cell (block width)

        ORG $6000        ; default build address only -- code is relocatable

; --- self-locate (position-independent) --------------------------------------
; Entry point == first instruction, so CALL <load address> runs it directly.
; JSR the fixed monitor RTS: the JSR pushes our real run-time return address,
; the ROM RTS pops it, and we read the just-popped bytes back off the stack page
; ($0100,X is the stack, a fixed location -- not a self-reference). The inline
; TDRE polls bloat each row past a relative branch's 127-byte reach, so the row
; loop jumps back via an RTS to a run-time pointer (ROWVEC) instead of a far
; branch -- the only mechanism here that needs our own run-time address, and it
; uses no absolute reference to our code.
        JSR KNOWNRTS     ; -> pushes (ANCHOR-1), ROM RTS returns to ANCHOR
ANCHOR  TSX              ; X = SP after the RTS popped the return address
        LDA $0100,X      ; high byte of pushed PC (= >(ANCHOR-1))
        STA SELF+1
        DEX
        LDA $0100,X      ; low byte (= <(ANCHOR-1))
        STA SELF
        CLC
        LDA SELF
        ADC #<(ROWLP-ANCHOR)     ; ROWVEC = run-time (ROWLP-1) for the RTS jump
        STA ROWVEC
        LDA SELF+1
        ADC #>(ROWLP-ANCHOR)
        STA ROWVEC+1

; --- ACIA setup: 9600 baud, 8N1, transmitter enabled ------------------------
        LDA #$1E          ; control: internal baud gen, 9600, 8 data, 1 stop
        STA CTRL
        LDA #$0B          ; command: DTR on, no parity, receiver/IRQs off
        STA CMD

; --- printer init: 72 dpi square dots, 8-dot seamless line pitch ------------
        LDA #$1B          ; ESC
        STA OUT
W00     LDA STATUS
        AND #$10
        BEQ W00
        LDA OUT
        STA ACIA
        LDA #$6E          ; 'n' -> extended pitch = 72 dpi graphics, square dots
        STA OUT
W01     LDA STATUS
        AND #$10
        BEQ W01
        LDA OUT
        STA ACIA
        LDA #$1B          ; ESC
        STA OUT
W02     LDA STATUS
        AND #$10
        BEQ W02
        LDA OUT
        STA ACIA
        LDA #$54          ; 'T' -> ESC T 16 : line height 16/144" = 8 dots exact
        STA OUT
W03     LDA STATUS
        AND #$10
        BEQ W03
        LDA OUT
        STA ACIA
        LDA #$31          ; '1'
        STA OUT
W04     LDA STATUS
        AND #$10
        BEQ W04
        LDA OUT
        STA ACIA
        LDA #$36          ; '6'
        STA OUT
W05     LDA STATUS
        AND #$10
        BEQ W05
        LDA OUT
        STA ACIA

        LDA #$00
        STA GROW
; --- one colour row -> one ESC G band ---------------------------------------
ROWLP   LDA GROW
        LSR               ; A = text row = GROW/2
        JSR BASCALC       ; -> BASL/BASH  (page-1 base)
        LDA PGSEL
        BEQ ROWP1         ; page 1: leave base as-is
        LDA BASL+1
        CLC
        ADC #$04          ; +$0400 -> lo-res page 2 window
        STA BASL+1
ROWP1   LDA #$1B          ; ESC
        STA OUT
W06     LDA STATUS
        AND #$10
        BEQ W06
        LDA OUT
        STA ACIA
        LDA #$47          ; 'G'
        STA OUT
W07     LDA STATUS
        AND #$10
        BEQ W07
        LDA OUT
        STA ACIA
        LDA #$30          ; count "0520" (40 cells * 13 dots)
        STA OUT
W08     LDA STATUS
        AND #$10
        BEQ W08
        LDA OUT
        STA ACIA
        LDA #$35          ; '5'
        STA OUT
W09     LDA STATUS
        AND #$10
        BEQ W09
        LDA OUT
        STA ACIA
        LDA #$32          ; '2'
        STA OUT
W10     LDA STATUS
        AND #$10
        BEQ W10
        LDA OUT
        STA ACIA
        LDA #$30          ; '0'
        STA OUT
W11     LDA STATUS
        AND #$10
        BEQ W11
        LDA OUT
        STA ACIA

        LDA #$00
        STA COL
; --- one cell: pick the nibble for this band, emit a solid block or a gap ----
CELLLP  LDY COL
        LDA (BASL),Y      ; GR byte: lo nibble = top cell, hi nibble = bottom
        PHA
        LDA GROW
        LSR               ; carry = GROW bit0 : 0 = top band, 1 = bottom band
        PLA               ; A = GR byte
        BCC USELOW        ; even row -> top cell -> low nibble
        LSR               ; odd row -> bottom cell -> bring hi nibble down
        LSR
        LSR
        LSR
USELOW  AND #$0F          ; colour 0..15 for this cell
        BEQ CELLOFF       ; colour 0 = black = no ink
        LDA #$FF          ; inked: all 8 dots of the column solid
        BNE CELLSET       ; (always taken; A = $FF)
CELLOFF LDA #$00
CELLSET STA OUT           ; block byte -> staged; re-loaded after each poll
        LDX #CW           ; emit CW copies -> a solid block CW dots wide
WLP     LDA STATUS
        AND #$10
        BEQ WLP
        LDA OUT
        STA ACIA
        DEX
        BNE WLP

        INC COL
        LDA COL
        CMP #$28          ; 40 columns?
        BNE CELLLP

        LDA #$0D          ; CR -> carriage return, x back to the left margin
        STA OUT
W12     LDA STATUS
        AND #$10
        BEQ W12
        LDA OUT
        STA ACIA
        LDA #$0A          ; LF -> feed exactly one 8-dot band. DIP-independent:
        STA OUT           ;   Auto-LF ON  -> printer swallows this LF (CR fed)
W13     LDA STATUS        ;   Auto-LF OFF -> CR did not feed, this LF does
        AND #$10
        BEQ W13
        LDA OUT
        STA ACIA
        INC GROW
        LDA GROW
        CMP #$30          ; 48 rows done?
        BEQ DONE
        LDA ROWVEC+1      ; else long back-jump to ROWLP, relocatably: push the
        PHA               ; run-time (ROWLP-1) and RTS to it -- the row body is
        LDA ROWVEC        ; >127 bytes (inline TDRE polls), past branch reach
        PHA
        RTS
DONE    RTS
