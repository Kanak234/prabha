/*
 * PRABHA 6.0.0 — Turbo C/C++ ka "extension IDE" VS Code ke andar.
 *
 * WHY:   Dev-C++ aur Turbo C++ ko update milna band ho gaya. College mein abhi bhi
 *        wahi code likha jaata hai. PRABHA wo poora IDE VS Code mein deta hai —
 *        compiler, console, errors, debugger, aur purane code ko modern banana —
 *        sab apna, kisi doosre extension par depend nahi.
 *
 * WHAT (6.0 = 5.1 + 5.2 + 6.0 ek saath):
 *   • Apna compiler: Windows → PRABHA GCC (WinLibs, gdb ke saath),
 *     Linux/macOS → PRABHA Zig (clang + libc + libc++). Ek click, SHA-256 check.
 *   • Dev-C++ jaisa Run: Ctrl+F9 = compile + run, Alt+F9 = sirf compile.
 *     Console programs "PRABHA Console" mein (input, "Press any key", exit time,
 *     crash ki Hinglish wajah). graphics.h / conio.h programs 640×480 panel mein.
 *   • Errors Problems tab mein — click karo to sahi line; har error ke saath
 *     Hinglish tip ("; bhool gaye", "iostream.h purana hai"…).
 *   • Debugger (F5): breakpoints, F7 step into, F8 step over, variables, watch,
 *     call stack. Linux/Windows → gdb (PRABHA ka apna adapter), macOS → lldb-dap.
 *   • Turbo → Modern: purana code side-by-side naya, har badlaav ka "kyun", quiz,
 *     aur "dono ka output same hai?" check.
 *
 * FLOW:  command → ensureToolchain() → lib/build.js build() → diagnostics →
 *        runConsole() (lib/console-core.js) | runPanel() (runtime protocol) |
 *        debug (lib/debug/gdb-adapter.js / lldb-dap)
 */
'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const toolchain = require('./lib/toolchain');
const { build, cleanup, usesPanel } = require('./lib/build');
const { ConsoleSession } = require('./lib/console-core');
const { GdbDebugSession } = require('./lib/debug/gdb-adapter');

// Import shared web-compatible core (Turbo→Modern, diagnostics, crash, stream)
const {
  VERSION,
  SRC_EXT,
  createRouter,
  explainExit,
  exitLine,
  engine,
  explain,
  modernState,  // shared state: panel, uri, lang, review
  modern: { openModern, renderModern, onModernMessage, renderModernSoon, modernDoc, modernResult }
} = require('./lib/web-core');

const modern = modernState;

let extRoot, storageDir;
let out, status, diag;
let cachedTc;                 // last detected toolchain
let panel, child;             // graphics panel + uska program
let con = null;               // { term, session, result } — PRABHA Console

/* ───────────────────────────── activate ───────────────────────────── */

function activate(context) {
  extRoot = context.extensionPath;
  storageDir = context.globalStorageUri ? context.globalStorageUri.fsPath : path.join(os.homedir(), '.prabha');
  out = vscode.window.createOutputChannel('PRABHA');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  status.command = 'prabha.showOutput';
  diag = vscode.languages.createDiagnosticCollection('prabha');

  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(out, status, diag,
    cmd('prabha.run', target => runCurrent(target)),
    cmd('prabha.compile', target => compileOnly(target)),
    cmd('prabha.stop', () => stopProgram('stopped from the command')),
    cmd('prabha.debug', target => startDebug(target)),
    cmd('prabha.modernize', target => openModern(context, target, onModernMessageDesktop)),
    cmd('prabha.showOutput', () => out.show(true)),
    cmd('prabha.openExample', () => openExample(context)),
    cmd('prabha.installCompiler', () => installCompiler(true)),
    cmd('prabha.compilerInfo', () => compilerInfo()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('prabha')) cachedTc = undefined; }),
    vscode.workspace.onDidCloseTextDocument(d => diag.delete(d.uri)),
    vscode.window.onDidCloseTerminal(t => { if (con && con.term === t) { con.session.kill(); cleanup(con.result); con = null; } }),
    vscode.workspace.onDidChangeTextDocument(e => { if (modern.panel && modern.uri && e.document.uri.toString() === modern.uri.toString()) renderModernSoon(); }),
    // Debugger
    vscode.debug.registerDebugConfigurationProvider('prabha', debugConfigProvider),
    vscode.debug.registerDebugAdapterDescriptorFactory('prabha', debugAdapterFactory),
    // debug khatam → temp build folder saaf
    vscode.debug.onDidTerminateDebugSession(s => { if (s.type === 'prabha' && s.configuration.prabhaWork) cleanup({ work: s.configuration.prabhaWork }); })
  );
}

function cfg() {
  const c = vscode.workspace.getConfiguration('prabha');
  return {
    cc: c.get('cCompiler', 'gcc'),
    cxx: c.get('cppCompiler', 'g++'),
    toolchain: c.get('toolchain', 'bundled'),
    toolchainUrl: c.get('toolchainUrl', ''),
    flags: c.get('extraFlags', ''),
    scale: c.get('scale', 1.5),
    keepOpen: c.get('keepPanelOpenOnExit', true),
    legacyCompat: c.get('turboCppCompatibility', true),
    runIn: c.get('runIn', 'auto'),
    timeout: c.get('runTimeoutSeconds', 0),
    debugConsole: c.get('debugConsole', 'integratedTerminal')
  };
}

/* ───────────────────────── compiler (in-built) ───────────────────────── */

function detectTc() {
  const conf = cfg();
  const base = { cc: conf.cc, cxx: conf.cxx };
  // user ki pasand pehle; na mile to 'auto' (taaki install ke baad PRABHA wala bhi mil jaaye)
  return toolchain.detect({ ...base, toolchain: conf.toolchain }, storageDir) ||
    (conf.toolchain !== 'auto' ? toolchain.detect({ ...base, toolchain: 'auto' }, storageDir) : null);
}

/** Kaam karne wala compiler lao; na mile to ek click mein install karwao */
let autoInstallTried = false;   // is session mein PRABHA compiler ka auto-install ek hi baar

async function ensureToolchain(isCpp) {
  const conf = cfg();
  /*
   * 6.0 default = 'bundled': PRABHA hamesha APNA compiler use kare (har student ka same,
   * tested compiler — purane CodeBlocks/TDM gcc wale bugs nahi). Pehli baar wo apne aap
   * install hota hai (progress dikhta hai, koi sawaal nahi). Internet na ho / cancel ho to
   * PC par jo compiler hai usse kaam chalta hai — student kabhi atakta nahi.
   */
  if (conf.toolchain === 'bundled' && !autoInstallTried &&
      !toolchain.detect({ cc: conf.cc, cxx: conf.cxx, toolchain: 'bundled' }, storageDir)) {
    autoInstallTried = true;
    cachedTc = undefined;
    const ok = await installBundledWithProgress();
    if (!ok) {
      const sys = detectTc();
      if (sys) vscode.window.showWarningMessage('PRABHA could not install its own compiler right now, so it is using the compiler on this PC: ' + sys.version + '. You can install it later with "PRABHA: Install / Choose Compiler".');
    }
  }
  if (!cachedTc) cachedTc = detectTc();
  if (cachedTc && (!isCpp || cachedTc.cxx)) return cachedTc;
  const ok = await installCompiler(false, isCpp);
  return ok ? cachedTc : null;
}

/**
 * PRABHA compiler install — har OS par EK button:
 *   Windows → PRABHA GCC (WinLibs, gdb ke saath)   Linux/macOS → PRABHA Zig (clang)
 * Doosre raaste: apna compiler folder chuno, ya system package (terminal command).
 */
async function installCompiler(explicit, isCpp) {
  const need = isCpp ? 'C++ compiler' : 'C compiler';
  const info = toolchain.bundledInfo();
  const B_INSTALL = 'Install PRABHA compiler', B_FOLDER = 'Mera compiler folder chuno', B_SYSTEM = 'System package (terminal)';
  const buttons = [B_INSTALL, B_FOLDER];
  const hint = process.platform === 'win32' ? null : toolchain.installHint();
  if (hint) buttons.push(B_SYSTEM);
  const pick = await vscode.window.showInformationMessage(
    (explicit ? 'PRABHA compiler: ' : 'PRABHA needs a ' + need + '. ') +
    'PRABHA can install its own compiler in one click — ' + info.name + ', ~' + info.mb +
    ' MB, once, inside PRABHA\'s own folder (your system PATH is not changed).',
    { modal: !explicit }, ...buttons);
  if (pick === B_FOLDER) return chooseCompilerFolder();
  if (pick === B_SYSTEM) {
    const t = vscode.window.createTerminal({ name: 'PRABHA · compiler install' });
    t.show(); t.sendText(hint.command);
    vscode.window.showInformationMessage('When the install finishes, press Ctrl+F9 again.');
    return false;
  }
  if (pick !== B_INSTALL) return false;
  return installBundledWithProgress();
}

/** PRABHA ka apna compiler download + verify + install, progress notification ke saath */
async function installBundledWithProgress() {
  const info = toolchain.bundledInfo();
  const B_FOLDER = 'Mera compiler folder chuno';
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'PRABHA: ' + info.name + ' — installing', cancellable: true }, async (progress, token) => {
      let last = 0;
      await toolchain.installBundled(storageDir, {
        url: cfg().toolchainUrl || undefined,
        isCancelled: () => token.isCancellationRequested,
        log: s => out.appendLine('[toolchain] ' + s),
        onProgress: (got, total) => {
          const pct = total ? Math.floor(got * 100 / total) : 0;
          if (pct > last) { progress.report({ increment: pct - last, message: Math.round(got / 1048576) + ' / ' + Math.round(total / 1048576) + ' MB' }); last = pct; }
        }
      });
      progress.report({ message: 'extracted, checking…' });
    });
  } catch (e) {
    out.appendLine('[toolchain] install failed: ' + (e.message || e));
    out.show(true);
    vscode.window.showErrorMessage('PRABHA: the compiler could not be installed — ' + (e.message || e) + '. Check your internet connection, or try "' + B_FOLDER + '".');
    return false;
  }
  cachedTc = detectTc();
  if (cachedTc) vscode.window.showInformationMessage('PRABHA: compiler ready — ' + cachedTc.version);
  return !!cachedTc;
}

/** Linux: PRABHA ka apna static gdb download + SHA-256 verify + install (progress ke saath) */
async function installGdbWithProgress() {
  const f = toolchain.GDB_STATIC.files[process.arch];
  try {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'PRABHA: debugger (gdb ' + toolchain.GDB_STATIC.version + ', ~' + (f ? f.mb : 13) + ' MB, once) — installing', cancellable: true }, async (progress, token) => {
      let last = 0;
      const g = await toolchain.installGdb(storageDir, {
        isCancelled: () => token.isCancellationRequested,
        log: s => out.appendLine('[debugger] ' + s),
        onProgress: (got, total) => {
          const pct = total ? Math.floor(got * 100 / total) : 0;
          if (pct > last) { progress.report({ increment: pct - last, message: Math.round(got / 1048576) + ' / ' + Math.round(total / 1048576) + ' MB' }); last = pct; }
        }
      });
      out.appendLine('[debugger] ready: ' + g);
      return g;
    });
  } catch (e) {
    out.appendLine('[debugger] install failed: ' + (e.message || e));
    vscode.window.showErrorMessage('PRABHA: the debugger could not be installed — ' + (e.message || e) + '. Check your internet connection, or install gdb from your distro.');
    return null;
  }
}

/** User apna compiler folder (…\\bin) chune → settings mein save */
async function chooseCompilerFolder() {
  const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'This folder contains gcc/clang' });
  if (!pick || !pick[0]) return false;
  const bin = pick[0].fsPath;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const pairs = [['gcc', 'g++'], ['clang', 'clang++']].map(([c, x]) => [path.join(bin, c + ext), path.join(bin, x + ext)]);
  const found = pairs.find(([c]) => toolchain.works(c, toolchain.envWith(bin)));
  if (!found) {
    vscode.window.showErrorMessage('PRABHA: no working gcc' + ext + '/clang' + ext + ' found in this folder (' + bin + ').');
    return false;
  }
  const c = vscode.workspace.getConfiguration('prabha');
  await c.update('cCompiler', found[0], vscode.ConfigurationTarget.Global);
  await c.update('cppCompiler', found[1], vscode.ConfigurationTarget.Global);
  cachedTc = toolchain.detect({ cc: found[0], cxx: found[1], toolchain: 'system' }, storageDir);
  return !!cachedTc;
}

function compilerInfo() {
  cachedTc = detectTc();
  if (!cachedTc) { installCompiler(true); return; }
  const gdb = toolchain.findGdb(cachedTc, storageDir), lldb = toolchain.findLldbDap();
  out.appendLine('PRABHA ' + VERSION + ' compiler: ' + cachedTc.version +
    '\n  C:        ' + cachedTc.cc + ' ' + (cachedTc.ccArgs || []).join(' ') +
    '\n  C++:      ' + (cachedTc.cxx ? cachedTc.cxx + ' ' + (cachedTc.cxxArgs || []).join(' ') : '(not found)') +
    '\n  from:     ' + cachedTc.source +
    '\n  debugger: ' + (gdb || lldb || '(none — press F5 and PRABHA will offer to install one)'));
  out.show(true);
  vscode.window.showInformationMessage('PRABHA compiler: ' + cachedTc.version + ' (' + cachedTc.source + ')', 'Install PRABHA compiler')
    .then(p => { if (p) installCompiler(true); });
}

/* ───────────────────────── compile (Alt+F9) ───────────────────────── */

/** Active / diya hua C/C++ file — saved; warna null */
async function sourceFile(target) {
  const editor = vscode.window.activeTextEditor;
  const uri = target && target.fsPath ? target : (editor ? editor.document.uri : undefined);
  if (!uri || uri.scheme !== 'file') {
    // untitled file: pehle save karwao (compiler ko disk par file chahiye)
    if (editor && editor.document.isUntitled) {
      const saved = await editor.document.save();
      if (saved) return sourceFile(vscode.window.activeTextEditor.document.uri);
    }
    vscode.window.showInformationMessage('PRABHA: open a .c or .cpp file, then press Ctrl+F9.');
    return null;
  }
  const file = uri.fsPath;
  const ext = path.extname(file).toLowerCase();
  if (!SRC_EXT.includes(ext)) {
    vscode.window.showWarningMessage('PRABHA runs C and C++ files (.c/.cpp) — this is ' + (ext || 'something else') + '.');
    return null;
  }
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (doc && doc.isDirty) await doc.save();
  return file;
}

/**
 * File compile karo, errors Problems tab mein daalo.
 * @returns build result (ok) ya null
 */
async function compileFile(file, mode, extra = {}) {
  const conf = cfg();
  const isCpp = path.extname(file).toLowerCase() !== '.c';
  const tc = await ensureToolchain(isCpp);
  if (!tc) return null;
  out.clear();
  out.appendLine('· PRABHA ' + VERSION + ' · ' + file);
  out.appendLine('compiler: ' + tc.version + ' (' + tc.source + ')' + (mode === 'debug' ? ' · debug build (-g -O0)' : ''));
  status.text = '$(sync~spin) PRABHA compiling';
  status.show();
  let r;
  try {
    r = await build(file, {
      tc, runtimeDir: path.join(extRoot, 'runtime'), mode,
      legacyCompat: conf.legacyCompat, extraFlags: conf.flags,
      log: s => out.appendLine(s), ...extra
    });
  } catch (e) {
    status.text = '$(error) PRABHA compile failed';
    out.appendLine(String(e.message || e)); out.show(true);
    return null;
  }
  const n = showDiagnostics(file, r.diagnostics, extra.diagUri);
  if (r.log.trim()) out.appendLine('\n' + r.log.trim());
  // Dev-C++ jaisa "Compilation results"
  out.appendLine('\n── Compilation results ──  Errors: ' + n.errors + '   Warnings: ' + n.warnings);
  if (!r.ok) {
    status.text = '$(error) PRABHA · ' + n.errors + ' error' + (n.errors === 1 ? '' : 's');
    const first = r.diagnostics.find(d => d.severity === 'error');
    const msg = first ? 'Line ' + first.line + ': ' + first.message + (first.tip ? '  💡 ' + first.tip : '') : 'Compilation failed — see the PRABHA output.';
    vscode.window.showErrorMessage('PRABHA: ' + msg, 'Show Problems', 'Show Output').then(p => {
      if (p === 'Show Problems') vscode.commands.executeCommand('workbench.actions.view.problems');
      if (p === 'Show Output') out.show(true);
    });
    if (first && first.file === file) revealLine(file, first.line, first.col);
    cleanup(r);
    return null;
  }
  r.tc = tc;
  return r;
}

/** Compiler messages → VS Code Problems (squiggly + Hinglish tip) */
function showDiagnostics(file, list, diagUri) {
  diag.delete(diagUri || vscode.Uri.file(file));
  const byFile = new Map();
  let errors = 0, warnings = 0;
  for (const d of list) {
    if (d.severity === 'error') errors++; else if (d.severity === 'warning') warnings++;
    if (!d.file) continue;
    const key = d.file === file && diagUri ? diagUri.toString() : vscode.Uri.file(d.file).toString();
    if (!byFile.has(key)) byFile.set(key, { uri: d.file === file && diagUri ? diagUri : vscode.Uri.file(d.file), items: [] });
    const line = Math.max(0, d.line - 1), col = Math.max(0, d.col - 1);
    const dg = new vscode.Diagnostic(new vscode.Range(line, col, line, col + wordLen(d.file, line, col)),
      d.message + (d.tip ? '\n💡 ' + d.tip : '') + (d.notes && d.notes.length ? '\n   ' + d.notes.slice(0, 2).join('\n   ') : ''),
      d.severity === 'error' ? vscode.DiagnosticSeverity.Error : d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
    dg.source = 'PRABHA';
    byFile.get(key).items.push(dg);
    out.appendLine((d.severity === 'error' ? '✖ ' : '⚠ ') + path.basename(d.file) + ':' + d.line + ':' + d.col + '  ' + d.message + (d.tip ? '\n    💡 ' + d.tip : ''));
  }
  for (const { uri, items } of byFile.values()) diag.set(uri, items);
  return { errors, warnings };
}

/** Error wale shabd ki lambai (squiggle poore word par) */
function wordLen(file, line, col) {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);
  if (!doc || line >= doc.lineCount) return 1;
  const m = /^[\w$]+/.exec(doc.lineAt(line).text.slice(col));
  return m ? m[0].length : 1;
}

async function revealLine(file, line, col) {
  const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === file);
  if (!ed) return;
  const pos = new vscode.Position(Math.max(0, line - 1), Math.max(0, (col || 1) - 1));
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function compileOnly(target) {
  const file = await sourceFile(target);
  if (!file) return;
  const r = await compileFile(file, 'compile');
  if (!r) return;
  const w = r.diagnostics.filter(d => d.severity === 'warning').length;
  status.text = '$(check) PRABHA · compiled' + (w ? ' (' + w + ' warning' + (w > 1 ? 's' : '') + ')' : '');
  vscode.window.setStatusBarMessage('PRABHA: compiled ✓  Errors: 0  Warnings: ' + w + '  — press Ctrl+F9 to run', 5000);
  cleanup(r);
}

/* ───────────────────────── run (Ctrl+F9) ───────────────────────── */

async function runCurrent(target) {
  const file = await sourceFile(target);
  if (!file) return;
  stopProgram();
  const r = await compileFile(file, 'run');
  if (!r) return;
  const conf = cfg();
  const panelMode = conf.runIn === 'panel' || (conf.runIn === 'auto' && r.usesPanel);
  if (panelMode) runPanel(r, file); else runConsole(r, file);
}

/** PRABHA Console — Dev-C++ ka kaala window, VS Code terminal ke roop mein */
function runConsole(r, file, title) {
  if (con) { try { con.term.dispose(); } catch { /* */ } }
  const writeEmitter = new vscode.EventEmitter();
  const closeEmitter = new vscode.EventEmitter();
  const conf = cfg();
  const session = new ConsoleSession({
    write: s => writeEmitter.fire(s),
    close: code => closeEmitter.fire(typeof code === 'number' ? code : 0),
    env: r.tc.env, cwd: path.dirname(file), timeoutSec: conf.timeout,
    onDone: (res, secs) => {
      const okRun = res.code === 0 && !res.signal;
      status.text = (okRun ? '$(check)' : '$(error)') + ' PRABHA · exit ' + (res.code === null ? res.signal : res.code);
      out.appendLine('\n' + exitLine(res, secs));
      const why = explainExit({ code: res.code, signal: res.signal, platform: process.platform });
      if (why) out.appendLine('✖ ' + why.title + '\n  ' + why.why + '\n  Fix: ' + why.fix);
    }
  });
  const pty = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      writeEmitter.fire('\x1b[2m PRABHA ' + VERSION + ' · ' + path.basename(file) + ' · ' + r.tc.version + '\x1b[0m\r\n\r\n');
      session.start(r.bin);
      status.text = '$(run) PRABHA running';
    },
    close: () => { session.kill(); },
    handleInput: d => session.input(d)
  };
  const term = vscode.window.createTerminal({ name: title || 'PRABHA Console', pty, iconPath: new vscode.ThemeIcon('terminal') });
  con = { term, session, result: r };
  term.show(false);                      // focus terminal par — user seedha type kare
}

/** graphics.h / conio.h — 640×480 panel (runtime protocol fd 3 / stdout) */
function runPanel(r, file) {
  const conf = cfg();
  ensurePanel(conf.scale);
  panel.webview.postMessage({ t: 'reset' });
  out.appendLine('');
  child = cp.spawn(r.bin, [], {
    cwd: path.dirname(file),
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    // Windows par fd 3 nahi hota — wahan stdout + lib/stream.js router
    env: process.platform === 'win32' ? r.tc.env : { ...r.tc.env, PRABHA_PROTO_FD: '3' }
  });
  const me = child;
  status.text = '$(run) PRABHA running';
  const started = Date.now();
  const toPanel = msg => { if (panel) panel.webview.postMessage({ t: 'proto', msg }); };
  const fd3 = createRouter(() => { /* fd 3 par sirf protocol */ }, toPanel);
  const so = createRouter(text => out.append(text), toPanel);
  if (child.stdio[3]) child.stdio[3].on('data', d => fd3.push(d));
  child.stdout.on('data', d => so.push(d));
  child.stderr.on('data', d => out.append(d.toString()));
  child.stdin.on('error', () => { /* program khatam */ });
  child.on('error', e => out.appendLine('[PRABHA] the program could not start: ' + e.message));
  // 'close' (na ki 'exit'): tab tak saara stdout/fd3 padh liya gaya hota hai
  child.on('close', (code, signal) => {
    fd3.end(); so.end();
    const secs = (Date.now() - started) / 1000;
    out.appendLine('\n' + exitLine({ code, signal }, secs));
    const why = explainExit({ code, signal, platform: process.platform });
    if (why) { out.appendLine('✖ ' + why.title + '\n  ' + why.why + '\n  Fix: ' + why.fix); out.show(true); }
    status.text = (code === 0 ? '$(check)' : '$(error)') + ' PRABHA · exit ' + (code === null ? signal : code);
    if (panel) panel.webview.postMessage({ t: 'exit', code: code === null ? signal : code, why: why ? why.title : '' });
    if (child === me) child = undefined;
    cleanup(r);
  });
}

function stopProgram(reason) {
  if (child) {
    try { child.kill(); } catch { /* */ }
    if (reason) out.appendLine('\n' + reason);
    child = undefined;
  }
  if (con && !con.session.finished) con.session.kill();
  const ds = vscode.debug.activeDebugSession;
  if (reason && ds && ds.type === 'prabha') vscode.debug.stopDebugging(ds);
}

/* keystrokes from the panel → program stdin, Turbo C style */
function sendKey(k) {
  if (!child || !child.stdin.writable) return;
  const scan = {
    ArrowUp: 72, ArrowLeft: 75, ArrowRight: 77, ArrowDown: 80,
    Home: 71, End: 79, PageUp: 73, PageDown: 81, Insert: 82, Delete: 83,
    F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68
  };
  try {
    if (k.key in scan) child.stdin.write(Buffer.from([0, scan[k.key]]));
    // "\r\n": getch() ko 13 milta hai (runtime '\n' nigal leta hai), aur scanf/fgets
    // ko poori line — dono kaam karte hain, Windows text mode mein bhi.
    else if (k.key === 'Enter') child.stdin.write('\r\n');
    else if (k.key === 'Backspace') child.stdin.write(Buffer.from([8]));
    else if (k.key === 'Tab') child.stdin.write('\t');
    else if (k.key === 'Escape') child.stdin.write(Buffer.from([27]));
    else if (k.key && k.key.length === 1) child.stdin.write(k.key);
  } catch { /* closed */ }
}

function ensurePanel(scale) {
  if (panel) { panel.reveal(vscode.ViewColumn.Beside, true); return; }
  panel = vscode.window.createWebviewPanel('prabha', 'PRABHA · 640×480 VGA',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true });
  panel.iconPath = vscode.Uri.file(path.join(extRoot, 'media', 'icon.png'));
  panel.webview.html = html(scale);
  panel.webview.onDidReceiveMessage(m => {
    if (m.t === 'key') sendKey(m);
    if (m.t === 'stop') stopProgram('stopped from the panel');
  });
  panel.onDidDispose(() => { panel = undefined; stopProgram('panel closed'); });
}

function html(scale) {
  const w = Math.round(640 * scale), h = Math.round(480 * scale);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { background:#111; color:#9a9a9a; font-family:monospace; margin:0;
         display:flex; flex-direction:column; align-items:center; }
  #bar { padding:6px 10px; width:100%; box-sizing:border-box; display:flex; gap:14px; }
  #bar b { color:#e0c060; }
  #st.bad { color:#ff7b72; }
  canvas { image-rendering:pixelated; width:${w}px; height:${h}px;
           border:1px solid #333; outline:none; margin-top:4px; }
  #hint { font-size:11px; padding:4px; }
</style></head><body>
<div id="bar"><b>PRABHA</b><span id="st">waiting for a program…</span><span id="fps"></span></div>
<canvas id="cv" width="640" height="480" tabindex="0"></canvas>
<div id="hint">click the screen so it hears your keyboard · getch()/kbhit() read these keys · Ctrl+F9 = run again</div>
<script>
const vsc = acquireVsCodeApi();
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const st = document.getElementById('st'), fpsEl = document.getElementById('fps');
let img = ctx.createImageData(640, 480);
let pal = [[0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],
           [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255]];
let fb = new Uint8Array(640*480);
let frames = 0, lastSec = Date.now(), fps = 0;
let audio, osc, gain;

function repaint() {
  const d = img.data;
  for (let i = 0; i < fb.length; i++) {
    const c = pal[fb[i] & 15];
    d[i*4] = c[0]; d[i*4+1] = c[1]; d[i*4+2] = c[2]; d[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function b64bytes(s) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
window.addEventListener('message', e => {
  const m = e.data;
  if (m.t === 'reset') { fb.fill(0); repaint(); st.textContent = 'running'; st.className = ''; return; }
  if (m.t === 'exit') { st.textContent = 'program exited (code ' + m.code + ')' + (m.why ? ' — ' + m.why : ''); st.className = m.why ? 'bad' : ''; stopSound(); return; }
  if (m.t !== 'proto') return;
  const p = m.msg;
  if (p.t === 'init') { fb.fill(0); st.textContent = p.w + '×' + p.h + ' · runtime ' + p.version; }
  else if (p.t === 'palette') { pal = p.rgb; repaint(); }
  else if (p.t === 'frame') {
    const raw = b64bytes(p.rle);
    let x = p.x, y = p.y, w = p.w, row = 0, col = 0;
    for (let i = 0; i < raw.length; i += 2) {
      let count = raw[i]; const v = raw[i+1];
      while (count--) {
        fb[(y + row) * 640 + x + col] = v;
        if (++col === w) { col = 0; row++; }
      }
    }
    repaint();
    frames++;
    const now = Date.now();
    if (now - lastSec >= 1000) { fps = frames; frames = 0; lastSec = now;
      fpsEl.textContent = fps + ' fps · frame ' + p.n; }
  }
  else if (p.t === 'input') { st.textContent = 'waiting for a key — click the screen and type'; cv.focus(); }
  else if (p.t === 'sound') { p.hz > 0 ? startSound(p.hz) : stopSound(); }
  else if (p.t === 'end') { st.textContent = 'closegraph()'; stopSound(); }
});
function startSound(hz) {
  try {
    if (!audio) { audio = new AudioContext(); gain = audio.createGain(); gain.gain.value = 0.05; gain.connect(audio.destination); }
    if (!osc) { osc = audio.createOscillator(); osc.type = 'square'; osc.connect(gain); osc.start(); }
    osc.frequency.value = hz;
  } catch {}
}
function stopSound() { if (osc) { try { osc.stop(); } catch {} osc = undefined; } }
cv.addEventListener('keydown', e => {
  e.preventDefault();
  vsc.postMessage({ t: 'key', key: e.key });
});
cv.addEventListener('click', () => cv.focus());
repaint();
</script></body></html>`;
}

/* ───────────────────────── debugger (F5) ───────────────────────── */

/** F5 / "PRABHA: Debug" — launch.json ke bina bhi chalta hai */
async function startDebug(target) {
  const file = await sourceFile(target);
  if (!file) return;
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
  await vscode.debug.startDebugging(folder, { type: 'prabha', request: 'launch', name: 'PRABHA: Debug ' + path.basename(file), source: file });
}

const debugConfigProvider = {
  provideDebugConfigurations() {
    return [{ type: 'prabha', request: 'launch', name: 'PRABHA: Debug current file', source: '${file}' }];
  },
  // launch.json khaali ho aur user F5 dabaye
  resolveDebugConfiguration(folder, config) {
    if (!config.type && !config.request) {
      const ed = vscode.window.activeTextEditor;
      if (!ed || !['c', 'cpp'].includes(ed.document.languageId)) return config;
      return { type: 'prabha', request: 'launch', name: 'PRABHA: Debug current file', source: '${file}' };
    }
    return config;
  },
  // ${file} jaise variables bhar jaane ke baad: compile (-g -O0), debugger chuno
  async resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
    const file = config.source || config.program;
    if (!file || !SRC_EXT.includes(path.extname(file).toLowerCase())) {
      vscode.window.showErrorMessage('PRABHA Debug: set "source" to a .c/.cpp file (default: ${file}).');
      return undefined;
    }
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file);
    if (doc && doc.isDirty) await doc.save();
    stopProgram();
    const r = await compileFile(file, 'debug');
    if (!r) return undefined;                        // errors Problems tab mein — debug shuru nahi
    const conf = cfg();
    let gdb = toolchain.findGdb(r.tc, storageDir);
    // Linux: debugger nahi mila → PRABHA ka apna gdb apne aap le aao (~13 MB, ek baar)
    if (!gdb && toolchain.gdbInstallable()) gdb = await installGdbWithProgress();
    const lldb = !gdb || process.platform === 'darwin' ? toolchain.findLldbDap() : null;
    const backend = process.platform === 'darwin' ? (lldb ? 'lldb' : gdb ? 'gdb' : null) : (gdb ? 'gdb' : lldb ? 'lldb' : null);
    if (!backend) {
      cleanup(r);
      const h = toolchain.debuggerHint();
      const pick = await vscode.window.showErrorMessage('PRABHA Debug: no debugger found. ' + (h.command ? 'One command: ' + h.command : h.label), h.command ? 'Run in terminal' : h.prabhaGdb ? 'Install PRABHA debugger' : 'Install PRABHA compiler');
      if (pick === 'Run in terminal') { const t = vscode.window.createTerminal({ name: 'PRABHA · debugger install' }); t.show(); t.sendText(h.command); }
      if (pick === 'Install PRABHA compiler') installCompiler(true);
      if (pick === 'Install PRABHA debugger') installGdbWithProgress();
      return undefined;
    }
    if (r.usesPanel) out.appendLine('\n[PRABHA] Debugging a graphics.h program: steps, variables and breakpoints all work — the 640×480 screen is only shown with Ctrl+F9 (Run).');
    const env = { ...r.tc.env, PRABHA_PROTO_FD: 'off' };
    const consoleMode = config.console || conf.debugConsole;
    if (backend === 'lldb') {
      // Apple/LLVM ka lldb-dap — uski apni launch config
      return {
        ...config, backend, lldbDap: lldb, program: r.bin, cwd: config.cwd || path.dirname(file),
        stopOnEntry: !!config.stopAtEntry, runInTerminal: consoleMode === 'integratedTerminal',
        env: Object.entries({ PRABHA_PROTO_FD: 'off' }).map(([k, v]) => k + '=' + v),
        prabhaWork: r.work
      };
    }
    return {
      ...config, backend, gdbPath: gdb, program: r.bin, cwd: config.cwd || path.dirname(file),
      console: consoleMode, env, sourceMap: r.sourceMap, prabhaWork: r.work
    };
  }
};

const debugAdapterFactory = {
  createDebugAdapterDescriptor(session) {
    const c = session.configuration;
    if (c.backend === 'lldb') return new vscode.DebugAdapterExecutable(c.lldbDap, []);
    return new vscode.DebugAdapterInlineImplementation(new GdbDebugSession());
  }
};

/* ─────────────────────── Turbo → Modern panel ─────────────────────── */

function enabledRules() { return [...engine.defaultEnabled(), ...modern.review]; }

// openModern, renderModern, onModernMessage are imported from web-core.js
// Desktop-specific handlers for 'check' and 'run' messages:
async function onModernMessageDesktop(m) {
  const doc = await modernDoc();
  if (!doc) return;
  switch (m.t) {
    case 'check': {
      const r = await sameOutputCheck(doc);
      if (modern.panel) modern.panel.webview.postMessage({ t: 'check', ok: r.ok, text: r.text });
      break;
    }
    case 'run': await runVersion(doc, m.which); break;
  }
}

// Combine web-core handler with desktop-specific handlers
async function onModernMessageCombined(m) {
  await onModernMessage(m);  // from web-core.js
  await onModernMessageDesktop(m);
}

async function openModernNewTab(doc, res) {
  const nd = await vscode.workspace.openTextDocument({ language: res.lang === 'c' ? 'c' : 'cpp', content: res.code });
  await vscode.window.showTextDocument(nd, vscode.ViewColumn.One);
}

/** Purana / naya code temp folder mein likho (user ki file nahi chhedte) */
function writeVersion(doc, which) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-' + which + '-'));
  const file = path.join(dir, path.basename(doc.fileName.match(/\.\w+$/) ? doc.fileName : doc.fileName + '.cpp'));
  const res = modernResult(doc);
  fs.writeFileSync(file, which === 'new' && res ? res.code : doc.getText(), 'utf8');
  return { file, dir };
}

/** "Purana chalao" (Turbo mode) / "Naya chalao" (strict C++17 / C11) — PRABHA Console mein */
async function runVersion(doc, which) {
  const v = writeVersion(doc, which);
  const r = await compileFile(v.file, 'run', which === 'new' ? { strict: true, diagUri: undefined } : { legacyCompat: true });
  if (!r) { out.show(true); return; }
  runConsole(r, v.file, which === 'new' ? 'PRABHA Console · modern' : 'PRABHA Console · turbo');
}

/**
 * Proof ki badlaav ne program ka matlab nahi badla:
 * purana Turbo mode mein + naya strict standard mein compile → same input → output match.
 */
async function sameOutputCheck(doc) {
  const isCpp = !/\.c$/i.test(doc.fileName);
  const tc = await ensureToolchain(isCpp);
  if (!tc) return { ok: false, text: 'No compiler found.' };
  const rt = path.join(extRoot, 'runtime');
  const oldV = writeVersion(doc, 'old'), newV = writeVersion(doc, 'new');
  const stdinFile = doc.fileName.replace(/\.\w+$/, '') + '.stdin';
  const input = fs.existsSync(stdinFile) ? fs.readFileSync(stdinFile, 'utf8') : '';
  const lines = [];
  try {
    const a = await build(oldV.file, { tc, runtimeDir: rt, legacyCompat: true });
    const b = await build(newV.file, { tc, runtimeDir: rt, strict: true });
    lines.push((a.ok ? '✓' : '✖') + ' old code (Turbo mode) ' + (a.ok ? 'compiles' : 'does not compile'));
    lines.push((b.ok ? '✓' : '✖') + ' new code ' + (b.ok ? 'compiles' : 'does not compile') + ' in strict ' + (isCpp ? 'C++17' : 'C11') + ' -pedantic-errors');
    if (!b.ok) lines.push(b.log.split('\n').slice(0, 8).join('\n'));
    // conio.h programs ka text output bhi stdout par aata hai (protocol off) — compare ho sakta hai.
    // Sirf graphics.h ka output screen par hai.
    const graphics = /^\s*#\s*include\s*[<"]graphics\.h[>"]/m.test(doc.getText());
    if (a.ok && b.ok && !graphics) {
      const run = bin => cp.spawnSync(bin, [], { input, encoding: 'utf8', timeout: 8000, env: { ...tc.env, PRABHA_PROTO_FD: 'off' } });
      const pa = run(a.bin), pb = run(b.bin);
      const same = pa.stdout === pb.stdout && pa.status === pb.status;
      lines.push((same ? '✓ Both versions print exactly the same output' : '✖ The outputs differ') + (input ? ' (input: ' + path.basename(stdinFile) + ')' : ' (no input given; to test with input, create "' + path.basename(stdinFile) + '")'));
      if (!same) lines.push('--- old ---\n' + String(pa.stdout).slice(0, 600) + '\n--- new ---\n' + String(pb.stdout).slice(0, 600));
      cleanup(a); cleanup(b);
      return { ok: same, text: lines.join('\n') };
    }
    if (graphics) lines.push('ℹ graphics.h program — its output is on the screen, so only compilation was checked.');
    cleanup(a); cleanup(b);
    return { ok: a.ok && b.ok, text: lines.join('\n') };
  } finally {
    for (const v of [oldV, newV]) { try { fs.rmSync(v.dir, { recursive: true, force: true }); } catch { /* */ } }
  }
}

function modernShell(webview, context) {
  const media = p => webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', p)));
  const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('modern-panel.css')}">
<title>PRABHA · Turbo → Modern</title></head>
<body><div id="app"><p class="muted">Loading…</p></div>
<script nonce="${nonce}" src="${media('modern-panel.js')}"></script></body></html>`;
}

/* ───────────────────────── examples ───────────────────────── */

async function openExample(context) {
  const dir = path.join(context.extensionPath, 'examples');
  const files = fs.readdirSync(dir).filter(f => SRC_EXT.includes(path.extname(f)));
  const pick = await vscode.window.showQuickPick(files, { placeHolder: 'Open a PRABHA example' });
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(path.join(dir, pick));
  await vscode.window.showTextDocument(doc);
}

function deactivate() { stopProgram(); if (con) { try { con.term.dispose(); } catch { /* */ } } }

// _diag/_out sirf tests ke liye (tests/extension-test.js)
module.exports = { activate, deactivate, _diag: () => diag, _out: () => out };
