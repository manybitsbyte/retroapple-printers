; ===========================================================================
; LO-RES KALEIDOSCOPE GENERATOR  (CALL 24576 / $6000)
;
; Fills the 40x48 single lo-res screen (page 1) with an XOR "munching squares"
; texture folded about the centre (20,24) -> 4-fold mirror symmetry, a
; kaleidoscope. colour(x,y) = (|x-20| EOR |y-24|) AND 15.  Single-lo-res cousin
; of dlr-kaleido.asm: a full 16-colour DESIGN (every hue appears, so the colour
; dump exercises every ribbon band and the BW dump every brightness), an
; alternative to the systematic LR.PLOT ramp -- the user picks which to draw.
;
; Each lo-res byte = two stacked cells: low nibble top row, high nibble bottom.
; BASCALC gives the page-1 line base; we write all 40 bytes of every text line.
; Page 1 only (the dump reads $0400-$07FF). Enables single lo-res on entry so
; the design shows as it draws.
; ===========================================================================

BASCALC EQU $FBC1        ; A = text line 0..23 -> BASL/BASH (page-1 base)
BASL    EQU $28

TL      EQU $06          ; text line 0..23
COL     EQU $07          ; column 0..39
YTOP    EQU $08          ; top lo-res row of this text line (= 2*TL)
FYTOP   EQU $09          ; |ytop-24|
FYBOT   EQU $0A          ; |ybot-24|
FX      EQU $0B          ; |x-20|
REFV    EQU $0C          ; fold reference passed to ABSDIFF
TMP     EQU $0D          ; scratch
TMPB    EQU $0E          ; assembled top nibble

TXTCLR    EQU $C050      ; graphics (TEXT off)
MIXCLR    EQU $C052      ; full screen (MIXED off)
TXTPAGE1  EQU $C054      ; display page 1
LORES     EQU $C056      ; lo-res (HIRES off)
CLR80VID  EQU $C00C      ; 40-column video
DHIRESOFF EQU $C05F      ; AN3 on -> double-res disabled (single lo-res)

        ORG $6000

; --- select single lo-res, page 1 -------------------------------------------
START   STA TXTCLR
        STA MIXCLR
        STA LORES
        STA CLR80VID
        STA DHIRESOFF
        STA TXTPAGE1

        LDA #$00
        STA TL

; --- one text line (a top/bottom lo-res row pair) ---------------------------
LINELP  LDA TL
        JSR BASCALC      ; -> BASL/BASH
        LDA TL
        ASL
        STA YTOP         ; ytop = 2*TL
; fold the two rows about y=24
        LDA #24
        STA REFV
        LDA YTOP
        JSR ABSDIFF
        STA FYTOP
        LDA YTOP
        CLC
        ADC #$01         ; ybot = ytop+1
        JSR ABSDIFF
        STA FYBOT
; columns fold about x=20
        LDA #20
        STA REFV
        LDA #$00
        STA COL
COLLP   LDA COL
        JSR ABSDIFF      ; FX = |COL-20|
        STA FX
        EOR FYTOP        ; top cell = (FX EOR FYTOP) AND 15
        AND #$0F
        STA TMPB
        LDA FX
        EOR FYBOT        ; bottom cell = (FX EOR FYBOT) AND 15
        AND #$0F
        ASL
        ASL
        ASL
        ASL              ; -> high nibble
        ORA TMPB
        LDY COL
        STA (BASL),Y
        INC COL
        LDA COL
        CMP #$28         ; 40 columns?
        BNE COLLP
        INC TL
        LDA TL
        CMP #$18         ; 24 text lines?
        BNE LINELP
        RTS

; --- ABSDIFF: A = |A - REFV| ------------------------------------------------
ABSDIFF CMP REFV
        BCS ADGE         ; A >= REFV
        STA TMP          ; A < REFV -> REFV - A
        LDA REFV
        SEC
        SBC TMP
        RTS
ADGE    SEC
        SBC REFV         ; A - REFV
        RTS
