#!/usr/bin/env node
/*
 * tests/zig-install-test.js — PRABHA ka asli "Install PRABHA compiler" raasta
 * (Linux/macOS) CI par: ziglang.org index.json → download → SHA-256 verify →
 * tar -xJf → detect({toolchain:'bundled'}) → build-test usi Zig se.
 * WHY:  Student ke laptop par jo chalega, wahi yahan chale — koi shortcut nahi.
 * USE:  node tests/zig-install-test.js   (internet chahiye; Windows par skip)
 */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const toolchain = require('../lib/toolchain');

(async () => {
  if (process.platform === 'win32') { console.log('zig-install-test: Windows uses PRABHA GCC — skipped'); return; }
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha storage '));
  let last = -1;
  const z = await toolchain.installZig(storage, {
    log: s => console.log('  ' + s),
    onProgress: (got, total) => { const p = total ? Math.floor(got * 10 / total) : 0; if (p !== last) { last = p; process.stdout.write(p * 10 + '% '); } }
  });
  console.log('\n  installed: ' + z);
  const tc = toolchain.detect({ cc: 'gcc', cxx: 'g++', toolchain: 'bundled' }, storage);
  if (!tc || tc.source !== 'prabha-zig') { console.log('FAIL detect did not pick PRABHA Zig: ' + JSON.stringify(tc)); process.exit(1); }
  console.log('  detect → ' + tc.version);
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-test.js')], {
    stdio: 'inherit', env: { ...process.env, PRABHA_TEST_TOOLCHAIN: 'zig', PRABHA_TEST_ZIG: z }
  });
  if (r.status !== 0) process.exit(r.status);

  // Linux: poora PRABHA-ka-apna stack — Zig se compile, PRABHA ke gdb se debug
  if (toolchain.gdbInstallable()) {
    console.log('\n=== PRABHA debugger (own gdb) on a Zig-compiled program');
    const g = await toolchain.installGdb(storage, { log: s => console.log('  ' + s) });
    const env = { ...toolchain.envWith(path.dirname(z)), ZIG_GLOBAL_CACHE_DIR: path.join(storage, 'zig-cache'),
      PRABHA_TEST_GDB: g, PRABHA_TEST_CC: z, PRABHA_TEST_CC_ARGS: 'cc' };
    const d = cp.spawnSync(process.execPath, [path.join(__dirname, 'debug-test.js'), 'gdb'], { stdio: 'inherit', env });
    process.exit(d.status);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
