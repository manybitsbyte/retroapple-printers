; ===========================================================================
; LORES (GR) PLOT TEST-PATTERN  ->  page 1 OR page 2, fully relocatable
;
; Plots a lo-res test screen by hand (direct RAM stores, no GR/PLOT) for the
; graphics screen-dump tests. Companion to the imagewriterii/test.bas text
; suite: that .bas exercises the text print modes; this .asm lays down the
; lo-res screen the GR dump test prints.
;
; POSITION-INDEPENDENT: the routine contains no absolute reference to its own
; code, so the assembled bytes run unchanged at ANY load address. Re-assemble
; with a different ORG, or just load the same binary somewhere else and CALL
; it there -- behaviour is identical. That is the page-independence proof:
; relocate the code clear of whichever page the running program needs, and it
; can never share memory with lo-res page 1 ($0400-$07FF) or page 2
; ($0800-$0BFF). The default ORG below ($6000) is only where this build lands;
; nothing depends on it.
;
; Every instruction is address-independent: relative branches only (no JMP to
; a self label), zero-page scratch (fixed regardless of load address), the
; indirect store STA (BASL),Y, and one JSR to a fixed monitor ROM entry
; ($FBC1, not relative to us). There is no embedded data byte in the code
; stream, so the entry point is simply the first instruction.
;
; Fills the 40x48 low-res screen with a diagonal 16-colour ramp:
;   colour(col,row) = (row + col) AND 15
; All 16 hues appear (so a colour dump exercises every ribbon band and a BW
; dump exercises the threshold at every brightness); the diagonal is
; asymmetric, so a printed page reveals any axis flip / mirror / page-mapping
; bug at a glance.
;
; Page select lives in zero page (fixed address, survives relocation). Set it,
; then CALL the load address (shown for the default $6000 = 24576 build):
;   POKE 9,0 : CALL 24576   -> fill lo-res PAGE 1 ($0400-$07FF, default)
;   POKE 9,1 : CALL 24576   -> fill lo-res PAGE 2 ($0800-$0BFF)
;
; On entry the routine selects the lo-res display and the page given by PGSEL,
; so the pattern is visible as it is drawn; otherwise it only writes graphics
; RAM, and the dump reads that RAM.
; ===========================================================================

BASCALC EQU $FBC1        ; monitor: A = text line 0..23 -> BASL/BASH line base
BASL    EQU $28          ; lo-res/text line base, set by BASCALC

GROW    EQU $06          ; top lo-res row of the current pair, 0,2,..,46
COL     EQU $07          ; current column, 0..39
PAIR    EQU $08          ; assembled cell byte: lo nibble=top row, hi=bottom
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2  (POKE before CALL)

TXTCLR    EQU $C050      ; graphics (TEXT off)
MIXCLR    EQU $C052      ; full screen (MIXED off)
TXTPAGE1  EQU $C054      ; display page 1
TXTPAGE2  EQU $C055      ; display page 2
LORES     EQU $C056      ; lo-res (HIRES off)
CLR80VID  EQU $C00C      ; 40-column video (single lo-res, not double)
DHIRESOFF EQU $C05F      ; AN3 on = double-res disabled

        ORG $6000        ; default build address only -- code is relocatable

; --- select the lo-res display ----------------------------------------------
; Switch the screen to 40-column lo-res and the page given by PGSEL, so the
; pattern is visible as it is drawn (formerly a pure RAM fill that left the
; screen in TEXT). Entry point == first instruction, so CALL runs it directly.
; All operands are FIXED I/O switches, so the routine stays relocatable.
        STA TXTCLR       ; graphics (TEXT off)
        STA MIXCLR       ; full screen (MIXED off)
        STA LORES        ; lo-res (HIRES off)
        STA CLR80VID     ; 40-column (single lo-res, not double)
        STA DHIRESOFF    ; AN3 on -> double-res off
        STA TXTPAGE1     ; default display page 1
        LDA PGSEL
        BEQ GRSET        ; PGSEL 0 -> page 1 already selected
        STA TXTPAGE2     ; PGSEL!=0 -> display page 2

; --- fill, one text line (a top/bottom lo-res row pair) at a time -----------
GRSET   LDA #$00
        STA GROW
LINELP  LDA GROW
        LSR              ; A = text line = GROW/2  (0..23)
        JSR BASCALC      ; -> BASL/BASH  (page-1 base)
        LDA PGSEL
        BEQ P1           ; page 1: leave base as-is
        LDA BASL+1
        CLC
        ADC #$04         ; +$0400 -> lo-res page 2 window
        STA BASL+1
P1      LDA #$00
        STA COL
COLLP   LDA GROW         ; top cell colour = (GROW + COL) AND 15
        CLC
        ADC COL
        AND #$0F
        STA PAIR         ; -> low nibble (top lo-res row)
        LDA GROW         ; bottom cell colour = (GROW+1 + COL) AND 15
        CLC
        ADC #$01
        CLC
        ADC COL
        AND #$0F
        ASL
        ASL
        ASL
        ASL              ; -> high nibble (bottom lo-res row)
        ORA PAIR
        LDY COL
        STA (BASL),Y     ; one byte = two stacked lo-res cells
        INC COL
        LDA COL
        CMP #$28         ; 40 columns?
        BNE COLLP
        INC GROW         ; advance past the pair (skip the odd row: it is the
        INC GROW         ; high nibble we just wrote)
        LDA GROW
        CMP #$30         ; 48 rows done?
        BNE LINELP
        RTS
