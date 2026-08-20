; HGR mono screen dump -> ImageWriter II, SSC any slot (POKE 24580,n)
; Reads HGR page 1, transposes 8 scanlines into vertical 8-dot printer columns.

ACIABASE    EQU  $C088       ; SSC ACIA data register = $C088 + slot*16

YT          EQU  $06
TMP         EQU  $07
PTR         EQU  $08
HGRL        EQU  $0A
HGRH        EQU  $0B
BAND        EQU  $0C
BX          EQU  $0D
BITP        EQU  $0E
SM          EQU  $0F
PCOL        EQU  $10
LINE0       EQU  $11
SLOTOFF     EQU  $12         ; slot*16 -> X index into $C088 (computed at START)

            ORG  $6000

            JMP  START
; --- display page select.  POKE 24579,1 then CALL 24576 -> HGR PAGE 2 dump --
;   0 = page 1 ($2000-$3FFF, default)   1 = page 2 ($4000-$5FFF)
PAGE        DFB  $00
; --- SSC slot select.  POKE 24580,n -> dump out the SSC in slot n (1..7) ------
;   default 2 (SSC slot 2).  ACIA data register = $C088 + slot*16.
SLOT        DFB  $02
HBASE       DFB  $20         ; HGR base high byte, derived from PAGE at START

START       LDA  PAGE
            BEQ  HGP1
            LDA  #$40        ; page 2 -> base $4000
            BNE  HGPS
HGP1        LDA  #$20        ; page 1 -> base $2000
HGPS        STA  HBASE
            LDA  SLOT        ; SLOTOFF = slot*16 (X index to ACIA data reg)
            ASL
            ASL
            ASL
            ASL
            STA  SLOTOFF
            JSR  PRINIT
            LDA  #$00
            STA  BAND
BANDLP      JSR  SETBASE
            JSR  ESCG280
            LDA  #$00
            STA  BX
BXLP        JSR  READ8
            LDA  #$00
            STA  BITP
EMITP       LDX  BITP
            LDA  SMASK,X
            STA  SM
            LDA  #$00
            STA  PCOL
            LDX  #$00
TLOOP       LDA  ROWB,X
            AND  SM
            BEQ  TNO
            LDA  PCOL
            ORA  PBIT,X
            STA  PCOL
TNO         INX
            CPX  #$08
            BNE  TLOOP
            LDA  PCOL
            JSR  PUT
            INC  BITP
            LDA  BITP
            CMP  #$07
            BNE  EMITP
            INC  BX
            LDA  BX
            CMP  #$28
            BNE  BXLP
            LDA  #$0D
            JSR  PUT
            INC  BAND
            LDA  BAND
            CMP  #$18
            BNE  BANDLP
            RTS

SETBASE     LDA  BAND
            ASL
            ASL
            ASL
            STA  LINE0
            LDX  #$00
SBLP        TXA
            CLC
            ADC  LINE0
            JSR  HCALC
            LDA  HGRL
            STA  BASEL,X
            LDA  HGRH
            STA  BASEH,X
            INX
            CPX  #$08
            BNE  SBLP
            RTS

READ8       LDX  #$00
RD8LP       LDA  BASEL,X
            STA  PTR
            LDA  BASEH,X
            STA  PTR+1
            LDY  BX
            LDA  (PTR),Y
            STA  ROWB,X
            INX
            CPX  #$08
            BNE  RD8LP
            RTS

HCALC       STA  YT
            LDA  HBASE       ; $20 page 1 / $40 page 2
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

ESCG280     LDA  #$1B
            JSR  PUT
            LDA  #$47
            JSR  PUT
            LDA  #$30
            JSR  PUT
            LDA  #$32
            JSR  PUT
            LDA  #$38
            JSR  PUT
            LDA  #$30
            JSR  PUT
            RTS

PRINIT      LDA  #$1B
            JSR  PUT
            LDA  #$6E
            JSR  PUT
            LDA  #$1B
            JSR  PUT
            LDA  #$54
            JSR  PUT
            LDA  #$31
            JSR  PUT
            LDA  #$36
            JSR  PUT
            RTS

PUT         LDX  SLOTOFF
            STA  ACIABASE,X
            RTS

SMASK       DFB  $01,$02,$04,$08,$10,$20,$40
PBIT        DFB  $01,$02,$04,$08,$10,$20,$40,$80
ROWB        DFB  $00,$00,$00,$00,$00,$00,$00,$00
BASEL       DFB  $00,$00,$00,$00,$00,$00,$00,$00
BASEH       DFB  $00,$00,$00,$00,$00,$00,$00,$00
