# Changelog

## [3.1.0] - 2026-09-02

### Added - Turbo C++ compatibility (runs old college code unchanged)
- Classic Turbo C++ / Borland C++ programs now compile and run on a modern
  compiler **without editing a single line**. On by default; toggle with
  `prabha.turboCppCompatibility`.
- Old header names resolve via shim headers: `<iostream.h>`, `<conio.h>`,
  `<iomanip.h>`, `<fstream.h>`, `<strstream.h>`, `<constream.h>`, `<process.h>`.
- `cout` / `cin` / `endl` / `setw` and other standard names work unqualified
  (no `std::`), the way `<iostream.h>` used to provide them.
- `void main()` / `void main(void)` are adapted to a valid `int main` entry on
  a temporary copy — the student's file on disk is never touched.
- `gets()`, removed from modern C/C++ but common in lab programs, is provided
  as a safe bounded replacement so those programs build and run.
- New example: `07_turbo_cpp_classic.cpp` — a marks-and-average program in the
  exact style taught in college.

# Changelog

## [3.0.0] — 2026-09-01

The complete Turbo C implementation. Everything `graphics.h`, `conio.h` and
`dos.h` promise now actually works.

### Added — graphics.h completed
- Arcs and ellipse arcs with correct `getarccoords`, `sector`, `pieslice`
  wedge filling
- All 12 BGI fill patterns plus `setfillpattern` user patterns, applied
  through every fill (`bar`, `fillpoly`, `fillellipse`, `floodfill`, wedges)
- `fillpoly` scanline fill, `drawpoly`, `bar3d` with top face
- Real `floodfill`: scanline, border-bounded, grows its own stack
- `getimage` / `putimage` with `COPY_PUT`, `XOR_PUT`, `OR_PUT`, `AND_PUT`,
  `NOT_PUT`; `imagesize` sized to match
- Line styles `DOTTED`, `CENTER`, `DASHED`, `USERBIT` with 16-bit patterns,
  and `THICK_WIDTH`
- `setwritemode(XOR_PUT)` applies to every drawing primitive
- Text: vertical direction, all justifications, sizes 1–10,
  `setusercharsize`, correct `textwidth` / `textheight`
- Viewport clipping honoured by every primitive; `clearviewport`
- 4 video pages: `setactivepage` / `setvisualpage` for flicker-free animation
- Palette: `setpalette`, `setallpalette`, `setrgbpalette`, `getpalette`,
  with true BGI `setbkcolor` semantics (slot 0 remap, no repaint)
- `graphdefaults`, `getmodename`, `getdrivername`, `setaspectratio`

### Added — conio.h completed
- `window`, scrolling, `insline`, `delline`, `clreol`, `gettextinfo`
- Full attribute model (`textattr`, `textcolor`, `textbackground`,
  `highvideo`, `lowvideo`, `normvideo`)
- `cprintf`, `cputs`, `putch`, `cscanf`, `cgets`, `getche`, `ungetch`
- `getch` / `kbhit` read real panel keystrokes; arrows and function keys
  arrive as `0` followed by the true DOS scan code
- conio works with no `initgraph` call — the console boots itself

### Added — dos.h
- `delay`, `sleep`, `sound`, `nosound` (the panel plays the note)

### Changed
- Frames are RLE-compressed bounding-box deltas over a private pipe, so
  `printf` / `scanf` keep stdout and stdin — a 30-frame animation is ~25 KB
- Include order no longer matters: `conio.h` before `graphics.h` compiles
- `registerbgidriver` / `registerbgifont` / `installuserdriver` /
  `installuserfont` return honest BGI error codes instead of silently passing

### Added — extension
- Six worked examples (shapes, bouncing ball, car, sine wave, arrow-key game,
  conio menu) via **PRABHA: Open Example…**
- Panel shows the live frame rate and runtime version; `Ctrl+Alt+G` runs
- Clear compiler-missing message with per-OS install instructions
