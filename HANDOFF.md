# HANDOFF — PRABHA Web Extension Audit

**Branch:** `web-audit`  
**Date:** 2026-10-19  
**Commit:** `$(git rev-parse HEAD)`

---

## Files Created

| File | Purpose |
|------|---------|
| `docs/web-extension/AUDIT.md` | Complete audit of Node-only API usage (150+ locations across 22 files) |
| `docs/web-extension/FEATURE-MAP.md` | Feature-by-feature compatibility table (24 features) |
| `docs/web-extension/OPTIONS.md` | 7 options for running graphics.h in browser with risks/sizes |
| `HANDOFF.md` | This file |

---

## Commands Run + Real Output

### `npm install`
```
up to date, audited 1 package in 65ms
found 0 vulnerabilities
```

### `node tests/build-test.js`
```
build-test · gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0
  ✓ turbo marks.cpp compiles
  ✓ turbo marks.cpp runs (exit 0)
  ✓ marks.cpp: user file not modified
  ... (38 tests total)
  ✓ usesPanel detection

build-test: 38 passed, 0 failed
```

### `node tests/modern-test.js`
```
[1] unit — Turbo → Modern engine
  ok   code in comments is never touched
  ... (26 unit tests)
[2] compile + same output (compilers: gcc / g++)
  ok   PRABHA runtime compiles
  ... (34 compile+run tests)

60 passed, 0 failed
```

### `node tests/integration.js`
```
  ok   program exit 0 (keys decoded right in C)
  ok   init message on fd3
  ok   frames on fd3
  ok   end message on close
  ok   printf stayed on stdout, clean
  ok   stdout carried no protocol
  ok   getch asked the panel each time

INTEGRATION PASSED
```

### `bash tests/run-all.sh`
```
== compiling runtime ==
== compiling every example ==
  ok  examples/01_shapes.c
  ok  examples/02_bouncing_ball.c
  ok  examples/03_moving_car.c
  ok  examples/04_sine_wave.c
  ok  examples/05_keyboard_game.c
  ok  examples/06_conio_menu.c
== API coverage program ==
2 frames decoded; saved ['/tmp/pr_all_frame_001.png']
== conio program ==
26 frames decoded; saved ['/tmp/pr_conio_frame_025.png']
== extension contract (fd3, stdin keys, stdout split) ==
  ok   program exit 0 (keys decoded right in C)
  ok   init message on fd3
  ok   frames on fd3
  ok   end message on close
  ok   printf stayed on stdout, clean
  ok   stdout carried no protocol
  ok   getch asked the panel each time

INTEGRATION PASSED
ALL PRABHA TESTS PASSED
```

### `node tests/extension-test.js`
```
[router] stdout splitting
  ok   protocol lines decoded across 3-byte chunks
  ...
[toolchain]
  ok   a working compiler is detected on linux: gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0
  ...
[extension] PRABHA on mock VS Code
  ok   version is 6.0.1
  ok   PRABHA panel opens
  ok   panel receives init + frames from the real compiled program (2 frames)
[console] Dev-C++ style run
  ok   PRABHA Console terminal opens
  ok   prompt shows before input (unbuffered stdout)
  ok   input reached the program (backspace handled): Sum = 42
  ...
[diagnostics] errors in Problems tab
  ok   error popup names the line + Hinglish tip
  ...
[modern] Turbo → Modern panel
  ok   Modern panel opens with CSP + script
  ok   changes with explanations
  ok   same-output check: Turbo build == strict modern build
  ...
[debug] F5 wiring
  ok   debug provider + adapter factory registered
  ok   F5 compiles with -g and picks gdb
  ok   stopped at breakpoint
  ok   program runs to the end
  ...

48 passed, 0 failed
```

---

## Feature Map Summary (5 Lines)

1. **✅ Fully web-compatible:** Turbo→Modern converter, diagnostics parsing, crash explanations, webview UIs, keybindings, settings — pure VS Code API / JavaScript.

2. **⚠️ Works with changes:** Open Examples (bundle as static assets), Graphics Panel UI (webview works, but needs WASM runtime for frames).

3. **❌ Cannot work on vscode.dev:** Compiler detection/install (needs fs, https, crypto, child_process, OS paths), Compile/Run (needs gcc/clang/zig + spawn + temp fs), Debug (needs gdb/lldb-dap subprocess + MI protocol).

4. **Core blocker:** vscode.dev has **no C/C++ compiler, no process spawn, no native file system, no native debugger** — the extension's core value (compile+run+debug Turbo C with graphics.h) fundamentally requires all four.

5. **Viable web subset:** A "PRABHA Teacher Edition" with converter, example viewer, diagnostics explainer, crash lookup — works today on web with minimal changes.

---

## Open Questions

1. **Should the web target be "PRABHA Teacher Edition" (converter + educational tools only) or full IDE?** The audit shows full IDE is impossible without server-side compilation or WASM toolchain.

2. **If full IDE: server-side (GitHub Codespaces / custom backend) or client-side WASM (Emscripten / Zig / Cheerp)?** Server is easier but requires infra; client-side is offline-capable but 2–3 months porting `prabha_core.c`.

3. **Blocking `getch()`/`kbhit()` in browser:** Turbo C programs block on input. Options: Asyncify (Emscripten), rewrite runtime to async (breaks source compat), or Web Workers with SharedArrayBuffer (complex, COOP/COEP headers needed).

4. **File I/O (`fopen`, `fwrite`) for student programs:** Browser has no fs. OPFS (Origin Private File System) or IndexedDB virtual FS? Or disable file I/O for web?

5. **Debugging on web:** VS Code Web debug adapter API is limited. DWARF + Chrome DevTools Protocol possible but untested for C/C++ WASM.

6. **License for Cheerp (Option 3):** PRABHA is MIT. Cheerp free for open source — does that cover PRABHA's use case?

7. **Graphics panel fidelity:** Porting 1350-line `prabha_core.c` (framebuffer, palette, flood fill, text, images, pages, sound) to canvas/WebAudio — estimated 2–4 weeks. Is 100% BGI compatibility required?

8. **Distribution:** If WASM route, how to deliver? npm package with `.wasm` files? CDN? Bundle in extension?

---

## Next Steps (For Decision)

1. **Decide scope:** Teacher Edition (web now) vs Full IDE (3–6 months).
2. **If Full IDE:** Choose Option 1 (Emscripten + server) or Option 3 (Cheerp client-side) or Option 6 (Codespaces).
3. **Prototype:** Port one graphics example (e.g., `01_shapes.c`) to WASM + canvas to validate approach.
4. **Extract web-compatible core:** Move `lib/modern/`, `lib/diagnostics.js`, `lib/crash.js`, `lib/stream.js` to separate npm package for web use.