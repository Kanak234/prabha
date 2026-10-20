# PRABHA Feature Map — Web Extension Compatibility

**Source:** `package.json` contributes + all source files  
**Date:** 2026-10-19  
**Legend:**
- ✅ **Works on web as-is** — Pure VS Code API / JavaScript, no Node dependencies
- ⚠️ **Works on web with changes** — Needs polyfills, bundled assets, or architecture change
- ❌ **Cannot work on web** — Fundamentally requires Node/OS capabilities (compiler, process spawn, fs, native debugger)

---

## Features from `package.json` Contributes

| # | Feature | Command/Entry | Works on Web? | Details |
|---|---------|---------------|---------------|---------|
| 1 | **Run (Ctrl+F9)** | `prabha.run` | ❌ | Spawns compiler → compiles → spawns program (console or panel). Needs `child_process`, `fs`, compiler binary. |
| 2 | **Compile (Alt+F9)** | `prabha.compile` | ❌ | Same as Run but stops after compile. Needs compiler, `fs` for temp files. |
| 3 | **Debug (F5)** | `prabha.debug` | ❌ | Spawns gdb/lldb-dap via DAP, needs MI protocol, debug build (-g), temp files. |
| 4 | **Turbo → Modern (explain)** | `prabha.modernize` | ✅ | Pure JS: `lib/modern/` engine, webview panel. No Node APIs. |
| 5 | **Stop Program** | `prabha.stop` | ⚠️ | Kills child process (`child.kill()`). On web: only relevant if program running. |
| 6 | **Show Output** | `prabha.showOutput` | ✅ | `vscode.window.createOutputChannel` — web-compatible. |
| 7 | **Open Example** | `prabha.openExample` | ⚠️ | Uses `fs.readdirSync` to list examples. Fix: bundle examples as static assets. |
| 8 | **Install / Choose Compiler** | `prabha.installCompiler` | ❌ | Downloads (HTTPS), verifies (crypto), extracts (tar/zip), writes to disk. |
| 9 | **Compiler Info** | `prabha.compilerInfo` | ❌ | Detects compiler via `fs`, `child_process`, `process.platform`. |

---

## Features from Source Code (User-Facing)

| # | Feature | Source | Works on Web? | Details |
|---|---------|--------|---------------|---------|
| 10 | **PRABHA Console** (Dev-C++ style terminal) | `extension.js:runConsole()`, `lib/console-core.js` | ❌ | Uses `vscode.window.createTerminal({ pty })` with `child_process.spawn`. PTY not available on web. |
| 11 | **Graphics Panel (640×480)** | `extension.js:runPanel()`, `media/modern-panel.js` + HTML | ⚠️ | Webview HTML/JS is web-compatible. **But** needs compiled program sending frames via fd 3 / stdout protocol. |
| 12 | **Graphics.h / Conio.h Runtime** | `runtime/prabha_core.c`, headers | ❌ (as C) | C code compiled to native binary. **Could work if compiled to WebAssembly** and runtime adapted to browser canvas. |
| 13 | **Compiler Auto-Detection** | `lib/toolchain.js:detect()` | ❌ | Scans filesystem, runs `gcc --version`, checks known paths. |
| 14 | **Bundled Compiler Install (WinLibs GCC / Zig)** | `lib/toolchain.js:installWindows()`, `installZig()` | ❌ | HTTPS download, SHA-256 verify, tar/zip extract, filesystem write. |
| 15 | **Diagnostics (Problems Tab + Hinglish Tips)** | `lib/diagnostics.js`, `extension.js:showDiagnostics()` | ✅ | Pure JS regex parsing. Works if compile output provided. |
| 16 | **Crash Explanations (Segfault → Hinglish)** | `lib/crash.js`, `extension.js:explainExit()` | ✅ | Pure JS mapping of exit codes/signals. |
| 17 | **Turbo C++ Compatibility Mode** | `lib/modern/turbo-adapt.js`, `runtime/compat/` | ⚠️ | Source rewrite (JS) works. Headers are text. **But** needs compiler to actually build. |
| 18 | **Modernize Engine (Rules + Explanations)** | `lib/modern/engine.js`, `rules.js`, `lexer.js`, `explain.js` | ✅ | 100% pure JS. Side-by-side diff, quiz, apply. |
| 19 | **Same-Output Verification** | `extension.js:sameOutputCheck()` | ❌ | Compiles both versions, runs both, compares stdout. Needs compiler + spawn. |
| 20 | **Debug Adapter (GDB MI → DAP)** | `lib/debug/gdb-adapter.js`, `lib/debug/mi.js` | ❌ | Spawns gdb, speaks MI protocol. Web cannot spawn gdb. |
| 21 | **Keybindings (Ctrl+F9, Alt+F9, F7, F8...)** | `package.json:keybindings` | ✅ | Declarative. Work if commands work. |
| 22 | **Configuration Settings** | `package.json:configuration` | ✅ | Declarative. Settings UI works on web. |
| 23 | **Status Bar Item** | `extension.js:activate()` | ✅ | `vscode.window.createStatusBarItem` — web-compatible. |
| 24 | **Output Channel** | `extension.js:activate()` | ✅ | `vscode.window.createOutputChannel` — web-compatible. |

---

## Summary Table (Condensed)

| Feature Category | Works on Web | With Changes | Cannot Work |
|------------------|--------------|--------------|-------------|
| **Turbo → Modern Converter** | ✅ | — | — |
| **Diagnostics Parsing** | ✅ | — | — |
| **Crash Explanations** | ✅ | — | — |
| **Webview Panels (UI)** | ✅ | — | — |
| **Keybindings / Menus / Config** | ✅ | — | — |
| **Open Examples** | — | ⚠️ Bundle examples as static assets | — |
| **Compiler Detection** | — | — | ❌ Needs fs, process, child_process |
| **Compiler Install** | — | — | ❌ Needs https, crypto, fs, tar/zip |
| **Compile C/C++** | — | — | ❌ Needs compiler binary + spawn |
| **Run Console Programs** | — | — | ❌ Needs compiler + spawn + PTY |
| **Run Graphics Programs** | — | ⚠️ If C→WASM + runtime port | ❌ Native binary + fd 3 protocol |
| **Debug (F5)** | — | — | ❌ Needs gdb/lldb-dap subprocess |
| **Stop Program** | — | ⚠️ Only if running | ❌ Needs child_process.kill |

---

## Honest Assessment

**The core "IDE" features (compile, run, debug) CANNOT work on vscode.dev** because:
1. **No compiler** — vscode.dev has no gcc, clang, zig, or any native toolchain
2. **No process spawn** — Web extensions cannot spawn child processes
3. **No file system** — Cannot write temp build directories or read compiler outputs
4. **No native debugger** — gdb/lldb-dap are native binaries requiring subprocess

**What COULD work on web (with effort):**
- The **Turbo → Modern converter** as a standalone code transformation tool
- **Syntax-aware diagnostics display** if fed compiler output from elsewhere
- **Graphics panel UI** as a viewer for pre-recorded or WASM-streamed frames
- **Educational content** (explanations, quiz, examples) as static web content

**What would need a complete re-architecture for web:**
- Compile C/C++ → WebAssembly (Emscripten / Zig WASM / Cheerp)
- Run graphics.h in browser (port `prabha_core.c` to WASM + canvas)
- Debug in browser (WASM debugging via DWARF + browser DevTools protocol)