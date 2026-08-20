; ===========================================================================
; HGR GRAYSCALE (halftone) SCREEN DUMP  ->  Epson FX-80 via Parallel Interface
; Card.  B/W ribbon.
;
; Mono 1-bit dumps print the raw dot grid, so HGR colours that share the same
; low-7-bit pattern and differ only in bit7 (orange vs green, blue vs violet)
; collapse to the SAME dots and become indistinguishable -- e.g. an orange path
; over green ground vanishes.  This dump instead CLASSIFIES each pixel's NTSC
; hue (reusing the colour dump's classifier, which honours bit7 + neighbours),
; fills the half-lit gaps so a solid colour reads as a solid area, maps each of
; the six classes to a distinct GREY level, then 4x4 Bayer-dithers to 1 bit.
; Result: every HGR colour prints as its own shade, so same-pattern hues stay
; separable.  Use the B/W ribbon (the FX-80 is monochrome -- no colour ribbon).
;
; THE AUTHENTIC PATH: this 6502 code reads HGR graphics RAM, classifies + gap-
; fills + halftones each 8-line band, and streams genuine Epson ESC/P bit-image
; graphics (ESC A / ESC *) one byte at a time to the Apple Parallel Interface
; Card's data latch.  Every data byte waits on the ACK-line ready bit first, so
; output is paced by the printer's own busy/ACK handshake exactly as on hardware
; -- no host framebuffer trick, no flooding.  The same program runs on a real
; Apple //e + Parallel card + Epson FX-80 and prints the identical page.
; Companion to common/hgr-plot.asm / common/hgr-art.asm, which lay down the HGR
; test screen this routine prints.
;
; The FX-80 speaks EPSON ESC/P, NOT the C. Itoh command core the DMP /
; ImageWriter share -- so the wire format DIFFERS from dmp/hgr-dump-gray.asm even
; though the transport (Parallel card, ACK handshake) is byte-for-byte the same,
; and the graphics half below -- NTSC classifier, gap fill, GRAY map, Bayer
; dither -- is identical to that DMP HGR grey dump.  Two ESC/P specifics drive
; the wire-format rewrite (the same two as epson/lr-dump-gray.asm and the DLR):
;   1. GRAPHICS SELECT is a per-line command that carries a BINARY column count.
;      C. Itoh sent ESC G "0560" (four ASCII digits); ESC/P sends ESC * m n1 n2
;      where n1+256*n2 is the count as two raw bytes (560 -> n1=$30 n2=$02) and m
;      is the density mode.  Mode 5 = 72 dpi horizontal, which makes SQUARE dots
;      against the 9-pin head's fixed 72 dpi vertical -- the same geometry the
;      C. Itoh dump got from ESC n.  (Op manual 3-45; _starWidths[5]=dpi/72=1.)
;      The MODEB config byte still selects aspect, now indexing ESC/P density
;      modes via the MODES table (default MODEB=0 -> mode 5 -> 72 dpi).
;   2. BIT ORDER IS INVERTED.  The Epson head puts the TOP pin in the MOST
;      significant bit (bit 7 = pin 1 = top dot); C. Itoh puts the top dot in
;      bit 0.  So the per-column PBIT table is reversed here -- $80 for pin 0
;      (top) down to $01 for pin 7 (bottom) -- where the DMP dump ran $01..$80.
;      (Manual Vol 2 App B; epson-fx80.js REV8 mirrors this on the way in.)  LINE
;      PITCH is set once by ESC A 8 = 8/72" = exactly 8 dots, so the 8-dot bands
;      butt seamlessly -- the ESC/P equivalent of the C. Itoh ESC T 16.
;
; --- PARALLEL HANDSHAKE (authentic pacing) -----------------------------------
; The Parallel Interface Card (341-0005/341-0019) latches a byte and auto-pulses
; the Centronics STROBE on every write to the data register ($C090).  The printer
; then holds the ACK line busy until it has taken the byte; the card exposes that
; on the ACK status register ($C094): bit 6 (tested with BIT -> V) is the ACK
; line, SET = ready.  So before EVERY data write PUT does BIT $C094 / BVC back
; until the ready edge, then STA $C090.  BIT only sets flags -- it leaves A
; untouched -- so the byte sits in A across the poll (no staging slot needed,
; unlike the ACIA path whose TDRE poll clobbers A).  One LDA $C097 at START reads
; the reset register to prime the ACK flip-flop ready before the first byte.  No
; baud / control programming: the parallel port has none.
;
; --- SLOT --------------------------------------------------------------------
; Targets the Parallel Interface Card in SLOT 1 (I/O $C090-$C09F: data $C090,
; ACK status $C094, reset $C097).  For slot 2 use $C0A0/$C0A4/$C0A7 and
; re-assemble.
;
; Aspect + page are run-time selectable:
;   MODEB ($6003 POKE 24579): horiz density mode 0=72 1=80 2=90 3=240 dpi
;                             (indexes MODES = the ESC * mode byte)
;   YDBL  ($6004 POKE 24580): 1 = 2x tall (each band -> 2 row-doubled sub-bands)
;   PAGE  ($6005 POKE 24581): 0 = page 1 ($2000)   1 = page 2 ($4000)
; HGR's 280 dots are pixel-doubled to 560 so widths match the DHGR/colour dumps;
; the 560-dot ESC * count ($30,$02) is the same in every mode -- m changes only
; horizontal pitch, not the byte count.
; ===========================================================================
DATA        EQU  $C090       ; parallel slot 1 data latch (write = clock byte + strobe)
PSTAT       EQU  $C094       ; parallel slot 1 ACK status (read); bit 6 = ACK line ready
PRESET      EQU  $C097       ; parallel slot 1 reset (read = prime ACK flip-flop ready)
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
GLV         EQU  $1F         ; grey level (0..15) of the current pixel's class
THR         EQU  $20         ; Bayer threshold / scratch index
HALF        EQU  $21         ; YDBL sub-band source-row offset (0 or 4)
SRCP        EQU  $22         ; class source pointer (CLSP + remapped row)
PINSV       EQU  $24         ; saved output pin during YDBL row remap
            ORG  $6000
            JMP  START
MODEB       DFB  $00         ; POKE 24579: horiz density mode 0..3 (MODES index)
YDBL        DFB  $00         ; POKE 24580: 1 = double height
PAGE        DFB  $00         ; POKE 24581: 1 = HGR page 2
HBASE       DFB  $20         ; HGR base high byte, derived from PAGE at START
MODES       DFB  $05,$04,$06,$03   ; ESC * mode byte = 72/80/90/240 dpi (m=5/4/6/3)
START       LDA  PAGE
            BEQ  HGP1
            LDA  #$40        ; page 2 -> base $4000
            BNE  HGPS
HGP1        LDA  #$20        ; page 1 -> base $2000
HGPS        STA  HBASE
            LDA  PRESET      ; prime ACK flip-flop to ready before first byte
            JSR  PRINIT
            LDA  #$00
            STA  BAND
MB1         JSR  SETBASE
            JSR  CLSBAND     ; classify this 8-line band into CLS ($8000)
            LDA  YDBL
            BNE  MBYD
            LDA  #$00
            STA  HALF
            JSR  EMITBAND
            JMP  MBADV
MBYD        LDA  #$00
            STA  HALF
            JSR  EMITBAND
            LDA  #$04
            STA  HALF
            JSR  EMITBAND
MBADV       INC  BAND
            LDA  BAND
            CMP  #$18
            BNE  MB1
            RTS
EMITBAND    JSR  ESCSTAR     ; ESC * m $30 $02 -> 560 bytes of bit-image follow
            JSR  GEMIT       ; emit 560 grey-dithered printer columns
            LDA  #$0D        ; CR -> carriage return to the left margin
            JSR  PUT
            LDA  #$0A        ; LF -> feed exactly one 8-dot band.  DIP-independent:
            JSR  PUT         ;   Auto-LF ON -> LF swallowed (CR fed); OFF -> LF feeds.
            RTS
; --- ESC * m 0230 : start a 560-dot bit-image line (280 px pixel-doubled) -----
; ESC/P carries the column count as two BINARY bytes (560 = $0230 -> n1=$30
; n2=$02), NOT four ASCII digits like the C. Itoh ESC G "0560".  Mode byte m
; (from MODES[MODEB]) picks horizontal density; default MODEB=0 -> m=5 = 72 dpi.
ESCSTAR     LDA  #$1B
            JSR  PUT
            LDA  #$2A        ; '*' -> ESC * : selectable-density bit image
            JSR  PUT
            LDX  MODEB
            LDA  MODES,X     ; density mode (5=72 dpi default)
            JSR  PUT
            LDA  #$30        ; n1 = 560 MOD 256
            JSR  PUT
            LDA  #$02        ; n2 = 560 DIV 256
            JSR  PUT
            RTS
; --- GEMIT : 280 source columns, each emitted twice (560 dots).  Each column
;   is 8 vertical pixels grey-dithered to 8 printer dots.  When YDBL, the output
;   pin maps to source row (pin>>1)+HALF (row-doubling); the dither uses the
;   output pin so the halftone stays regular in print space.  Class for a black
;   pixel is gap-filled from a horizontal neighbour so solid colour reads solid.
GEMIT       LDA  #$00
            STA  CLSP
            STA  XLO
            STA  XHI
            LDA  #$80
            STA  CLSP+1
GCOL        LDA  #$00
            STA  PCOL
            LDY  #$00
GROW        LDA  YDBL         ; source row = YDBL ? (pin>>1)+HALF : pin
            BEQ  GDIR
            TYA
            LSR
            CLC
            ADC  HALF
            JMP  GSR
GDIR        TYA
GSR         CLC
            ADC  CLSP
            STA  SRCP
            LDA  CLSP+1
            ADC  #$00
            STA  SRCP+1
            STY  PINSV        ; save output pin (Y reused for class reads)
            LDY  #$00
            LDA  (SRCP),Y     ; class of pixel (x, source row)
            BNE  GHAVE
; gap-fill: pixel is black; borrow a colour from a horizontal neighbour
            LDA  XLO          ; left neighbour only if x>0
            ORA  XHI
            BEQ  GTRYR
            LDA  SRCP
            SEC
            SBC  #$08
            STA  T2
            LDA  SRCP+1
            SBC  #$00
            STA  T2+1
            LDY  #$00
            LDA  (T2),Y
            CMP  #$02         ; >=2 -> a colour class (2..5)
            BCS  GHAVE
GTRYR       LDA  XHI          ; right neighbour only if x<279
            CMP  #$01
            BNE  GDOR
            LDA  XLO
            CMP  #$17
            BEQ  GZERO
GDOR        LDA  SRCP
            CLC
            ADC  #$08
            STA  T2
            LDA  SRCP+1
            ADC  #$00
            STA  T2+1
            LDY  #$00
            LDA  (T2),Y
            CMP  #$02
            BCS  GHAVE
GZERO       LDA  #$00
GHAVE       TAX
            LDY  PINSV        ; restore output pin
            LDA  GRAY,X       ; grey level for this class
            STA  GLV
            LDA  XLO          ; bx = x & 3
            AND  #$03
            ASL
            ASL               ; bx<<2
            STA  THR
            TYA               ; by = pin & 3
            AND  #$03
            ORA  THR
            TAX               ; X = (bx<<2)|by
            LDA  BAYER,X
            STA  THR
            LDA  GLV
            CMP  THR          ; dot on iff grey > threshold
            BCC  GROFF
            BEQ  GROFF
            LDA  PCOL
            ORA  PBIT,Y
            STA  PCOL
GROFF       INY
            CPY  #$08
            BEQ  GEND
            JMP  GROW
GEND        LDA  PCOL
            JSR  PUT
            JSR  PUT          ; pixel-double -> 560 dots
            LDA  CLSP
            CLC
            ADC  #$08
            STA  CLSP
            BCC  GA
            INC  CLSP+1
GA          INC  XLO
            BNE  GB
            INC  XHI
GB          LDA  XHI
            CMP  #$01
            BEQ  GCHK         ; x>=256 -> test for end of line
            JMP  GCOL         ; still < 256 columns (BNE GCOL out of range)
GCHK        LDA  XLO
            CMP  #$18         ; x == 280 ?
            BEQ  GDONE
            JMP  GCOL
GDONE       RTS
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
; --- printer init: ESC A 8 = 8/72" line pitch (8-dot seamless bands) ----------
; The ESC/P equivalent of the C. Itoh ESC n density + ESC T 16 feed pair: density
; now rides the per-band ESC * mode byte, and the 8-dot feed is set once here.
PRINIT      LDA  #$1B         ; ESC
            JSR  PUT
            LDA  #$41         ; 'A' -> ESC A n : n/72" line spacing
            JSR  PUT
            LDA  #$08         ; n = 8 -> 8/72" = exactly 8 dots (bands butt)
            JSR  PUT
            RTS
; --- PUT : paced send of one byte to the Parallel card ----------------------
; Wait for the ACK line ready (bit 6 -> V, tested via BIT), then latch the byte
; into the data register.  BIT leaves A untouched so the caller's byte survives.
PUT         BIT  PSTAT        ; ACK line ready?
            BVC  PUT
            STA  DATA         ; latch byte + auto-strobe
            RTS
; class -> INK density (0=bare paper .. 15=solid black).  Luminance-faithful so
; the print reads positive, not a negative: black source -> solid, white -> bare.
; Hues stay separable and ordered by brightness: blue sky lightest, then violet,
; green grass, orange path/sun darkest of the colours (so the walkway reads a
; distinct shade from the green ground on a B/W ribbon).
;            0 blk 1 wht 2 grn 3 vio 4 blu 5 org
GRAY        DFB  $0F,$00,$08,$07,$05,$0B
; 4x4 ordered (Bayer) dither, indexed (x&3)<<2 | (y&3)
BAYER       DFB  $00,$08,$02,$0A
            DFB  $0C,$04,$0E,$06
            DFB  $03,$0B,$01,$09
            DFB  $0F,$07,$0D,$05
SMASK       DFB  $01,$02,$04,$08,$10,$20,$40
; Epson wire order: bit 7 = pin 1 = TOP dot .. bit 0 = pin 9 area = BOTTOM.
; Indexed by output pin Y (0=top): reversed vs the DMP dump's $01..$80.
PBIT        DFB  $80,$40,$20,$10,$08,$04,$02,$01
BASEL       DFB  $00,$00,$00,$00,$00,$00,$00,$00
BASEH       DFB  $00,$00,$00,$00,$00,$00,$00,$00
