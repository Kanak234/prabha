/*
 * tests/build-test.js — lib/build.js ka test: wahi compile jo Run/Compile/Debug karte hain.
 *
 * WHY:  extension.js ka saara compile isi function se hota hai. Yahan asli compiler
 *       (gcc / clang / PRABHA ka Zig) se check: Turbo-mode programs, graphics
 *       examples, error → user ki file+line+Hinglish tip, debug build (-g).
 * USE:  node tests/build-test.js
 *       PRABHA_TEST_TOOLCHAIN=zig PRABHA_TEST_ZIG=/path/zig node tests/build-test.js
 *       PRABHA_TEST_CC=clang PRABHA_TEST_CXX=clang++ node tests/build-test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const toolchain = require('../lib/toolchain');
const { build, cleanup, usesPanel } = require('../lib/build');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + String(extra).split('\n').slice(0, 12).join('\n      ') : '')); }
}

function pickToolchain() {
  if (process.env.PRABHA_TEST_TOOLCHAIN === 'zig') {
    const z = process.env.PRABHA_TEST_ZIG;
    const env = toolchain.envWith(path.dirname(z));
    env.ZIG_GLOBAL_CACHE_DIR = path.join(os.tmpdir(), 'prabha-zig-cache');
    return { cc: z, cxx: z, ccArgs: ['cc'], cxxArgs: ['c++'], version: 'zig ' + toolchain.works(z, env, ['cc']), env, mingw: false, zig: true, binDir: path.dirname(z) };
  }
  if (process.env.PRABHA_TEST_CC) {
    const env = { ...process.env };
    return { cc: process.env.PRABHA_TEST_CC, cxx: process.env.PRABHA_TEST_CXX, ccArgs: [], cxxArgs: [], version: toolchain.works(process.env.PRABHA_TEST_CC, env), env, mingw: process.platform === 'win32' };
  }
  return toolchain.detect({ cc: 'gcc', cxx: 'g++', toolchain: 'system' }, null);
}

(async () => {
  const tc = pickToolchain();
  if (!tc) { console.log('no compiler — skipped'); return; }
  console.log('build-test · ' + tc.version);
  const rt = path.join(root, 'runtime');
  // space + Hindi wala folder — Dev-C++ yahan fail hota tha
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha build परीक्षा '));
  const runBin = (bin, stdin, env) => cp.spawnSync(bin, [], { input: stdin || '', encoding: 'utf8', timeout: 20000, env: { ...process.env, ...env } });

  // 1) Turbo C++ programs (tests/modern fixtures) console mode mein compile + chalo
  for (const f of ['marks.cpp', 'table.cpp', 'fullname.cpp', 'menu.cpp', 'student.c', 'dice.cpp']) {
    const src = path.join(dir, f);
    fs.copyFileSync(path.join(__dirname, 'modern', f), src);
    const r = await build(src, { tc, runtimeDir: rt, mode: 'run' });
    ok(r.ok, 'turbo ' + f + ' compiles', r.log);
    if (r.ok) {
      const stdinF = path.join(__dirname, 'modern', f.replace(/\.\w+$/, '.stdin'));
      const p = runBin(r.bin, fs.existsSync(stdinF) ? fs.readFileSync(stdinF, 'utf8') : '');
      ok(p.status === 0 || (f === 'dice.cpp' && p.status !== null), 'turbo ' + f + ' runs (exit ' + p.status + ')', p.stderr);
    }
    ok(fs.readFileSync(src, 'utf8') === fs.readFileSync(path.join(__dirname, 'modern', f), 'utf8'), f + ': user file not modified');
    cleanup(r);
  }

  // 2) graphics examples compile (panel mode)
  for (const f of fs.readdirSync(path.join(root, 'examples'))) {
    const src = path.join(dir, f);
    fs.copyFileSync(path.join(root, 'examples', f), src);
    const r = await build(src, { tc, runtimeDir: rt });
    ok(r.ok && r.usesPanel, 'example ' + f + ' compiles (panel)', r.log);
    cleanup(r);
  }

  // 3) error → diagnostic on the USER file (temp copy nahi), sahi line + Hinglish tip
  const bad = path.join(dir, 'galti.cpp');
  fs.writeFileSync(bad, '#include <iostream.h>\nvoid main()\n{\n  int a = 5\n  cout << a;\n}\n');
  const rb = await build(bad, { tc, runtimeDir: rt });
  ok(!rb.ok, 'broken program fails');
  const d = rb.diagnostics.find(x => x.severity === 'error');
  ok(d && d.file === bad, 'error mapped to user file', JSON.stringify(rb.diagnostics.slice(0, 2)) + '\n' + rb.log);
  ok(d && (d.line === 4 || d.line === 5), 'error on line 4/5 (got ' + (d && d.line) + ')');
  ok(d && /;/.test(d.tip || ''), 'Hinglish tip for missing ;', d && d.tip);
  cleanup(rb);

  // 4) undefined reference (linker) → main file line 1
  const lk = path.join(dir, 'link.c');
  fs.writeFileSync(lk, '#include <stdio.h>\nvoid hello(void);\nint main(void){ hello(); return 0; }\n');
  const rl = await build(lk, { tc, runtimeDir: rt });
  ok(!rl.ok && rl.diagnostics.some(x => x.file === lk && /undefined|symbol/i.test(x.message)), 'linker error shown on main file', rl.log);
  cleanup(rl);

  // 5) debug build: -g, user ka path debug info mein (breakpoints ke liye)
  const dbg = path.join(dir, 'debugme.cpp');
  fs.writeFileSync(dbg, '#include <iostream.h>\nvoid main()\n{\n  int x = 6;\n  cout << x * 7 << endl;\n}\n');
  const rd = await build(dbg, { tc, runtimeDir: rt, mode: 'debug' });
  ok(rd.ok, 'debug build compiles', rd.log);
  if (rd.ok) {
    const p = runBin(rd.bin);
    ok(/42/.test(p.stdout), 'debug build prints 42', p.stdout + p.stderr);
    const bytes = fs.readFileSync(rd.bin);
    ok(bytes.includes(Buffer.from('debugme.cpp')), 'debug info names the source file');
  }
  cleanup(rd);

  // 6) strict mode (Turbo off) — modern code still fine, old code fails
  const mod = path.join(dir, 'modern.cpp');
  fs.writeFileSync(mod, '#include <iostream>\nint main() { std::cout << "ok\\n"; return 0; }\n');
  const rm = await build(mod, { tc, runtimeDir: rt, legacyCompat: false });
  ok(rm.ok && /ok/.test(runBin(rm.bin).stdout), 'strict mode: modern C++ works', rm.log);
  cleanup(rm);
  const rs = await build(bad.replace('galti', 'galti2'), { tc, runtimeDir: rt, legacyCompat: false }).catch(e => ({ ok: false, log: String(e) }));
  ok(!rs.ok, 'strict mode: missing file / old code rejected');

  ok(usesPanel('#include<graphics.h>\n') && usesPanel('  # include "conio.h"') && !usesPanel('// #include <stdio.h>'), 'usesPanel detection');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  console.log('\nbuild-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
