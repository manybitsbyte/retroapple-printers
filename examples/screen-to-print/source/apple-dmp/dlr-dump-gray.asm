; ===========================================================================
; DOUBLE LO-RES (DLR) SCREEN DUMP, GRAYSCALE  ->  Apple DMP via Parallel
; Interface Card, fully relocatable 65C02.
;
; THE AUTHENTIC PATH: this 6502 code reads 80-column double-lo-res graphics RAM
; (main + aux banks), transposes each colour row to vertical dot columns, and
; streams genuine C. Itoh 8510 bit-image graphics (ESC n / ESC T / ESC G) one
; byte at a time to the Apple Parallel Interface Card's data latch. Every data
; byte waits on the ACK-line ready bit first, so output is paced by the printer's
; own busy/ACK handshake exactly as on hardware -- no host framebuffer trick, no
; flooding. The same program runs on a real Apple //e + Parallel card + Apple DMP
; and prints the identical page. Companion to common/dlr-plot.asm, which lays
; down the DLR test screen this routine prints.
;
; The Apple DMP is a rebadged C. Itoh 8510 -- the same command core the
; ImageWriter I/II inherit -- so ESC n / ESC T / ESC G are byte-for-byte the same
; wire format as imagewriteri/dlr-dump-gray.asm. ONLY the transport differs: the
; ImageWriter rides the Super Serial Card's 6551 ACIA (poll TDRE, write TX reg);
; the DMP rides the Parallel card (poll ACK, write data latch). The graphics half
; below -- AUXMOVE aux read, ROL4 aux phase, 7/6 dot pair split, dither -- is
; identical to the IW1 double-lo-res grey dump.
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
; ((n<<1)|(n>>3)) AND 15. Main cells are used raw. With this the printed
; luminance is continuous across every aux/main cell boundary, matching screen.
;
; --- OUTPUT GEOMETRY ---------------------------------------------------------
; Each colour row prints as one 8-dot-high ESC G band. The 80 cells map to
; 40 pairs; the LEFT (aux) cell of each pair prints 7 dot columns and the RIGHT
; (main) cell prints 6, so a pair is 13 dots -- 40 pairs = 520 dots ~= 7.2" at
; 72 dpi, square dots, the same true 4:3 aspect as a single-lo-res dump. ESC T 16
; sets a 16/144" = exactly-8-dot line pitch so the bands butt seamlessly.
;
; --- GRAYSCALE COLOUR MODEL (Apple DMP has no colour ribbon) -----------------
; The DMP is monochrome, so the 16 lo-res colours become 16 DISTINCT ink
; densities ordered by luminance (black = full ink .. white = bare paper) via the
; CDENS table. An ordered 4x4 Bayer dither (BAYER) turns each density into a dot
; field across the cell's column block, so all 16 colours read as their own grey
; and the colour design prints as a faithful luminance map. Same CDENS/BAYER as
; imagewriteri/dlr-dump-gray.asm. (ESC K colour-ribbon select is an ImageWriter
; II addition the DMP has no hardware for and is deliberately NOT used here.)
;
; --- PARALLEL HANDSHAKE (authentic pacing) -----------------------------------
; The Parallel Interface Card (341-0005/341-0019) latches a byte and auto-pulses
; the Centronics STROBE on every write to the data register ($C0n0). The printer
; then holds the ACK line busy until it has taken the byte; the card exposes that
; on the ACK status register ($C0n4): bit 6 (tested with BIT -> V) is the ACK
; line, SET = ready. So before EVERY data write we BIT $C0n4 / BVC back until the
; ready edge, then STA $C0n0. BIT only sets flags -- it leaves A untouched -- so
; the byte can sit in A across the whole poll (no staging slot needed, unlike the
; ACIA path whose TDRE poll clobbers A). One LDA $C0n7 at start reads the reset
; register to prime the ACK flip-flop to the ready state before the first byte.
; No baud / control programming: the parallel port has none.
;
; --- SLOT --------------------------------------------------------------------
; Targets the Parallel Interface Card in SLOT 1 (I/O $C090-$C09F: data $C090,
; ACK status $C094, reset $C097). For slot 2 use $C0A0/$C0A4/$C0A7 and
; re-assemble; the I/O addresses are fixed, so this does not affect
; relocatability.
;
; --- PAGE (POKE before CALL) -------------------------------------------------
;   POKE 9,0 : CALL <load addr>   -> dump DLR PAGE 1 (main+aux $0400-$07FF)
;   POKE 9,1 : CALL <load addr>   -> dump DLR PAGE 2 (main+aux $0800-$0BFF)
; Line bases come from BASCALC (page-1 only); page 2 is reached by adding $04 to
; BASL+1 after each BASCALC call -- itself relocation-safe (zero page). AUXMOVE
; reads the aux line from the same page-adjusted base, so both pages dump alike.
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
; ($FBC1), AUXMOVE ($C311), known-RTS ($FF58), the aux buffer ($0200), the stack
; page ($0100,X) and the Parallel card registers ($C090-$C097). The assembled
; bytes run unchanged at any load address; the default ORG below ($6000) is only
; where this build lands.
; ===========================================================================

DATA    EQU $C090        ; parallel slot 1 data latch (write = clock byte + strobe)
PSTAT   EQU $C094        ; parallel slot 1 ACK status (read); bit 6 = ACK line ready
PRESET  EQU $C097        ; parallel slot 1 reset (read = prime ACK flip-flop ready)
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
MASK    EQU $0E          ; current dot bit within the column
BIDX    EQU $0F          ; Bayer table index (y row * 4 + x phase)
BCOL    EQU $10          ; x dither phase 0..3, continuous across the row
DCOL    EQU $11          ; dot-column countdown within the cell (7 aux / 6 main)
SELF    EQU $14          ; (2) run-time base = address of ANCHOR-1
CDPTR   EQU $16          ; (2) run-time pointer to CDENS table
BAYPTR  EQU $18          ; (2) run-time pointer to BAYER table
ROWVEC  EQU $1A          ; (2) run-time (ROWLP-1) for the row RTS long back-jump
CELLVEC EQU $1C          ; (2) run-time (CELLLP-1) for the cell RTS long back-jump

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

; --- printer init: 72 dpi square dots, 8-dot seamless line pitch ------------
        LDA #$1B          ; ESC
W00     BIT PSTAT         ; bit 6 (V) = ACK line ready?
        BVC W00
        STA DATA          ; latch byte + auto-strobe
        LDA #$6E          ; 'n' -> extended pitch = 72 dpi graphics, square dots
W01     BIT PSTAT
        BVC W01
        STA DATA
        LDA #$1B          ; ESC
W02     BIT PSTAT
        BVC W02
        STA DATA
        LDA #$54          ; 'T' -> ESC T 16 : line height 16/144" = 8 dots exact
W03     BIT PSTAT
        BVC W03
        STA DATA
        LDA #$31          ; '1'
W04     BIT PSTAT
        BVC W04
        STA DATA
        LDA #$36          ; '6'
W05     BIT PSTAT
        BVC W05
        STA DATA

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
; --- ESC G "0520" : 520 graphics columns follow this band -------------------
        LDA #$1B          ; ESC
W06     BIT PSTAT
        BVC W06
        STA DATA
        LDA #$47          ; 'G'
W07     BIT PSTAT
        BVC W07
        STA DATA
        LDA #$30          ; '0'
W08     BIT PSTAT
        BVC W08
        STA DATA
        LDA #$35          ; '5'
W09     BIT PSTAT
        BVC W09
        STA DATA
        LDA #$32          ; '2'
W10     BIT PSTAT
        BVC W10
        STA DATA
        LDA #$30          ; '0'
W11     BIT PSTAT
        BVC W11
        STA DATA

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
        LDA (CDPTR),Y     ; ink density 0..16 for this colour's luminance
        STA VALUE
        LDX HALF
        BNE CWM           ; main cell -> 6 dot columns
        LDA #$07          ; aux cell -> 7 dot columns
        BNE CWS           ; (always taken; A = $07)
CWM     LDA #$06
CWS     STA DCOL
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
; as imagewriteri/dlr-dump-gray.asm):
;        0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
;       blk mag dbl pur dgn gr1 mbl lbl brn org gr2 pnk lgn yel aqu wht
CDENS   DFB $10,$0C,$0F,$0B,$0E,$09,$0A,$06,$0D,$07,$08,$05,$04,$02,$03,$00

; 4x4 ordered (Bayer) thresholds 0..15, row-major (y row * 4 + x phase):
BAYER   DFB $00,$08,$02,$0A
        DFB $0C,$04,$0E,$06
        DFB $03,$0B,$01,$09
        DFB $0F,$07,$0D,$05
