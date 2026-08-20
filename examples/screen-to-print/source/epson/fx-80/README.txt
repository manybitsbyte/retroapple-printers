 SCREEN TO PRINT - EPSON FX-80

These programs dump the Apple //e
graphics screen to an Epson FX-80
over the Apple Parallel Interface
Card in slot 1.
Black-and-white only - the FX-80 has
no colour ribbon.  For colour use an
ImageWriter II.

The FX-80 speaks Epson ESC/P, so the
dumps use ESC * for graphics and ESC A
for line spacing - a different dialect
to the ImageWriter / DMP (C. Itoh) but
it prints the same picture.

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
2. Epson FX-80 on-line.

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

HGR/DHGR CONTROLS (before CALL)
POKE 24579,n  width 0=7.8 1=7.0
              2=5.8 3=3.5 (4:3)
POKE 24580,1  double height (tall)
POKE 24581,p  page 0=one 1=two
POKE 24582,s  parallel slot (def 1)

NOTES
-----
Code is relocatable - any A$addr OK.
Every colour prints as its own grey
so the design reads in black & white.
Width mode 3 (240 dpi) is quad density:
the FX-80 cannot fire adjacent dots so
solids thin to grey - it is the narrow
4:3 aspect mode.
A dump can take a minute as the
printer paces the output.
Happy printing!
