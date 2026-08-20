; ===========================================================================
; DHGR (double hi-res) GREYSCALE screen dump  ->  Apple DMP via Parallel
; Interface Card.  B/W ribbon.
;
; The Apple DMP has a black ribbon only, so a DHGR colour screen is made
; readable in mono: read aux+main, spread to 560 dots, classify each 4-dot cell
; into a 0..15 colour, map that colour to an INK DENSITY (0=bare .. 16=solid),
; then ordered-dither (4x4 Bayer) to 1 bit and emit a single ESC G 0560 pass per
; band.  Every colour becomes its own grey, so the design still reads in B/W --
; better fidelity than a flat luma threshold.
;
; THE AUTHENTIC PATH: this 6502 code reads DHGR graphics RAM (aux + main), maps
; each 4-dot cell to an ink grey, halftones each 8-line band, and streams genuine
; C. Itoh 8510 bit-image graphics (ESC n / ESC T / ESC G) one byte at a time to
; the Apple Parallel Interface Card's data latch.  Every data byte waits on the
; ACK-line ready bit first, so output is paced by the printer's own busy/ACK
; handshake exactly as on hardware -- no host framebuffer trick, no flooding.
; The same program runs on a real Apple //e + Parallel card + Apple DMP and
; prints the identical page.
;
; The Apple DMP is a rebadged C. Itoh 8510 -- the same command core the
; ImageWriter I/II inherit -- so ESC n / ESC T / ESC G are byte-for-byte the same
; wire format as imagewriteri/dhgr-dump-gray.asm.  ONLY the transport differs: the
; ImageWriter rides the Super Serial Card's 6551 ACIA (write TX reg); the DMP
; rides the Parallel card (poll ACK, write data latch).  The graphics half below
; -- aux/main read, cell classify, INK map, Bayer dither -- is identical to the
; IW1 DHGR grey dump.
;
; --- PARALLEL HANDSHAKE (authentic pacing) -----------------------------------
; The Parallel Interface Card (341-0005/341-0019) latches a byte and auto-pulses
; the Centronics STROBE on every write to the data register ($C090).  The printer
; then holds the ACK line busy until it has taken the byte; the card exposes that
; on the ACK status register ($C094): bit 6 (tested with BIT -> V) is the ACK
; line, SET = ready.  So before EVERY data write PUT does BIT $C094 / BVC back
; until the ready edge, then STA $C090.  BIT only sets flags -- it leaves A
; untouched -- so the byte sits in A across the poll (no staging slot needed,
; unlike the ACIA path).  One LDA $C097 at START reads the reset register to prime
; the ACK flip-flop ready before the first byte.  No baud / control programming:
; the parallel port has none.
;
; --- SLOT --------------------------------------------------------------------
; Targets the Parallel Interface Card in SLOT 1 (I/O $C090-$C09F: data $C090,
; ACK status $C094, reset $C097).  For slot 2 use $C0A0/$C0A4/$C0A7 and
; re-assemble.
;
;   MODEB ($6003 POKE 24579): horiz density 0..7 (DENS table; printed width)
;   YDBL  ($6004 POKE 24580): 1 = 2x tall (each band -> 2 row-doubled sub-bands)
;   PAGE  ($6005 POKE 24581): 0 = page 1 ($2000)   1 = page 2 ($4000)
; Entry: CALL 24576 / 6000G.
DATA        EQU  $C090       ; parallel slot 1 data latch (write = clock byte + strobe)
PSTAT       EQU  $C094       ; parallel slot 1 ACK status (read); bit 6 = ACK line ready
PRESET      EQU  $C097       ; parallel slot 1 reset (read = prime ACK flip-flop ready)
SET80S      EQU  $C001
SET80C      EQU  $C000       ; 80STORE off (page-2 path: let RAMRD reach $4000)
HIRES       EQU  $C057
PG2MAIN     EQU  $C054
PG2AUX      EQU  $C055
RAMRDA      EQU  $C003       ; read aux  $0200-$BFFF (page-2 aux access)
RAMRDM      EQU  $C002       ; read main $0200-$BFFF
AUXRD       EQU  $0100       ; page-2 aux-read stub, installed in the stack page
CLS         EQU  $8000       ; classified buffer: 1 (ink) / 0 (bare) per dot
DOTS        EQU  $9200       ; per-row spread buffer (560 dots)
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
COLNL       EQU  $2C
COLNH       EQU  $2D
PCOL        EQU  $2E
BYTE        EQU  $2F
HALF        EQU  $30
SRCP        EQU  $32
PINSV       EQU  $34
LEVV        EQU  $36         ; INK[colour] dither threshold (0..16)
DI          EQU  $39         ; dither sub-column counter 0..3
            ORG  $6000
            JMP  START
MODEB       DFB  $00         ; POKE 24579: horiz density 0..7 (DENS index)
YDBL        DFB  $00         ; POKE 24580: 1 = double height
PAGE        DFB  $00         ; POKE 24581: 1 = DHR page 2
HBASE       DFB  $20         ; DHR base high byte, derived from PAGE at START
; 8 IW-II graphics pitches; 0..3 = curated aspect set 72/80/96/160 dpi, 4..7 =
; 107/120/136/144 dpi.  ESC n/N/E/P/e/q/Q/p.
DENS        DFB  $6E,$4E,$45,$50,$65,$71,$51,$70
; Per-DHGR-colour ink density (darkness). bayer<INK -> ink dot, else bare.
; $00 = white/bare, $10 = solid black.  Indexed by the 0..15 cell colour.
INK         DFB  $10,$08,$07,$05,$06,$07,$05,$03,$07,$06,$06,$03,$05,$06,$02,$00
; 4x4 ordered (Bayer) thresholds 0..15, row-major ((y&3)*4 + (x&3)):
BAYER       DFB  $00,$08,$02,$0A
            DFB  $0C,$04,$0E,$06
            DFB  $03,$0B,$01,$09
            DFB  $0F,$07,$0D,$05
BITT        DFB  $01,$02,$04,$08,$10,$20,$40
PBIT        DFB  $01,$02,$04,$08,$10,$20,$40,$80
BASEL       DFB  $00,$00,$00,$00,$00,$00,$00,$00
BASEH       DFB  $00,$00,$00,$00,$00,$00,$00,$00
START       LDA  PAGE
            BEQ  STP1
            STA  SET80C      ; page 2: 80STORE off so RAMRD reaches $4000 aux
            JSR  INSTUB
            LDA  #$40
            STA  HBASE
            JMP  STHI
STP1        STA  SET80S      ; page 1: 80STORE on -> PAGE2 banks $2000 window
            LDA  #$20
            STA  HBASE
STHI        STA  HIRES
            LDA  PRESET      ; prime ACK flip-flop ready before first byte
            JSR  PRINIT
            LDA  #$00
            STA  BAND
MB1         JSR  SETBASE
            JSR  CLSBAND
            LDA  YDBL
            BNE  MBYD
            LDA  #$00
            STA  HALF
            JSR  DOEMIT
            JMP  MBADV
MBYD        LDA  #$00
            STA  HALF
            JSR  DOEMIT
            LDA  #$04
            STA  HALF
            JSR  DOEMIT
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
; --- one sub-band: ESC G 0560 header, 560 packed columns, CR ----------------
DOEMIT      JSR  GHDR
            JSR  EMITGRAY
            LDA  #$0D
            JSR  PUT
            RTS
GHDR        LDA  #$1B
            JSR  PUT
            LDA  #$47        ; 'G'
            JSR  PUT
            LDA  #$30        ; '0'
            JSR  PUT
            LDA  #$35        ; '5'
            JSR  PUT
            LDA  #$36        ; '6'
            JSR  PUT
            LDA  #$30        ; '0'  -> "0560"
            JSR  PUT
            RTS
EMITGRAY    LDA  #$00
            STA  CLSP
            LDA  #$80
            STA  CLSP+1
            LDA  #$00
            STA  COLNL
            STA  COLNH
EG1         LDA  #$00
            STA  PCOL
            LDY  #$00
EG2         LDA  YDBL
            BEQ  EGSR0
            TYA
            LSR
            CLC
            ADC  HALF
            JMP  EGSR1
EGSR0       TYA
EGSR1       CLC
            ADC  CLSP
            STA  SRCP
            LDA  CLSP+1
            ADC  #$00
            STA  SRCP+1
            STY  PINSV
            LDY  #$00
            LDA  (SRCP),Y
            LDY  PINSV
            CMP  #$00        ; classified ink? (1 = ink, 0 = bare)
            BEQ  EG3
            LDA  PCOL
            ORA  PBIT,Y
            STA  PCOL
EG3         INY
            CPY  #$08
            BNE  EG2
            LDA  PCOL
            JSR  PUT
            LDA  CLSP
            CLC
            ADC  #$08
            STA  CLSP
            BCC  EG4
            INC  CLSP+1
EG4         INC  COLNL
            BNE  EG5
            INC  COLNH
EG5         LDA  COLNH
            CMP  #$02
            BNE  EG1
            LDA  COLNL
            CMP  #$30        ; 560 = $0230 columns done
            BEQ  EGDONE
            JMP  EG1
EGDONE      RTS
; --- classify one band's 8 rows into CLS as 1-bit dithered ink ---------------
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
            JSR  AUXRD
            STA  BYTE
            JSR  SPREAD7
            LDY  K
            LDA  (P2),Y
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
            LDA  INK,X
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
            BCC  INKON       ; bayer < ink -> ink dot
            LDA  #$00
            JMP  CLWS
INKON       LDA  #$01
CLWS        LDY  #$00
            STA  (CLSP),Y
            LDA  CLSP
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
            BNE  CL1
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
            LDA  #$54        ; ESC T 16 -> 8/72" band feed
            JSR  PUT
            LDA  #$31
            JSR  PUT
            LDA  #$36
            JSR  PUT
            RTS
; --- PUT : paced send of one byte to the Parallel card ----------------------
; Wait for the ACK line ready (bit 6 -> V, tested via BIT), then latch the byte
; into the data register.  BIT leaves A untouched so the caller's byte survives.
PUT         BIT  PSTAT        ; ACK line ready?
            BVC  PUT
            STA  DATA         ; latch byte + auto-strobe
            RTS
INSTUB      LDX  #$08
INS1        LDA  STUB,X
            STA  AUXRD,X
            DEX
            BPL  INS1
            RTS
STUB        DFB  $8D,$03,$C0   ; STA $C003   RAMRD aux on
            DFB  $B1,$20       ; LDA ($20),Y (P2 = $20)
            DFB  $8D,$02,$C0   ; STA $C002   RAMRD main off
            DFB  $60           ; RTS
