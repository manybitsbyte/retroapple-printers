; ===========================================================================
; LORES (GR) SCREEN DUMP, COLOUR  ->  ImageWriter II via Super Serial Card,
; fully relocatable 65C02.
;
; THE AUTHENTIC PATH: this 6502 code reads lo-res graphics RAM and streams
; genuine ImageWriter colour bit-image graphics to the Super Serial Card's
; ACIA data register, one byte at a time. For each 8-dot-high band it walks the
; 40 cells left to right; per cell it selects the ribbon band for that lo-res
; colour (ESC K) and prints a 13-column block (ESC G) whose ink coverage is set
; by an ordered (Bayer) dither so the solid hues, greys and pastels all read
; correctly through the four ribbon colours. No host-side framebuffer trick --
; the same program runs on a real Apple //e + SSC + ImageWriter II and prints
; the identical colour page. Companion to common/lr-plot.asm.
;
; POSITION-INDEPENDENT: the routine contains no absolute reference to its own
; code. Its three data tables are reached through pointers built at run time:
; we JSR the monitor's fixed "known RTS" ($FF58) -- the JSR pushes our real
; run-time address, the ROM RTS pops it, and we read the just-popped bytes back
; off the stack page (RTS moves SP but leaves the bytes in memory). Each table
; pointer is that run-time base plus an assemble-time constant offset added with
; immediate operands (no absolute table read), so the tables are found wherever
; the code was loaded. Control flow is relative branches only (no JMP / JSR to a
; self label) with one assemble-time-safe exception: the per-row and per-cell
; back edges are long jumps synthesised by pushing the computed loop address and
; executing RTS -- themselves fully relocatable, since the address is derived
; from the run-time base, never an assembled constant. The only absolute
; operands are FIXED addresses that do not move with the code: the monitor
; known-RTS ($FF58) and BASCALC ($FBC1), the SSC ACIA data register ($C0A8),
; and the stack page ($0100,X). The assembled bytes therefore run unchanged at
; ANY load address; the default ORG below ($6000) is only where this build lands.
;
; --- SLOT --------------------------------------------------------------------
; Targets the Super Serial Card in SLOT 2 (ACIA data register $C0A8). For a
; card in slot 1 change ACIA to $C098 and re-assemble; the I/O address is a
; fixed location, so this does not affect relocatability. The emulated 6551
; forwards every data-register write straight to the printer, so no baud / 6551
; setup is needed here (on real hardware initialise the SSC first, e.g. PR#2).
;
; --- PAGE (same convention as common/lr-plot.asm) -----------------
;   POKE 9,0 : CALL <load addr>   -> dump lo-res PAGE 1 ($0400-$07FF, default)
;   POKE 9,1 : CALL <load addr>   -> dump lo-res PAGE 2 ($0800-$0BFF)
;
; --- COLOUR MODEL ------------------------------------------------------------
; Each lo-res colour 0..15 maps to a ribbon band (ESC K '0'..'6': blk/yel/red/
; blu/org/grn/pur) and an ink density 0..16. Colour 15 (white) maps to $FF =
; bare paper (no ESC K, density 0). The Bayer 4x4 matrix turns the density into
; a dot field across each cell's 13-column block. ESC n / ESC T 16 set 72 dpi
; square dots and an 8-dot line pitch so the bands butt seamlessly.
;
; --- ImageWriter I NOTE: colour uses ESC K, which the IW1 lacks; colour is
; IW2-only. Use imagewriterii/lr-dump-bw.asm for IW1.
; ===========================================================================

ACIA    EQU $C0A8        ; SSC slot 2 ACIA transmit data register (write = TX)
BASCALC EQU $FBC1        ; monitor: A = text line 0..23 -> BASL/BASH line base
KNOWNRTS EQU $FF58       ; monitor's fixed "known RTS" -- JSR here to read our PC
BASL    EQU $28          ; lo-res/text line base, set by BASCALC

GROW    EQU $06          ; current GR row, 0..47
COL     EQU $07          ; current column, 0..39
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2 (POKE before CALL)
KCOL    EQU $0A          ; ribbon index for this cell ($FF = white/blank)
VALUE   EQU $0B          ; ink density 0..16 for this cell's colour
CBYTE   EQU $0C          ; assembled 8-dot graphics column
MASK    EQU $0E          ; current dot bit within the column
BIDX    EQU $0F          ; Bayer table index (y row * 4 + x phase)
BCOL    EQU $10          ; x dither phase 0..3, continuous across the row
DCOL    EQU $11          ; dot-column countdown within the cell
SELF    EQU $12          ; (2) run-time base = address of ANCHOR-1
CKPTR   EQU $14          ; (2) run-time pointer to CKCOL table
CDPTR   EQU $16          ; (2) run-time pointer to CDENS table
BAYPTR  EQU $18          ; (2) run-time pointer to BAYER table
ROWVEC  EQU $1A          ; (2) run-time (CROWLP-1) for the row RTS long back-jump
CELLVEC EQU $1C          ; (2) run-time (CLP-1) for the cell RTS long back-jump

CW      EQU $0D          ; 13 dot columns per cell (block width)

        ORG $6000        ; default build address only -- code is relocatable

; --- self-locate (position-independent) --------------------------------------
; Entry point == first instruction, so CALL <load address> runs it directly.
; JSR the fixed monitor RTS: the JSR pushes our real run-time return address,
; the ROM RTS pops it, and we read the just-popped bytes back off the stack page
; ($0100,X is the stack, a fixed location -- not a self-reference). No absolute
; reference to our own code, so this self-locates at ANY load address.
        JSR KNOWNRTS     ; -> pushes (ANCHOR-1), ROM RTS returns to ANCHOR
ANCHOR  TSX              ; X = SP after the RTS popped the return address
        LDA $0100,X      ; high byte of pushed PC (= >(ANCHOR-1))
        STA SELF+1
        DEX
        LDA $0100,X      ; low byte (= <(ANCHOR-1))
        STA SELF
; build the 5 run-time pointers with immediate (assemble-time) offsets:
;   pointer = SELF + (target - ANCHOR + adj) -- no absolute table read, no index
; stride; CKPTR/CDPTR/BAYPTR use +1 (SELF is ANCHOR-1), ROW/CELLVEC carry the
; -1 the RTS long-jumps need.
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
        ADC #<(CROWLP-ANCHOR)    ; ROWVEC  = run-time (CROWLP-1) for the RTS jump
        STA ROWVEC
        LDA SELF+1
        ADC #>(CROWLP-ANCHOR)
        STA ROWVEC+1
        CLC
        LDA SELF
        ADC #<(CLP-ANCHOR)       ; CELLVEC = run-time (CLP-1)    for the RTS jump
        STA CELLVEC
        LDA SELF+1
        ADC #>(CLP-ANCHOR)
        STA CELLVEC+1

; --- printer init: 72 dpi square dots, 8-dot line pitch ---------------------
        LDA #$1B
        STA ACIA
        LDA #$6E         ; 'n'  -> 72 dpi graphics, square dots
        STA ACIA
        LDA #$1B
        STA ACIA
        LDA #$54         ; 'T'  -> ESC T 16 : 8-dot line pitch
        STA ACIA
        LDA #$31         ; '1'
        STA ACIA
        LDA #$36         ; '6'
        STA ACIA

        LDA #$00
        STA GROW
; --- one colour row ---------------------------------------------------------
CROWLP  LDA GROW
        LSR              ; A = text row = GROW/2
        JSR BASCALC      ; -> BASL/BASH (page-1 base)
        LDA PGSEL
        BEQ CRP1
        LDA BASL+1
        CLC
        ADC #$04         ; +$0400 -> lo-res page 2 window
        STA BASL+1
CRP1    LDA #$00
        STA COL
        STA BCOL         ; reset dither x-phase at the left margin
; --- one cell ---------------------------------------------------------------
CLP     LDY COL
        LDA (BASL),Y     ; GR byte: lo nibble = top cell, hi nibble = bottom
        PHA
        LDA GROW
        LSR              ; carry = GROW bit0 : 0 = top band, 1 = bottom band
        PLA
        BCC CTOP         ; even row -> top cell -> low nibble
        LSR
        LSR
        LSR
        LSR
CTOP    AND #$0F         ; colour 0..15
        TAY
        LDA (CKPTR),Y    ; ribbon index ($FF = white/bare paper)
        STA KCOL
        LDA (CDPTR),Y    ; ink density 0..16
        STA VALUE
        LDA KCOL
        CMP #$FF
        BEQ NOK          ; white: no ribbon select, density 0 -> all blank
        LDA #$1B         ; ESC K <ribbon '0'..'6'>
        STA ACIA
        LDA #$4B         ; 'K'
        STA ACIA
        LDA KCOL
        ORA #$30
        STA ACIA
NOK     LDA #$1B         ; ESC G "0013" : 13 graphics columns follow
        STA ACIA
        LDA #$47         ; 'G'
        STA ACIA
        LDA #$30         ; '0'
        STA ACIA
        LDA #$30         ; '0'
        STA ACIA
        LDA #$31         ; '1'
        STA ACIA
        LDA #$33         ; '3'
        STA ACIA
        LDA #CW
        STA DCOL
; --- emit one dithered 8-dot column -----------------------------------------
DCLP    LDA BCOL
        STA BIDX         ; Bayer index for the top dot at this x-phase
        LDA #$00
        STA CBYTE
        LDA #$01
        STA MASK
        LDX #$08         ; 8 vertical dots
DBIT    LDY BIDX
        LDA (BAYPTR),Y
        CMP VALUE        ; C set if threshold >= density -> no ink
        BCS DNOINK
        LDA CBYTE
        ORA MASK         ; density beats threshold -> set this dot
        STA CBYTE
DNOINK  ASL MASK
        LDA BIDX
        CLC
        ADC #$04         ; step to next y row of the Bayer matrix
        AND #$0F
        STA BIDX
        DEX
        BNE DBIT
        LDA CBYTE
        STA ACIA         ; emit the dithered column byte
        INC BCOL
        LDA BCOL
        AND #$03         ; x phase wraps 0..3
        STA BCOL
        DEC DCOL
        BNE DCLP

        INC COL
        LDA COL
        CMP #$28         ; 40 columns?
        BEQ CELLDONE     ; row complete -> emit CR/LF and advance the band
        LDA CELLVEC+1    ; else long-jump back to CLP (relocatable RTS jump;
        PHA              ;   the cell body is >127 bytes, past branch reach)
        LDA CELLVEC
        PHA
        RTS
CELLDONE LDA #$0D        ; CR -> carriage return to the left margin
        STA ACIA
        LDA #$0A         ; LF -> feed one 8-dot band (DIP-independent: swallowed
        STA ACIA         ;   when Auto-LF is on, feeds when it is off)
        INC GROW
        LDA GROW
        CMP #$30         ; 48 rows done?
        BEQ DONE
        LDA ROWVEC+1     ; long back-jump to CROWLP, relocatably: push the
        PHA              ; run-time (CROWLP-1) and RTS to it (clears the >127
        LDA ROWVEC       ; relative-branch reach without an absolute JMP)
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
