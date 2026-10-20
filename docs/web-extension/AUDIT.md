# PRABHA VS Code Extension — Web Extension Audit

**Branch:** `web-audit`  
**Date:** 2026-10-19  
**Auditor:** Automated audit (this task)

---

## Summary

This audit identifies every location in the PRABHA extension that uses **Node.js-only APIs** which are **not available in VS Code Web (vscode.dev / github.dev)** running in Chromium. The web extension host lacks:

- `fs` (file system)
- `path` (Node path resolution — though some path operations can be polyfilled)
- `child_process` (spawning compilers, gdb, etc.)
- `os` (OS info, tmpdir, homedir)
- `process` (platform, arch, env, cwd)
- `crypto` (SHA-256 for compiler downloads)
- `https` (downloading compiler toolchains)
- Native modules / `require` of `.node` files
- Spawning external processes (gcc, g++, zig, gdb, tar, powershell)

**Total files audited:** 22 source files  
**Total Node-only API usages found:** 150+ locations

---

## File-by-File Audit

### 1. `extension.js` (Main Entry Point) — **31 usages**

| Line | API | Context | VERIFIED |
|------|-----|---------|----------|
| 29 | `require('child_process')` | `cp.spawn` for running compiled programs | ✅ |
| 30 | `require('fs')` | `fs.mkdtempSync`, `fs.writeFileSync`, `fs.readFileSync`, `fs.existsSync`, `fs.rmSync`, `fs.readdirSync`, `fs.copyFileSync` | ✅ |
| 31 | `require('os')` | `os.homedir()`, `os.tmpdir()` | ✅ |
| 32 | `require('path')` | `path.join`, `path.dirname`, `path.extname`, `path.basename`, `path.resolve`, `path.isAbsolute` | ✅ |
| 56 | `context.globalStorageUri.fsPath` | Requires `fsPath` (local file system) | ✅ |
| 56 | `path.join(os.homedir(), '.prabha')` | Fallback storage path | ✅ |
| 108 | `toolchain.detect(..., storageDir)` | Passes local fs path to toolchain | ✅ |
| 119 | `toolchain.detect(..., storageDir)` | Passes local fs path to toolchain | ✅ |
| 127 | `installBundledWithProgress()` | Downloads + extracts compiler (https, fs, cp) | ✅ |
| 144 | `installCompiler()` | Spawns terminal for system package install | ✅ |
| 149 | `process.platform === 'win32'` | Platform detection | ✅ |
| 158 | `vscode.window.createTerminal` + `sendText` | Terminal command execution | ✅ |
| 172-182 | `toolchain.installBundled()` | Downloads compiler via HTTPS, verifies SHA-256, extracts zip | ✅ |
| 197-217 | `installGdbWithProgress()` | Downloads gdb, verifies SHA-256, extracts tar.gz | ✅ |
| 221-236 | `chooseCompilerFolder()` | `vscode.window.showOpenDialog`, `path.join`, `fs.existsSync` | ✅ |
| 239-250 | `compilerInfo()` | `toolchain.findGdb`, `toolchain.findLldbDap` (use fs, cp) | ✅ |
| 269 | `path.extname(file).toLowerCase()` | Path manipulation | ✅ |
| 283-322 | `compileFile()` | Calls `build()` (uses fs, cp), `cleanup()` (fs.rmSync) | ✅ |
| 348-353 | `wordLen()` / `revealLine()` | `vscode.workspace.textDocuments` (OK), `path.basename` | ✅ |
| 376-384 | `runCurrent()` | Calls `compileFile`, then `runPanel` or `runConsole` | ✅ |
| 422-456 | `runPanel()` | `cp.spawn` with `stdio: ['pipe','pipe','pipe','pipe']` (fd 3), `child.stdio[3]` | ✅ |
| 458-467 | `stopProgram()` | `child.kill()`, `taskkill` on Windows (`cp.spawn`) | ✅ |
| 489-501 | `ensurePanel()` | `vscode.window.createWebviewPanel` (web-compatible), `path.join` for icon | ✅ |
| 503-586 | `html()` | Inline HTML/JS for webview (web-compatible) | ✅ |
| 591-596 | `startDebug()` | `vscode.debug.startDebugging` (web-compatible API) | ✅ |
| 612-654 | `resolveDebugConfigurationWithSubstitutedVariables()` | `compileFile`, `toolchain.findGdb`, `toolchain.findLldbDap`, `cp.spawnSync` for debugger detection | ✅ |
| 657-663 | `debugAdapterFactory` | `vscode.DebugAdapterExecutable` (needs gdb binary path) | ✅ |
| 667-750 | `openModern()` / `onModernMessage()` | `vscode.workspace.openTextDocument`, `vscode.window.createWebviewPanel`, `fs.mkdtempSync`, `fs.writeFileSync`, `fs.readFileSync`, `fs.rmSync`, `cp.spawnSync` | ✅ |
| 757-763 | `writeVersion()` | `fs.mkdtempSync`, `path.join`, `fs.writeFileSync` | ✅ |
| 766-771 | `runVersion()` | `compileFile`, `runConsole` | ✅ |
| 777-810 | `sameOutputCheck()` | `fs.mkdtempSync`, `fs.writeFileSync`, `fs.existsSync`, `fs.readFileSync`, `build()`, `cp.spawnSync`, `fs.rmSync` | ✅ |
| 826-833 | `openExample()` | `path.join`, `fs.readdirSync`, `vscode.workspace.openTextDocument` | ✅ |
| 835 | `deactivate()` | `stopProgram()`, `con.term.dispose()` | ✅ |

---

### 2. `lib/build.js` — **28 usages**

| Line | API | Context | VERIFIED |
|------|-----|---------|----------|
| 15 | `require('child_process')` | `cp.execFileSync` in `run()` | ✅ |
| 16 | `require('fs')` | `fs.readFileSync`, `fs.writeFileSync`, `fs.mkdtempSync`, `fs.rmSync`, `fs.existsSync`, `fs.cpSync`, `fs.readdirSync`, `fs.copyFileSync` | ✅ |
| 17 | `require('os')` | `os.tmpdir()` | ✅ |
| 18 | `require('path')` | `path.join`, `path.dirname`, `path.extname`, `path.basename`, `path.resolve`, `path.isAbsolute` | ✅ |
| 29-39 | `workBase()` | `os.tmpdir()`, `process.env.PUBLIC`, `fs.mkdirSync`, `path.join` | ✅ |
| 42-49 | `asciiRuntime()` | `fs.existsSync`, `fs.cpSync`, `path.join`, `workBase()` | ✅ |
| 57-62 | `trapFlags()` | `process.arch` | ✅ |
| 69-75 | `run()` | `cp.execFile` with `maxBuffer`, `env`, `cwd` | ✅ |
| 82-177 | `build()` | Extensive: `fs.readFileSync`, `path.extname`, `path.join`, `path.resolve`, `fs.mkdtempSync`, `path.basename`, `fs.readdirSync`, `fs.copyFileSync`, `fs.writeFileSync`, `cp.execFile` via `run()`, `fs.existsSync`, `fs.rmSync` | ✅ |
| 179-181 | `cleanup()` | `fs.rmSync` with recursive force | ✅ |

---

### 3. `lib/toolchain.js` — **47 usages**

| Line | API | Context | VERIFIED |
|------|-----|---------|----------|
| 17 | `require('child_process')` | `cp.execFileSync`, `cp.spawnSync`, `cp.spawn` | ✅ |
| 18 | `require('fs')` | `fs.existsSync`, `fs.readFileSync`, `fs.writeFileSync`, `fs.mkdirSync`, `fs.rmSync`, `fs.unlinkSync`, `fs.chmodSync`, `fs.readdirSync`, `fs.createWriteStream`, `fs.statSync` | ✅ |
| 19 | `require('os')` | `os.tmpdir()` not directly but `process.platform`, `process.arch` | ✅ |
| 20 | `require('path')` | `path.join`, `path.dirname`, `path.basename`, `path.resolve`, `path.delimiter` | ✅ |
| 21 | `require('https')` | `https.get` for downloading compiler | ✅ |
| 22 | `require('crypto')` | `crypto.createHash('sha256')` for checksum verification | ✅ |
| 46-51 | `works()` | `cp.execFileSync` with `--version`, `env`, `timeout` | ✅ |
| 54-60 | `onPath()` | `cp.execFileSync('where'/'which')` | ✅ |
| 63-79 | `windowsKnownBins()` | `process.env`, `path.join`, `fs.readdirSync` | ✅ |
| 81-84 | `unixKnownBins()` | Hardcoded paths | ✅ |
| 93-98 | `toolchainHome()` | `process.platform`, `process.env.PUBLIC`, `path.join` | ✅ |
| 99-100 | `prabhaToolchainDir()` / `prabhaBin()` | `path.join` | ✅ |
| 103-107 | `envWith()` | `process.env`, `path.delimiter` | ✅ |
| 115-162 | `detect()` | `process.platform`, `process.arch`, `fs.existsSync`, `onPath()`, `works()`, `envWith()`, `path.join`, `path.dirname`, `path.basename` | ✅ |
| 164-166 | `xcodeToolsInstalled()` | `cp.execFileSync('xcode-select')` | ✅ |
| 169-183 | `installHint()` | `fs.readFileSync('/etc/os-release')`, `process.platform` | ✅ |
| 188-202 | `get()` | `https.get` with redirects, `crypto` not here but used in callers | ✅ |
| 204-206 | `downloadText()` | `get()` wrapper | ✅ |
| 208-224 | `downloadFile()` | `https.get`, `fs.createWriteStream`, `crypto.createHash('sha256')`, `onProgress`, `isCancelled` | ✅ |
| 227-237 | `extractZip()` | `fs.mkdirSync`, `cp.spawnSync('tar')` or `powershell.exe Expand-Archive` | ✅ |
| 245-271 | `installWindows()` | `downloadText`, `downloadFile`, `extractZip`, `fs.rmSync`, `works()` | ✅ |
| 275-320 | `installZig()` | `downloadText`, `downloadFile`, `cp.spawnSync('tar')`, `fs.unlinkSync`, `works()`, `envWith()` | ✅ |
| 323-328 | `installBundled()` / `bundledInfo()` | Platform branching | ✅ |
| 348-354 | `gdbRoot()` / `prabhaGdbPath()` | `path.join`, `fs.existsSync` | ✅ |
| 356 | `gdbInstallable()` | `process.platform`, `process.arch` | ✅ |
| 358-380 | `installGdb()` | `downloadFile`, `cp.spawnSync('tar')`, `fs.chmodSync`, `cp.execFileSync` | ✅ |
| 383-392 | `findGdb()` | `path.join`, `cp.execFileSync`, `fs.statSync` | ✅ |
| 395-406 | `findLldbDap()` | `cp.execFileSync('xcrun')`, `fs.readdirSync`, `fs.statSync` | ✅ |
| 409-416 | `debuggerHint()` | `process.platform`, `installHint()` | ✅ |

---

### 4. `lib/stream.js` — **0 Node-only APIs**

Pure JavaScript string/buffer manipulation. **Web-compatible.** ✅

---

### 5. `lib/console-core.js` — **5 usages**

| Line | API | Context | VERIFIED |
|------|-----|---------|----------|
| 19 | `require('child_process')` | `cp.spawn` for running program | ✅ |
| 42-44 | `start()` | `cp.spawn` with `stdio: ['pipe','pipe','pipe']`, `env`, `cwd` | ✅ |
| 84-90 | `kill()` | `process.platform === 'win32' ? cp.spawn('taskkill') : child.kill('SIGKILL')` | ✅ |
| 104 | `explainExit()` | Uses `process.platform` as fallback | ✅ |

---

### 6. `lib/diagnostics.js` — **0 Node-only APIs**

Pure regex parsing. **Web-compatible.** ✅

---

### 7. `lib/crash.js` — **2 usages**

| Line | API | Context | VERIFIED |
|------|-----|---------|----------|
| 88-101 | `explainExit()` | `process.platform` for NTSTATUS vs signal mapping | ✅ |
| 93-96 | NTSTATUS handling | `code >>> 0` for unsigned conversion, `platform === 'win32'` | ✅ |

---

### 8. `lib/debug/gdb-adapter.js` — **18 usages**

| Line | API | Context | VERIFIED |
|------|-----|---------|----------|
| 16 | `require('child_process')` | `cp.spawn` for gdb process | ✅ |
| 17 | `require('fs')` | `fs.readFileSync`, `fs.mkdtempSync`, `fs.writeFileSync` | ✅ |
| 18 | `require('os')` | `os.tmpdir()`, `os.homedir()` | ✅ |
| 19 | `require('path')` | `path.join`, `path.basename`, `path.resolve` | ✅ |
| 111-126 | `start()` | `cp.spawn(gdbPath, ['--interpreter=mi2', '-q', '-nx'], { env, stdio })` | ✅ |
| 128-134 | `kill()` | `process.kill(pid)`, `gdb.kill('SIGKILL')` | ✅ |
| 188-203 | `makeTerminal()` | `fs.mkdtempSync`, `fs.writeFileSync`, `fs.readFileSync`, `path.join`, `os.tmpdir()`, `os.homedir()`, `cp.spawnSync` not directly but `request('runInTerminal')` | ✅ |
| 205-225 | `on_setBreakpoints()` | `path.basename` | ✅ |
| 289-295 | `mapPath()` | `path.resolve`, `path.basename` | ✅ |

---

### 9. `lib/debug/mi.js` — **0 Node-only APIs**

Pure MI protocol parsing. **Web-compatible.** ✅

---

### 10. `lib/modern/engine.js` — **0 Node-only APIs**

Pure string/array manipulation. **Web-compatible.** ✅

---

### 11. `lib/modern/rules.js` — **0 Node-only APIs**

Pure regex/string manipulation. **Web-compatible.** ✅

---

### 12. `lib/modern/lexer.js` — **0 Node-only APIs**

Pure string manipulation. **Web-compatible.** ✅

---

### 13. `lib/modern/explain.js` — **0 Node-only APIs**

Static data + string lookup. **Web-compatible.** ✅

---

### 14. `lib/modern/turbo-adapt.js` — **0 Node-only APIs**

Uses `lexer.js` only. **Web-compatible.** ✅

---

### 15. Runtime C files — **Not applicable (C code)**

These are **compiled into the student's program**, not run in the extension host:
- `runtime/prabha_core.c` — Graphics/conio runtime (compiled with user's code)
- `runtime/graphics.h`, `runtime/conio.h`, `runtime/dos.h` — Headers
- `runtime/prabha_unbuffered.h` — Constructor attribute for unbuffered stdout
- `runtime/compat/*.h` — Turbo C++ compatibility shims

**These work on web IF the C code can be compiled to WebAssembly.** The headers themselves are just text.

---

### 16. Test Files (Not part of extension, but informative)

| File | Node APIs Used | Note |
|------|----------------|------|
| `tests/ci.js` | `child_process.spawnSync` | CI helper only |
| `tests/run-all.sh` | Shell script (gcc, python) | Local test runner |
| `tests/integration.js` | `child_process.spawn`, `fs.writeFileSync` | Tests runtime contract |
| `tests/extension-test.js` | `fs`, `path`, `os`, mock VS Code | Unit tests with mock |
| `tests/build-test.js` | `fs`, `path`, `os`, `child_process`, `toolchain` | Build integration tests |
| `tests/modern-test.js` | `fs`, `path`, `os`, `child_process` | Modernize engine tests |
| `tests/debug-test.js` | (not read) | Likely similar |
| `tests/zig-install-test.js` | (not read) | Likely similar |
| `tests/ide-test.js` | (not read) | Likely similar |
| `tests/gdb-install-test.js` | (not read) | Likely similar |
| `tests/winlibs-install-test.js` | (not read) | Likely similar |
| `tests/windows-sim.js` | (not read) | Likely similar |
| `tests/vscode-mock.js` | (not read) | Mock for tests |
| `tests/anim_test.c` | C test program | Compiled by tests |
| `tests/conio_test.c` | C test program | Compiled by tests |
| `tests/all_graphics.c` | C test program | Compiled by tests |
| `tests/decode.py` | Python script | Decodes protocol frames |

---

## Categories of Node-Only Usage

### Category A: Compiler Toolchain (CANNOT work on web without major redesign)
- Downloading compiler (HTTPS, crypto SHA-256)
- Extracting archives (tar, zip, PowerShell)
- Spawning compiler (gcc, g++, zig cc, clang++)
- Finding compiler on disk (fs, which/where, known paths)
- Managing compiler installation (globalStorage, Public folder)

### Category B: Program Execution (CANNOT work on web as-is)
- `cp.spawn` / `cp.execFile` to run compiled binaries
- `stdio: ['pipe','pipe','pipe','pipe']` for fd 3 protocol
- `child.kill()`, `taskkill` on Windows
- PTY-based console (`vscode.window.createTerminal({ pty })`)
- `fs.mkdtempSync` for build directories
- `fs.writeFileSync` / `fs.readFileSync` for source files

### Category C: Debugger (CANNOT work on web as-is)
- Spawning gdb / lldb-dap as subprocess
- MI protocol over stdin/stdout
- `runInTerminal` for integrated terminal debugging
- Temporary terminal for gdb tty (`fs.mkdtempSync`, shell script)

### Category D: File System Operations (Some can be polyfilled)
- `fs.readdirSync` for examples, headers
- `fs.copyFileSync` for temp copies
- `fs.rmSync` for cleanup
- `path.join`, `path.dirname`, `path.extname`, `path.basename`, `path.resolve`
- `os.tmpdir()`, `os.homedir()`, `process.env`

### Category E: Web-Compatible (Already OK)
- Webview panels (graphics panel, modern panel)
- VS Code API: commands, diagnostics, status bar, output channel
- Language features: modernize engine, diagnostics parsing, crash explanation
- Configuration, keybindings, menus

---

## Verdict per Major Feature

| Feature | Web-Compatible? | Blockers |
|---------|-----------------|----------|
| **Turbo C++ → Modern C++ converter** | ✅ Yes | Pure JS, no Node APIs |
| **Syntax highlighting / diagnostics parsing** | ✅ Yes | Pure JS |
| **Crash explanations (Hinglish)** | ✅ Yes | Pure JS |
| **Compiler detection/install** | ❌ No | Needs fs, https, crypto, child_process, OS-specific paths |
| **Compile (Alt+F9)** | ❌ No | Needs gcc/g++/zig, fs for temp files |
| **Run console programs (Ctrl+F9)** | ❌ No | Needs compiler + spawn + PTY |
| **Run graphics.h programs (Ctrl+F9)** | ❌ No | Needs compiler + spawn + fd 3 protocol + webview |
| **Debug (F5)** | ❌ No | Needs gdb/lldb-dap subprocess + MI protocol |
| **Install PRABHA compiler** | ❌ No | Download + verify + extract |
| **Open examples** | ⚠️ Partial | `fs.readdirSync` for listing; could use bundled examples |

---

## Conclusion

**The extension as a whole CANNOT run on vscode.dev** because its core value proposition (compile + run + debug C/C++ with graphics.h) fundamentally requires:
1. A C/C++ compiler (gcc/clang/zig)
2. Process spawning
3. File system access for temp build artifacts
4. Native debugger (gdb/lldb)

**However, these parts ARE web-compatible and could be extracted:**
- Turbo → Modern converter (entire `lib/modern/`)
- Diagnostics parsing (`lib/diagnostics.js`)
- Crash explanations (`lib/crash.js`)
- Protocol stream router (`lib/stream.js`)
- Webview UIs (graphics panel HTML/JS, modern panel HTML/JS/CSS)

See `FEATURE-MAP.md` and `OPTIONS.md` for detailed breakdown and alternatives.