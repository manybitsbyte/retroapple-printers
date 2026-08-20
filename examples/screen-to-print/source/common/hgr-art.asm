; ===========================================================================
; HGR "CASTLE AT SUNSET" SCENE   (CALL 24576 / $6000, or monitor 6000G)
;
; Real-art HGR test image for the screen-dump tests -- a 6-colour landscape
; (sky, sun, clouds, violet mountains, white castle, green ground, orange
; path). Companion to the DHGR "Sierra" castle: this is its 280x192 HGR
; cousin, so the HGR colour and BW dumps print a recognisable scene instead of
; a contrived ramp.
;
; --- PAGE SELECT (POKE before CALL) ------------------------------------------
;   POKE 24579,0 : CALL 24576   -> draw + show HGR page 1 ($2000)   (default)
;   POKE 24579,1 : CALL 24576   -> draw + show HGR page 2 ($4000)
; The scene is drawn straight into the chosen page and that page is displayed,
; so a page-2 dump test needs NO copy-from-page-1 and NO poisoning of $2000 --
; just draw the page you want, then run the dump with its matching PAGE byte.
; Both HGR pages are fully displayable, so the page-2 scene shows live too.
;
; --- HGR COLOUR PACKING ------------------------------------------------------
; A hi-res byte holds 7 dots (bits 0..6, bit0 leftmost); bit7 picks the colour
; palette for those 7 dots. NTSC artifacting makes a lit dot show one hue at an
; even screen-dot column and another at an odd column, so a solid colour fill
; is just a fixed bit pattern that DIFFERS between even and odd BYTE columns.
; The six HGR colours therefore reduce to a pair of byte values (even-col byte,
; odd-col byte). The scene is built from byte-aligned rectangles, so every byte
; is single-colour and packing is a two-entry table lookup -- no per-dot palette
; conflicts. Vertical edges are full 1-line resolution; horizontal steps are one
; byte (7 dots), the period-authentic HGR "chunky" look.
;
;   idx col      even-byte  odd-byte
;    0  BLACK      $00        $00
;    1  WHITE      $7F        $7F
;    2  GREEN      $2A        $55
;    3  VIOLET     $55        $2A
;    4  ORANGE     $AA        $D5     (bit7 set)
;    5  BLUE       $D5        $AA     (bit7 set)
;
; --- HGR LINE ADDRESSING -----------------------------------------------------
; Line L is NOT linear: base(L) = PGBASE + (L&7)*$400 + ((L>>3)&7)*$80
;                                        + (L>>6)*$28.  CALCBASE computes it,
; where PGBASE = $2000 (page 1) or $4000 (page 2) per the PGHI byte.
;
; Fixed ORG $6000 (consistent with dhgr-sierra). Draws into the selected page,
; RTS when done; enables full-screen hi-res on that page first so the scene
; shows as it builds.
; ===========================================================================

TXTCLR    EQU $C050      ; graphics (TEXT off)
MIXCLR    EQU $C052      ; full screen (MIXED off)
TXTPAGE1  EQU $C054      ; display page 1
TXTPAGE2  EQU $C055      ; display page 2 ($4000 IS displayable in plain HGR)
HIRES     EQU $C057      ; hi-res on
CLR80VID  EQU $C00C      ; 40-column video
DHIRESOFF EQU $C05F      ; AN3 on -> double-res disabled (plain HGR)

LINE    EQU $06          ; current scanline 0..191
CUR     EQU $07          ; current rectangle colour index
XL      EQU $08          ; rect left  byte column 0..39
XR      EQU $09          ; rect right byte column 0..39 (inclusive)
YT      EQU $0A          ; rect top    line
YB      EQU $0B          ; rect bottom line (inclusive)
PTR     EQU $0C          ; (2) pointer into the RECTS record list
HBASE   EQU $1A          ; (2) base address of the current scanline
TMPL    EQU $1C          ; scratch: line copy for CALCBASE
SCR     EQU $1D          ; scratch
TMPG    EQU $1E          ; scratch: (L>>6) group

        ORG $6000

        JMP START        ; CALL 24576 / 6000G lands here -> START
PAGE    DFB $00          ; $6003  POKE 24579: 0 = page 1 ($2000), 1 = page 2 ($4000)
PGHI    DFB $20          ; $6004  scene base high byte, derived from PAGE at START

; --- entry: pick the page, select full-screen hi-res, walk the record list ----
; PAGE picks BOTH the draw target and the displayed page, so a page-2 scene is
; drawn straight into $4000 and shown live -- no copy-from-page-1, no poisoning.
START   LDA PAGE
        BNE STPG2
        LDA #$20         ; page 1 -> base $2000
        STA PGHI
        LDA #$00
        STA TXTCLR       ; graphics
        STA MIXCLR       ; full screen
        STA HIRES        ; hi-res
        STA CLR80VID     ; 40-column
        STA DHIRESOFF    ; plain HGR (not double)
        STA TXTPAGE1     ; show page 1
        JMP STSETP
STPG2   LDA #$40         ; page 2 -> base $4000
        STA PGHI
        LDA #$00
        STA TXTCLR       ; graphics
        STA MIXCLR       ; full screen
        STA HIRES        ; hi-res
        STA CLR80VID     ; 40-column
        STA DHIRESOFF    ; plain HGR (not double)
        STA TXTPAGE2     ; show page 2
STSETP  LDA #<RECTS
        STA PTR
        LDA #>RECTS
        STA PTR+1

; --- read one rectangle record (xL,xR,yT,yB,col); $FF in xL ends ------------
NEXTREC LDY #$00
        LDA (PTR),Y
        CMP #$FF
        BEQ ALLDONE
        STA XL
        LDY #$01
        LDA (PTR),Y
        STA XR
        LDY #$02
        LDA (PTR),Y
        STA YT
        LDY #$03
        LDA (PTR),Y
        STA YB
        LDY #$04
        LDA (PTR),Y
        STA CUR

; --- fill the rectangle, one scanline at a time -----------------------------
        LDA YT
        STA LINE
LINELP  LDA LINE
        JSR CALCBASE     ; -> HBASE for this line
        LDY XL
FILLX   TYA
        AND #$01
        BNE ODDX
        LDX CUR
        LDA COLEV,X
        JMP PUTX
ODDX    LDX CUR
        LDA COLOD,X
PUTX    STA (HBASE),Y
        CPY XR
        BEQ XDONE
        INY
        JMP FILLX
XDONE   LDA LINE
        CMP YB
        BEQ RECTDN
        INC LINE
        JMP LINELP

; --- advance to the next record ---------------------------------------------
RECTDN  CLC
        LDA PTR
        ADC #$05
        STA PTR
        BCC NEXTREC
        INC PTR+1
        JMP NEXTREC

ALLDONE RTS

; --- CALCBASE: A = line 0..191 -> HBASE/HBASE+1 (page 1 $2000) ---------------
CALCBASE STA TMPL
        AND #$07
        ASL
        ASL              ; (L&7)*4 -> high byte
        STA HBASE+1
        LDA #$00
        STA HBASE
        LDA TMPL
        LSR
        LSR
        LSR
        AND #$07         ; v = (L>>3)&7
        LSR              ; carry = v&1, A = v>>1
        PHP
        CLC
        ADC HBASE+1
        STA HBASE+1      ; high += v>>1
        PLP
        BCC NOLO
        LDA #$80
        STA HBASE        ; low = $80 when v odd
NOLO    LDA TMPL
        LSR
        LSR
        LSR
        LSR
        LSR
        LSR              ; A = L>>6  (0..2)
        STA TMPG
        ASL
        ASL
        ASL              ; g*8
        STA SCR
        LDA TMPG
        ASL
        ASL
        ASL
        ASL
        ASL              ; g*32
        CLC
        ADC SCR          ; g*40
        CLC
        ADC HBASE
        STA HBASE
        BCC NOC
        INC HBASE+1
NOC     LDA HBASE+1
        CLC
        ADC PGHI         ; + scene base high ($20 page 1 / $40 page 2)
        STA HBASE+1
        RTS

; --- colour byte tables: index -> even-col byte / odd-col byte ---------------
;        BLK  WHT  GRN  VIO  ORG  BLU
COLEV   DFB $00,$7F,$2A,$55,$AA,$D5
COLOD   DFB $00,$7F,$55,$2A,$D5,$AA

; --- scene record list: xL,xR,yT,yB,colour  (col: 0BLK 1WHT 2GRN 3VIO 4ORG 5BLU)
RECTS
        DFB 0,39,0,95,5         ; sky          (blue)
        DFB 0,39,96,191,2       ; ground       (green)
; sun, top-right, orange disc (stacked)
        DFB 31,35,8,11,4
        DFB 30,36,12,15,4
        DFB 29,37,16,27,4
        DFB 30,36,28,31,4
        DFB 31,35,32,35,4
; clouds (white)
        DFB 4,11,16,18,1
        DFB 2,13,19,21,1
        DFB 20,27,24,26,1
        DFB 18,29,27,28,1
; violet mountains flanking the castle
        DFB 2,10,88,95,3
        DFB 4,8,84,87,3
        DFB 5,7,80,83,3
        DFB 30,38,88,95,3
        DFB 32,36,84,87,3
        DFB 33,35,80,83,3
; castle body & towers (white)
        DFB 13,16,64,95,1       ; left tower
        DFB 24,27,64,95,1       ; right tower
        DFB 16,24,72,95,1       ; keep
        DFB 13,27,84,95,1       ; curtain wall
; crenellations (white merlons; gaps stay blue sky)
        DFB 13,13,60,63,1
        DFB 15,15,60,63,1
        DFB 24,24,60,63,1
        DFB 26,26,60,63,1
        DFB 17,17,68,71,1
        DFB 19,19,68,71,1
        DFB 21,21,68,71,1
        DFB 23,23,68,71,1
; gate (black arch)
        DFB 19,21,84,95,0
; windows (blue)
        DFB 14,15,72,76,5
        DFB 25,26,72,76,5
        DFB 17,18,78,82,5
        DFB 22,23,78,82,5
; path widening to the foreground (orange)
        DFB 19,21,96,119,4
        DFB 18,22,120,143,4
        DFB 17,23,144,167,4
        DFB 16,24,168,191,4
        DFB $FF                 ; end of list
