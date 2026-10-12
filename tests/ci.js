#!/usr/bin/env node
/*
 * tests/ci.js — CI step wrapper: command chalao, output dikhao, aur fail hone par
 * FAIL wali lines + aakhri lines ek ::error annotation mein daalo.
 * WHY: Actions ke log zip proxy se nahi khulte, annotations Checks API se padh sakte hain.
 * USE: node tests/ci.js "<title>" node tests/ide-test.js [args…]
 */
'use strict';
const cp = require('child_process');
const [title, cmd, ...args] = process.argv.slice(2);
const r = cp.spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
const text = (r.stdout || '') + (r.stderr || '') + (r.error ? '\n' + r.error.message : '');
process.stdout.write(text);
if (r.status !== 0) {
  const lines = text.split(/\r?\n/);
  const bad = [];
  lines.forEach((l, i) => { if (/FAIL|✗|Error|error:/.test(l)) bad.push(...lines.slice(i, i + 6)); });
  const body = [...bad.slice(0, 60), '--- tail ---', ...lines.slice(-25)].join('\n').slice(0, 6000);
  const esc = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log('::error title=' + esc(title + ' (exit ' + r.status + ')') + '::' + esc(body));
  process.exit(r.status || 1);
}
