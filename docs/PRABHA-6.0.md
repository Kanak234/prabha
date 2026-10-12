# PRABHA 6.0 — PRD + TRD

Status: released 6.0.0 (2026-10-13) — CI green on Windows, Linux, macOS · Owner: Kanak Prabhakar · Replaces the 5.1 / 5.2 / 6.0 plan with one release.

## 1. Problem

College students in India learn C/C++ on Turbo C++ (1990s, DOS) or Dev-C++
(no meaningful update in years). Both are frozen, Turbo needs DOSBox, and the
code they teach (`iostream.h`, `void main`, `clrscr`, `getch`, `gets`) does not
compile on a modern compiler. VS Code is what students now use, but on VS Code
they must install and configure a compiler and a debugger themselves — the most
common reason a beginner gives up. A competing extension (Nitin's C-Lite IDE)
embeds a compiler; PRABHA must match that and go further.

## 2. Goal

PRABHA becomes an **"extension IDE"**: inside VS Code, a student opens a `.c` /
`.cpp` file and can **compile, run, debug and modernise** it with nothing else
installed — like Dev-C++ / Turbo C++, but maintained, cross-platform, and teaching.

## 3. Non-goals

- Writing a C/C++ compiler from scratch (GCC/Clang quality is decades of work; a
  home-made compiler would miscompile student code). PRABHA *embeds* proven
  compilers instead.
- Project/Makefile/CMake builds — single-file programs (what students write).
- Publishing on non-VS Code marketplaces for now.

## 4. Users

BCA / B.Tech / class 11–12 students; lab instructors; anyone with old Turbo C/C++ code.

## 5. Features (6.0)

| # | Feature | Behaviour |
|---|---|---|
| F1 | **Own compiler, every OS** | `bundled` (default): PRABHA's own compiler, auto-installed on the first Run; offline → PC's compiler with a notice. `auto`: PC's compiler first. Windows: pinned WinLibs GCC (includes gdb). Linux/macOS: pinned Zig 0.17.0 (clang-based C/C++ with its own libc/libc++). Downloaded once, SHA-256 verified against the official index, kept in PRABHA's storage; no PATH changes. `prabha.toolchain`: `auto` / `bundled` / `system`. |
| F2 | **Run (Ctrl+F9)** | Programs with `graphics.h`/`conio.h` → PRABHA panel (unchanged). Other programs → **PRABHA Console** (own terminal): live input, unbuffered output, Dev-C++ style footer "Process exited after X s with return value N", "Press any key to close". |
| F3 | **Compile only (Alt+F9)** | Compile, show errors, no run. |
| F4 | **Errors in Problems tab** | Compiler errors/warnings mapped to the student's file and line (clickable), each with a **Hinglish explanation** of the ~25 most common beginner errors. |
| F5 | **Crash explanations** | Segmentation fault, divide by zero, stack overflow, abort — on Linux/macOS signals and Windows NTSTATUS codes — explained in Hinglish instead of a bare exit code. |
| F6 | **Debugger** | VS Code Debug panel: breakpoints, continue, step over/into/out, call stack, locals with expandable arrays/structs, watch/hover. Linux/Windows: PRABHA's own debug adapter over **gdb/MI** (Windows: gdb from PRABHA GCC; Linux: PRABHA's pinned static gdb 17.2, auto-installed on first F5); macOS: **lldb-dap** from Xcode tools. F5 starts debugging a C/C++ file without any launch.json. Turbo keys while debugging: F7 step into, F8 step over. |
| F7 | **Turbo C++ → Modern C++** | Side-by-side panel (old / modern), card per change with Hinglish/English explanation and a quiz, Apply / Open in new tab / Copy. Same idea and UI as Punarnava. |
| F8 | **Stability** | Paths with spaces / Hindi characters, no hangs (stop button, timeout), clear messages instead of raw tool errors. |

### F7 rules (Turbo → Modern)

| Rule | Old | Modern | Lang | Safety |
|---|---|---|---|---|
| old-headers | `<iostream.h>`, `<fstream.h>`, `<iomanip.h>` | `<iostream>`, … | C++ | safe |
| std-qualify | `cout`, `cin`, `endl`, `setw` … (no `using namespace std`) | `std::cout` … | C++ | safe |
| void-main / implicit-int-main | `void main()`, `main()` | `int main()` | C, C++ | safe |
| getch-hold | final `getch();` that holds the screen | `std::cin.get();` / `getchar();` | C, C++ | safe |
| clrscr | `clrscr();` | removed (no standard equivalent) | C, C++ | review |
| conio-include | `#include <conio.h>` with no conio calls left | removed | C, C++ | safe |
| gets | `gets(s)` | `std::cin.getline(s, N)` / `fgets` + strip newline | C, C++ | safe |
| char-array-string | `char name[20]; cin >> name;` used only with `cin >>`/`cout <<` | `std::string name;` | C++ | safe |
| random | `randomize()`, `random(n)` | `std::srand(std::time(nullptr))`, `std::rand() % n` | C++ | safe |
| delay | `delay(ms)` in a console program | `std::this_thread::sleep_for(...)` | C++ | safe |
| null | `NULL` | `nullptr` | C++ | safe |
| far-near | `far` / `near` / `huge` pointer qualifiers | removed | C, C++ | safe |

`graphics.h` has no standard modern equivalent; such programs keep running on
PRABHA's runtime and only their non-graphics parts are modernised.

## 6. Acceptance criteria

- A1 Every F7 fixture: original compiles in PRABHA's Turbo mode, modern version
  compiles with **`-std=c++17 -pedantic-errors`** (C: `-std=c11`) and **without**
  PRABHA's compat headers, and both print the same output for the same input.
- A2 Code inside comments and strings is never changed.
- A3 Diagnostics: file/line/column parsed from GCC and Clang formats; every
  explained pattern has a unit test.
- A4 Crash: real programs that segfault / divide by zero / overflow the stack get
  the right explanation on Linux, macOS and Windows (CI).
- A5 Debugger: a scripted DAP session (breakpoint → stop → stack → locals → step →
  array expand → continue → exit) passes against real gdb (Linux, Windows CI) and
  lldb-dap (macOS CI).
- A6 Zig toolchain compiles and runs PRABHA's runtime, all examples and the Turbo
  C++ compat mode (verified on Linux; CI on macOS).
- A7 All suites green on Windows, Linux and macOS in CI.

## 7. Architecture (TRD)

```
extension.js            VS Code glue: commands, panel, console, debug provider
lib/toolchain.js        compiler + debugger discovery, WinLibs/Zig install (sha256)
lib/stream.js           stdout protocol router (5.0)
lib/diagnostics.js      GCC/Clang output → {file,line,col,severity,message,tip}
lib/crash.js            exit code / signal → Hinglish explanation
lib/console-core.js     PRABHA Console logic (pure; tested without VS Code)
lib/modern/             Turbo → Modern engine: lexer, rules, explain (pure)
lib/debug/mi.js         gdb/MI output parser (pure)
lib/debug/gdb-adapter.js  DAP ↔ gdb/MI debug adapter (pure Node; inline in VS Code)
media/modern-panel.*    Turbo → Modern webview
runtime/                PRABHA's own graphics.h/conio.h/dos.h runtime (unchanged)
```

Decisions:
- **Embed, don't write, the compiler** (see non-goals). Zig chosen for Linux/macOS
  because one ~55 MB download gives clang + libc + libc++ for that OS with no
  system dependency; WinLibs kept on Windows because it also ships gdb.
- **Debug adapter is inline** (DebugAdapterInlineImplementation): no separate
  process to locate, works offline; the same class runs in Node tests.
- **lldb-dap on macOS**: gdb on macOS needs code-signing; Apple's lldb is the only
  debugger that works there out of the box.
- **Console as a VS Code Pseudoterminal**: PRABHA owns input, output, exit code
  and crash text. Output is made unbuffered with an injected
  `setvbuf(stdout, 0, _IONBF, 0)` constructor so prompts appear before input.
- Modern engine is a copy of Punarnava's architecture (masking lexer → rules →
  safety checks → explanation), adapted to C/C++.

## 8. Limitations (known, documented)

- Linux: Zig ships no debugger, so PRABHA brings its own static gdb (guyush1/gdb-static
  17.2 slim, pinned SHA-256) on the first F5.
- Windows: MinGW cannot run from a path with a space or non-ASCII letters; the
  toolchain then lives in C:\\Users\\Public\\prabha-toolchain and builds in an ASCII
  work folder.
- macOS: the debugger needs Xcode Command Line Tools (`xcode-select --install`).
- Keyboard input to `graphics.h` programs while *debugging* is not supported in
  6.0 (console programs get full input).
