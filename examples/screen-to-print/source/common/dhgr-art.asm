; ===========================================================================
; DHGR "SIERRA" SCENE  (CALL 24576 / $6000, or monitor 6000G)
;
; A King's-Quest-style backdrop drawn straight into Double Hi-Res, using the
; tricks period Sierra AGI/SCI art used to escape the blocky 140-wide colour
; grid: ORDERED DITHER for gradient skies and shading, and SLOPED silhouettes
; (diagonal path, triangular roofs and peaks) instead of stacked rectangles.
;
; Each scanline is built in a 560-dot BUF of single-dot cells; every primitive
; paints its span at px*4, then the row is packed back into aux/main HGR bytes
; via PAGE2 banking. 16 colours chosen so the colour dump maps each to a
; distinct ribbon hue.
;
; Primitive records (first byte = type, $FF ends the list):
;   0 RECT  x0,x1,y0,y1,col                 solid block        (6 bytes)
;   1 DRECT x0,x1,y0,y1,colA,colB           checker (x^y)&1    (7 bytes)
;   2 TRI   cx,ytop,ybot,halfbot,col        up triangle        (6 bytes)
;   3 TRAP  xlT,xrT,xlB,xrB,ytop,ybot,col   sloped-edge band   (8 bytes)
; ===========================================================================

TXTCLR      EQU  $C050
MIXCLR      EQU  $C052
HIRES       EQU  $C057
SET80V      EQU  $C00D
SET80S      EQU  $C001
SET80C      EQU  $C000       ; 80STORE off (page-2 path uses RAMWRT to bank $4000)
IOUDIS      EQU  $C07E
DHION       EQU  $C05E
PG2MAIN     EQU  $C054       ; 80STORE on: bank $2000 window main / off: display page 1
PG2AUX      EQU  $C055       ; 80STORE on: bank $2000 window aux  / off: display page 2
WRMAIN      EQU  $C004       ; RAMWRT off = write main  (page-2 banking)
WRAUX       EQU  $C005       ; RAMWRT on  = write aux   (page-2 banking)
BUF         EQU  $8000
YT          EQU  $06
TMP         EQU  $07
HGRL        EQU  $08
HGRH        EQU  $09
BUFP        EQU  $0A
RP          EQU  $0C
PX          EQU  $0E
DOTL        EQU  $10
DOTH        EQU  $11
KIDX        EQU  $12
ACC         EQU  $13
COL         EQU  $14
RX0         EQU  $15
RX1         EQU  $16
RY0         EQU  $17
RY1         EQU  $18
CB          EQU  $1C
LS          EQU  $1D
P           EQU  $1A
ZP          EQU  $1E
LE          EQU  $30
LH          EQU  $31
LT          EQU  $32
LV          EQU  $33
LACC        EQU  $34
LSGN        EQU  $35
XL          EQU  $37
XR          EQU  $38
CX          EQU  $39
YTOP        EQU  $3A
YBOT        EQU  $3B
HALFB       EQU  $3C
LDLT        EQU  $3D
RECLEN      EQU  $3E
CA          EQU  $3F
            ORG  $6000
            JMP  START
PAGE        DFB  $00         ; $6003 POKE 24579: 0 = page 1 ($2000), 1 = page 2 ($4000)
PGHI        DFB  $20         ; $6004 scene base high, derived from PAGE at START
; --- scene primitives (x 0-139 cell, y 0-191) ---
; Drawn the AGI way: flat fills BOUNDED by black outlines + 1-dot line detail
; (stone courses, mullioned windows, planked door, conical roofs w/ finials,
; bark, hill ridge), with ordered dither for skies/shading/foliage. col $00 as
; a 1-cell-thick RECT = a clean black pen stroke.
RECTS
; --- sky: dithered vertical gradient ---
            DFB  $01,$00,$8B,$00,$0E,$0B,$03
            DFB  $01,$00,$8B,$0F,$1C,$03,$0B
            DFB  $00,$00,$8B,$1D,$2C,$03
            DFB  $01,$00,$8B,$2D,$3A,$03,$0F
            DFB  $01,$00,$8B,$3B,$45,$0F,$03
; --- clouds: flat base + staggered round bumps (puffy, not a box) ---
            DFB  $01,$0E,$22,$0F,$11,$0F,$0B
            DFB  $01,$10,$18,$0C,$10,$0F,$0B
            DFB  $01,$16,$20,$0A,$10,$0F,$0B
            DFB  $01,$1E,$24,$0D,$10,$0F,$0B
            DFB  $01,$5C,$74,$17,$19,$0F,$0B
            DFB  $01,$5E,$66,$14,$18,$0F,$0B
            DFB  $01,$63,$6D,$12,$18,$0F,$0B
            DFB  $01,$6B,$73,$15,$18,$0F,$0B
; --- sun ---
            DFB  $00,$64,$70,$08,$14,$0C
            DFB  $00,$62,$72,$0B,$11,$0C
            DFB  $00,$66,$6E,$06,$16,$0C
; --- distant dithered hills flanking the castle ---
            DFB  $02,$16,$34,$46,$16,$02
            DFB  $02,$76,$32,$46,$18,$02
            DFB  $01,$00,$2C,$3C,$46,$02,$06
            DFB  $01,$60,$8B,$3A,$46,$02,$06
; --- horizon pen line + dithered grass + solid foreground ---
            DFB  $00,$00,$8B,$46,$47,$00
            DFB  $01,$00,$8B,$48,$76,$06,$02
            DFB  $00,$00,$8B,$77,$BF,$06
            DFB  $01,$08,$1E,$96,$A0,$06,$02
            DFB  $01,$6C,$82,$8C,$96,$06,$02
; --- path: black-outlined yellow trapezoid (perspective) ---
            DFB  $03,$40,$4B,$26,$66,$48,$BF,$00
            DFB  $03,$42,$49,$2A,$62,$48,$BF,$0E
; --- castle body + towers (outline then grey fill) ---
            DFB  $00,$32,$5A,$20,$48,$00
            DFB  $00,$33,$59,$21,$48,$05
            DFB  $00,$2C,$34,$1A,$48,$00
            DFB  $00,$2D,$33,$1B,$48,$05
            DFB  $00,$58,$60,$1A,$48,$00
            DFB  $00,$59,$5F,$1B,$48,$05
; --- shaded right edge of each tower (dither grey/black) ---
            DFB  $01,$31,$33,$1D,$48,$05,$00
            DFB  $01,$5D,$5F,$1D,$48,$05,$00
; --- stone courses (black pen lines across body + towers) ---
            DFB  $00,$33,$59,$28,$28,$00
            DFB  $00,$33,$59,$30,$30,$00
            DFB  $00,$33,$59,$38,$38,$00
            DFB  $00,$33,$59,$40,$40,$00
            DFB  $00,$2D,$33,$28,$28,$00
            DFB  $00,$2D,$33,$34,$34,$00
            DFB  $00,$2D,$33,$40,$40,$00
            DFB  $00,$59,$5F,$28,$28,$00
            DFB  $00,$59,$5F,$34,$34,$00
            DFB  $00,$59,$5F,$40,$40,$00
; --- conical roofs (outline, magenta fill, finial) ---
            DFB  $02,$46,$12,$21,$14,$00
            DFB  $02,$46,$14,$21,$12,$08
            DFB  $02,$30,$10,$1B,$08,$00
            DFB  $02,$30,$12,$1B,$06,$08
            DFB  $00,$2F,$31,$0C,$10,$00
            DFB  $02,$5C,$10,$1B,$08,$00
            DFB  $02,$5C,$12,$1B,$06,$08
            DFB  $00,$5B,$5D,$0C,$10,$00
; --- mullioned windows (frame, glass, cross bars) ---
            DFB  $00,$37,$3C,$2C,$34,$00
            DFB  $00,$38,$3B,$2D,$33,$03
            DFB  $00,$39,$3A,$2D,$33,$00
            DFB  $00,$38,$3B,$30,$30,$00
            DFB  $00,$4F,$54,$2C,$34,$00
            DFB  $00,$50,$53,$2D,$33,$03
            DFB  $00,$51,$52,$2D,$33,$00
            DFB  $00,$50,$53,$30,$30,$00
            DFB  $00,$42,$49,$28,$2E,$00
            DFB  $00,$43,$48,$29,$2D,$0E
            DFB  $00,$45,$46,$29,$2D,$00
; --- planked arch door ---
            DFB  $00,$3E,$4E,$38,$48,$00
            DFB  $00,$40,$4C,$39,$48,$01
            DFB  $00,$43,$43,$3A,$48,$00
            DFB  $00,$46,$46,$3A,$48,$00
            DFB  $00,$49,$49,$3A,$48,$00
; --- tree: rounded outlined canopy (dappled) over a dithered-dark trunk ---
            DFB  $00,$06,$16,$38,$3C,$00
            DFB  $00,$02,$1A,$3C,$56,$00
            DFB  $00,$06,$16,$56,$5C,$00
            DFB  $01,$07,$15,$39,$3B,$02,$06
            DFB  $01,$03,$19,$3D,$55,$06,$02
            DFB  $01,$07,$15,$57,$5B,$02,$06
            DFB  $01,$05,$0D,$40,$4A,$06,$0F
            DFB  $01,$0E,$18,$4E,$56,$02,$00
            DFB  $00,$0B,$11,$5A,$82,$00
            DFB  $01,$0C,$10,$5B,$81,$08,$00
; --- bush ---
            DFB  $00,$64,$7C,$68,$78,$00
            DFB  $01,$65,$7B,$69,$77,$06,$02
            DFB  $01,$68,$72,$6C,$72,$02,$00
            DFB  $FF
BITT        DFB  $01,$02,$04,$08,$10,$20,$40
START       LDA  PAGE
            BEQ  STP1
            LDA  #$40        ; page 2 -> base $4000
            BNE  STPS
STP1        LDA  #$20        ; page 1 -> base $2000
STPS        STA  PGHI
            JSR  ENABLE
            JSR  CLRSCR
            LDA  #$00
            STA  YT
ROWLP       LDA  YT
            JSR  HCALC
            JSR  CLRBUF
            JSR  DRAWROW
            JSR  PACKAUX
            JSR  PACKMAIN
            INC  YT
            LDA  YT
            CMP  #$C0
            BNE  ROWLP
            RTS
; PAGE picks BOTH the draw target and the displayed page.  Page 1 uses the
; classic 80STORE+PAGE2 window banking of $2000; page 2 turns 80STORE OFF and
; banks $4000 with RAMWRT, PAGE2 ($C055) now selecting the DISPLAY page -- the
; scene is drawn straight into $4000 aux+main and shown live, so a page-2 dump
; needs NO copy-from-page-1 and NO poisoning of $2000.
ENABLE      STA  TXTCLR
            STA  MIXCLR
            STA  HIRES
            STA  SET80V      ; 80COL on
            STA  IOUDIS      ; IOU disable -> $C05E/$C05F are DHIRES, not AN3
            STA  DHION       ; double hi-res on
            LDA  PAGE
            BNE  ENAP2
            STA  SET80S      ; page 1: 80STORE ON (PAGE2 banks the $2000 window)
            STA  PG2MAIN     ;         display page 1
            RTS
ENAP2       STA  SET80C      ; page 2: 80STORE OFF (RAMWRT banks $4000)
            STA  PG2AUX      ;         PAGE2 -> display page 2 ($4000)
            RTS
CLRSCR      LDA  PAGE
            BNE  CLRP2
            STA  PG2MAIN     ; page 1: bank $2000 window -> main
            JSR  ZAP
            STA  PG2AUX      ;         -> aux
            JSR  ZAP
            STA  PG2MAIN     ;         back to main
            RTS
CLRP2       STA  WRMAIN      ; page 2: RAMWRT main -> clear $4000 main
            JSR  ZAP
            STA  WRAUX       ;         RAMWRT aux  -> clear $4000 aux
            JSR  ZAP
            STA  WRMAIN      ;         restore write-main (BUF writes hit main)
            RTS
ZAP         LDA  #$00
            STA  ZP
            LDA  PGHI        ; $20 page 1 / $40 page 2
            STA  ZP+1
            LDX  #$20
            LDY  #$00
ZAP1        LDA  #$00
            STA  (ZP),Y
            INY
            BNE  ZAP1
            INC  ZP+1
            DEX
            BNE  ZAP1
            RTS
CLRBUF      LDA  #$00
            STA  BUFP
            LDA  #$80
            STA  BUFP+1
            LDX  #$03
            LDY  #$00
CB1         LDA  #$00
            STA  (BUFP),Y
            INY
            BNE  CB1
            INC  BUFP+1
            DEX
            BNE  CB1
            RTS
; --- per-row primitive rasteriser -------------------------------------------
DRAWROW     LDA  #$05        ; RECTS at $6005 (after JMP + PAGE + PGHI)
            STA  RP
            LDA  #$60
            STA  RP+1
DR1         LDY  #$00
            LDA  (RP),Y
            CMP  #$FF
            BNE  DR1A
            RTS
DR1A        CMP  #$00
            BNE  DR1B
            JMP  DRECT0
DR1B        CMP  #$01
            BNE  DR1C
            JMP  DDITH
DR1C        CMP  #$02
            BNE  DR1D
            JMP  DTRI
DR1D        JMP  DTRAP
ADV         LDA  RP
            CLC
            ADC  RECLEN
            STA  RP
            BCC  ADVX
            INC  RP+1
ADVX        JMP  DR1
; -- type 0: solid rect --
DRECT0      LDA  #$06
            STA  RECLEN
            LDY  #$03
            LDA  (RP),Y
            STA  RY0
            LDY  #$04
            LDA  (RP),Y
            STA  RY1
            LDA  YT
            CMP  RY0
            BCC  RSK
            LDA  RY1
            CMP  YT
            BCC  RSK
            LDY  #$01
            LDA  (RP),Y
            STA  RX0
            LDY  #$02
            LDA  (RP),Y
            STA  RX1
            LDY  #$05
            LDA  (RP),Y
            STA  COL
            LDA  RX0
            STA  PX
RECTF       JSR  PUTCELL
            LDA  PX
            CMP  RX1
            BEQ  RSK
            INC  PX
            JMP  RECTF
RSK         JMP  ADV
; -- type 1: dithered rect (checker on (x^y)&1) --
DDITH       LDA  #$07
            STA  RECLEN
            LDY  #$03
            LDA  (RP),Y
            STA  RY0
            LDY  #$04
            LDA  (RP),Y
            STA  RY1
            LDA  YT
            CMP  RY0
            BCC  DSK
            LDA  RY1
            CMP  YT
            BCC  DSK
            LDY  #$01
            LDA  (RP),Y
            STA  RX0
            LDY  #$02
            LDA  (RP),Y
            STA  RX1
            LDY  #$05
            LDA  (RP),Y
            STA  CA
            LDY  #$06
            LDA  (RP),Y
            STA  CB
            LDA  RX0
            STA  PX
DITF        LDA  PX
            EOR  YT
            AND  #$01
            BEQ  DITA
            LDA  CB
            JMP  DITP
DITA        LDA  CA
DITP        STA  COL
            JSR  PUTCELL
            LDA  PX
            CMP  RX1
            BEQ  DSK
            INC  PX
            JMP  DITF
DSK         JMP  ADV
; -- type 2: up triangle, half-width grows to halfbot at ybot --
DTRI        LDA  #$06
            STA  RECLEN
            LDY  #$02
            LDA  (RP),Y
            STA  YTOP
            LDY  #$03
            LDA  (RP),Y
            STA  YBOT
            LDA  YT
            CMP  YTOP
            BCC  TSK
            LDA  YBOT
            CMP  YT
            BCC  TSK
            LDY  #$01
            LDA  (RP),Y
            STA  CX
            LDY  #$04
            LDA  (RP),Y
            STA  HALFB
            LDY  #$05
            LDA  (RP),Y
            STA  COL
            LDA  #$00
            STA  LS
            LDA  HALFB
            STA  LE
            LDA  YBOT
            SEC
            SBC  YTOP
            STA  LH
            LDA  YT
            SEC
            SBC  YTOP
            STA  LT
            JSR  LERP
            LDA  CX
            SEC
            SBC  LV
            BCS  TRIL1
            LDA  #$00
TRIL1       STA  XL
            LDA  CX
            CLC
            ADC  LV
            CMP  #$8C
            BCC  TRIR1
            LDA  #$8B
TRIR1       STA  XR
            LDA  XL
            STA  PX
TRIF        JSR  PUTCELL
            LDA  PX
            CMP  XR
            BEQ  TSK
            INC  PX
            JMP  TRIF
TSK         JMP  ADV
; -- type 3: trapezoid, both edges lerped from top row to bottom row --
DTRAP       LDA  #$08
            STA  RECLEN
            LDY  #$05
            LDA  (RP),Y
            STA  YTOP
            LDY  #$06
            LDA  (RP),Y
            STA  YBOT
            LDA  YT
            CMP  YTOP
            BCC  PSK
            LDA  YBOT
            CMP  YT
            BCC  PSK
            LDA  YBOT
            SEC
            SBC  YTOP
            STA  LH
            LDA  YT
            SEC
            SBC  YTOP
            STA  LT
            LDY  #$01
            LDA  (RP),Y
            STA  LS
            LDY  #$03
            LDA  (RP),Y
            STA  LE
            JSR  LERP
            LDA  LV
            STA  XL
            LDY  #$02
            LDA  (RP),Y
            STA  LS
            LDY  #$04
            LDA  (RP),Y
            STA  LE
            JSR  LERP
            LDA  LV
            STA  XR
            LDY  #$07
            LDA  (RP),Y
            STA  COL
            LDA  XL
            STA  PX
TRAPF       JSR  PUTCELL
            LDA  PX
            CMP  XR
            BEQ  PSK
            INC  PX
            JMP  TRAPF
PSK         JMP  ADV
; -- LERP: LV = LS + (LE-LS)*LT/LH  (sign-aware, no divide) --
LERP        LDA  LS
            STA  LV
            LDA  LE
            SEC
            SBC  LS
            BCS  LRPPOS
            EOR  #$FF
            CLC
            ADC  #$01
            STA  LDLT
            LDA  #$FF
            STA  LSGN
            JMP  LRPGO
LRPPOS      STA  LDLT
            LDA  #$01
            STA  LSGN
LRPGO       LDA  #$00
            STA  LACC
            LDX  LT
            BEQ  LRPDN
LRPL        LDA  LACC
            CLC
            ADC  LDLT
            STA  LACC
LRPW        LDA  LACC
            CMP  LH
            BCC  LRPNX
            SEC
            SBC  LH
            STA  LACC
            LDA  LSGN
            BMI  LRPDEC
            INC  LV
            JMP  LRPW
LRPDEC      DEC  LV
            JMP  LRPW
LRPNX       DEX
            BNE  LRPL
LRPDN       RTS
; --- shared cell + pack engine (unchanged) ----------------------------------
PUTCELL     LDA  PX
            ASL
            STA  DOTL
            LDA  #$00
            ROL
            STA  DOTH
            ASL  DOTL
            ROL  DOTH
            LDA  DOTL
            STA  P
            LDA  #$80
            CLC
            ADC  DOTH
            STA  P+1
            LDA  COL
            AND  #$01
            LDY  #$00
            STA  (P),Y
            LDA  COL
            LSR
            AND  #$01
            LDY  #$01
            STA  (P),Y
            LDA  COL
            LSR
            LSR
            AND  #$01
            LDY  #$02
            STA  (P),Y
            LDA  COL
            LSR
            LSR
            LSR
            AND  #$01
            LDY  #$03
            STA  (P),Y
            RTS
PACKAUX     LDA  PAGE
            BNE  PAXP2
            STA  PG2AUX      ; page 1: 80STORE window -> aux
            JMP  PAXGO
PAXP2       STA  WRAUX       ; page 2: RAMWRT aux -> writes hit $4000 aux
PAXGO       LDA  #$00
            STA  DOTL
            STA  DOTH
            STA  KIDX
PA1         JSR  COLLECT
            LDY  KIDX
            LDA  ACC
            STA  (HGRL),Y
            LDA  DOTL
            CLC
            ADC  #$0E
            STA  DOTL
            BCC  PA2
            INC  DOTH
PA2         INC  KIDX
            LDA  KIDX
            CMP  #$28
            BNE  PA1
            LDA  PAGE
            BEQ  PAXRET
            STA  WRMAIN      ; page 2: restore write-main so BUF writes stay main
PAXRET      RTS
PACKMAIN    LDA  PAGE
            BNE  PMP2
            STA  PG2MAIN     ; page 1: 80STORE window -> main
            JMP  PMGO
PMP2        STA  WRMAIN      ; page 2: RAMWRT main -> writes hit $4000 main
PMGO        LDA  #$07
            STA  DOTL
            LDA  #$00
            STA  DOTH
            STA  KIDX
PM1         JSR  COLLECT
            LDY  KIDX
            LDA  ACC
            STA  (HGRL),Y
            LDA  DOTL
            CLC
            ADC  #$0E
            STA  DOTL
            BCC  PM2
            INC  DOTH
PM2         INC  KIDX
            LDA  KIDX
            CMP  #$28
            BNE  PM1
            RTS
COLLECT     LDA  DOTL
            STA  P
            LDA  #$80
            CLC
            ADC  DOTH
            STA  P+1
            LDA  #$00
            STA  ACC
            LDY  #$00
CO1         LDA  (P),Y
            BEQ  CO2
            LDA  ACC
            ORA  BITT,Y
            STA  ACC
CO2         INY
            CPY  #$07
            BNE  CO1
            RTS
HCALC       STA  YT
            LDA  PGHI        ; $20 page 1 / $40 page 2
            STA  HGRH
            LDA  #$00
            STA  HGRL
            LDA  YT
            AND  #$07
            ASL
            ASL
            CLC
            ADC  HGRH
            STA  HGRH
            LDA  YT
            LSR
            LSR
            LSR
            AND  #$07
            STA  TMP
            LSR
            CLC
            ADC  HGRH
            STA  HGRH
            LDA  TMP
            AND  #$01
            BEQ  HC1
            LDA  HGRL
            ORA  #$80
            STA  HGRL
HC1         LDA  YT
            LSR
            LSR
            LSR
            LSR
            LSR
            LSR
            STA  TMP
            BEQ  HC3
HC2         LDA  HGRL
            CLC
            ADC  #$28
            STA  HGRL
            BCC  HC2A
            INC  HGRH
HC2A        DEC  TMP
            BNE  HC2
HC3         RTS
