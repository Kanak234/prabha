#!/usr/bin/env node
/*
 * tests/gdb-install-test.js — Linux par PRABHA ka APNA debugger, asli raaste se:
 *   GitHub se pinned static gdb → SHA-256 verify → extract → findGdb() use chune
 *   (PATH par koi gdb nahi) → poora debugger suite usi gdb se.
 * WHY: Zig ke saath debugger nahi aata; F5 dabane par PRABHA khud gdb laata hai.
 *      Ye test saabit karta hai ki wahi gdb student ke PC par breakpoint/step/locals sab chalata hai.
 * USE: node tests/gdb-install-test.js   (Linux + internet; baaki OS par skip)
 */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const toolchain = require('../lib/toolchain');

(async () => {
  if (!toolchain.gdbInstallable()) { console.log('gdb-install-test: Linux x64/arm64 only — skipped'); return; }
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha storage '));
  let last = -1;
  const g = await toolchain.installGdb(storage, {
    log: s => console.log('  ' + s),
    onProgress: (got, total) => { const p = total ? Math.floor(got * 10 / total) : 0; if (p !== last) { last = p; process.stdout.write(p * 10 + '% '); } }
  });
  console.log('\n  installed: ' + g);

  // PATH par system gdb ho tab bhi PRABHA ka apna gdb pehle chuna jaana chahiye
  const found = toolchain.findGdb(null, storage);
  if (found !== g) { console.log('FAIL findGdb did not pick PRABHA gdb: ' + found); process.exit(1); }
  console.log('  findGdb → ' + found + ' (preferred over any gdb on PATH)');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'debug-test.js'), 'gdb'], { stdio: 'inherit', env: { ...process.env, PRABHA_TEST_GDB: g } });
  if (r.status !== 0) { console.log('FAIL debug-test with PRABHA gdb, exit ' + r.status); process.exit(1); }
  console.log('\nGDB INSTALL TEST PASSED');
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
