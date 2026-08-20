; ===========================================================================
; LO-RES (GR) SCREEN DUMP, GRAYSCALE  ->  Epson FX-80 via Parallel Interface
; Card, fully relocatable 65C02.
;
; THE AUTHENTIC PATH: this 6502 code reads lo-res graphics RAM, transposes each
; colour row to a row of vertical dot columns, and streams genuine Epson ESC/P
; bit-image graphics (ESC A / ESC *) one byte at a time to the Apple Parallel
; Interface Card's data latch. Every data byte waits on the ACK-line ready bit
; first, so output is paced by the printer's own busy/ACK handshake exactly as on
; hardware -- no host framebuffer trick, no flooding. The same program runs on a
; real Apple //e + Parallel card + Epson FX-80 and prints the identical page.
; Companion to common/lr-plot.asm, which lays down the test screen this prints.
;
; The FX-80 speaks EPSON ESC/P, NOT the C. Itoh command core the DMP /
; ImageWriter share -- so the wire format DIFFERS from dmp/lr-dump-gray.asm even
; though the transport (Parallel card, ACK handshake) is byte-for-byte the same.
; Two ESC/P specifics drive the rewrite below:
;   1. GRAPHICS SELECT is a per-line command that carries a BINARY column count.
;      C. Itoh sent ESC G "0520" (four ASCII digits); ESC/P sends ESC * m n1 n2
;      where n1+256*n2 is the count as two raw bytes (520 -> n1=$08 n2=$02) and m
;      is the density mode. Mode 5 = 72 dpi horizontal, which makes SQUARE dots
;      against the 9-pin head's fixed 72 dpi vertical -- the exact 4:3 GR aspect
;      the C. Itoh dump got from ESC n. (Op manual 3-45; _starWidths[5]=dpi/72.)
;   2. BIT ORDER IS INVERTED. The Epson head puts the TOP pin in the MOST
;      significant bit (bit 7 = pin 1 = top dot); C. Itoh puts the top dot in
;      bit 0. So this dump assembles each column MSB-first: MASK starts at $80 and
;      shifts RIGHT (LSR) down the 8 dots, where the DMP dump started at $01 and
;      shifted left. (Manual Vol 2 App B; epson-fx80.js REV8 mirrors this on the
;      way in.) LINE PITCH is set once by ESC A 8 = 8/72" = exactly 8 dots, so the
;      8-dot bands butt seamlessly -- the ESC/P equivalent of the C. Itoh ESC T 16.
;
; --- GRAYSCALE COLOUR MODEL (FX-80 is monochrome, black ribbon) --------------
; The FX-80 has no colour ribbon, so the 16 lo-res colours become 16 DISTINCT ink
; densities ordered by luminance (black = full ink .. white = bare paper) via the
; CDENS table. An ordered 4x4 Bayer dither (BAYER) turns each density into a dot
; field across the cell's 13-column block, so all 16 colours read as their own
; grey and the colour design prints as a faithful luminance map. Same CDENS/BAYER
; as dmp/lr-dump-gray.asm -- the grey model is transport-agnostic; only the wire
; format around it changed.
;
; --- PARALLEL HANDSHAKE (authentic pacing) -----------------------------------
; The Parallel Interface Card (341-0005/341-0019) latches a byte and auto-pulses
; the Centronics STROBE on every write to the data register ($C0n0). The printer
; then holds the ACK line busy until it has taken the byte; the card exposes that
; on the ACK status register ($C0n4): bit 6 (tested with BIT -> V) is the ACK
; line, SET = ready. So before EVERY data write we BIT $C0n4 / BVC back until the
; ready edge, then STA $C0n0. BIT only sets flags -- it leaves A untouched -- so
; the byte can sit in A across the whole poll (no staging slot needed). One
; LDA $C0n7 at start reads the reset register to prime the ACK flip-flop to the
; ready state before the first byte. No baud / control programming: the parallel
; port has none. (Identical to dmp/lr-dump-gray.asm -- same card.)
;
; --- SLOT --------------------------------------------------------------------
; Targets the Parallel Interface Card in SLOT 1 (I/O $C090-$C09F: data $C090,
; ACK status $C094, reset $C097). For slot 2 use $C0A0/$C0A4/$C0A7 and
; re-assemble; the I/O addresses are fixed, so this does not affect
; relocatability.
;
; --- PAGE (POKE before CALL) -------------------------------------------------
;   POKE 9,0 : CALL <load addr>   -> dump lo-res PAGE 1 ($0400-$07FF, default)
;   POKE 9,1 : CALL <load addr>   -> dump lo-res PAGE 2 ($0800-$0BFF)
; LORES line bases come from BASCALC (page-1 only); page 2 is reached by adding
; $04 to BASL+1 after each BASCALC call -- itself relocation-safe (zero page).
;
; --- OUTPUT GEOMETRY ---------------------------------------------------------
; Each of the 48 colour rows prints as one 8-dot-high ESC * band. 40 cells * 13
; dots = 520 dots ~= 7.2" at 72 dpi, square dots, true 4:3 GR aspect. ESC A 8
; sets an 8/72" line pitch so the bands butt seamlessly.
;
; POSITION-INDEPENDENT: no absolute reference to its own code. The two data
; tables are reached through pointers built at run time from a self-located base:
; we JSR the monitor's fixed known-RTS ($FF58) -- the JSR pushes our run-time PC,
; the ROM RTS pops it, and we read the bytes back off the stack page ($0100,X).
; Each pointer is that base plus an assemble-time offset added with immediate
; operands (no absolute table read). The per-row and per-cell back edges exceed a
; relative branch's 127-byte reach (inline ACK polls), so they are long jumps
; synthesised by pushing the run-time loop address and RTS-ing to it. The only
; absolute operands are FIXED locations that never move with the code: BASCALC
; ($FBC1), known-RTS ($FF58), the stack page ($0100,X) and the Parallel card
; registers ($C090-$C097). The assembled bytes run unchanged at any load address;
; the default ORG below ($6000) is only where this build lands.
; ===========================================================================

DATA    EQU $C090        ; parallel slot 1 data latch (write = clock byte + strobe)
PSTAT   EQU $C094        ; parallel slot 1 ACK status (read); bit 6 = ACK line ready
PRESET  EQU $C097        ; parallel slot 1 reset (read = prime ACK flip-flop ready)
BASCALC EQU $FBC1        ; monitor: A = text line 0..23 -> BASL/BASH line base
KNOWNRTS EQU $FF58       ; monitor's fixed "known RTS" -- JSR here to read our PC
BASL    EQU $28          ; lo-res/text line base, set by BASCALC

GROW    EQU $06          ; current GR row, 0..47
COL     EQU $07          ; current column, 0..39
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2 (POKE before CALL)
TMP     EQU $0A          ; source GR byte / scratch
VALUE   EQU $0B          ; ink density 0..16 for this cell's colour
CBYTE   EQU $0C          ; assembled 8-dot graphics column
MASK    EQU $0E          ; current dot bit within the column
BIDX    EQU $0F          ; Bayer table index (y row * 4 + x phase)
BCOL    EQU $10          ; x dither phase 0..3, continuous across the row
DCOL    EQU $11          ; dot-column countdown within the cell
SELF    EQU $14          ; (2) run-time base = address of ANCHOR-1
CDPTR   EQU $16          ; (2) run-time pointer to CDENS table
BAYPTR  EQU $18          ; (2) run-time pointer to BAYER table
ROWVEC  EQU $1A          ; (2) run-time (ROWLP-1) for the row RTS long back-jump
CELLVEC EQU $1C          ; (2) run-time (CELLLP-1) for the cell RTS long back-jump

CW      EQU $0D          ; 13 dot columns per cell (block width)

        ORG $6000        ; default build address only -- code is relocatable

; --- self-locate (position-independent) --------------------------------------
; Entry point == first instruction, so CALL <load address> runs it directly.
        JSR KNOWNRTS     ; -> pushes (ANCHOR-1), ROM RTS returns to ANCHOR
ANCHOR  TSX              ; X = SP after the RTS popped the return address
        LDA $0100,X      ; high byte of pushed PC (= >(ANCHOR-1))
        STA SELF+1
        DEX
        LDA $0100,X      ; low byte (= <(ANCHOR-1))
        STA SELF
; build run-time pointers: pointer = SELF + (target - ANCHOR + adj). The table
; pointers use +1 (SELF is ANCHOR-1); ROW/CELLVEC carry the -1 the RTS jumps need.
        CLC
        LDA SELF
        ADC #<(CDENS-ANCHOR+1)
        STA CDPTR
        LDA SELF+1
        ADC #>(CDENS-ANCHOR+1)
        STA CDPTR+1
        CLC
        LDA SELF
        ADC #<(BAYER-ANCHOR+1)
        STA BAYPTR
        LDA SELF+1
        ADC #>(BAYER-ANCHOR+1)
        STA BAYPTR+1
        CLC
        LDA SELF
        ADC #<(ROWLP-ANCHOR)     ; ROWVEC = run-time (ROWLP-1) for the RTS jump
        STA ROWVEC
        LDA SELF+1
        ADC #>(ROWLP-ANCHOR)
        STA ROWVEC+1
        CLC
        LDA SELF
        ADC #<(CELLLP-ANCHOR)    ; CELLVEC = run-time (CELLLP-1) for the RTS jump
        STA CELLVEC
        LDA SELF+1
        ADC #>(CELLLP-ANCHOR)
        STA CELLVEC+1

; --- parallel card: prime the ACK handshake to the ready state --------------
        LDA PRESET        ; read $C0n7 -> resets ACK flip-flop to ready

; --- printer init: ESC A 8 = 8/72" line pitch (8-dot seamless bands) ---------
        LDA #$1B          ; ESC
W00     BIT PSTAT         ; bit 6 (V) = ACK line ready?
        BVC W00
        STA DATA          ; latch byte + auto-strobe
        LDA #$41          ; 'A' -> ESC A n : n/72" line spacing
W01     BIT PSTAT
        BVC W01
        STA DATA
        LDA #$08          ; n = 8 -> 8/72" = exactly 8 dots (bands butt)
W02     BIT PSTAT
        BVC W02
        STA DATA

        LDA #$00
        STA GROW
; --- one colour row -> one ESC * band ---------------------------------------
ROWLP   LDA GROW
        LSR               ; A = text row = GROW/2
        JSR BASCALC       ; -> BASL/BASH  (page-1 base)
        LDA PGSEL
        BEQ ROWP1         ; page 1: leave base as-is
        LDA BASL+1
        CLC
        ADC #$04          ; +$0400 -> lo-res page 2 window
        STA BASL+1
; --- ESC * 5 n1 n2 : mode 5 (72 dpi), 520 columns follow this band -----------
; count 520 = $0208 : n1 = $08 (low), n2 = $02 (high). BINARY bytes, not ASCII.
ROWP1   LDA #$1B          ; ESC
W06     BIT PSTAT
        BVC W06
        STA DATA
        LDA #$2A          ; '*' -> ESC * : selectable-density bit image
W07     BIT PSTAT
        BVC W07
        STA DATA
        LDA #$05          ; mode 5 = 72 dpi horizontal (square dots, 4:3)
W08     BIT PSTAT
        BVC W08
        STA DATA
        LDA #$08          ; n1 = 520 MOD 256
W09     BIT PSTAT
        BVC W09
        STA DATA
        LDA #$02          ; n2 = 520 DIV 256
W10     BIT PSTAT
        BVC W10
        STA DATA

        LDA #$00
        STA COL
        STA BCOL          ; reset dither x-phase at the left margin
; --- one cell: pick this band's nibble -> density -> dithered 13-col block ----
CELLLP  LDY COL
        LDA (BASL),Y      ; GR byte: lo nibble = top cell, hi nibble = bottom
        STA TMP
        LDA GROW
        LSR               ; carry = GROW bit0 : 0 = top band, 1 = bottom band
        LDA TMP
        BCC CLOW          ; even row -> top cell -> low nibble
        LSR               ; odd row -> bottom cell -> bring hi nibble down
        LSR
        LSR
        LSR
CLOW    AND #$0F          ; colour 0..15 for this cell
        TAY
        LDA (CDPTR),Y     ; ink density 0..16 for this colour's luminance
        STA VALUE
        LDA #CW           ; 13 dot columns per cell
        STA DCOL
; --- emit DCOL dithered 8-dot columns ---------------------------------------
; Epson MSB=top: MASK starts at $80 (bit 7 = pin 1 = top dot) and shifts RIGHT
; down the band, so bit 0 = bottom dot. (DMP dump used $01 + ASL -- opposite.)
DCLP    LDA BCOL
        STA BIDX          ; Bayer index for the top dot at this x-phase
        LDA #$00
        STA CBYTE
        LDA #$80          ; bit 7 = TOP dot (Epson wire order)
        STA MASK
        LDX #$08          ; 8 vertical dots
DBIT    LDY BIDX
        LDA (BAYPTR),Y
        CMP VALUE         ; C set if threshold >= density -> no ink
        BCS DNOINK
        LDA CBYTE
        ORA MASK          ; density beats threshold -> set this dot
        STA CBYTE
DNOINK  LSR MASK          ; step DOWN the column (bit7 top .. bit0 bottom)
        LDA BIDX
        CLC
        ADC #$04          ; step to next y row of the Bayer matrix
        AND #$0F
        STA BIDX
        DEX
        BNE DBIT
        LDA CBYTE         ; paced send of the dithered column byte
WD      BIT PSTAT
        BVC WD
        STA DATA
        INC BCOL
        LDA BCOL
        AND #$03          ; x phase wraps 0..3, continuous across cells
        STA BCOL
        DEC DCOL
        BNE DCLP

        INC COL
        LDA COL
        CMP #$28          ; 40 columns?
        BEQ ROWEND
        LDA CELLVEC+1     ; else long-jump back to CELLLP (relocatable RTS jump;
        PHA               ;   the cell body is >127 bytes, past branch reach)
        LDA CELLVEC
        PHA
        RTS
ROWEND  LDA #$0D          ; CR -> carriage return to the left margin
W12     BIT PSTAT
        BVC W12
        STA DATA
        LDA #$0A          ; LF -> feed exactly one 8-dot band. DIP-independent:
W13     BIT PSTAT         ;   Auto-LF ON  -> printer swallows this LF (CR fed)
        BVC W13           ;   Auto-LF OFF -> CR did not feed, this LF does
        STA DATA
        INC GROW
        LDA GROW
        CMP #$30          ; 48 rows done?
        BEQ DONE
        LDA ROWVEC+1      ; else long back-jump to ROWLP, relocatably: push the
        PHA               ; run-time (ROWLP-1) and RTS to it (row body is >127
        LDA ROWVEC        ; bytes, past relative-branch reach)
        PHA
        RTS
DONE    RTS

; --- colour -> ink density (luminance, black=full ink .. white=bare paper) ---
; 16 DISTINCT levels so every lo-res colour prints as its own grey (same table
; as dmp/lr-dump-gray.asm):
;        0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
;       blk mag dbl pur dgn gr1 mbl lbl brn org gr2 pnk lgn yel aqu wht
CDENS   DFB $10,$0C,$0F,$0B,$0E,$09,$0A,$06,$0D,$07,$08,$05,$04,$02,$03,$00

; 4x4 ordered (Bayer) thresholds 0..15, row-major (y row * 4 + x phase):
BAYER   DFB $00,$08,$02,$0A
        DFB $0C,$04,$0E,$06
        DFB $03,$0B,$01,$09
        DFB $0F,$07,$0D,$05
