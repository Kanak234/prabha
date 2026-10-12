# Changelog

## 5.0.0 — 2026-10-12

### Added — in-built compiler

- **No more "gcc not found".** PRABHA finds a compiler on its own: your setting,
  PATH, then the places students actually have one installed without PATH
  (CodeBlocks' MinGW, MSYS2, TDM-GCC, Dev-C++, WinGet WinLibs).
- **Windows: one-click PRABHA GCC.** If nothing is found, PRABHA downloads a pinned
  GCC 16.2.0 (WinLibs, UCRT, x86_64), verifies its SHA-256 before using it, and
  installs it inside its own storage folder — no PATH or system change.
- **macOS / Linux:** one click opens the right install command in a terminal
  (`xcode-select --install`, or apt / dnf / pacman / zypper / apk by distro).
- **PRABHA: Install / Choose Compiler** and **PRABHA: Which compiler am I using?**
- Windows programs are linked `-static`, so they never stop with a missing
  `libstdc++-6.dll` / `libgcc` DLL error.

### Fixed — Windows

- **The runtime did not compile on Windows at all.** `M_PI` is not defined under
  `-std=c99` by MinGW, and `_kbhit` had no prototype. Both fixed; the runtime now
  builds with `-Wall` and zero warnings on MinGW.
- **`getch()` hung on Enter.** Windows opens stdin in text mode, where reading a
  lone `\r` from a pipe waits for a `\n` that never comes. stdin/stdout are now
  switched to binary mode.
- **Frames broke and printf text vanished on Windows.** Without fd 3 the protocol
  shares stdout with the program; the old code routed whole pipe *chunks*, so a
  frame line split across two chunks was dumped into Output as JSON and the frame
  was lost, and printf text sharing a chunk with a frame disappeared. Output is
  now routed line by line (`lib/stream.js`), including a marker in the middle of a
  line after `printf("Enter: ")`. The runtime also flushes the program's stdout
  before every protocol line so the two stay in order.

### Verified

- Linux: full suite (`tests/run-all.sh`) — runtime `-Wall -Wextra` clean, every
  example, API coverage frames, conio frames, fd-3 integration.
- Windows (MinGW build run under Wine, and native Windows in CI): runtime and all
  7 examples compile; K, RIGHT arrow (0,77) and Enter (13) decode with no hang;
  frames arrive intact even when stdout is cut into 7-byte chunks.
- Extension wiring on mock VS Code: commands, compiler detect, install prompts,
  a real example compiled and streaming frames to the panel.


## 3.1.1

### Added

- **`dos.h` now has the date, time and random API.** It previously declared
  only `delay`, `sleep`, `sound` and `nosound` — 18 lines. Programs using
  `struct date`, `struct time`, `getdate()` or `gettime()` failed with
  "storage size of 'd' isn't known", which is most attendance registers,
  billing programs and anything that stamps a record. The structs use
  Borland's field names (`da_year`, `ti_hour` …) because programs read them
  directly, and the values come from the host clock.

  `randomize()` is implemented; `random()` is a macro, as it was in Borland's
  header — it cannot be a function because glibc already declares
  `long random(void)`.

  `setdate`/`settime`/`int86` are accepted and do nothing, so old code links.
  Setting the host clock needs root and should not happen by accident.

- **`<strstream.h>` actually works.** The header existed but only aliased
  `std::ostringstream`, so `ostrstream o(buf, sizeof buf)` did not compile —
  the old class wrote into a caller-supplied buffer and the modern one owns
  its own. It is now a real wrapper that keeps the old call shape and copies
  into the caller's buffer.

### Verified

Six classic Turbo C/C++ programs compile and produce correct output:
`clrscr`/`gotoxy`/`cprintf`, BGI graphics with `floodfill`, a class with
`<iostream.h>` and `void main()`, file I/O through `<fstream.h>`,
`getdate`/`gettime`/`sound`, and `ostrstream`.


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
