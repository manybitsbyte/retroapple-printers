; HGR colour screen dump -> ImageWriter II.  6-hue classify + per-colour
; overprint passes.  Aspect + page + slot are all run-time selectable:
;   MODEB ($6003 POKE 24579): horiz density 0=72 1=80 2=96 3=160 dpi
;                             (560-dot stream fixed, only column pitch changes)
;   YDBL  ($6004 POKE 24580): 1 = 2x tall (each band -> 2 row-doubled sub-bands)
;   PAGE  ($6005 POKE 24581): 0 = page 1 ($2000)   1 = page 2 ($4000)
;   SLOT  ($6006 POKE 24582): SSC slot 1..7 (default 2); ACIA = $C088 + slot*16
; HGR's 280 dots are pixel-doubled to 560 so the printed widths match the DHGR
; dump: 72/80/96/160 dpi -> 7.78 / 7.00 / 5.83 / 3.50" (160 ~= 4:3 corrected).
ACIABASE    EQU  $C088       ; SSC ACIA data register = $C088 + slot*16
CLS         EQU  $8000
LIT         EQU  $9000
YT          EQU  $06
TMP         EQU  $07
PTR         EQU  $08
HGRL        EQU  $0A
HGRH        EQU  $0B
BAND        EQU  $0C
ROW         EQU  $0D
XLO         EQU  $0E
XHI         EQU  $0F
CLSP        EQU  $10
BYTE        EQU  $12
BYTEIDX     EQU  $13
LITP        EQU  $14
PASS        EQU  $16
PCOL        EQU  $17
CUR         EQU  $18
T2          EQU  $1A
PIDX        EQU  $1C
LINE0       EQU  $1D
SLOTOFF     EQU  $1E         ; slot*16 -> X index into $C088 (computed at START)
HALF        EQU  $1F         ; YDBL sub-band source-row offset (0 or 4)
SRCP        EQU  $20         ; class source pointer (CLSP + remapped row)
PINSV       EQU  $22         ; saved output pin during YDBL row remap
            ORG  $6000
            JMP  START
MODEB       DFB  $00         ; POKE 24579: horiz density 0..3 (DENS index)
YDBL        DFB  $00         ; POKE 24580: 1 = double height
PAGE        DFB  $00         ; POKE 24581: 1 = HGR page 2
SLOT        DFB  $02         ; POKE 24582: SSC slot, ACIA = $C088 + slot*16
HBASE       DFB  $20         ; HGR base high byte, derived from PAGE at START
DENS        DFB  $6E,$4E,$45,$50   ; ESC n/N/E/P = 72/80/96/160 dpi
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
MB1         JSR  SETBASE
            JSR  CLSBAND
            LDA  YDBL
            BNE  MBYD
            LDA  #$00
            STA  HALF
            JSR  DOPASS5
            JMP  MBADV
MBYD        LDA  #$00
            STA  HALF
            JSR  DOPASS5
            LDA  #$04
            STA  HALF
            JSR  DOPASS5
MBADV       INC  BAND
            LDA  BAND
            CMP  #$18
            BNE  MB1
            RTS
DOPASS5     LDX  #$00
            STX  PIDX
MP1         LDX  PIDX
            LDA  CLASSV,X
            STA  PASS
            JSR  PASSHDR
            JSR  EMITPASS
            INC  PIDX
            LDA  PIDX
            CMP  #$05
            BNE  MP1
            LDA  #$0D
            JSR  PUT
            RTS
PASSHDR     LDA  #$1B
            JSR  PUT
            LDA  #$46
            JSR  PUT
            LDA  #$30
            JSR  PUT
            JSR  PUT
            JSR  PUT
            JSR  PUT
            LDA  #$1B
            JSR  PUT
            LDA  #$4B
            JSR  PUT
            LDX  PIDX
            LDA  ESCKV,X
            ORA  #$30
            JSR  PUT
            LDA  #$1B
            JSR  PUT
            LDA  #$47
            JSR  PUT
            LDA  #$30
            JSR  PUT
            LDA  #$35
            JSR  PUT
            LDA  #$36
            JSR  PUT
            LDA  #$30
            JSR  PUT
            RTS
EMITPASS    LDA  #$00
            STA  CLSP
            LDA  #$80
            STA  CLSP+1
            LDA  #$00
            STA  XLO
            STA  XHI
EP1         LDA  #$00
            STA  PCOL
            LDY  #$00
EP2         LDA  YDBL
            BEQ  EPDIR
            TYA
            LSR
            CLC
            ADC  HALF
            JMP  EPADD
EPDIR       TYA
EPADD       CLC
            ADC  CLSP
            STA  SRCP
            LDA  CLSP+1
            ADC  #$00
            STA  SRCP+1
            STY  PINSV
            LDY  #$00
            LDA  (SRCP),Y
            LDY  PINSV
            CMP  PASS
            BNE  EP3
            LDA  PCOL
            ORA  PBIT,Y
            STA  PCOL
EP3         INY
            CPY  #$08
            BNE  EP2
            LDA  PCOL
            JSR  PUT
            JSR  PUT
            LDA  CLSP
            CLC
            ADC  #$08
            STA  CLSP
            BCC  EP4
            INC  CLSP+1
EP4         INC  XLO
            BNE  EP5
            INC  XHI
EP5         LDA  XHI
            CMP  #$01
            BNE  EP1
            LDA  XLO
            CMP  #$18
            BEQ  EPDONE
            JMP  EP1
EPDONE      RTS
CLSBAND     LDX  #$00
CB1         STX  ROW
            LDA  BASEL,X
            STA  PTR
            LDA  BASEH,X
            STA  PTR+1
            JSR  CLROW
            LDX  ROW
            INX
            CPX  #$08
            BNE  CB1
            RTS
CLROW       LDA  #$00
            STA  LITP
            LDA  #$90
            STA  LITP+1
            LDA  #$00
            STA  BYTEIDX
PA1         LDY  BYTEIDX
            LDA  (PTR),Y
            STA  BYTE
            AND  #$80
            STA  TMP
            LDX  #$00
PA2         LDA  BYTE
            AND  SMASK,X
            BEQ  PA3
            LDA  #$01
            ORA  TMP
            JMP  PA3B
PA3         LDA  #$00
PA3B        LDY  #$00
            STA  (LITP),Y
            INC  LITP
            BNE  PA4
            INC  LITP+1
PA4         INX
            CPX  #$07
            BNE  PA2
            INC  BYTEIDX
            LDA  BYTEIDX
            CMP  #$28
            BNE  PA1
            LDA  #$00
            STA  LITP
            LDA  #$90
            STA  LITP+1
            LDA  #$00
            CLC
            ADC  ROW
            STA  CLSP
            LDA  #$80
            ADC  #$00
            STA  CLSP+1
            LDA  #$00
            STA  XLO
            STA  XHI
PB1         LDY  #$00
            LDA  (LITP),Y
            STA  CUR
            AND  #$01
            BNE  PBLIT
            LDA  #$00
            JMP  PBSTORE
PBLIT       LDA  XLO
            ORA  XHI
            BEQ  PBNL
            LDA  LITP
            SEC
            SBC  #$01
            STA  T2
            LDA  LITP+1
            SBC  #$00
            STA  T2+1
            LDY  #$00
            LDA  (T2),Y
            AND  #$01
            BNE  PBWHITE
PBNL        LDA  XHI
            CMP  #$01
            BNE  PBRR
            LDA  XLO
            CMP  #$17
            BEQ  PBART
PBRR        LDA  LITP
            CLC
            ADC  #$01
            STA  T2
            LDA  LITP+1
            ADC  #$00
            STA  T2+1
            LDY  #$00
            LDA  (T2),Y
            AND  #$01
            BNE  PBWHITE
PBART       LDA  CUR
            AND  #$80
            BNE  PBP1
            LDA  XLO
            AND  #$01
            BNE  PBP0O
            LDA  #$03
            JMP  PBSTORE
PBP0O       LDA  #$02
            JMP  PBSTORE
PBP1        LDA  XLO
            AND  #$01
            BNE  PBP1O
            LDA  #$04
            JMP  PBSTORE
PBP1O       LDA  #$05
            JMP  PBSTORE
PBWHITE     LDA  #$01
PBSTORE     LDY  #$00
            STA  (CLSP),Y
            LDA  CLSP
            CLC
            ADC  #$08
            STA  CLSP
            BCC  PBA
            INC  CLSP+1
PBA         INC  LITP
            BNE  PBB
            INC  LITP+1
PBB         INC  XLO
            BNE  PBC
            INC  XHI
PBC         LDA  XHI
            CMP  #$01
            BNE  PBNX
            LDA  XLO
            CMP  #$18
            BEQ  PBDONE
PBNX        JMP  PB1
PBDONE      RTS
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
PRINIT      LDA  #$1B
            JSR  PUT
            LDX  MODEB
            LDA  DENS,X
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
CLASSV      DFB  $00,$02,$03,$04,$05
ESCKV       DFB  $00,$05,$06,$03,$04
SMASK       DFB  $01,$02,$04,$08,$10,$20,$40
PBIT        DFB  $01,$02,$04,$08,$10,$20,$40,$80
BASEL       DFB  $00,$00,$00,$00,$00,$00,$00,$00
BASEH       DFB  $00,$00,$00,$00,$00,$00,$00,$00
