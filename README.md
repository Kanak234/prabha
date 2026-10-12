# PRABHA — the Turbo C++ / Dev-C++ IDE, inside VS Code

Dev-C++ and Turbo C++ stopped getting updates, but college labs still teach with
them. PRABHA 6.0 gives you that whole IDE as one VS Code extension — **its own
compiler, console, error help, debugger, `graphics.h`, and a Turbo → Modern C++
converter that explains every change.** No DOSBox, no Turbo C, no emulator, no
other extension needed. Windows, Linux and macOS.

| Key | What it does |
|---|---|
| `Ctrl+F9` | Compile + run. Console programs open in **PRABHA Console** (type input, *Process exited after 0.42 s with return value 0*, *Press any key*). `graphics.h` / `conio.h` programs open the 640×480 panel. |
| `Alt+F9` | Compile only — errors go to the Problems tab; click one to jump to the line. Each common error has a plain-English tip ("a `;` is missing on the previous line", "`iostream.h` is an old Turbo C++ header"…). |
| `F5` | Debug — breakpoints (click the gutter), variables, watch, call stack. No `launch.json` needed. |
| `F7` / `F8` | Step into / step over while debugging (Turbo C++ keys). `F4` runs to the cursor, `Ctrl+F2` stops. |
| ✨ button | **Turbo C++ → Modern C++**: old code next to new code, why each change was made, the common mistake, a one-question quiz, and **✔ Check: same output?** which compiles the old version in Turbo mode and the new one with strict `-std=c++17 -pedantic-errors` and compares their output. |

When a program crashes, PRABHA says why in plain words — *Segmentation fault —
NULL ya galat pointer*, *0 se divide*, *stack overflow (infinite recursion?)* — with
the fix, on Linux, macOS and Windows (`0xC0000005`, `0xC0000094`, …). Folders with
spaces or Hindi names work.

```c
#include <graphics.h>
#include <conio.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    setcolor(YELLOW);
    circle(320, 240, 100);
    outtextxy(250, 400, "PRABHA");
    getch();
    closegraph();
    return 0;
}
```

Press **Ctrl+F9** (or the ▶ button) and it runs.

## What's implemented (v3.0.0 — everything)

**Setup & modes** — `initgraph` `initwindow` `closegraph` `detectgraph`
`graphresult` `grapherrormsg` `getgraphmode` `setgraphmode` `restorecrtmode`
`getmaxmode` `getmodename` `getdrivername` `graphdefaults`

**Drawing** — `putpixel` `getpixel` `line` `lineto` `linerel` `moveto` `moverel`
`rectangle` `circle` `arc` `ellipse` `drawpoly` `getarccoords`

**Filling** — `bar` `bar3d` `fillpoly` `fillellipse` `pieslice` `sector`
`floodfill`, all 12 BGI patterns plus `setfillpattern` user patterns

**Attributes** — `setcolor` `getcolor` `setbkcolor` `getbkcolor` `getmaxcolor`
`setfillstyle` `getfillsettings` `getfillpattern` `setlinestyle`
`getlinesettings` `setwritemode` (`XOR_PUT` really XORs)
`setpalette` `getpalette` `setallpalette` `setrgbpalette` `getpalettesize`

**Text** — `outtext` `outtextxy` `settextstyle` `settextjustify`
`setusercharsize` `textheight` `textwidth` `gettextsettings`, horizontal and
vertical direction, all justifications, character sizes 1–10

**Images** — `imagesize` `getimage` `putimage` with `COPY_PUT` `XOR_PUT`
`OR_PUT` `AND_PUT` `NOT_PUT`

**Viewport & pages** — `setviewport` `getviewsettings` `clearviewport`
`cleardevice` with real clipping, and 4 video pages via `setactivepage` /
`setvisualpage` for flicker-free animation

**conio.h (complete)** — `clrscr` `clreol` `delline` `insline` `gotoxy`
`wherex` `wherey` `window` `textmode` `gettextinfo` `_setcursortype`
`textcolor` `textbackground` `textattr` `highvideo` `lowvideo` `normvideo`
`cprintf` `cputs` `putch` `cscanf` `cgets` `getch` `getche` `kbhit` `ungetch`,
with the real scan codes (`KEY_UP`, `KEY_LEFT`, `KEY_F1` …) after a leading 0

**dos.h** — `delay` `sleep` `sound` `nosound` (beeps play in the panel)

**PRABHA extras** — `prabha_flush()`, `prabha_set_auto_flush(ms)`,
`prabha_frame_count()`, `prabha_version()`

## How it works

The runtime is a real 640×480, 16-colour, 4-page framebuffer written in C.
`getpixel` returns exactly what `putpixel` wrote, `getimage`/`putimage`
round-trip byte for byte, and `floodfill` is a genuine scanline fill. Frames are
RLE-compressed and sent as bounding-box deltas over a private pipe, so your
program's own `printf` and `scanf` keep stdout and stdin to themselves — a
30-frame animation costs about 25 KB of traffic.

`getch()` and `kbhit()` read real keystrokes from the panel: click the screen
once so it has keyboard focus.

## Runs your old Turbo C++ code unchanged

College labs still teach the classic Turbo C++ / Borland C++ style, which a
modern compiler rejects outright:

```cpp
#include <iostream.h>      // no .h header on a modern compiler
#include <conio.h>
void main()                // modern C++ requires int main()
{
    clrscr();
    int a, b;
    cout << "Sum? ";        // unqualified cout/cin — no std::
    cin >> a >> b;
    cout << "= " << a + b;
    getch();
}
```

PRABHA runs this **exactly as written** — no edits, no conversion. Turbo C++
compatibility is on by default and handles:

- `#include <iostream.h>`, `<conio.h>`, `<iomanip.h>`, `<fstream.h>`,
  `<strstream.h>`, `<constream.h>`, `<process.h>` — the old header names resolve
- `cout` / `cin` / `endl` / `setw` and friends **without** `std::`
- `void main()` and `void main(void)` — adapted to a real entry point
- `gets()` — removed from modern C/C++, provided here as a safe bounded version

Your source file on disk is never modified — the adaptation happens on a
temporary copy at compile time. If you only write standard modern C++ and want
strict compilation, set `prabha.turboCppCompatibility` to `false`.

## Compiler and debugger — PRABHA's own, on every OS (6.0)

You don't need to install anything. The first time you press `Ctrl+F9`, PRABHA
installs **its own** compiler (progress shown, no questions, once) and uses it from
then on — every student gets the same tested compiler, not whatever old MinGW /
TDM / CodeBlocks gcc happens to be on the PC.

| OS | PRABHA's own compiler | PRABHA's debugger |
|---|---|---|
| Windows | GCC 16.2 (WinLibs), ~260 MB once | gdb from the same download |
| Linux | Zig 0.17.0 — clang + libc + libc++, ~57 MB once | static gdb 17.2, ~13 MB, fetched on the first `F5` |
| macOS | Zig 0.17.0, ~57 MB once | Apple's `lldb-dap` (see limits) |

Every download is pinned to an exact version and its SHA-256 is checked before
anything is unpacked. Everything lives in PRABHA's own folder — your system PATH
is not touched. On Windows, if your user folder has a space or Hindi letters
(MinGW cannot run from such paths) PRABHA keeps its toolchain in
`C:\Users\Public\prabha-toolchain` instead.

No internet the first time? PRABHA uses a compiler already on the PC (your
setting, PATH, or the usual CodeBlocks / MSYS2 / TDM-GCC / Dev-C++ / WinGet folders)
and tells you so. `prabha.toolchain`: `bundled` (default) · `auto` (prefer the
PC's compiler) · `system` (never download). **PRABHA: Which compiler am I using?**
shows the compiler and debugger in use.

## Commands

| Command | Key |
|---|---|
| PRABHA: Run | `Ctrl+F9` (also `Ctrl+Alt+G`) |
| PRABHA: Compile | `Alt+F9` |
| PRABHA: Debug | `F5` (while debugging: `Ctrl+F7` adds the selection to Watch) |
| PRABHA: Turbo C++ → Modern C++ | ✨ in the editor title bar |
| PRABHA: Stop Program | `Ctrl+F2` |
| PRABHA: Open Example… | — |
| PRABHA: Show Output | — |
| PRABHA: Install / Choose Compiler | — |
| PRABHA: Which compiler am I using? | — |

Already use a different C/C++ debugger with `F5`? Turn off `prabha.useF5ForDebug`.

## Settings

`prabha.toolchain` (auto / bundled / system) · `prabha.runIn` (auto / console / panel) ·
`prabha.runTimeoutSeconds` · `prabha.useF5ForDebug` · `prabha.debugConsole` ·
`prabha.turboCppCompatibility` · `prabha.cCompiler` · `prabha.cppCompiler` ·
`prabha.extraFlags` · `prabha.toolchainUrl` · `prabha.scale` · `prabha.keepPanelOpenOnExit`

## Examples included

Shapes gallery, bouncing ball with page flipping, moving car, live sine wave,
arrow-key game, and a pure-conio menu. Run **PRABHA: Open Example…**

## Honest limits

- 640×480 in 16 colours is the only mode — that is VGA `VGAHI`, the mode nearly
  every Turbo C lab program used.
- `registerbgidriver`, `registerbgifont`, `installuserdriver` and
  `installuserfont` return real BGI error codes instead of pretending: there
  are no `.BGI` or `.CHR` files here.
- **macOS debugger:** Apple allows only its own debugger to control programs, so
  `F5` needs Xcode Command Line Tools (`xcode-select --install`, free, once).
  Compiling and running need nothing.
- While debugging a `graphics.h` program, breakpoints, steps and variables
  work but the 640×480 screen is not drawn — use `Ctrl+F9` to see it.
- In the debugger, `getch()` waits for Enter (the terminal is in line mode).
- Stroked fonts (TRIPLEX, GOTHIC…) are approximated with the built-in 8×8 font
  scaled up one extra step, so layouts land close to the original but the
  letterforms are not Borland's.

MIT © Kanak Prabhakar
