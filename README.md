# PRABHA — Turbo C `graphics.h` inside VS Code

Your college Turbo C / Borland C++ programs, compiled by a modern compiler and
drawn in a VS Code panel. **No DOSBox. No Turbo C. No emulator.**

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

Press **Ctrl+Alt+G** (or the ▶ button) and it runs.

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

## Compiler — built in (new in 5.0)

You don't need to set anything up. When you press Run, PRABHA finds a compiler
by itself:

1. your `prabha.cCompiler` / `prabha.cppCompiler` setting, if you changed it
2. `gcc` / `cc` / `clang` on your PATH
3. compilers that are installed but **not** on PATH — CodeBlocks' MinGW, MSYS2,
   TDM-GCC, Dev-C++, WinGet's WinLibs (the usual college-lab setups)
4. PRABHA's own GCC, if you installed it before

If none is found:

| OS | What PRABHA does |
|---|---|
| Windows | One click **Install PRABHA GCC** — downloads GCC 16.2 (WinLibs, ~260 MB, once), checks its SHA-256, and keeps it inside PRABHA's own folder. Your system PATH is not touched. |
| macOS | One click opens `xcode-select --install` (Apple's installer). |
| Linux | One click opens a terminal with the right command for your distro (`apt`, `dnf`, `pacman`, `zypper`, `apk`). |

Already have MinGW somewhere? Choose **Mera MinGW folder chuno** and point at its
`bin` folder. **PRABHA: Which compiler am I using?** shows what is being used.

## Commands

| Command | Key |
|---|---|
| PRABHA: Run graphics.h Program | `Ctrl+Alt+G` |
| PRABHA: Stop Program | — |
| PRABHA: Open Example… | — |
| PRABHA: Show Program Output | — |
| PRABHA: Install / Choose Compiler | — |
| PRABHA: Which compiler am I using? | — |

## Settings

`prabha.cCompiler` · `prabha.cppCompiler` · `prabha.extraFlags` · `prabha.toolchainUrl` ·
`prabha.scale` (panel size, default 1.5×) · `prabha.keepPanelOpenOnExit`

## Examples included

Shapes gallery, bouncing ball with page flipping, moving car, live sine wave,
arrow-key game, and a pure-conio menu. Run **PRABHA: Open Example…**

## Honest limits

- 640×480 in 16 colours is the only mode — that is VGA `VGAHI`, the mode nearly
  every Turbo C lab program used.
- `registerbgidriver`, `registerbgifont`, `installuserdriver` and
  `installuserfont` return real BGI error codes instead of pretending: there
  are no `.BGI` or `.CHR` files here.
- Stroked fonts (TRIPLEX, GOTHIC…) are approximated with the built-in 8×8 font
  scaled up one extra step, so layouts land close to the original but the
  letterforms are not Borland's.

MIT © Kanak Prabhakar
