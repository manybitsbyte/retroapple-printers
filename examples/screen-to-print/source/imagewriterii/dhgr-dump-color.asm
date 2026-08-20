ACIABASE    EQU  $C088       ; SSC ACIA data = $C088 + slot*16 (SLOT @24582)
SET80S      EQU  $C001
SET80C      EQU  $C000      ; 80STORE off (page-2 path: let RAMRD reach $4000)
HIRES       EQU  $C057
PG2MAIN     EQU  $C054
PG2AUX      EQU  $C055
RAMRDA      EQU  $C003      ; read aux  $0200-$BFFF (page-2 aux access)
RAMRDM      EQU  $C002      ; read main $0200-$BFFF
AUXRD       EQU  $0100      ; page-2 aux-read stub, installed in the stack page
                            ; (RAMRD re-banks all of $0200-$BFFF incl. our $6000
                            ;  code, so the toggling read MUST run from $01xx)
CLS         EQU  $8000
DOTS        EQU  $9200
YT          EQU  $06
TMP         EQU  $07
HGRL        EQU  $0A
HGRH        EQU  $0B
BAND        EQU  $0C
ROW         EQU  $0D
K           EQU  $0E
LINE0       EQU  $0F
P2          EQU  $20
DP          EQU  $22
DOTSP       EQU  $24
CLSP        EQU  $26
CELL        EQU  $28
NIB         EQU  $29
BANDV       EQU  $2A
PASS        EQU  $2B
COLNL       EQU  $2C
COLNH       EQU  $2D
PCOL        EQU  $2E
BYTE        EQU  $2F
HALF        EQU  $30
SRCP        EQU  $32
PINSV       EQU  $34
SLOTOFF     EQU  $35         ; slot*16 -> X index into $C088
LEVV        EQU  $36         ; CKLEV[colour] dither threshold (0..16)
BV1         EQU  $37         ; CKBAND[colour] primary ribbon band
BV2         EQU  $38         ; CKB2[colour]   secondary ribbon band
DI          EQU  $39         ; dither sub-column counter 0..3
            ORG  $6000
            JMP  START
; --- density / printed-aspect select.  POKE 24579,n (0..7) then CALL 24576.
; Indexes the DENS table below; see it for the full 8-pitch list. Vertical is
; fixed 72 dpi (ESC T 16 = 8/72" band); only horizontal column pitch changes,
; so the 560-dot stream + ESC G 0560 byte count are identical across all modes.
MODEB       DFB  $00
; --- vertical aspect double. POKE 24580,1 then CALL 24576 -> 2x tall ---
; Pins are fixed 1/72" so height can't stretch via ESC T. Instead each 8-dot
; band is emitted as TWO stacked 8-pin sub-bands; each source row maps to 2
; output pins (row-doubling). 24 bands x 2 = 48 sub-bands = 2x printed height.
YDBL        DFB  $00
; --- display page select.  POKE 24581,1 then CALL 24576 -> DHR PAGE 2 dump --
;   0 = page 1 ($2000 main+aux, default)   1 = page 2 ($4000 main+aux)
; Page-2 aux can't use the 80STORE/PAGE2 trick (that banks only the $2000
; window), so page 2 reads aux via RAMRD ($C003) with 80STORE off. The page-1
; path is unchanged.
PAGE        DFB  $00
SLOT        DFB  $02        ; POKE 24582: SSC slot (ACIA = $C088 + slot*16)
HBASE       DFB  $20        ; DHR base high byte, derived from PAGE at START
; All 8 IW-II graphics pitches (Table 8-2). MODEB 0..3 keep the curated aspect
; set (72/80/96/160 dpi); 4..7 add the in-between pitches so every CPI is
; reachable. Widths for 560 dots:
;   0 ESC n 72=7.78"  1 ESC N 80=7.00"  2 ESC E 96=5.83"  3 ESC P 160=3.50"
;   4 ESC e 107=5.23" 5 ESC q 120=4.67" 6 ESC Q 136=4.12" 7 ESC p 144=3.89"
DENS        DFB  $6E,$4E,$45,$50,$65,$71,$51,$70
; Per-DHGR-colour ribbon mapping. Each colour ordered-dithers (4x4 Bayer)
; between a PRIMARY band CKBAND and a SECONDARY band CKB2, at threshold CKLEV
; (bayer<CKLEV -> primary; else secondary; CKLEV $10=all primary, $00=all
; secondary). Bands: 0=blk 1=yel 2=mag 3=cyn 4=org 5=grn 6=pur, $FF=bare paper.
; Two-hue dither fakes blue / grey / brown / pink that the 7-hue ribbon can't
; reach with a single pass.
; idx:        0   1   2   3   4   5   6   7   8   9   A   B   C   D   E   F
;             blk pur dgn blu  -  gry grn  -  mag  -  gry lbl org  -  yel wht
; No true blue ink -- cyan is the closest; sky blues dither cyan+white (NOT
; cyan+magenta, which prints as the purple band). Greys dither black+white.
CKBAND      DFB  $00,$06,$05,$03,$05,$00,$05,$03,$02,$04,$00,$03,$04,$02,$01,$FF
CKB2        DFB  $00,$06,$00,$FF,$05,$FF,$FF,$03,$02,$01,$FF,$FF,$01,$02,$01,$FF
CKLEV       DFB  $10,$10,$0A,$05,$10,$06,$0D,$10,$10,$08,$06,$08,$0C,$10,$10,$00
; 4x4 ordered (Bayer) thresholds 0..15, row-major ((y&3)*4 + (x&3)):
BAYER       DFB  $00,$08,$02,$0A
            DFB  $0C,$04,$0E,$06
            DFB  $03,$0B,$01,$09
            DFB  $0F,$07,$0D,$05
BITT        DFB  $01,$02,$04,$08,$10,$20,$40
PBIT        DFB  $01,$02,$04,$08,$10,$20,$40,$80
PRESENT     DFB  $00,$00,$00,$00,$00,$00,$00
BASEL       DFB  $00,$00,$00,$00,$00,$00,$00,$00
BASEH       DFB  $00,$00,$00,$00,$00,$00,$00,$00
START       LDA  SLOT        ; SLOTOFF = slot*16 -> X index into $C088
            ASL
            ASL
            ASL
            ASL
            STA  SLOTOFF
            LDA  PAGE
            BEQ  STP1
            STA  SET80C      ; page 2: 80STORE off so RAMRD reaches $4000 aux
            JSR  INSTUB      ; install the RAMRD-safe aux-read stub at $0100
            LDA  #$40
            STA  HBASE
            JMP  STHI
STP1        STA  SET80S      ; page 1: 80STORE on -> PAGE2 banks $2000 window
            LDA  #$20
            STA  HBASE
STHI        STA  HIRES
            JSR  PRINIT
            LDA  #$00
            STA  BAND
MB1         JSR  SETBASE
            JSR  CLRPRES
            JSR  CLSBAND
            LDA  YDBL
            BNE  MBYD
            LDA  #$00
            STA  HALF
            JSR  DOPASSES
            JMP  MBADV
MBYD        LDA  #$00
            STA  HALF
            JSR  DOPASSES
            LDA  #$04
            STA  HALF
            JSR  DOPASSES
MBADV       INC  BAND
            LDA  BAND
            CMP  #$18
            BNE  MB1
            LDX  PAGE
            BNE  ENDP2
            STA  PG2MAIN     ; page 1: window back to main RAM
            RTS
ENDP2       STA  RAMRDM      ; page 2: restore main reads (critical, else hang)
            RTS
DOPASSES    LDA  #$00
            STA  PASS
DP1         LDX  PASS
            LDA  PRESENT,X
            BEQ  DPNX
            JSR  PASSHDR
            JSR  EMITPASS
DPNX        INC  PASS
            LDA  PASS
            CMP  #$07
            BNE  DP1
            LDA  #$0D
            JSR  PUT
            RTS
CLRPRES     LDX  #$00
            LDA  #$00
CP1         STA  PRESENT,X
            INX
            CPX  #$07
            BNE  CP1
            RTS
CLSBAND     LDX  #$00
CB1         STX  ROW
            JSR  DECROW
            LDX  ROW
            INX
            CPX  #$08
            BNE  CB1
            RTS
DECROW      LDX  ROW
            LDA  BASEL,X
            STA  P2
            LDA  BASEH,X
            STA  P2+1
            LDA  #$00
            STA  DP
            LDA  #$92
            STA  DP+1
            LDA  #$00
            STA  K
DR1         LDX  PAGE
            BNE  DRP2
; ---- page 1: aux+main via 80STORE/PAGE2 (banks only $2000, code safe) ----
            STA  PG2AUX
            LDY  K
            LDA  (P2),Y
            STA  BYTE
            JSR  SPREAD7
            STA  PG2MAIN
            LDY  K
            LDA  (P2),Y
            STA  BYTE
            JSR  SPREAD7
            JMP  DRNX
; ---- page 2: aux via the $0100 RAMRD stub; main read direct (RAMRD off) ----
DRP2        LDY  K
            JSR  AUXRD       ; A = aux $40xx,K with RAMRD restored off on return
            STA  BYTE
            JSR  SPREAD7
            LDY  K
            LDA  (P2),Y      ; RAMRD off -> main RAM $40xx
            STA  BYTE
            JSR  SPREAD7
DRNX        INC  K
            LDA  K
            CMP  #$28
            BNE  DR1
            JSR  CLASSIFY
            RTS
SPREAD7     LDX  #$00
S71         LDA  BYTE
            AND  BITT,X
            BEQ  S72
            LDA  #$01
            BNE  S73
S72         LDA  #$00
S73         LDY  #$00
            STA  (DP),Y
            INC  DP
            BNE  S74
            INC  DP+1
S74         INX
            CPX  #$07
            BNE  S71
            RTS
CLASSIFY    LDA  #$00
            STA  DOTSP
            LDA  #$92
            STA  DOTSP+1
            LDA  #$00
            CLC
            ADC  ROW
            STA  CLSP
            LDA  #$80
            ADC  #$00
            STA  CLSP+1
            LDA  #$00
            STA  CELL
CL1         LDY  #$00
            LDA  (DOTSP),Y
            STA  NIB
            LDY  #$01
            LDA  (DOTSP),Y
            ASL
            ORA  NIB
            STA  NIB
            LDY  #$02
            LDA  (DOTSP),Y
            ASL
            ASL
            ORA  NIB
            STA  NIB
            LDY  #$03
            LDA  (DOTSP),Y
            ASL
            ASL
            ASL
            ORA  NIB
            STA  NIB
            LDX  NIB
            LDA  CKBAND,X
            STA  BV1
            LDA  CKB2,X
            STA  BV2
            LDA  CKLEV,X
            STA  LEVV
            LDA  #$00
            STA  DI
CLW1        LDA  ROW         ; bayer idx = (ROW&3)*4 + DI (sub-column 0..3)
            AND  #$03
            ASL
            ASL
            ORA  DI
            TAY
            LDA  BAYER,Y
            CMP  LEVV
            BCS  CLWB        ; bayer >= level -> secondary hue
            LDA  BV1
            JMP  CLWS
CLWB        LDA  BV2
CLWS        LDY  #$00
            STA  (CLSP),Y
            CMP  #$FF        ; $FF = bare paper -> no band present
            BEQ  CLWNP
            TAX
            LDA  #$01
            STA  PRESENT,X
CLWNP       LDA  CLSP
            CLC
            ADC  #$08
            STA  CLSP
            BCC  CLWA
            INC  CLSP+1
CLWA        INC  DI
            LDA  DI
            CMP  #$04
            BNE  CLW1
            LDA  DOTSP
            CLC
            ADC  #$04
            STA  DOTSP
            BCC  CLW3
            INC  DOTSP+1
CLW3        INC  CELL
            LDA  CELL
            CMP  #$8C
            BEQ  CLEND
            JMP  CL1
CLEND       RTS
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
            LDA  PASS
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
            STA  COLNL
            STA  COLNH
EP1         LDA  #$00
            STA  PCOL
            LDY  #$00
EP2         LDA  YDBL
            BEQ  EPSR0
            TYA
            LSR
            CLC
            ADC  HALF
            JMP  EPSR1
EPSR0       TYA
EPSR1       CLC
            ADC  CLSP
            STA  SRCP
            LDA  CLSP+1
            ADC  #$00
            STA  SRCP+1
            STY  PINSV
            LDY  #$00
            LDA  (SRCP),Y
            LDY  PINSV
            CMP  PASS        ; classified band == this pass? ink it
            BNE  EP3
            LDA  PCOL
            ORA  PBIT,Y
            STA  PCOL
EP3         INY
            CPY  #$08
            BNE  EP2
            LDA  PCOL
            JSR  PUT
            LDA  CLSP
            CLC
            ADC  #$08
            STA  CLSP
            BCC  EP4
            INC  CLSP+1
EP4         INC  COLNL
            BNE  EP5
            INC  COLNH
EP5         LDA  COLNH
            CMP  #$02
            BNE  EP1
            LDA  COLNL
            CMP  #$30
            BEQ  EPDONE
            JMP  EP1
EPDONE      RTS
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
; Density code picked from DENS table by MODEB ($6003); see header. Default 0
; = ESC n 72 dpi (matches K tamu's photo-verified IIc colour dump).
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
; --- install the aux-read stub in the stack page (page-2 path only) ----------
; RAMRD ($C003) banks ALL of $0200-$BFFF to aux -- including this $6000 code --
; so the one read of aux $40xx must execute where RAMRD can't reach it:
; $0100-$01FF (governed by ALTZP, not RAMRD). Low stack stays clear: BASIC's SP
; sits near $01F0 and nesting here is only a few levels deep.
;   $0100  STA $C003   ; RAMRD aux on
;   $0103  LDA (P2),Y  ; read aux $40xx (P2/$20 ptr + Y); fetched from safe $01xx
;   $0105  STA $C002   ; RAMRD main off
;   $0108  RTS
INSTUB      LDX  #$08
INS1        LDA  STUB,X
            STA  AUXRD,X
            DEX
            BPL  INS1
            RTS
STUB        DFB  $8D,$03,$C0   ; STA $C003   RAMRD aux on
            DFB  $B1,$20       ; LDA ($20),Y (P2 = $20 -- update if P2 moves)
            DFB  $8D,$02,$C0   ; STA $C002   RAMRD main off
            DFB  $60           ; RTS