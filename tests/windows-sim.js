#!/usr/bin/env node
/*
 * tests/windows-sim.js — PRABHA ko "Windows jaisa" chala kar test karna.
 *
 * Do tarike:
 *   - Asli Windows (CI windows-latest): gcc se compile, seedha .exe chalao
 *   - Linux par: MinGW cross-compiler (x86_64-w64-mingw32-gcc) + Wine
 * Windows par fd 3 nahi hota, isliye protocol stdout par aata hai — yahi woh
 * raasta hai jo pehle toot raha tha (runtime compile nahi hota tha, Enter key par
 * getch atak jaata tha, aur chunk boundaries par frames kharab hote the).
 * FLOW: node tests/windows-sim.js → exit 0 = pass, 77 = skip (tools nahi)
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRouter } = require('../lib/stream');

const root = path.join(__dirname, '..');
const native = process.platform === 'win32';
const which = c => { try { cp.execFileSync(native ? 'where' : 'which', [c], { stdio: 'ignore' }); return true; } catch { return false; } };
const CC = native ? 'gcc' : 'x86_64-w64-mingw32-gcc';
const CXX = native ? 'g++' : 'x86_64-w64-mingw32-g++';
const WINE = fs.existsSync('/usr/lib/wine/wine64') ? '/usr/lib/wine/wine64' : 'wine';
if (!which(CC) || (!native && !(fs.existsSync(WINE) || which('wine')))) {
  console.log('windows-sim: skipped (needs ' + (native ? 'gcc' : 'mingw-w64 + wine') + ')');
  process.exit(77);
}
const env = { ...process.env, WINEDEBUG: '-all', WINEPREFIX: process.env.WINEPREFIX || path.join(os.tmpdir(), 'prabha-wine') };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-win-'));
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n       ' + x : '')); } };

// Runtime hamesha C ki tarah compile hota hai (extension bhi yahi karta hai),
// phir user ka program (C ya C++) us object ke saath link hota hai.
function compile(drv, src, out, extra = []) {
  const core = path.join(tmp, 'core.o');
  if (!fs.existsSync(core)) cp.spawnSync(CC, ['-std=c99', '-O2', '-I', path.join(root, 'runtime'), '-c', path.join(root, 'runtime', 'prabha_core.c'), '-o', core]);
  const r = cp.spawnSync(drv, [...extra, '-I', path.join(root, 'runtime'), src, core, '-o', out, '-lm', '-static'], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || r.stdout);
}
function run(exe, onProto, onText) {
  return native ? cp.spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] }) : cp.spawn(WINE, [exe], { stdio: ['pipe', 'pipe', 'pipe'], env });
}

(async () => {
  console.log('\n[windows] PRABHA runtime on ' + (native ? 'native Windows' : 'Wine (MinGW cross build)'));

  // 1) runtime + every example compile for Windows
  const objErr = cp.spawnSync(CC, ['-Wall', '-std=c99', '-I', path.join(root, 'runtime'), '-c', path.join(root, 'runtime', 'prabha_core.c'), '-o', path.join(tmp, 'core.o')], { encoding: 'utf8' });
  ok(objErr.status === 0 && !/warning/.test(objErr.stderr), 'runtime compiles for Windows with -Wall, no warnings', objErr.stderr);
  for (const f of fs.readdirSync(path.join(root, 'examples'))) {
    const isCpp = f.endsWith('.cpp');
    const compat = isCpp ? ['-std=c++14', '-fpermissive', '-I', path.join(root, 'runtime', 'compat'), '-include', path.join(root, 'runtime', 'compat', 'prabha_cpp_prelude.h')] : ['-std=c99'];
    let src = path.join(root, 'examples', f);
    if (isCpp) { const t = path.join(tmp, f); fs.writeFileSync(t, fs.readFileSync(src, 'utf8').replace(/\bvoid(\s+)main(\s*)\(/g, 'int$1main$2(')); src = t; }
    const e = compile(isCpp ? CXX : CC, src, path.join(tmp, f + '.exe'), compat);
    ok(!e, 'example compiles for Windows: ' + f, e && e.split('\n').slice(0, 4).join('\n'));
  }

  // 2) keyboard + protocol over stdout (no fd 3 on Windows)
  const prog = path.join(tmp, 'keys.c');
  fs.writeFileSync(prog, `
#include <graphics.h>
#include <conio.h>
#include <stdio.h>
int main(void){
  int gd=DETECT,gm; initgraph(&gd,&gm,"");
  setcolor(YELLOW); circle(100,100,40);
  printf("Press keys:");
  int a=getch();
  int b=getch();
  int c=(b==0)?getch():-1;
  int d=getch();
  printf(" got %d %d %d %d\\n",a,b,c,d);
  outtextxy(10,200,"done");
  closegraph();
  return (a=='K' && b==0 && c==77 && d==13) ? 0 : 9;
}`);
  const e = compile(CC, prog, path.join(tmp, 'keys.exe'), ['-std=c99']);
  ok(!e, 'key test program compiles', e);
  if (!e) {
    let inputs = 0, frames = 0, sawInit = false, text = '';
    const child = run(path.join(tmp, 'keys.exe'));
    const router = createRouter(t => { text += t; }, m => {
      if (m.t === 'init') sawInit = true;
      if (m.t === 'frame') frames++;
      if (m.t === 'input') {
        inputs++;
        if (inputs === 1) child.stdin.write('K');
        if (inputs === 2) child.stdin.write(Buffer.from([0, 77]));   // RIGHT arrow = 2 bytes
        if (inputs === 4) child.stdin.write('\r');                   // ENTER — used to hang
      }
    });
    // chunks ko jaan-boojh kar 7-byte tukdon mein todo: pipe boundary ka worst case
    child.stdout.on('data', d => { for (let i = 0; i < d.length; i += 7) router.push(d.subarray(i, i + 7)); });
    const code = await new Promise(res => {
      const t = setTimeout(() => { child.kill(); res('timeout'); }, 60000);
      child.on('close', c => { clearTimeout(t); router.end(); res(c); });
    });
    ok(code === 0, 'getch decodes K, arrow (0,77) and Enter (13) — no hang', 'exit=' + code + ' inputs=' + inputs);
    ok(sawInit && frames >= 1, 'init + frames arrive over stdout (' + frames + ' frames)');
    ok(/Press keys:/.test(text) && /got 75 0 77 13/.test(text), 'printf text reaches Output intact', JSON.stringify(text));
    ok(!/##PRABHA##|"t":"frame"/.test(text), 'no protocol fragments leak into Output', JSON.stringify(text.slice(0, 200)));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
