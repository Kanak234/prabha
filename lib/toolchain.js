/*
 * lib/toolchain.js — PRABHA ka "in-built compiler" wala hissa.
 *
 * WHY:   Sabse bada reason jo students PRABHA chhod dete the: "gcc not found".
 *        Windows par MinGW install karna, PATH set karna — beginner ke liye yahi
 *        sabse mushkil step hai. Ab PRABHA khud compiler dhoondhta hai, aur na mile
 *        to EK CLICK mein apna GCC le aata hai.
 * WHAT:  detect()        → settings → PATH → jaani-pehchaani jagah (CodeBlocks, MSYS2,
 *                          TDM, WinGet) → PRABHA ka apna GCC (globalStorage)
 *        installWindows() → WinLibs GCC (UCRT, x86_64) download + SHA-256 verify + extract
 *        installHint()  → macOS/Linux ke liye sahi ek-line command
 * USE:   extension.js → `const tc = await detect(...)` → tc.cc / tc.cxx / tc.env
 * NOTE:  Is file mein `vscode` import nahi hai — taaki Node tests seedha chala sakein.
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

/* Pinned WinLibs build (GCC 16.2.0 + MinGW-w64 14.0.0, UCRT, posix threads, x86_64).
 * Pinned = har student ko same compiler milta hai; setting se badal sakte ho. */
const WINLIBS = {
  version: 'GCC 16.2.0 (WinLibs, UCRT)',
  url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r2.zip',
  sha256Url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r2.zip.sha256',
  approxMB: 261
};

const isWin = () => process.platform === 'win32';
const exe = n => (isWin() ? n + '.exe' : n);

/** `cmd --version` chala kar dekho ki compiler sach mein kaam karta hai */
function works(cmd, env) {
  try {
    const out = cp.execFileSync(cmd, ['--version'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'], env });
    return /gcc|clang|Free Software Foundation|LLVM/i.test(out) ? out.split(/\r?\n/)[0].trim() : null;
  } catch { return null; }
}

/** PATH mein naam se dhoondho (where / which) */
function onPath(name) {
  try {
    const r = cp.execFileSync(isWin() ? 'where' : 'which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
    const first = r.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    return first || null;
  } catch { return null; }
}

/** Windows par students ke paas aksar compiler hota hai par PATH mein nahi */
function windowsKnownBins() {
  const env = process.env;
  const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean);
  const list = [
    'C:\\msys64\\ucrt64\\bin', 'C:\\msys64\\mingw64\\bin', 'C:\\msys64\\clang64\\bin',
    'C:\\mingw64\\bin', 'C:\\MinGW\\bin', 'C:\\TDM-GCC-64\\bin', 'C:\\TDM-GCC-32\\bin',
    ...pf.map(p => path.join(p, 'CodeBlocks', 'MinGW', 'bin')),
    ...pf.map(p => path.join(p, 'mingw-w64', 'mingw64', 'bin')),
    ...pf.map(p => path.join(p, 'Dev-Cpp', 'MinGW64', 'bin'))
  ];
  // WinGet se install hua WinLibs
  const wg = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(wg)) if (/WinLibs/i.test(d)) list.push(path.join(wg, d, 'mingw64', 'bin'));
  } catch { /* WinGet folder nahi */ }
  return list;
}

function unixKnownBins() {
  const list = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
  return list;
}

/** PRABHA ka apna GCC kahan rakha jaata hai */
function prabhaToolchainDir(storageDir) { return path.join(storageDir, 'toolchain'); }
function prabhaBin(storageDir) { return path.join(prabhaToolchainDir(storageDir), 'mingw64', 'bin'); }

/** bin folder ko PATH ke aage jod kar env banao (gcc ko apne DLL/as/ld milein) */
function envWith(binDir) {
  if (!binDir) return { ...process.env };
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  return { ...process.env, [key]: binDir + path.delimiter + (process.env[key] || '') };
}

/**
 * Compiler dhoondho.
 * @param {{cc?:string, cxx?:string}} conf  user settings (prabha.cCompiler / cppCompiler)
 * @param {string} storageDir                context.globalStorageUri.fsPath
 * @returns {{cc:string, cxx:string, binDir:string|null, source:string, version:string, env:object, mingw:boolean}|null}
 */
function detect(conf, storageDir) {
  const tries = [];
  const add = (cc, cxx, binDir, source) => tries.push({ cc, cxx, binDir, source });

  // 1) User setting — absolute path ya naam (default 'gcc' / 'g++')
  if (conf.cc && conf.cc !== 'gcc') add(conf.cc, conf.cxx || conf.cc.replace(/gcc(\.exe)?$/i, 'g++$1'), path.isAbsolute(conf.cc) ? path.dirname(conf.cc) : null, 'setting');

  // 2) PATH
  for (const [c, x] of [['gcc', 'g++'], ['cc', 'c++'], ['clang', 'clang++']]) {
    const p = onPath(exe(c));
    if (p) add(p, onPath(exe(x)) || p.replace(new RegExp(c + '(\\.exe)?$', 'i'), x + '$1'), path.dirname(p), 'PATH');
  }

  // 3) PRABHA ka apna (pehle install kiya hua)
  if (storageDir) {
    const b = prabhaBin(storageDir);
    add(path.join(b, exe('gcc')), path.join(b, exe('g++')), b, 'prabha');
  }

  // 4) Jaani-pehchaani jagah (PATH mein nahi)
  for (const b of (isWin() ? windowsKnownBins() : unixKnownBins())) {
    for (const [c, x] of [['gcc', 'g++'], ['clang', 'clang++']]) {
      const cc = path.join(b, exe(c));
      if (fs.existsSync(cc)) add(cc, path.join(b, exe(x)), b, 'known-location');
    }
  }

  const seen = new Set();
  for (const t of tries) {
    const key = (t.cc || '').toLowerCase();
    if (!t.cc || seen.has(key)) continue;
    seen.add(key);
    // macOS: /usr/bin/gcc ek shim hai jo Xcode tools na hon to install dialog kholta hai
    if (process.platform === 'darwin' && /^\/usr\/bin\/(gcc|cc|clang)$/.test(t.cc) && !xcodeToolsInstalled()) continue;
    const env = envWith(t.binDir);
    const v = works(t.cc, env);
    if (!v) continue;
    const cxxOk = t.cxx && (fs.existsSync(t.cxx) || onPath(path.basename(t.cxx))) ? t.cxx : null;
    return { cc: t.cc, cxx: cxxOk, binDir: t.binDir, source: t.source, version: v, env, mingw: isWin() && /gcc|mingw|GNU/i.test(v) && !/clang/i.test(v) };
  }
  return null;
}

function xcodeToolsInstalled() {
  try { cp.execFileSync('xcode-select', ['-p'], { stdio: 'ignore', timeout: 10000 }); return true; } catch { return false; }
}

/** macOS / Linux par compiler na ho to user ko kaunsi EK command chalani hai */
function installHint() {
  if (process.platform === 'darwin') {
    return { label: 'Install Xcode Command Line Tools', command: 'xcode-select --install', note: 'Apple ka dialog khulega — "Install" dabao, phir PRABHA dobara chalao.' };
  }
  let id = '';
  try { id = fs.readFileSync('/etc/os-release', 'utf8'); } catch { /* unknown distro */ }
  const like = (/^ID_LIKE=(.*)$/m.exec(id) || [])[1] || '';
  const name = ((/^ID=(.*)$/m.exec(id) || [])[1] || '').replace(/"/g, '');
  const all = (name + ' ' + like).toLowerCase();
  if (/fedora|rhel|centos|rocky|alma/.test(all)) return { label: 'Install gcc', command: 'sudo dnf install -y gcc gcc-c++' };
  if (/arch|manjaro|endeavour/.test(all)) return { label: 'Install gcc', command: 'sudo pacman -S --needed --noconfirm base-devel' };
  if (/suse/.test(all)) return { label: 'Install gcc', command: 'sudo zypper install -y gcc gcc-c++' };
  if (/alpine/.test(all)) return { label: 'Install gcc', command: 'sudo apk add build-base' };
  return { label: 'Install gcc', command: 'sudo apt-get install -y build-essential' };
}

/* ───────────── Windows: PRABHA ka apna GCC ───────────── */

/** HTTPS GET with redirects (GitHub → objects.githubusercontent.com) */
function get(url, onRes, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PRABHA-VSCode' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error('too many redirects'));
        return resolve(get(new URL(res.headers.location, url).toString(), onRes, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      resolve(onRes(res));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('network timeout')));
  });
}

function downloadText(url) {
  return get(url, res => new Promise((ok, bad) => { let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; }); res.on('end', () => ok(s)); res.on('error', bad); }));
}

function downloadFile(url, dest, onProgress, isCancelled) {
  return get(url, res => new Promise((ok, bad) => {
    const total = Number(res.headers['content-length']) || 0;
    let got = 0;
    const hash = crypto.createHash('sha256');
    const f = fs.createWriteStream(dest);
    res.on('data', d => {
      if (isCancelled && isCancelled()) { res.destroy(new Error('cancelled')); return; }
      got += d.length; hash.update(d);
      if (onProgress) onProgress(got, total);
    });
    res.on('error', bad);
    f.on('error', bad);
    res.pipe(f);
    f.on('finish', () => f.close(() => ok({ bytes: got, sha256: hash.digest('hex') })));
  }));
}

/** zip extract: Windows 10+ ka `tar` (bsdtar) tez hai; na ho to PowerShell Expand-Archive */
function extractZip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(tar)) {
    const r = cp.spawnSync(tar, ['-xf', zip, '-C', dir], { stdio: 'pipe', timeout: 30 * 60000 });
    if (r.status === 0) return;
  }
  const ps = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`], { stdio: 'pipe', timeout: 60 * 60000 });
  if (ps.status !== 0) throw new Error('extract failed: ' + (ps.stderr || '').toString().slice(0, 400));
}

/**
 * WinLibs GCC download → SHA-256 verify → extract → `gcc --version` check.
 * @param {string} storageDir
 * @param {{url?:string, sha256Url?:string, onProgress?:Function, isCancelled?:Function, log?:Function}} o
 * @returns {Promise<string>} bin folder
 */
async function installWindows(storageDir, o = {}) {
  const url = o.url || WINLIBS.url;
  const shaUrl = o.sha256Url !== undefined ? o.sha256Url : (o.url ? null : WINLIBS.sha256Url);
  const log = o.log || (() => {});
  fs.mkdirSync(storageDir, { recursive: true });
  const zip = path.join(storageDir, 'prabha-gcc.zip');
  let expected = null;
  if (shaUrl) {
    const t = await downloadText(shaUrl);
    expected = (/([a-f0-9]{64})/i.exec(t) || [])[1];
    if (!expected) throw new Error('could not read the SHA-256 checksum');
    log('expected sha256 ' + expected);
  }
  const res = await downloadFile(url, zip, o.onProgress, o.isCancelled);
  log('downloaded ' + res.bytes + ' bytes, sha256 ' + res.sha256);
  if (expected && res.sha256.toLowerCase() !== expected.toLowerCase()) {
    try { fs.unlinkSync(zip); } catch { /* ignore */ }
    throw new Error('checksum mismatch — download corrupted or tampered, not installing');
  }
  const dir = prabhaToolchainDir(storageDir);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* fresh */ }
  extractZip(zip, dir);
  try { fs.unlinkSync(zip); } catch { /* keep going */ }
  const bin = prabhaBin(storageDir);
  if (!works(path.join(bin, exe('gcc')), envWith(bin))) throw new Error('installed, but gcc --version did not run from ' + bin);
  return bin;
}

module.exports = { detect, installHint, installWindows, envWith, WINLIBS, prabhaBin, windowsKnownBins, works };
