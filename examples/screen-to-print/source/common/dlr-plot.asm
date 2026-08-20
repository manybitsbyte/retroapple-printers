; ===========================================================================
; DOUBLE LO-RES (DLR) PLOT TEST-PATTERN  ->  page 1 OR page 2, relocatable
;
; Lays down an 80x48 double-lo-res test screen by hand (direct RAM stores, no
; firmware) for the DLR screen-dump tests. Companion to
; imagewriteri/dlr-dump-gray.asm, which prints the screen this routine draws.
;
; --- WHY DOUBLE LO-RES NEEDS BOTH MEMORY BANKS -------------------------------
; DLR doubles the horizontal resolution of lo-res to 80 cells by interleaving
; AUXILIARY and MAIN RAM: for each of the 40 byte positions in a text line, the
; AUX byte is the LEFT cell (even screen column 0,2,..,78) and the MAIN byte is
; the RIGHT cell (odd screen column 1,3,..,79). Each byte still packs two
; stacked cells: low nibble = top lo-res row, high nibble = bottom row. So this
; routine writes the SAME 40 line addresses twice -- once to aux, once to main.
;
; --- AUX WRITES VIA RAMWRT (fetch-safe) --------------------------------------
; Writing aux RAM uses the RAMWRT soft switch ($C005 on / $C004 off). RAMWRT
; only redirects WRITES to $0200-$BFFF; instruction fetches and reads are
; unaffected, so this code runs from main RAM at any address while it pokes aux.
; (RAMRD would redirect opcode fetches and crash us -- never used here.) Zero
; page is below $0200, so BASL and our scratch always stay in main. The aux
; window is kept to a single STA: RAMWRT on -> store aux cell -> RAMWRT off ->
; store main cell. Works identically for page 1 ($0400) and page 2 ($0800).
;
; --- AUX HALF-COLOR-CLOCK PHASE (ROR4) ---------------------------------------
; The //e video hardware rotates each aux nibble LEFT by one bit before display
; (a half-color-clock phase shift). To make an aux cell SHOW colour C we must
; therefore store ROR4(C) = ((C>>1)|(C<<3)) AND 15. Main cells are stored raw.
; The matching dump rotates aux nibbles back (ROL4), so screen and print agree.
;
; --- THE PATTERN -------------------------------------------------------------
;   colour(screenCol, row) = (screenCol + row + tint) AND 15
; A fine diagonal 16-colour ramp at the full 80-column resolution. For byte
; column COL the running base = 2*COL + GROW + tint gives the four cells in
; sequence: aux-top = base, aux-bottom = base+1, main-top = base+1,
; main-bottom = base+2. Adjacent aux/main cells differ by one colour step, so an
; aux/main swap shows as a stair reversal and the asymmetric diagonal reveals
; any axis flip. tint = 0 on page 1, 8 on page 2, so the pages look different.
;
; --- DISPLAY NOTE ------------------------------------------------------------
; The emulator (like standard //e usage) scans DLR only from page 1 ($0400
; main+aux); page 2 ($0800) is written and dumped for the RAM-level test but is
; not shown as DLR on screen. On entry the routine selects the double-lo-res
; display (page 1) so the pattern is visible as it is drawn; otherwise it only
; writes graphics RAM, and the dump reads that RAM.
;
; --- PAGE (POKE before CALL) -------------------------------------------------
;   POKE 9,0 : CALL <load addr>   -> fill DLR PAGE 1 (main+aux $0400-$07FF)
;   POKE 9,1 : CALL <load addr>   -> fill DLR PAGE 2 (main+aux $0800-$0BFF)
;
; POSITION-INDEPENDENT: no absolute reference to its own code. The per-line
; loop body exceeds a relative branch's 127-byte reach, so the loop-back is a
; relocatable RTS long-jump: we self-locate by JSR-ing the monitor known-RTS
; ($FF58) -- the JSR pushes our run-time PC, the ROM RTS pops it, we read it off
; the stack page -- then push a run-time pointer (ROWVEC) and RTS to it. The
; only absolute operands are FIXED locations that never move with the code:
; BASCALC ($FBC1), known-RTS ($FF58), the stack page ($0100,X) and the RAMWRT
; switches ($C004/$C005). The assembled bytes run unchanged at any load address.
; ===========================================================================

BASCALC EQU $FBC1        ; monitor: A = text line 0..23 -> BASL/BASH line base
KNOWNRTS EQU $FF58       ; monitor's fixed "known RTS" -- JSR here to read our PC
BASL    EQU $28          ; lo-res/text line base, set by BASCALC

GROW    EQU $06          ; top lo-res row of the current pair: 0,2,..,46
COL     EQU $07          ; byte column 0..39 (a main/aux cell pair)
PAIR    EQU $08          ; assembled cell byte: lo nibble=top row, hi=bottom
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2 (POKE before CALL)
TINT    EQU $0A          ; page colour phase: 0 (page 1) or 8 (page 2)
BASE    EQU $0B          ; running colour base for this cell pair
SELF    EQU $0C          ; (2) run-time base = address of ANCHOR-1
ROWVEC  EQU $0E          ; (2) run-time (LINELP-1) for the line RTS long back-jump

RAMWRTON  EQU $C005      ; redirect $0200-$BFFF writes to AUX RAM
RAMWRTOFF EQU $C004      ; redirect $0200-$BFFF writes back to MAIN RAM

TXTCLR    EQU $C050      ; graphics (TEXT off)
MIXCLR    EQU $C052      ; full screen (MIXED off)
TXTPAGE1  EQU $C054      ; display page 1
LORES     EQU $C056      ; lo-res (HIRES off)
SET80VID  EQU $C00D      ; 80-column video on -> double-res scan
DHIRESON  EQU $C05E      ; AN3 off = double-res enabled (double lo-res)
CLR80STORE EQU $C000     ; 80STORE off -> RAMWRT (not PAGE2) routes $0400 writes

        ORG $6000        ; default build address only -- code is relocatable

; --- select the double-lo-res display ---------------------------------------
; Switch the screen to double lo-res, page 1, so the pattern is visible as it
; is drawn (formerly a pure RAM fill that left the screen in TEXT). The //e
; scans double lo-res only from page 1 ($0400 main+aux); a PGSEL=1 fill still
; writes page 2 ($0800) for the RAM/print test but is not shown here. Every
; operand is a FIXED I/O switch, so the routine stays relocatable.
; CLR80STORE is essential: the aux (even) cells below are stored through the
; RAMWRT switch, but RAMWRT only routes $0400-$07FF writes while 80STORE is OFF.
; If 80STORE is left ON at entry (e.g. by a prior 80-col text / print pass),
; PAGE2 -- not RAMWRT -- selects the bank, so every "aux" store silently lands
; in MAIN, the aux bank stays blank, and the DLR screen shows only the odd
; (main) columns with black gaps between them. Clearing it here makes the aux
; writes land regardless of the entry state.
        STA CLR80STORE   ; 80STORE off -> RAMWRT controls the aux writes
        STA TXTCLR       ; graphics (TEXT off)
        STA MIXCLR       ; full screen (MIXED off)
        STA LORES        ; lo-res (HIRES off)
        STA SET80VID     ; 80-column video on
        STA DHIRESON     ; AN3 off -> double lo-res
        STA TXTPAGE1     ; display page 1

; --- self-locate (position-independent) --------------------------------------
; Entry point == first instruction, so CALL <load address> runs it directly.
        JSR KNOWNRTS     ; -> pushes (ANCHOR-1), ROM RTS returns to ANCHOR
ANCHOR  TSX              ; X = SP after the RTS popped the return address
        LDA $0100,X      ; high byte of pushed PC (= >(ANCHOR-1))
        STA SELF+1
        DEX
        LDA $0100,X      ; low byte (= <(ANCHOR-1))
        STA SELF
        CLC
        LDA SELF
        ADC #<(LINELP-ANCHOR)    ; ROWVEC = run-time (LINELP-1) for the RTS jump
        STA ROWVEC
        LDA SELF+1
        ADC #>(LINELP-ANCHOR)
        STA ROWVEC+1

; --- set up the page colour phase -------------------------------------------
        LDA #$00
        STA TINT
        LDA PGSEL
        BEQ TSET         ; page 1: tint stays 0
        LDA #$08
        STA TINT         ; page 2: phase the ramp by 8 so it looks different
TSET    LDA #$00
        STA GROW

; --- fill one text line (a top/bottom lo-res row pair) ----------------------
LINELP  LDA GROW
        LSR              ; A = text line = GROW/2  (0..23)
        JSR BASCALC      ; -> BASL/BASH  (page-1 line base)
        LDA PGSEL
        BEQ P1           ; page 1: leave base as-is
        LDA BASL+1
        CLC
        ADC #$04         ; +$0400 -> page-2 window ($0800-$0BFF)
        STA BASL+1
P1      LDA #$00
        STA COL

; --- one cell pair: aux cell (left) then main cell (right) ------------------
COLLP   LDA COL
        ASL              ; A = COL*2 = aux screen column (even)
        CLC
        ADC GROW
        CLC
        ADC TINT
        STA BASE         ; base = 2*COL + GROW + TINT
; aux byte: top = base (ROR4 -> low), bottom = base+1 (ROR4 -> high)
        LDA BASE
        AND #$0F
        LSR              ; ROR4: carry=bit0, A=C>>1
        BCC AT0
        ORA #$08         ; fold bit0 into bit3
AT0     STA PAIR
        LDA BASE
        CLC
        ADC #$01
        AND #$0F
        LSR              ; ROR4
        BCC AB0
        ORA #$08
AB0     ASL
        ASL
        ASL
        ASL
        ORA PAIR
        STA PAIR
        LDY COL
        STA RAMWRTON     ; writes now land in AUX
        LDA PAIR
        STA (BASL),Y
        STA RAMWRTOFF    ; writes back to MAIN
; main byte (raw): top = base+1 (low), bottom = base+2 (high)
        LDA BASE
        CLC
        ADC #$01
        AND #$0F
        STA PAIR
        LDA BASE
        CLC
        ADC #$02
        AND #$0F
        ASL
        ASL
        ASL
        ASL
        ORA PAIR
        LDY COL
        STA (BASL),Y     ; RAMWRT off -> MAIN bank
        INC COL
        LDA COL
        CMP #$28          ; 40 byte columns?
        BNE COLLP
        INC GROW          ; advance past the pair (the odd row is the high
        INC GROW          ; nibble we just wrote)
        LDA GROW
        CMP #$30          ; 48 rows done?
        BEQ DONE
        LDA ROWVEC+1      ; else long back-jump to LINELP, relocatably: push the
        PHA               ; run-time (LINELP-1) and RTS to it (line body is >127
        LDA ROWVEC        ; bytes, past relative-branch reach)
        PHA
        RTS
DONE    RTS
