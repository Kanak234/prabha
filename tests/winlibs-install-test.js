#!/usr/bin/env node
/*
 * tests/winlibs-install-test.js — Windows par PRABHA ka APNA compiler, asli raaste se:
 *   GitHub se WinLibs GCC download → SHA-256 verify → extract → detect({toolchain:'bundled'})
 *   → poora build-test usi GCC se → debugger test usi WinLibs ke gdb se.
 *
 * WHY:  6.0 ka default yahi compiler hai (student ke PC par kuch install nahi chahiye).
 *       CI ka MinGW (choco) ek "system" compiler hai — usse test pass hona ye saabit nahi
 *       karta ki PRABHA ka apna GCC download hokar chalta hai. Ye test wahi saabit karta hai.
 * USE:  node tests/winlibs-install-test.js   (Windows + internet; baaki OS par skip)
 * FLOW: installWindows() → detect() → build-test.js + debug-test.js (env se toolchain)
 */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const toolchain = require('../lib/toolchain');

(async () => {
  if (process.platform !== 'win32') { console.log('winlibs-install-test: Windows only — skipped'); return; }
  // Storage folder jaan-boojh kar space ke saath (VS Code ka globalStorage bhi aisa ho sakta hai)
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha storage '));
  let last = -1;
  const t0 = Date.now();
  const bin = await toolchain.installWindows(storage, {
    log: s => console.log('  ' + s),
    onProgress: (got, total) => { const p = total ? Math.floor(got * 10 / total) : 0; if (p !== last) { last = p; process.stdout.write(p * 10 + '% '); } }
  });
  console.log('\n  installed in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s: ' + bin);

  // PATH se system MinGW hata do — sirf PRABHA ka GCC dikhe (asli student PC jaisa)
  const cleanPath = (process.env.PATH || '').split(path.delimiter).filter(p => !/mingw|msys|chocolatey|strawberry|\\gcc/i.test(p)).join(path.delimiter);
  process.env.PATH = cleanPath;
  const tc = toolchain.detect({ cc: 'gcc', cxx: 'g++', toolchain: 'bundled' }, storage);
  if (!tc || tc.source !== 'prabha') { console.log('FAIL detect did not pick PRABHA GCC: ' + JSON.stringify(tc)); process.exit(1); }
  console.log('  detect → ' + tc.version + ' (' + tc.source + ')');
  const gdb = toolchain.findGdb(tc);
  if (!gdb || !gdb.startsWith(tc.binDir)) { console.log('FAIL WinLibs gdb not found next to PRABHA GCC: ' + gdb); process.exit(1); }
  console.log('  gdb   → ' + gdb);

  const env = { ...toolchain.envWith(tc.binDir), PRABHA_TEST_CC: tc.cc, PRABHA_TEST_CXX: tc.cxx, PRABHA_TEST_GDB: gdb };
  for (const t of ['build-test.js', 'debug-test.js']) {
    console.log('\n=== ' + t + ' with PRABHA GCC');
    const r = cp.spawnSync(process.execPath, [path.join(__dirname, t), ...(t === 'debug-test.js' ? ['gdb'] : [])], { stdio: 'inherit', env });
    if (r.status !== 0) { console.log('FAIL ' + t + ' exit ' + r.status); process.exit(1); }
  }
  console.log('\nWINLIBS INSTALL TEST PASSED');
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
