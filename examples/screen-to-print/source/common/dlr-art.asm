; ===========================================================================
; DOUBLE-LORES KALEIDOSCOPE GENERATOR  (CALL 28672 / $7000)
;
; Fills the 80x48 double-lo-res screen with an XOR "munching squares" texture
; folded about the centre (40,24) -> 4-fold mirror symmetry, a kaleidoscope.
; colour(x,y) = (|x-40| EOR |y-24|) AND 15.
;
; Writes every cell so it also clears whatever was on screen. Aux cells store
; the colour rotated right one bit, so the //e video's left-rotate of bank 1
; lands the intended hue -- left/right halves match and the dump prints true.
;
; BASIC just enables double-lo-res then CALLs here; pixel math is far too slow
; in Applesoft for 3840 cells.
; ===========================================================================

BASCALC EQU $FBC1        ; A = text line 0..23 -> BASL/BASH
BASL    EQU $28

STORE80 EQU $C001        ; W: 80STORE on -> PAGE2 banks the $0400-$7FF window
PG2MAIN EQU $C054        ; PAGE2 off -> window = main RAM
PG2AUX  EQU $C055        ; PAGE2 on  -> window = aux RAM

TR      EQU $06          ; text row 0..23
FYT     EQU $08          ; |topY-24|
FYB     EQU $09          ; |botY-24|
FX      EQU $0A          ; |x-40|
COLT    EQU $0B          ; assembled top nibble
TMP     EQU $0C          ; scratch / byte to store

        ORG $7000

KSTART  STA STORE80      ; bank text window with PAGE2
        LDA #$00
        STA TR

KROW    LDA TR
        JSR BASCALC      ; BASL/BASH = base of this text row
        LDA TR
        ASL              ; topY = 2*TR
        JSR ABS24
        STA FYT
        LDA TR
        ASL
        CLC
        ADC #$01         ; botY = 2*TR+1
        JSR ABS24
        STA FYB

        LDY #$00
KCOL    ; ---- aux cell: x = 2*Y ----
        TYA
        ASL
        JSR ABS40
        STA FX
        EOR FYT
        AND #$0F
        JSR RR           ; aux: rotate colour right
        STA COLT
        LDA FX
        EOR FYB
        AND #$0F
        JSR RR
        ASL
        ASL
        ASL
        ASL              ; bottom nibble -> high
        ORA COLT
        STA TMP
        STA PG2AUX       ; select aux window
        LDA TMP
        STA (BASL),Y

        ; ---- main cell: x = 2*Y+1 ----
        TYA
        ASL
        CLC
        ADC #$01
        JSR ABS40
        STA FX
        EOR FYT
        AND #$0F
        STA COLT
        LDA FX
        EOR FYB
        AND #$0F
        ASL
        ASL
        ASL
        ASL
        ORA COLT
        STA TMP
        STA PG2MAIN      ; select main window
        LDA TMP
        STA (BASL),Y

        INY
        CPY #$28         ; 40 byte columns
        BNE KCOL

        INC TR
        LDA TR
        CMP #$18         ; 24 rows
        BNE KROW
        STA PG2MAIN      ; leave window on main
        RTS

; --- |A - 40| ---------------------------------------------------------------
ABS40   CMP #40
        BCS A40GE
        STA TMP
        LDA #40
        SEC
        SBC TMP
        RTS
A40GE   SEC
        SBC #40
        RTS

; --- |A - 24| ---------------------------------------------------------------
ABS24   CMP #24
        BCS A24GE
        STA TMP
        LDA #24
        SEC
        SBC TMP
        RTS
A24GE   SEC
        SBC #24
        RTS

; --- rotate a 4-bit colour right one bit: A = (A>>1) | ((A&1)<<3) ------------
RR      LSR
        BCC RROK
        ORA #$08
RROK    RTS
