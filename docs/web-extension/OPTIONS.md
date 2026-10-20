# PRABHA — Options for Running graphics.h in a Browser

**Date:** 2026-10-19  
**Context:** vscode.dev (Chromium) has no compiler, no process spawn, no native fs.  
**Goal:** Run Turbo C `graphics.h` / `conio.h` programs in the browser.

---

## Option 1: Compile C to WebAssembly (Emscripten)

**What it needs:**
- Emscripten SDK (`emcc`) — compiles C/C++ to WASM + JS glue
- Port `prabha_core.c` to use browser canvas / Web Audio API instead of fd 3 protocol
- Replace `delay()`, `sound()`, `kbhit()`, `getch()` with JS async equivalents
- Bundle runtime as `.wasm` + `.js` (≈ 200–500 KB gzipped)

**Rough size:**
- Emscripten toolchain: ~2 GB install (CI only)
- Output per program: 100–500 KB (.wasm + .js + HTML shell)
- PRABHA runtime (WASM): ~150 KB

**Main risk:**
- **GUESS:** Emscripten's `stdio` emulation (stdin/stdout) works for console programs but **graphics.h requires custom runtime**. The entire `prabha_core.c` (1350 lines) must be ported to use `<canvas>` and JS event loop. `kbhit()`/`getch()` need async keyboard handling — blocking calls don't exist in JS.
- Turbo C `graphics.h` assumes synchronous drawing; browser requires `requestAnimationFrame` + async frame pushes.
- `conio.h` text mode (80×30 cells) must be rendered on canvas — doable but faithful cursor/attribute behavior is tricky.
- **No `fork()`/`exec()`** — student programs that spawn processes won't work.

**Precedent:** DOSBox-X Emscripten port runs Turbo C in browser (~10 MB WASM). `graphics.h` works via SDL2→canvas.

---

## Option 2: Zig `cc` → WASM (Native WASM Target)

**What it needs:**
- Zig 0.13+ (has `zig cc -target wasm32-freestanding` or `wasm32-wasi`)
- WASI SDK / WASI libc for syscalls (fd_read, fd_write, proc_exit)
- Custom WASI `imports` for graphics: `canvas_draw`, `canvas_get_key`, `audio_beep`
- Port `prabha_core.c` to WASI + custom imports

**Rough size:**
- Zig compiler: ~57 MB (already used by PRABHA on Linux/macOS)
- WASI sysroot: ~5 MB
- Output per program: 50–200 KB .wasm
- Runtime imports (JS side): ~20 KB

**Main risk:**
- **GUESS:** WASI `wasi-libc` does not provide `graphics.h` or `conio.h`. All of `prabha_core.c` must be rewritten against custom WASI imports.
- WASI preview1/preview2 has no graphics, no sound, no keyboard polling — all must be custom imports.
- Zig's `wasm32-wasi` target is maturing but **threading / async** support limited; `kbhit()`/`getch()` blocking semantics hard to map.
- Debugging WASM in VS Code Web: needs DWARF + Chrome DevTools protocol (possible but complex).

**Precedent:** `wasm32-wasi` runs C console apps. No known `graphics.h` port.

---

## Option 3: Cheerp (C++ → WASM/JS Compiler)

**What it needs:**
- Cheerp compiler (commercial, free for non-commercial / open source)
- Annotate `prabha_core.c` with `[[cheerp::genericjs]]` for DOM bindings
- Client-side compilation: Cheerp can run in browser (via WASM) — **compile in browser!**

**Rough size:**
- Cheerp runtime: ~100 KB
- Compiler (WASM): ~20 MB (loads in browser)
- Output per program: 50–200 KB

**Main risk:**
- **GUESS:** Cheerp is **C++ focused**; C support exists but `graphics.h`/`conio.h` still need porting.
- License: Free for open source, but PRABHA is MIT — may qualify. Commercial use requires paid license.
- Browser-side compilation is innovative but **slow** (seconds to minutes) and memory-heavy.
- Debugging: Cheerp has source maps but not full DWARF.

**Precedent:** Cheerp used for porting games (e.g., Flash → HTML5). Not known for Turbo C graphics.h.

---

## Option 4: WebAssembly Interpreter (WASM3 / Wasmer / Wasmtime in Browser)

**What it needs:**
- Pre-compile `prabha_core.c` + student code to `.wasm` **on server** (or CI)
- Run `.wasm` in browser via WASM3 (interpreter, ~100 KB) or Wasmer-JS (JIT, ~2 MB)
- Provide host imports for graphics/keyboard/sound

**Rough size:**
- WASM3: ~100 KB gzipped
- Wasmer-JS: ~2 MB gzipped
- Runtime imports: ~20 KB

**Main risk:**
- **GUESS:** Still need to **compile C to WASM somewhere**. If server-side, defeats "pure web" goal. If client-side, need compiler in browser (Option 1/2/3).
- Interpreter (WASM3) is **slow** — 10–50× native. Graphics demos (bouncing ball, moving car) need 30+ FPS; interpreter may stutter.
- JIT (Wasmer) faster but larger download, complex setup.
- Same `prabha_core.c` porting effort as Option 1/2.

---

## Option 5: DOSBox / v86 / PCjs (Full x86 Emulation in Browser)

**What it needs:**
- v86 (x86 emulator in WASM, ~2 MB) or DOSBox-Emscripten (~10 MB)
- Pre-built FreeDOS + Turbo C / DJGPP / OpenWatcom image
- Student C code compiled **inside emulator** (slow) or cross-compiled to DOS .exe
- Map emulator's VGA output to canvas, keyboard to JS events

**Rough size:**
- v86: ~2 MB WASM + ~4 MB disk image
- DOSBox-Emscripten: ~10–15 MB
- Disk image with compiler: +20–50 MB

**Main risk:**
- **GUESS:** **Extremely slow** — emulating x86 in WASM is 100–1000× slower than native. `delay(10)` becomes seconds.
- Compiling inside emulator: `gcc` takes minutes. Cross-compile to DOS .exe then run — possible but complex toolchain.
- Not "PRABHA in VS Code" — it's "Turbo C in browser via emulator." Different UX.
- Keyboard/mouse capture issues in iframe/webview.

**Precedent:** PCjs runs MS-DOS 6.22 + Turbo C in browser. v86 runs Linux/Windows 9x. Used for retro computing demos.

---

## Option 6: Server-Side Compilation + WASM Streaming (Hybrid)

**What it needs:**
- Backend service (GitHub Codespaces, custom server, Cloudflare Workers) with PRABHA compiler
- Extension on vscode.dev sends source → server compiles to WASM (Emscripten/Zig) → returns `.wasm`
- Browser loads `.wasm`, runs with JS runtime imports (canvas, audio, keyboard)
- **Graphics panel** becomes a WASM host

**Rough size:**
- Server: persistent (Codespaces) or serverless
- Network: source → server (KB), WASM ← server (100–500 KB)
- Client runtime: ~50 KB JS

**Main risk:**
- **GUESS:** Requires **infrastructure** (server, auth, billing, privacy). Not "offline-first" like desktop PRABHA.
- Latency: compile round-trip 1–5 s. Acceptable for education?
- Offline: completely broken without server.
- **Vercel/Cloudflare Workers have CPU time limits** (10–30 s) — linking large programs may timeout.
- CORS, CSP, WASM streaming compilation restrictions on some hosts.

**Precedent:** GitHub Codespaces, Replit, CodeSandbox, Godbolt Compiler Explorer.

---

## Option 7: Transpile C → JavaScript (Emscripten + Embind / Wasm-Component-Model)

**What it needs:**
- Compile C to JS (not WASM) via Emscripten `-s SIDE_MODULE=0 -s EXPORT_ES6=1`
- Or use `wasm-component-model` with WASI 0.2 + custom interfaces
- Student code + `prabha_core.c` → single ES module

**Rough size:**
- Output: 200–800 KB JS (larger than WASM)
- No WASM streaming compile; parses as JS

**Main risk:**
- **GUESS:** JS output is **larger and slower to parse** than WASM. No real advantage unless WASM unsupported (all modern browsers support it).
- Same porting effort for `prabha_core.c`.

---

## Comparison Table

| Option | Compile in Browser? | Graphics.h Support | Conio.h Support | Offline? | Download Size | Complexity | Maturity |
|--------|---------------------|-------------------|-----------------|----------|---------------|------------|----------|
| 1. Emscripten | ❌ (needs CI/server) | ✅ (port needed) | ✅ (port needed) | ❌ (needs emcc) | 100–500 KB/prog | High | High |
| 2. Zig WASM | ❌ (needs Zig binary) | ✅ (port needed) | ✅ (port needed) | ❌ | 50–200 KB/prog | High | Medium |
| 3. Cheerp | ✅ (compiler in WASM) | ✅ (port needed) | ✅ (port needed) | ✅ | 20 MB compiler + prog | Medium | Medium |
| 4. WASM Interpreter | ❌ (needs compiler) | ✅ (port needed) | ✅ (port needed) | ✅ | 100 KB–2 MB runtime | Medium | Medium |
| 5. x86 Emulator | ✅ (Turbo C inside) | ✅ (native BGI) | ✅ (native) | ✅ | 10–50 MB | Low (reuse) | High |
| 6. Server Compile | ❌ (server compiles) | ✅ (port needed) | ✅ (port needed) | ❌ | 50–500 KB/prog | High (infra) | High |
| 7. C→JS Transpile | ❌ (needs emcc) | ✅ (port needed) | ✅ (port needed) | ❌ | 200–800 KB/prog | High | Medium |

---

## Critical Unknowns (Marked GUESS)

1. **GUESS:** Porting `prabha_core.c` (1350 lines) to any browser target is **2–4 weeks of focused work** — not a weekend task. It handles: 4-page framebuffer, RLE encoding, palette, viewport, fill patterns, flood fill, text rendering (8×8 font), keyboard protocol, sound, mouse (not yet), images, pages.

2. **GUESS:** `conio.h` text mode (80×30, 8×16 cells, attributes, cursor shapes, windowing, scroll) is **surprisingly complex** to replicate faithfully on `<canvas>`. DOSBox does it via SDL; browser canvas needs custom renderer.

3. **GUESS:** **Blocking `getch()`/`kbhit()`** — Turbo C programs spin on `while (!kbhit())` or block on `getch()`. In browser, **cannot block the main thread**. Must rewrite runtime to use async/await or callbacks, which **breaks source compatibility** unless the whole program is transformed (continuation-passing style or asyncify).

4. **GUESS:** **Emscripten's `Asyncify`** can transform blocking calls to async, but adds ~20% size overhead and requires careful annotation. Zig WASM has no Asyncify equivalent yet.

5. **GUESS:** **Debugging** (F5, breakpoints, variables) in browser for WASM: possible via Chrome DevTools Protocol + DWARF, but VS Code Web's debug adapter API is limited. No gdb/lldb in browser.

6. **GUESS:** **File I/O** (`fopen`, `fread`, `fwrite`) — student programs read/write files. Browser has no fs. Options: IndexedDB virtual FS, OPFS (Origin Private File System), or disable file I/O.

---

## Recommendation Matrix (For Decision)

| Priority | Approach | Why |
|----------|----------|-----|
| **If "must run on vscode.dev today"** | Option 5 (v86/DOSBox) | Only one that runs **unmodified Turbo C binaries** including graphics.h. Heavy download but works. |
| **If "PRABHA-like UX, can invest 2–3 months"** | Option 1 (Emscripten) + Option 6 (Server) | Best long-term: native WASM performance, PRABHA panel as host, server compiles. |
| **If "no server, pure client-side"** | Option 3 (Cheerp) | Only compiler that runs **in browser**. License check needed. |
| **If "educational demo only, simple programs"** | Option 4 (WASM3 interpreter) + precompiled WASM | Small runtime, but need precompiled `.wasm` files (no user code compile). |
| **If "just the converter/teacher tools"** | Extract `lib/modern/` + webview | **Do this first.** Works today on web. High value for teachers. |

---

## Minimal Viable Web Feature Set (No Compiler)

These work **today** on vscode.dev with minimal changes:
1. **Turbo → Modern Converter** — paste code, see side-by-side diff, explanations, quiz
2. **Example Viewer** — browse 7 bundled examples, read code, see expected output (static screenshots/GIFs)
3. **Diagnostics Explorer** — paste compiler errors, see Hinglish tips
4. **Crash Explanation Lookup** — paste exit code/signal, get Hinglish explanation
5. **Settings / Docs** — all declarative

**This is a "PRABHA Teacher Edition" for web** — no compile/run/debug, but high educational value.