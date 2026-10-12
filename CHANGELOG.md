# Changelog

## 6.0.0 — 2026-10-12

PRABHA becomes a full Turbo C++ / Dev-C++ style IDE inside VS Code
(the planned 5.1, 5.2 and 6.0 in one release).

### Added

- **PRABHA's own compiler on every OS.** Windows: GCC 16.2 with gdb (as before).
  Linux and macOS: Zig 0.17.0 (clang + libc + libc++), downloaded once with its
  SHA-256 checked from ziglang.org's index. New setting `prabha.toolchain`
  (auto / bundled / system).
- **Ctrl+F9 / Alt+F9.** Ctrl+F9 compiles and runs; Alt+F9 only compiles.
- **PRABHA Console.** Console programs run in a VS Code terminal with input echo
  and backspace, prompts shown before input (unbuffered stdout),
  *Process exited after X s with return value N* and *Press any key to close*.
  Ctrl+C stops, Ctrl+D / Ctrl+Z ends input. Optional `prabha.runTimeoutSeconds`.
- **Clickable errors with Hinglish tips** in the Problems tab, mapped back to your
  own file and line even when Turbo mode compiled a temporary copy. Linker errors
  (`undefined reference`) land on your file too. A Dev-C++ style
  *Compilation results: Errors / Warnings* line is shown in the output.
- **Crash explanations** for segmentation fault, divide by zero, abort, stack
  overflow, bus error, illegal instruction and killed programs — Linux/macOS
  signals and Windows NTSTATUS codes.
- **Debugger (F5).** Breakpoints (with conditions), step into/over/out (F7/F8, and
  F4 run to cursor), call stack, locals, structs, arrays, watch, set variable,
  pause, and crash stops on the faulting line with the Hinglish reason. Linux and
  Windows use PRABHA's own gdb adapter; macOS uses Apple's `lldb-dap`. No
  `launch.json` needed; `"type": "prabha"` configurations are supported.
- **Turbo C++ → Modern C++ panel**: side-by-side old/new code, why each change
  was made, the common mistake, a quiz, Hinglish/English, apply to file or open in
  a new tab, run either version, and a **same-output check** (old in Turbo mode
  vs new with strict `-std=c++17 -pedantic-errors` / `-std=c11`).

### Changed

- **PRABHA's own compiler is now the default** (`prabha.toolchain: "bundled"`). The
  first Run installs it automatically (progress shown, no questions); every student
  gets the same tested compiler instead of whatever old MinGW / TDM / CodeBlocks gcc
  is on the PC. Offline or cancelled → PRABHA falls back to a compiler on the PC and
  says so. `auto` and `system` are still available.

### Fixed

- **Windows: Hindi (non-ASCII) folder or username.** MinGW gcc/ld cannot open such
  paths ("cannot open output file …\\?????\\a.exe"). Builds now run in an ASCII work
  folder (source and neighbouring headers copied when needed), PRABHA's runtime and
  toolchain are kept in an ASCII folder too, and errors still point at your file.
- **Hinglish error tips were missing on most Linux PCs.** GCC prints curly quotes
  (`‘;’`) in a UTF-8 locale; tips matched only straight quotes.
- **Windows: `scanf`/`gets` got a stray `\\r` after `getch()`-style programs**, and
  Turbo programs used different line endings from normal Windows programs. The
  runtime keeps Windows text mode; `getch()` reads raw keys itself, so Enter never
  hangs. Enter is sent as `\\r\\n`: `getch()` returns 13 and swallows the `\\n`.
- **Apple Silicon / ARM: integer divide by zero did not crash** (ARM returns 0
  silently, hiding the bug). Student builds on ARM now stop there like on a PC.
- **Debugger: a late command to a gdb that had already exited crashed the extension
  host** (uncaught EPIPE, found on Windows CI). Now handled.
- Turbo mode no longer rewrites `void main()` that appears inside strings or
  comments, now also handles implicit-int `main()`, `return;` inside main, and
  `far` / `near` / `huge` pointers, and applies to C files as well as C++.
- clang (macOS) rejected Turbo programs with `return;` in `main`; now adapted.


## 5.0.1 — 2026-10-12

### Fixed

- **PRABHA did not compile on macOS at all** (since 3.1.1). macOS's `<time.h>`
  declares POSIX `struct tm *getdate(const char *)`, which clashed with Turbo C's
  `getdate(struct date *)` from `dos.h` ("conflicting types for 'getdate'").
  The same clash hit any `.cpp` program that included both `<dos.h>` and
  `<time.h>` with g++ on Linux. `dos.h` now includes `<time.h>` first and maps the
  Turbo C name to PRABHA's own symbol — student code still calls `getdate(&d)`.

- **Blank panel when fd 3 was already open.** The runtime used to send frames to
  fd 3 whenever fd 3 happened to be open. Some shells, IDEs and the macOS CI
  runner leave fd 3 open, so every frame went into that unrelated descriptor and
  nothing was drawn. The runtime now uses fd 3 only when the extension says so
  with `PRABHA_PROTO_FD=3`, and falls back to stdout otherwise.
- Verified by running the whole suite with fd 3 deliberately inherited
  (`exec 3>/dev/null`): all tests pass; Windows (MinGW + Wine) 13/13.


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
