/*
 * PRABHA 5.0.0 — Turbo C graphics.h / conio.h inside VS Code.
 *
 * 5.0.0: in-built compiler. PRABHA ab khud compiler dhoondhta hai (PATH,
 * CodeBlocks/MSYS2/TDM/WinGet folders) aur na mile to Windows par EK click mein
 * apna GCC le aata hai (lib/toolchain.js). macOS/Linux par sahi install command
 * terminal mein khol deta hai. Windows ka stdout protocol bhi ab line-level par
 * route hota hai (lib/stream.js) — frames tootte nahi, printf ka text gum nahi hota.
 *
 * The runtime (runtime/prabha_core.c) implements the whole BGI + conio
 * surface against a 640x480 16-colour framebuffer and streams RLE frames
 * over an extra pipe (fd 3), so the program's own printf/scanf still own
 * stdout/stdin. This file compiles the user's program against that runtime,
 * runs it, feeds frames to the panel, and feeds the panel's keystrokes back
 * to the program's stdin for getch/kbhit/cscanf.
 */
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const toolchain = require('./lib/toolchain');
const { createRouter } = require('./lib/stream');

const VERSION = '5.0.1';
let panel;            // the one PRABHA screen
let child;            // running program
let out;              // output channel
let status;
let extRoot;
const coreObjs = new Map(); // compiler path → compiled prabha_core.o (session cache)
let storageDir;       // PRABHA ka apna GCC yahan rehta hai (globalStorage)
let cachedTc;         // last detected toolchain

function activate(context) {
  extRoot = context.extensionPath;
  storageDir = context.globalStorageUri ? context.globalStorageUri.fsPath : path.join(os.homedir(), '.prabha');
  out = vscode.window.createOutputChannel('PRABHA');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  status.command = 'prabha.showOutput';
  context.subscriptions.push(out, status,
    vscode.commands.registerCommand('prabha.run', target => runCurrent(target)),
    vscode.commands.registerCommand('prabha.stop', () => stopProgram('stopped from the command')),
    vscode.commands.registerCommand('prabha.showOutput', () => out.show(true)),
    vscode.commands.registerCommand('prabha.openExample', () => openExample(context)),
    vscode.commands.registerCommand('prabha.installCompiler', () => installCompiler(true)),
    vscode.commands.registerCommand('prabha.compilerInfo', () => compilerInfo()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('prabha')) cachedTc = undefined; })
  );
}

function cfg() {
  const c = vscode.workspace.getConfiguration('prabha');
  return {
    cc: c.get('cCompiler', 'gcc'),
    cxx: c.get('cppCompiler', 'g++'),
    toolchainUrl: c.get('toolchainUrl', ''),
    flags: c.get('extraFlags', ''),
    scale: c.get('scale', 1.5),
    keepOpen: c.get('keepPanelOpenOnExit', true),
    legacyCompat: c.get('turboCppCompatibility', true)
  };
}

/* ───────────── compiler (in-built toolchain) ───────────── */

/**
 * Kaam karne wala compiler lao. Na mile to user se ek click mein install karwao.
 * Return: toolchain object ya null (user ne mana kiya / install fail).
 */
async function ensureToolchain(isCpp) {
  const conf = cfg();
  if (!cachedTc) cachedTc = toolchain.detect({ cc: conf.cc, cxx: conf.cxx }, storageDir);
  if (cachedTc && (!isCpp || cachedTc.cxx)) return cachedTc;
  const ok = await installCompiler(false, isCpp);
  return ok ? cachedTc : null;
}

/** Compiler install flow — Windows: PRABHA GCC; macOS: Xcode tools; Linux: package manager */
async function installCompiler(explicit, isCpp) {
  const need = isCpp ? 'C++ compiler (g++)' : 'C compiler (gcc)';
  if (process.platform === 'win32') {
    const pick = await vscode.window.showInformationMessage(
      'PRABHA ko ' + need + ' chahiye. PRABHA apna GCC ek click mein install kar sakta hai (' + toolchain.WINLIBS.version +
      ', ~' + toolchain.WINLIBS.approxMB + ' MB, sirf ek baar, sirf PRABHA ke folder mein — system PATH nahi chhedta).',
      { modal: !explicit }, 'Install PRABHA GCC', 'Mera MinGW folder chuno');
    if (pick === 'Mera MinGW folder chuno') return chooseCompilerFolder();
    if (pick !== 'Install PRABHA GCC') return false;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'PRABHA: GCC install ho raha hai', cancellable: true }, async (progress, token) => {
        let last = 0;
        await toolchain.installWindows(storageDir, {
          url: cfg().toolchainUrl || undefined,
          isCancelled: () => token.isCancellationRequested,
          log: s => out.appendLine('[toolchain] ' + s),
          onProgress: (got, total) => {
            const pct = total ? Math.floor(got * 100 / total) : 0;
            if (pct > last) { progress.report({ increment: pct - last, message: Math.round(got / 1048576) + ' / ' + Math.round(total / 1048576) + ' MB' }); last = pct; }
          }
        });
        progress.report({ message: 'extract ho gaya, check kar raha hoon…' });
      });
    } catch (e) {
      out.appendLine('[toolchain] install failed: ' + (e.message || e));
      out.show(true);
      vscode.window.showErrorMessage('PRABHA: GCC install nahi ho paya — ' + (e.message || e) + '. Internet check karo, ya "Mera MinGW folder chuno" try karo.');
      return false;
    }
    cachedTc = toolchain.detect({ cc: cfg().cc, cxx: cfg().cxx }, storageDir);
    if (cachedTc) vscode.window.showInformationMessage('PRABHA: compiler ready — ' + cachedTc.version);
    return !!cachedTc;
  }
  const hint = toolchain.installHint();
  const pick = await vscode.window.showInformationMessage(
    'PRABHA ko ' + need + ' chahiye. Ek command se install ho jaayega: ' + hint.command + (hint.note ? ' — ' + hint.note : ''),
    hint.label + ' (terminal mein)', 'Compiler folder chuno');
  if (pick === 'Compiler folder chuno') return chooseCompilerFolder();
  if (!pick) return false;
  const t = vscode.window.createTerminal({ name: 'PRABHA · compiler install' });
  t.show();
  t.sendText(hint.command);
  vscode.window.showInformationMessage('Install khatam hone ke baad PRABHA: Run dobara dabao.');
  return false;
}

/** User apna compiler folder (…\\bin) chune → settings mein save */
async function chooseCompilerFolder() {
  const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Is folder mein gcc hai' });
  if (!pick || !pick[0]) return false;
  const bin = pick[0].fsPath;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const cc = path.join(bin, 'gcc' + ext), cxx = path.join(bin, 'g++' + ext);
  if (!toolchain.works(cc, toolchain.envWith(bin))) {
    vscode.window.showErrorMessage('PRABHA: is folder mein chalne wala gcc' + ext + ' nahi mila (' + bin + ').');
    return false;
  }
  const c = vscode.workspace.getConfiguration('prabha');
  await c.update('cCompiler', cc, vscode.ConfigurationTarget.Global);
  await c.update('cppCompiler', cxx, vscode.ConfigurationTarget.Global);
  cachedTc = toolchain.detect({ cc, cxx }, storageDir);
  return !!cachedTc;
}

function compilerInfo() {
  cachedTc = toolchain.detect({ cc: cfg().cc, cxx: cfg().cxx }, storageDir);
  if (!cachedTc) { installCompiler(true); return; }
  out.appendLine('PRABHA compiler: ' + cachedTc.version + '\n  C:   ' + cachedTc.cc + '\n  C++: ' + (cachedTc.cxx || '(not found)') + '\n  from: ' + cachedTc.source);
  out.show(true);
  vscode.window.showInformationMessage('PRABHA compiler: ' + cachedTc.version + ' (' + cachedTc.source + ')');
}

async function runCurrent(target) {
  const editor = vscode.window.activeTextEditor;
  const uri = target || (editor ? editor.document.uri : undefined);
  if (!uri || uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a .c or .cpp file that uses graphics.h or conio.h, then run PRABHA.');
    return;
  }
  const file = uri.fsPath;
  const ext = path.extname(file).toLowerCase();
  if (!['.c', '.cpp', '.cc', '.cxx'].includes(ext)) {
    vscode.window.showWarningMessage('PRABHA runs C and C++ files (.c/.cpp) — this is ' + (ext || 'not one') + '.');
    return;
  }
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (doc && doc.isDirty) await doc.save();

  stopProgram();
  const conf = cfg();
  const isCpp = ext !== '.c';
  const tc = await ensureToolchain(isCpp);
  if (!tc) return;
  const cc = tc.cc;
  const cxx = tc.cxx;
  const driver = isCpp ? cxx : cc;
  const isClang = /clang/i.test(tc.version);

  out.clear();
  out.appendLine('· PRABHA ' + VERSION + ' · ' + file);
  out.appendLine('compiler: ' + tc.version + ' (' + tc.source + ')');
  status.text = '$(sync~spin) PRABHA compiling';
  status.show();

  const runtime = path.join(extRoot, 'runtime');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-'));
  const bin = path.join(work, 'program' + (process.platform === 'win32' ? '.exe' : ''));

  try {
    // 1) the runtime object is compiled once per session per compiler, always as C
    let coreObj = coreObjs.get(cc);
    if (!coreObj || !fs.existsSync(coreObj)) {
      coreObj = path.join(os.tmpdir(), 'prabha_core_' + process.pid + '_' + coreObjs.size + '.o');
      await exec(cc, ['-std=c99', '-O2', '-I', runtime, '-c',
        path.join(runtime, 'prabha_core.c'), '-o', coreObj], tc.env);
      coreObjs.set(cc, coreObj);
      out.appendLine('runtime compiled with ' + cc);
    }

    // 2) the user's program, with its natural compiler.
    //
    // Turbo C++ compatibility (on by default): old college programs use
    // <iostream.h>, unqualified cout/cin, and `void main()`, none of which a
    // modern g++ accepts as-is. When enabled, PRABHA compiles such a program
    // WITHOUT asking the student to change a single line:
    //   - the compat/ folder supplies <iostream.h>, <conio.h>, <iomanip.h>...
    //   - the prelude header pulls in `using namespace std` and the common
    //     standard headers, so unqualified names resolve
    //   - `void main(...)` is rewritten to `int main(...)` in a temporary copy
    //     (the compiler rejects a void-returning main outright)
    // A program that is already valid modern C++ is unaffected by any of this.
    const legacy = isCpp && conf.legacyCompat;
    const compatDir = path.join(runtime, 'compat');
    const std = isCpp ? (legacy ? '-std=c++14' : '-std=c++17') : '-std=c99';
    const extra = conf.flags ? conf.flags.split(/\s+/).filter(Boolean) : [];

    let srcToCompile = file;
    if (legacy) {
      const raw = fs.readFileSync(file, 'utf8');
      // Rewrite only the `void main` entry form; `int main` is left untouched.
      const fixed = raw.replace(/\bvoid(\s+)main(\s*)\(/g, 'int$1main$2(');
      // Compile a temp copy so the student's file on disk is never modified.
      srcToCompile = path.join(work, path.basename(file));
      fs.writeFileSync(srcToCompile, fixed, 'utf8');
      if (fixed !== raw) out.appendLine('Turbo C++ mode: void main() adapted to int main()');
    }

    const args = [std];
    if (legacy) {
      if (!isClang) args.push('-fpermissive');   // clang ka equivalent nahi; uske bina bhi chalta hai
      args.push(
        '-I', compatDir,
        '-include', path.join(compatDir, 'prabha_cpp_prelude.h'));
    }
    args.push('-I', runtime, srcToCompile, coreObj, '-o', bin, '-lm', ...extra);
    // Windows + MinGW: static link, taaki program ko libstdc++-6.dll / libgcc DLL
    // dhoondhne na pade ("The code execution cannot proceed..." error).
    if (tc.mingw) args.push('-static');

    await exec(driver, args, tc.env);
    out.appendLine('program compiled with ' + driver +
      (legacy ? ' (Turbo C++ compatibility on)' : '') + '\n');
  } catch (e) {
    status.text = '$(error) PRABHA compile failed';
    out.appendLine(String(e.message || e));
    out.show(true);
    return;
  }

  ensurePanel(conf.scale);
  panel.webview.postMessage({ t: 'reset' });

  // fd 3 carries the frame protocol; stdout stays the program's own.
  child = cp.spawn(bin, [], {
    cwd: path.dirname(file),
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    // runtime ko saaf batao ki protocol fd 3 par bhejo (Windows par fd 3 nahi
    // hota, wahan stdout + lib/stream.js router)
    env: process.platform === 'win32' ? tc.env : { ...tc.env, PRABHA_PROTO_FD: '3' }
  });
  status.text = '$(run) PRABHA running';
  const started = Date.now();

  // Protocol message → panel. fd 3 (Linux/macOS) aur stdout (Windows) dono
  // isi router se guzarte hain; line beech mein tooti ho tab bhi sahi jodta hai.
  const toPanel = msg => { if (panel) panel.webview.postMessage({ t: 'proto', msg }); };
  const fd3 = createRouter(() => { /* fd 3 par sirf protocol aata hai */ }, toPanel);
  const so = createRouter(text => out.append(text), toPanel);
  if (child.stdio[3]) child.stdio[3].on('data', d => fd3.push(d));
  child.stdout.on('data', d => so.push(d));
  child.stderr.on('data', d => out.append(d.toString()));
  child.stdin.on('error', () => {});
  // 'close' (na ki 'exit'): tab tak saara stdout/fd3 data padh liya gaya hota hai
  child.on('close', code => {
    fd3.end(); so.end();
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    out.appendLine('\nprogram exited with code ' + code + ' after ' + secs + 's');
    status.text = (code === 0 ? '$(check)' : '$(error)') + ' PRABHA · exit ' + code;
    if (panel) panel.webview.postMessage({ t: 'exit', code });
    child = undefined;
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { }
  });
}

function exec(cmd, args, env) {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || String(err)).trim()));
      else resolve();
    });
  });
}

function stopProgram(reason) {
  if (child) {
    try { child.kill(); } catch { }
    if (reason) out.appendLine('\n' + reason);
    child = undefined;
  }
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
    else if (k.key === 'Enter') child.stdin.write('\r');
    else if (k.key === 'Backspace') child.stdin.write(Buffer.from([8]));
    else if (k.key === 'Tab') child.stdin.write('\t');
    else if (k.key === 'Escape') child.stdin.write(Buffer.from([27]));
    else if (k.key && k.key.length === 1) child.stdin.write(k.key);
  } catch { }
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
  canvas { image-rendering:pixelated; width:${w}px; height:${h}px;
           border:1px solid #333; outline:none; margin-top:4px; }
  #hint { font-size:11px; padding:4px; }
</style></head><body>
<div id="bar"><b>PRABHA</b><span id="st">waiting for a program…</span><span id="fps"></span></div>
<canvas id="cv" width="640" height="480" tabindex="0"></canvas>
<div id="hint">click the screen so it hears your keyboard · getch()/kbhit() read these keys</div>
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
  if (m.t === 'reset') { fb.fill(0); repaint(); st.textContent = 'running'; return; }
  if (m.t === 'exit') { st.textContent = 'program exited (code ' + m.code + ')'; stopSound(); return; }
  if (m.t !== 'proto') return;
  const p = m.msg;
  if (p.t === 'init') { fb.fill(0); st.textContent = p.w + '×' + p.h + ' · runtime ' + p.version; }
  else if (p.t === 'palette') { pal = p.rgb; repaint(); }
  else if (p.t === 'frame') {
    const raw = b64bytes(p.rle);
    let o = 0, x = p.x, y = p.y, w = p.w, hh = p.h, row = 0, col = 0;
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

async function openExample(context) {
  const dir = path.join(context.extensionPath, 'examples');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.c') || f.endsWith('.cpp'));
  const pick = await vscode.window.showQuickPick(files, { placeHolder: 'Open a PRABHA example' });
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(path.join(dir, pick));
  await vscode.window.showTextDocument(doc);
}

function deactivate() { stopProgram(); }

module.exports = { activate, deactivate };
