; ===========================================================================
; DOUBLE LO-RES (DLR) SCREEN DUMP, COLOUR  ->  ImageWriter II via Super Serial
; Card, fully relocatable 65C02.
;
; THE AUTHENTIC PATH: this 6502 code reads 80-column double-lo-res graphics RAM
; (main + aux banks), and for each colour row streams genuine ImageWriter II
; colour bit-image graphics to the Super Serial Card's ACIA one byte at a time.
; Per cell it selects the ribbon band for that lo-res colour (ESC K) and prints
; an ESC G block whose ink coverage is set by an ordered (Bayer) dither so the
; solid hues, greys and pastels read correctly through the four ribbon colours.
; Every data byte waits on the transmitter-empty bit (TDRE) first, so output is
; paced at the real serial baud rate exactly as on hardware -- no host
; framebuffer trick. The same program runs on a real Apple //e + SSC +
; ImageWriter II and prints the identical colour page. Companion to
; common/dlr-plot.asm, which lays down the DLR test screen.
;
; --- WHY DOUBLE LO-RES NEEDS BOTH BANKS (and AUXMOVE) ------------------------
; DLR doubles lo-res to 80 cells by interleaving AUX and MAIN RAM: for each of
; the 40 byte positions in a text line the AUX byte is the LEFT cell (even
; screen column 0,2,..,78) and the MAIN byte is the RIGHT cell (odd column
; 1,3,..,79). Each byte still packs two stacked cells: low nibble = top lo-res
; row, high nibble = bottom row. MAIN cells we read directly with (BASL),Y. AUX
; cannot be read that way without RAMRD, which would also redirect opcode
; fetches and crash code living in $0200-$BFFF. Instead, once per row we call the
; monitor AUXMOVE ($C311) to copy the 40 aux bytes of the line down into a MAIN
; buffer at $0200; AUXMOVE saves and restores the bank switches internally and
; never redirects fetches, so it is fetch-safe at any load address. We then read
; the aux cells from $0200 (a FIXED address) and the main cells from (BASL),Y.
;
; --- AUX HALF-COLOR-CLOCK PHASE (ROL4) ---------------------------------------
; The //e video hardware rotates each aux nibble LEFT by one bit before display.
; The plot stored ROR4(colour) in aux so the cell SHOWS the intended colour; to
; recover the displayed colour from an aux RAM byte we rotate it back, ROL4(n) =
; ((n<<1)|(n>>3)) AND 15. Main cells are used raw. With this the printed colour
; is continuous across every aux/main cell boundary, matching the screen.
;
; --- OUTPUT GEOMETRY ---------------------------------------------------------
; Each colour row prints as one 8-dot-high band. The 80 cells map to 40 pairs;
; the LEFT (aux) cell of each pair prints 7 dot columns and the RIGHT (main)
; cell prints 6, so a pair is 13 dots -- 40 pairs = 520 dots ~= 7.2" at 72 dpi,
; square dots, the same true 4:3 aspect as a single-lo-res dump. Because the
; ribbon may change from cell to cell each cell is its OWN ESC G block, with a
; per-cell column count of "0007" (aux) or "0006" (main). ESC T 16 sets a
; 16/144" = exactly-8-dot line pitch so the bands butt seamlessly.
;
; --- COLOUR MODEL (ImageWriter II ribbon) ------------------------------------
; Each lo-res colour 0..15 maps to a ribbon band (ESC K '0'..'6': blk/yel/red/
; blu/org/grn/pur) via CKCOL and an ink density 0..16 via CDENS. Colour 15
; (white) maps to $FF = bare paper (no ESC K, density 0). The Bayer 4x4 matrix
; turns the density into a dot field across the cell's column block.
;
; --- SERIAL HANDSHAKE (authentic pacing) -------------------------------------
; The routine programs the 6551 (9600 baud, 8N1, transmitter on) and polls TDRE
; (status $C0A9, bit 4) before EVERY data-register write, so the dump prints at
; true serial speed instead of instantly. Re-programming an already-PR#2-
; configured SSC is harmless.
;
; --- ImageWriter I NOTE: colour uses ESC K, which the IW1 lacks; colour is
; IW2-only. Use imagewriteri/dlr-dump-gray.asm for the IW1 (and for IW2 in
; black & white -- the BW dump uses no ESC K and prints identically on both).
;
; --- SLOT --------------------------------------------------------------------
; Targets the Super Serial Card in SLOT 2 (ACIA $C0A8-$C0AB). For slot 1 use
; $C098-$C09B and re-assemble; the I/O addresses are fixed, so this does not
; affect relocatability.
;
; --- PAGE (POKE before CALL) -------------------------------------------------
;   POKE 9,0 : CALL <load addr>   -> dump DLR PAGE 1 (main+aux $0400-$07FF)
;   POKE 9,1 : CALL <load addr>   -> dump DLR PAGE 2 (main+aux $0800-$0BFF)
;
; POSITION-INDEPENDENT: no absolute reference to its own code. The three data
; tables are reached through pointers built at run time from a self-located base
; (JSR the monitor known-RTS $FF58, read our pushed PC off the stack page). The
; per-row and per-cell back edges exceed a relative branch's 127-byte reach
; (inline TDRE polls), so they are long jumps synthesised by pushing the
; run-time loop address and RTS-ing to it. The only absolute operands are FIXED
; locations that never move with the code: BASCALC ($FBC1), AUXMOVE ($C311),
; known-RTS ($FF58), the aux buffer ($0200), the stack page ($0100,X) and the
; SSC ACIA registers ($C0A8-$C0AB). The assembled bytes run unchanged at any
; load address; the default ORG below ($6000) is only where this build lands.
; ===========================================================================

ACIA    EQU $C0A8        ; SSC slot 2 ACIA transmit data register (write = TX)
STATUS  EQU $C0A9        ; SSC slot 2 ACIA status register (read); bit 4 = TDRE
CMD     EQU $C0AA        ; SSC slot 2 ACIA command register
CTRL    EQU $C0AB        ; SSC slot 2 ACIA control register
BASCALC EQU $FBC1        ; monitor: A = text line 0..23 -> BASL/BASH line base
KNOWNRTS EQU $FF58       ; monitor's fixed "known RTS" -- JSR here to read our PC
AUXMOVE EQU $C311        ; monitor block move; C clear = aux->main, fetch-safe
BASL    EQU $28          ; lo-res/text line base, set by BASCALC

A1L     EQU $3C          ; AUXMOVE source start (lo/hi)
A1H     EQU $3D
A2L     EQU $3E          ; AUXMOVE source end, inclusive (lo/hi)
A2H     EQU $3F
A4L     EQU $42          ; AUXMOVE destination start (lo/hi)
A4H     EQU $43
AUXBUF  EQU $0200        ; main-RAM landing buffer for the copied aux line

GROW    EQU $06          ; current GR row, 0..47
CIDX    EQU $07          ; cell index across the row, 0..79 (even=aux, odd=main)
HALF    EQU $08          ; 0 = aux (left) cell, 1 = main (right) cell
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2 (POKE before CALL)
TMP     EQU $0A          ; source GR byte / scratch
VALUE   EQU $0B          ; ink density 0..16 for this cell's colour
CBYTE   EQU $0C          ; assembled 8-dot graphics column
KCOL    EQU $0D          ; ribbon index for this cell ($FF = white/blank)
MASK    EQU $0E          ; current dot bit within the column
BIDX    EQU $0F          ; Bayer table index (y row * 4 + x phase)
BCOL    EQU $10          ; x dither phase 0..3, continuous across the row
DCOL    EQU $11          ; dot-column countdown within the cell (7 aux / 6 main)
OUT     EQU $12          ; byte staged for a paced send (poll clobbers A)
WDIG    EQU $13          ; ESC G width digit: '7' (aux) or '6' (main)
SELF    EQU $14          ; (2) run-time base = address of ANCHOR-1
CKPTR   EQU $16          ; (2) run-time pointer to CKCOL table
CDPTR   EQU $18          ; (2) run-time pointer to CDENS table
BAYPTR  EQU $1A          ; (2) run-time pointer to BAYER table
ROWVEC  EQU $1C          ; (2) run-time (ROWLP-1) for the row RTS long back-jump
CELLVEC EQU $1E          ; (2) run-time (CELLLP-1) for the cell RTS long back-jump

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
        ADC #<(CKCOL-ANCHOR+1)
        STA CKPTR
        LDA SELF+1
        ADC #>(CKCOL-ANCHOR+1)
        STA CKPTR+1
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
; --- one colour row ---------------------------------------------------------
ROWLP   LDA GROW
        LSR               ; A = text row = GROW/2
        JSR BASCALC       ; -> BASL/BASH  (page-1 base)
        LDA PGSEL
        BEQ ROWP1         ; page 1: leave base as-is
        LDA BASL+1
        CLC
        ADC #$04          ; +$0400 -> DLR page 2 window
        STA BASL+1
; --- copy this line's 40 AUX bytes down to $0200 (fetch-safe) ---------------
ROWP1   LDA BASL
        STA A1L           ; AUXMOVE source start = aux line base
        LDA BASL+1
        STA A1H
        CLC
        LDA BASL
        ADC #$27          ; +39 -> source end (40 bytes inclusive)
        STA A2L
        LDA BASL+1
        ADC #$00
        STA A2H
        LDA #<AUXBUF
        STA A4L           ; destination = $0200 in MAIN RAM
        LDA #>AUXBUF
        STA A4H
        CLC               ; carry clear = move AUX -> MAIN
        JSR AUXMOVE

        LDA #$00
        STA CIDX
        STA BCOL          ; reset dither x-phase at the left margin
; --- one cell: aux (left, 7 dots) or main (right, 6 dots) -------------------
CELLLP  LDA CIDX
        AND #$01
        STA HALF          ; 0 = aux cell, 1 = main cell
        LDA CIDX
        LSR               ; A = byte column = CIDX/2 (0..39)
        TAY
        LDA HALF
        BNE CMAIN         ; odd index -> main (right) cell
        LDA AUXBUF,Y      ; aux byte (mirrored line copy at $0200)
        LDX HALF          ; HALF = 0 here -> Z set
        BEQ CGOT          ; (always taken) skip the main fetch
CMAIN   LDA (BASL),Y      ; main byte
CGOT    STA TMP
        LDA GROW
        LSR               ; carry = GROW bit0 : 0 = top band, 1 = bottom band
        LDA TMP
        BCC CLOW          ; even row -> top cell -> low nibble
        LSR               ; odd row -> bottom cell -> bring hi nibble down
        LSR
        LSR
        LSR
CLOW    AND #$0F          ; cell nibble 0..15
        LDX HALF
        BNE CNOPH         ; main cell: use raw nibble
        ASL               ; ROL4: recover displayed aux colour
        CMP #$10
        BCC CPH1          ; old bit3 clear
        ORA #$01          ; wrap old bit3 into bit0
CPH1    AND #$0F
CNOPH   TAY
        LDA (CKPTR),Y     ; ribbon index ($FF = white/bare paper)
        STA KCOL
        LDA (CDPTR),Y     ; ink density 0..16 for this colour
        STA VALUE
; --- per-cell width: aux = 7 dot cols ('7'), main = 6 ('6') -----------------
        LDX HALF
        BNE CWM           ; main cell
        LDA #$37          ; '7'
        STA WDIG
        LDA #$07
        STA DCOL
        BNE CWDONE        ; (always taken; A = $07)
CWM     LDA #$36          ; '6'
        STA WDIG
        LDA #$06
        STA DCOL
CWDONE
; --- ESC K <ribbon> : select this colour's ribbon band (skip white) ---------
        LDA KCOL
        CMP #$FF
        BEQ NOK           ; white: no ribbon select, density 0 -> blank columns
        LDA #$1B          ; ESC
        STA OUT
WK0     LDA STATUS
        AND #$10
        BEQ WK0
        LDA OUT
        STA ACIA
        LDA #$4B          ; 'K'
        STA OUT
WK1     LDA STATUS
        AND #$10
        BEQ WK1
        LDA OUT
        STA ACIA
        LDA KCOL
        ORA #$30          ; ribbon index -> ASCII '0'..'6'
        STA OUT
WK2     LDA STATUS
        AND #$10
        BEQ WK2
        LDA OUT
        STA ACIA
; --- ESC G "000W" : W graphics columns follow for this cell -----------------
NOK     LDA #$1B          ; ESC
        STA OUT
WG0     LDA STATUS
        AND #$10
        BEQ WG0
        LDA OUT
        STA ACIA
        LDA #$47          ; 'G'
        STA OUT
WG1     LDA STATUS
        AND #$10
        BEQ WG1
        LDA OUT
        STA ACIA
        LDA #$30          ; '0'
        STA OUT
WG2     LDA STATUS
        AND #$10
        BEQ WG2
        LDA OUT
        STA ACIA
        LDA #$30          ; '0'
        STA OUT
WG3     LDA STATUS
        AND #$10
        BEQ WG3
        LDA OUT
        STA ACIA
        LDA #$30          ; '0'
        STA OUT
WG4     LDA STATUS
        AND #$10
        BEQ WG4
        LDA OUT
        STA ACIA
        LDA WDIG          ; width digit '7' (aux) or '6' (main)
        STA OUT
WG5     LDA STATUS
        AND #$10
        BEQ WG5
        LDA OUT
        STA ACIA
; --- emit DCOL dithered 8-dot columns ---------------------------------------
DCLP    LDA BCOL
        STA BIDX          ; Bayer index for the top dot at this x-phase
        LDA #$00
        STA CBYTE
        LDA #$01
        STA MASK
        LDX #$08          ; 8 vertical dots
DBIT    LDY BIDX
        LDA (BAYPTR),Y
        CMP VALUE         ; C set if threshold >= density -> no ink
        BCS DNOINK
        LDA CBYTE
        ORA MASK          ; density beats threshold -> set this dot
        STA CBYTE
DNOINK  ASL MASK
        LDA BIDX
        CLC
        ADC #$04          ; step to next y row of the Bayer matrix
        AND #$0F
        STA BIDX
        DEX
        BNE DBIT
WD      LDA STATUS        ; paced send of the dithered column byte
        AND #$10
        BEQ WD
        LDA CBYTE
        STA ACIA
        INC BCOL
        LDA BCOL
        AND #$03          ; x phase wraps 0..3, continuous across cells
        STA BCOL
        DEC DCOL
        BNE DCLP

        INC CIDX
        LDA CIDX
        CMP #$50          ; 80 cells?
        BEQ ROWEND
        LDA CELLVEC+1     ; else long-jump back to CELLLP (relocatable RTS jump;
        PHA               ;   the cell body is >127 bytes, past branch reach)
        LDA CELLVEC
        PHA
        RTS
ROWEND  LDA #$0D          ; CR -> carriage return to the left margin
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
        PHA               ; run-time (ROWLP-1) and RTS to it (row body is >127
        LDA ROWVEC        ; bytes, past relative-branch reach)
        PHA
        RTS
DONE    RTS

; --- colour -> ribbon hue + ink density -------------------------------------
; Ribbon: 0=blk 1=yel 2=red 3=blu 4=org 5=grn 6=pur   $FF = white (bare paper)
;        0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
;       blk mag dbl pur dgn gr1 mbl lbl brn org gr2 pnk lgn yel aqu wht
CKCOL   DFB $00,$02,$03,$06,$05,$00,$03,$03,$04,$04,$00,$02,$05,$01,$05,$FF
CDENS   DFB $10,$10,$10,$10,$10,$08,$10,$08,$10,$10,$04,$08,$10,$10,$08,$00

; 4x4 ordered (Bayer) thresholds 0..15, row-major (y row * 4 + x phase):
BAYER   DFB $00,$08,$02,$0A
        DFB $0C,$04,$0E,$06
        DFB $03,$0B,$01,$09
        DFB $0F,$07,$0D,$05
