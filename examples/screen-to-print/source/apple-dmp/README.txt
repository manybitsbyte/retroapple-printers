  SCREEN TO PRINT - APPLE DMP

These programs dump the Apple //e
graphics screen to an Apple DMP
(Dot Matrix Printer) over the Apple
Parallel Interface Card in slot 1.
Black-and-white only - the Apple DMP
has no colour ribbon.  For colour use
an ImageWriter II.

The DMP is a rebadged C. Itoh 8510, so
it shares the ImageWriter command core
(ESC n / ESC T / ESC G) and prints the
same picture - only the transport
differs (parallel card, not serial).

FILES IN THIS FOLDER
LR.PLOT    draw 40-col lo-res test
LR.BW      print lo-res  (greys)
DLR.PLOT   draw 80-col dbl lo-res
DLR.BW     print dbl lo-res (greys)
HGR.ART    draw hi-res test picture
HGR.BW     print hi-res  (greys)
DHGR.ART   draw dbl hi-res picture
DHGR.BW    print dbl hi-res (greys)
VIEW       show this README

SET UP
------
1. Apple Parallel Interface Card in
   slot 1.
2. Apple DMP on-line.

PAGE SELECT (location 9)
POKE 9,0  = graphics page 1
POKE 9,1  = graphics page 2

DRAW THEN PRINT
Run a PLOT/ART to draw a screen then
run the matching BW program to dump it.

Lo-res page 1 example:
] BLOAD LR.PLOT,A$6000
] POKE 9,0 : CALL 24576
] BLOAD LR.BW,A$6000
] CALL 24576

Double lo-res page 1 example:
] BLOAD DLR.PLOT,A$6000
] POKE 9,0 : CALL 24576
] BLOAD DLR.BW,A$6000
] CALL 24576

Hi-res page 1 example:
] BLOAD HGR.ART,A$6000
] CALL 24576
] BLOAD HGR.BW,A$6000
] CALL 24576

Double hi-res page 1 example:
] BLOAD DHGR.ART,A$6000
] CALL 24576
] BLOAD DHGR.BW,A$6000
] CALL 24576

HGR/DHGR CONTROLS (before CALL)
The HGR/DHGR dumps add their own
knobs in place of POKE 9:
POKE 24579,n  width 0=7.8" 1=7.0"
              2=5.8" 3=3.5" (4:3)
POKE 24580,1  double height (tall)
POKE 24581,p  page 0=one 1=two
POKE 24582,s  parallel slot (def 1)

NOTES
-----
Code is relocatable - any A$addr OK.
Dbl lo-res shows on screen only from
page 1.  A dump can take a minute as
the printer paces the output.
Every colour prints as its own grey
so the design reads in black & white.
Happy printing!
