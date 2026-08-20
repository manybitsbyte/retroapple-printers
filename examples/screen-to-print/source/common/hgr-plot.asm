; ===========================================================================
; HIRES (HGR) PLOT TEST-PATTERN  ->  page 1 OR page 2, fully relocatable
;
; Lays down a 280x192 hi-res test screen by hand (direct RAM stores, no
; firmware HPLOT) for the HGR screen-dump tests. Companion to
; imagewriter-ii-hgr-print-bw.asm, which prints the screen this routine draws.
;
; --- HGR MEMORY ORDER --------------------------------------------------------
; The 192 hi-res lines are NOT stored linearly. Line L lives at
;   base(L) = PAGE + (L AND 7)*$400 + ((L>>3) AND 7)*$80 + (L>>6)*$28
; (the classic triple-interleave); PAGE = $2000 (page 1) or $4000 (page 2).
; Each of the 40 bytes on a line packs SEVEN horizontal pixels in bits 0..6
; (bit 0 leftmost); bit 7 is the colour/half-shift bit, ignored by a BW dump.
; This routine computes base(L) directly so it needs no monitor entry.
;
; --- THE PATTERN -------------------------------------------------------------
; Orientation is unambiguous so a printed page reveals any flip/mirror:
;   * top 8 lines   -> solid bar  ("this edge is the TOP")
;   * left byte col -> solid bar  ("this edge is the LEFT")
;   * body          -> 7px x 8px checkerboard of white ($7F) / black ($00)
; All bytes use bit7=0, so on a colour monitor the white blocks artifact to
; green/violet; the dump only cares about the dot pattern, so BW is exact.
;
; --- PAGE (POKE before CALL) -------------------------------------------------
;   POKE 9,0 : CALL <load addr>   -> fill HGR PAGE 1 ($2000-$3FFF, default)
;   POKE 9,1 : CALL <load addr>   -> fill HGR PAGE 2 ($4000-$5FFF)
;
; On entry the routine selects the hi-res display and the page given by PGSEL,
; so the pattern is visible as it is drawn; otherwise it only writes graphics
; RAM, and the dump reads that RAM.
;
; POSITION-INDEPENDENT: no absolute reference to its own code. The per-line
; loop body exceeds a relative branch's reach, so the loop-back is a relocatable
; RTS long-jump: self-locate via the monitor known-RTS ($FF58), then push a
; run-time pointer (ROWVEC) and RTS to it. The only absolute operands are FIXED
; locations that never move with the code: known-RTS ($FF58), the stack page
; ($0100,X) and the display soft switches. Runs unchanged at any load address.
; ===========================================================================

KNOWNRTS EQU $FF58       ; monitor's fixed "known RTS" -- JSR here to read our PC

LINE    EQU $06          ; current hi-res line 0..191
PGSEL   EQU $09          ; page select: 0 = page 1, 1 = page 2 (POKE before CALL)
HBASE   EQU $1A          ; (2) computed base address of the current line
HPAGE   EQU $1C          ; high byte of the page base: $20 or $40
TMP     EQU $1D          ; scratch
ROWBIT  EQU $1E          ; checker phase for the current line (0/1) + scratch
SELF    EQU $0E          ; (2) run-time base = address of ANCHOR-1
ROWVEC  EQU $10          ; (2) run-time (LINELP-1) for the line RTS long back-jump

TXTCLR    EQU $C050      ; graphics (TEXT off)
MIXCLR    EQU $C052      ; full screen (MIXED off)
TXTPAGE1  EQU $C054      ; display page 1
TXTPAGE2  EQU $C055      ; display page 2
HIRES     EQU $C057      ; hi-res (HIRES on)
CLR80VID  EQU $C00C      ; 40-column video

        ORG $6000        ; default build address only -- code is relocatable

; --- select the hi-res display ----------------------------------------------
; Switch the screen to full-screen hi-res and the page given by PGSEL, and set
; HPAGE (the RAM page high byte) to match. All operands are FIXED I/O switches.
        STA TXTCLR       ; graphics (TEXT off)
        STA MIXCLR       ; full screen (MIXED off)
        STA HIRES        ; hi-res on
        STA CLR80VID     ; 40-column video
        LDA PGSEL
        BNE DPG2
        STA TXTPAGE1     ; PGSEL 0 -> display page 1 (A=0, value ignored)
        LDA #$20
        BNE SETHP        ; always (A=$20)
DPG2    STA TXTPAGE2     ; PGSEL!=0 -> display page 2
        LDA #$40
SETHP   STA HPAGE

; --- self-locate (position-independent) --------------------------------------
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

        LDA #$00
        STA LINE

; --- compute base(LINE) and fill its 40 bytes -------------------------------
LINELP  LDA #$00
        STA HBASE
; high byte = (LINE AND 7) * 4   ($400 per scan step)
        LDA LINE
        AND #$07
        ASL
        ASL
        STA HBASE+1
; add ((LINE>>3) AND 7) * $80
        LDA LINE
        LSR
        LSR
        LSR
        AND #$07
        LSR              ; carry = sub bit0, A = sub>>1
        PHP
        CLC
        ADC HBASE+1
        STA HBASE+1      ; high += sub>>1
        PLP
        BCC NOLO
        LDA #$80
        STA HBASE        ; low = $80 when sub is odd
NOLO    LDA LINE
        LSR
        LSR
        LSR
        LSR
        LSR
        LSR              ; A = LINE>>6  (group 0..2)
        AND #$03
        STA TMP          ; TMP = group
        ASL
        ASL
        ASL              ; group*8
        STA ROWBIT       ; (scratch)
        LDA TMP
        ASL
        ASL
        ASL
        ASL
        ASL              ; group*32
        CLC
        ADC ROWBIT       ; group*40
        CLC
        ADC HBASE
        STA HBASE
        BCC NOC
        INC HBASE+1
NOC     LDA HBASE+1
        CLC
        ADC HPAGE        ; + page base high ($20 / $40)
        STA HBASE+1

; checker phase for this line = (LINE AND 8) -> 0 or 1
        LDA LINE
        AND #$08
        BEQ STORB        ; A = 0 when bit clear
        LDA #$01
STORB   STA ROWBIT

; --- fill 40 bytes ----------------------------------------------------------
        LDY #$00
FILL    LDA LINE
        CMP #$08
        BCC SOLID        ; LINE < 8 -> top bar, solid
        CPY #$00
        BEQ SOLID        ; left byte column -> solid
        TYA
        AND #$01
        EOR ROWBIT       ; checker: rowbit XOR (col bit0)
        BEQ BLANK        ; == 0 -> black
SOLID   LDA #$7F         ; 7 pixels on
        BNE PUT          ; always (A=$7F)
BLANK   LDA #$00
PUT     STA (HBASE),Y
        INY
        CPY #$28         ; 40 bytes?
        BNE FILL

        INC LINE
        LDA LINE
        CMP #$C0         ; 192 lines done?
        BEQ DONE
        LDA ROWVEC+1     ; else long back-jump to LINELP, relocatably
        PHA
        LDA ROWVEC
        PHA
        RTS
DONE    RTS
