/*
 * PRABHA 3.0.0 — Turbo C graphics.h / conio.h inside VS Code.
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

let panel;            // the one PRABHA screen
let child;            // running program
let out;              // output channel
let status;
let extRoot;
let coreObj;          // cached compiled prabha_core.o per session

function activate(context) {
  extRoot = context.extensionPath;
  out = vscode.window.createOutputChannel('PRABHA');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  status.command = 'prabha.showOutput';
  context.subscriptions.push(out, status,
    vscode.commands.registerCommand('prabha.run', target => runCurrent(target)),
    vscode.commands.registerCommand('prabha.stop', () => stopProgram('stopped from the command')),
    vscode.commands.registerCommand('prabha.showOutput', () => out.show(true)),
    vscode.commands.registerCommand('prabha.openExample', () => openExample(context))
  );
}

function cfg() {
  const c = vscode.workspace.getConfiguration('prabha');
  return {
    cc: c.get('cCompiler', 'gcc'),
    cxx: c.get('cppCompiler', 'g++'),
    flags: c.get('extraFlags', ''),
    scale: c.get('scale', 1.5),
    keepOpen: c.get('keepPanelOpenOnExit', true),
    legacyCompat: c.get('turboCppCompatibility', true)
  };
}

function which(cmd) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const r = cp.execFileSync(probe, [cmd], { encoding: 'utf8' });
    return r.split(/\r?\n/)[0].trim();
  } catch { return ''; }
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
  const cc = which(conf.cc) ? conf.cc : (which('cc') ? 'cc' : '');
  const cxx = which(conf.cxx) ? conf.cxx : (which('c++') ? 'c++' : '');
  const driver = isCpp ? cxx : cc;
  if (!cc || (isCpp && !cxx)) {
    vscode.window.showErrorMessage(
      'PRABHA needs ' + (isCpp ? 'a C++ compiler (g++)' : 'a C compiler (gcc)') +
      '. Install it (Linux: build-essential, Windows: MinGW-w64/MSYS2, macOS: xcode-select --install) or set prabha.cCompiler / prabha.cppCompiler.');
    return;
  }

  out.clear();
  out.appendLine('· PRABHA 3.0.0 · ' + file);
  status.text = '$(sync~spin) PRABHA compiling';
  status.show();

  const runtime = path.join(extRoot, 'runtime');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-'));
  const bin = path.join(work, 'program' + (process.platform === 'win32' ? '.exe' : ''));

  try {
    // 1) the runtime object is compiled once per session, always as C
    if (!coreObj || !fs.existsSync(coreObj)) {
      coreObj = path.join(os.tmpdir(), 'prabha_core_' + process.pid + '.o');
      await exec(cc, ['-std=c99', '-O2', '-I', runtime, '-c',
        path.join(runtime, 'prabha_core.c'), '-o', coreObj]);
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
      args.push('-fpermissive',
        '-I', compatDir,
        '-include', path.join(compatDir, 'prabha_cpp_prelude.h'));
    }
    args.push('-I', runtime, srcToCompile, coreObj, '-o', bin, '-lm', ...extra);

    await exec(driver, args);
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
    stdio: ['pipe', 'pipe', 'pipe', 'pipe']
  });
  status.text = '$(run) PRABHA running';
  const started = Date.now();

  let acc = '';
  const onProto = chunk => {
    acc += chunk.toString('latin1');
    let nl;
    while ((nl = acc.indexOf('\n')) !== -1) {
      const line = acc.slice(0, nl); acc = acc.slice(nl + 1);
      if (line.startsWith('##PRABHA##')) {
        try { panel && panel.webview.postMessage({ t: 'proto', msg: JSON.parse(line.slice(10)) }); }
        catch { /* half-written line at exit — ignore */ }
      }
    }
  };
  if (child.stdio[3]) child.stdio[3].on('data', onProto);
  child.stdout.on('data', d => {
    // programs without the extension pipe fall back to stdout — split it
    const text = d.toString('latin1');
    if (text.includes('##PRABHA##')) onProto(d);
    else out.append(text);
  });
  child.stderr.on('data', d => out.append(d.toString()));
  child.stdin.on('error', () => {});
  child.on('exit', code => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    out.appendLine('\nprogram exited with code ' + code + ' after ' + secs + 's');
    status.text = (code === 0 ? '$(check)' : '$(error)') + ' PRABHA · exit ' + code;
    if (panel) panel.webview.postMessage({ t: 'exit', code });
    child = undefined;
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { }
  });
}

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
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
