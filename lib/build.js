/*
 * lib/build.js — PRABHA ka "Compile" button. Run (Ctrl+F9), Compile (Alt+F9)
 * aur Debug (F5) teeno isi ek function se compile karte hain.
 *
 * WHY:   Ek hi jagah saare rules: Turbo mode (purana code bina badle chale),
 *        runtime (graphics.h/conio.h), console ke liye unbuffered output, debug
 *        info, Windows par -static, Zig ke `cc`/`c++` prefix, aur errors ko
 *        Problems tab ke liye user ki file/line par map karna.
 * WHAT:  build(file, opts) → { ok, bin, diagnostics[], log, usesPanel, sourceMap, work }
 * NOTE:  vscode import nahi — tests/build-test.js seedha chalata hai.
 * FLOW:  extension.js → build() → (ok) → panel / PRABHA Console / debugger
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { adaptTurbo } = require('./modern/turbo-adapt');
const { parseDiagnostics } = require('./diagnostics');

const coreCache = new Map();   // compiler+mode → prabha_core.o (session cache)

/*
 * Windows + MinGW: gcc/ld Unicode path nahi samajhte. Hindi (ya kisi bhi non-ASCII)
 * naam wale folder mein `ld: cannot open output file …\?????\a.exe` aata tha.
 * Isliye build ka kaam hamesha ek ASCII folder mein hota hai.
 */
const isAscii = p => /^[\x20-\x7e]*$/.test(p);
let asciiBase;
function workBase() {
  if (asciiBase) return asciiBase;
  const t = os.tmpdir();
  if (process.platform !== 'win32' || isAscii(t)) return (asciiBase = t);
  // username Hindi ho to tmpdir bhi non-ASCII — sabke liye likhne layak Public folder
  const pub = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'prabha-work');
  try { fs.mkdirSync(pub, { recursive: true }); if (isAscii(pub)) return (asciiBase = pub); } catch { /* */ }
  return (asciiBase = t);
}

/** Runtime folder ka ASCII copy (extension path Hindi username ke andar ho sakta hai) */
let rtCopy;
function asciiRuntime(rt) {
  if (process.platform !== 'win32' || isAscii(rt)) return rt;
  if (rtCopy && fs.existsSync(rtCopy)) return rtCopy;
  rtCopy = path.join(workBase(), 'runtime-' + process.pid);
  fs.cpSync(rt, rtCopy, { recursive: true });
  return rtCopy;
}

/*
 * ARM CPU (Apple Silicon, ARM Linux) integer divide-by-zero par crash nahi karta —
 * result 0 aata hai aur galti chhup jaati hai. Turbo C ("Divide error") aur x86 PCs
 * jaisa behaviour dene ke liye sirf ye ek check trap ke saath on karte hain.
 * (koi sanitizer runtime library nahi chahiye — sirf ek trap instruction)
 */
function trapFlags(isClang, arch = process.arch) {
  if (arch !== 'arm64') return [];
  return isClang
    ? ['-fsanitize=integer-divide-by-zero', '-fsanitize-trap=integer-divide-by-zero']
    : ['-fsanitize=integer-divide-by-zero', '-fsanitize-undefined-trap-on-error'];
}

/** graphics.h / conio.h / dos.h wale programs PRABHA panel mein chalte hain */
function usesPanel(src) {
  return /^\s*#\s*include\s*[<"](graphics|conio)\.h[>"]/m.test(src);
}

function run(cmd, args, env, cwd) {
  return new Promise(resolve => {
    cp.execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, env, cwd }, (err, stdout, stderr) => {
      resolve({ ok: !err, text: String(stderr || '') + String(stdout || ''), error: err && !stderr && !stdout ? String(err.message || err) : '' });
    });
  });
}

/**
 * @param {string} file  user ki .c/.cpp file (disk par saved)
 * @param {{tc:object, runtimeDir:string, mode?:'run'|'compile'|'debug', console?:boolean,
 *          legacyCompat?:boolean, strict?:boolean, extraFlags?:string, log?:(s:string)=>void}} o
 */
async function build(file, o) {
  const tc = o.tc;
  const log = o.log || (() => {});
  const ext = path.extname(file).toLowerCase();
  const isCpp = ext !== '.c';
  const raw = fs.readFileSync(file, 'utf8');
  const panel = usesPanel(raw);
  const debug = o.mode === 'debug';
  const rt = asciiRuntime(path.resolve(o.runtimeDir));   // relative path compiler ke cwd se toot jaata
  const work = fs.mkdtempSync(path.join(workBase(), 'prabha-'));
  // MinGW khud .exe jodta hai — naam pehle se .exe rakho (cross-build par bhi)
  const bin = path.join(work, 'program' + (process.platform === 'win32' || tc.mingw ? '.exe' : ''));
  const isClang = /clang|zig/i.test(tc.version);
  const ccCmd = tc.cc, ccPre = tc.ccArgs || [];
  const cxxCmd = tc.cxx, cxxPre = tc.cxxArgs || [];
  // strict = "Modern" check: Turbo mode band + standard ke bahar kuch bhi error
  const legacy = o.legacyCompat !== false && !o.strict;

  // 1) runtime object — har compiler (aur debug/normal) ke liye ek baar
  const coreKey = ccCmd + '|' + ccPre.join(' ') + '|' + (debug ? 'g' : 'O2');
  let core = coreCache.get(coreKey);
  if (!core || !fs.existsSync(core)) {
    core = path.join(workBase(), 'prabha_core_' + process.pid + '_' + coreCache.size + '.o');
    const r = await run(ccCmd, [...ccPre, '-std=c99', debug ? '-g' : '-O2', '-I', rt, '-c', path.join(rt, 'prabha_core.c'), '-o', core], tc.env);
    if (!r.ok) return { ok: false, bin: null, diagnostics: [], log: 'PRABHA runtime compile failed:\n' + r.text + r.error, usesPanel: panel, work };
    coreCache.set(coreKey, core);
    log('runtime compiled with ' + tc.version);
  }

  // 2) Turbo mode: temp copy (user ki file kabhi nahi badalti). Line numbers same rehti hain.
  let src = file;
  let adapted = null;
  // Windows par non-ASCII path → source (aur paas ke headers) ASCII work folder mein copy
  const copyNeeded = process.platform === 'win32' && !isAscii(file);
  const srcName = isAscii(path.basename(file)) ? path.basename(file) : 'main' + ext;
  if (copyNeeded) {
    try {
      for (const h of fs.readdirSync(path.dirname(file))) if (/\.(h|hpp|hh)$/i.test(h) && isAscii(h)) fs.copyFileSync(path.join(path.dirname(file), h), path.join(work, h));
    } catch { /* headers optional */ }
  }
  let code = raw;
  if (legacy) {
    adapted = adaptTurbo(raw);
    if (adapted.code !== raw) { code = adapted.code; for (const c of adapted.changed) log('Turbo mode: ' + c); }
  }
  if (code !== raw || copyNeeded) {
    src = path.join(work, srcName);
    fs.writeFileSync(src, code, 'utf8');
  }

  const args = [];
  if (o.strict) args.push(isCpp ? '-std=c++17' : '-std=c11', '-pedantic-errors');
  else args.push(isCpp ? (legacy ? '-std=gnu++14' : '-std=c++17') : '-std=gnu99');
  args.push('-Wall');
  if (debug) args.push('-g', '-O0'); else args.push('-O2');
  args.push(...trapFlags(isClang));
  if (isCpp && legacy) {
    if (!isClang) args.push('-fpermissive');
    args.push('-I', path.join(rt, 'compat'), '-include', path.join(rt, 'compat', 'prabha_cpp_prelude.h'));
  }
  // Console / debugger: stdout unbuffered → "Enter a: " input se pehle dikhe
  if (!panel || debug) args.push('-include', path.join(rt, 'prabha_unbuffered.h'));
  // Debug info mein temp folder ki jagah user ka folder → breakpoints sahi file par
  if (debug && src !== file && !copyNeeded) args.push('-fdebug-prefix-map=' + work + '=' + path.dirname(file));
  args.push('-I', rt, src, core, '-o', bin, '-lm');
  if (o.extraFlags) args.push(...o.extraFlags.split(/\s+/).filter(Boolean));
  if (tc.mingw) args.push('-static');

  const driver = isCpp ? cxxCmd : ccCmd;
  const pre = isCpp ? cxxPre : ccPre;
  const r = await run(driver, [...pre, ...args], tc.env, copyNeeded ? work : path.dirname(file));
  // temp copy ke path ko user ki file par map karo (Problems tab click → asli file)
  const mapFile = p => {
    const rp = path.resolve(copyNeeded ? work : path.dirname(file), p);
    if (rp === path.resolve(src) || rp === path.resolve(file)) return file;
    return null;
  };
  const diagnostics = parseDiagnostics(r.text, { mapFile, mainFile: file });
  return {
    ok: r.ok && fs.existsSync(bin),
    bin: r.ok ? bin : null,
    diagnostics,
    log: r.text + r.error,
    usesPanel: panel,
    isCpp,
    sourceMap: src !== file ? { from: src, to: file } : null,
    work
  };
}

function cleanup(result) {
  if (result && result.work) { try { fs.rmSync(result.work, { recursive: true, force: true }); } catch { /* */ } }
}

module.exports = { build, cleanup, usesPanel, trapFlags, workBase, isAscii };
