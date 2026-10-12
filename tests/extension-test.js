#!/usr/bin/env node
/*
 * tests/extension-test.js — PRABHA 5.0.0 ka wiring test, mock VS Code par
 * (Windows/Linux/macOS teeno par same chalta hai).
 *  - stdout router: tooti hui lines, beech mein marker, prompts
 *  - toolchain: detect, install hints
 *  - extension: activate → commands → asli example compile + run → panel ko frames
 * FLOW: node tests/extension-test.js → exit 0 = pass
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mock = require('./vscode-mock');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n       ' + x : '')); } };

(async () => {
  /* ── 1. stream router ── */
  console.log('\n[router] stdout splitting');
  const { createRouter } = require('../lib/stream');
  {
    let text = ''; const msgs = [];
    const r = createRouter(t => { text += t; }, m => msgs.push(m));
    const stream = 'hello\nEnter:##PRABHA##{"t":"input"}\n##PRABHA##{"t":"frame","n":1,"rle":"AAAA"}\nbye\n##PRABHA##{"t":"end"}\n';
    for (let i = 0; i < stream.length; i += 3) r.push(stream.slice(i, i + 3));   // 3-byte tukde
    r.end();
    ok(msgs.map(m => m.t).join(',') === 'input,frame,end', 'protocol lines decoded across 3-byte chunks', JSON.stringify(msgs));
    ok(text === 'hello\nEnter:bye\n', 'printf text kept, even when the marker follows it on the same line', JSON.stringify(text));
  }
  {
    let text = '';
    const r = createRouter(t => { text += t; }, () => {});
    r.push('Enter a number: ');
    ok(text === 'Enter a number: ', 'a prompt without newline shows immediately');
    r.push('##PRA');
    ok(text === 'Enter a number: ', 'a partial marker at the end is held back');
    r.push('BHA##{"t":"input"}\r\n');
    ok(text === 'Enter a number: ', 'CRLF protocol line (Windows text mode) still parsed, nothing leaks');
  }

  /* ── 2. toolchain ── */
  console.log('\n[toolchain]');
  const tcm = require('../lib/toolchain');
  const tc = tcm.detect({ cc: 'gcc', cxx: 'g++' }, path.join(require('os').tmpdir(), 'prabha-gs-test'));
  ok(tc && tc.cc && /gcc|clang/i.test(tc.version), 'a working compiler is detected on ' + process.platform + ': ' + (tc && tc.version));
  ok(tc && tc.cxx, 'a C++ compiler is detected too');
  const bogus = tcm.detect({ cc: path.join(root, 'no-such-gcc'), cxx: 'nope' }, '/nonexistent');
  ok(bogus && bogus.source !== 'setting', 'a broken compiler setting falls back to a working one');
  const hint = tcm.installHint();
  ok(process.platform === 'win32' || /install|xcode-select/.test(hint.command), 'install hint for this OS: ' + hint.command);
  ok(/winlibs.*x86_64.*ucrt.*\.zip$/.test(tcm.WINLIBS.url) && /\.sha256$/.test(tcm.WINLIBS.sha256Url), 'Windows GCC download is pinned and checksum-verified');
  ok(Array.isArray(tcm.windowsKnownBins()) && tcm.windowsKnownBins().some(b => /CodeBlocks/.test(b)), 'CodeBlocks/MSYS2/TDM folders are searched on Windows');

  /* ── 3. extension on mock VS Code ── */
  console.log('\n[extension] PRABHA on mock VS Code');
  const answers = [];
  const vscode = mock.install({ answer: (m, b) => { answers.push({ m, b }); return undefined; } });
  const ext = require(path.join(root, 'extension.js'));
  ext.activate(mock.context(root));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  ok(pkg.version === '5.0.1', 'version is 5.0.1');
  ok(pkg.contributes.commands.every(c => vscode._commands.has(c.command)), 'every command in package.json is implemented');

  // asli example chalao
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'prabha-ext-'));
  const file = path.join(tmp, '01_shapes.c');
  fs.copyFileSync(path.join(root, 'examples', '01_shapes.c'), file);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('prabha.run', doc.uri);
  const panel = vscode._panels[0];
  ok(!!panel, 'PRABHA panel opens');
  // program ko kuch frames bhejne do, phir ek key (examples getch() par rukte hain)
  await new Promise(r => setTimeout(r, 1500));
  if (panel && panel._recv) panel.send({ t: 'key', key: 'x' });
  await new Promise(r => setTimeout(r, 1500));
  const protos = panel ? panel.posted.filter(m => m.t === 'proto').map(m => m.msg.t) : [];
  ok(protos.includes('init') && protos.includes('frame'), 'panel receives init + frames from the real compiled program (' + protos.filter(x => x === 'frame').length + ' frames)', protos.join(','));
  await vscode.commands.executeCommand('prabha.stop');

  // compiler info + install flow (Linux/macOS: terminal command; Windows: GCC prompt)
  await vscode.commands.executeCommand('prabha.compilerInfo');
  ok(vscode._messages.some(m => /PRABHA compiler:/.test(m.m)), 'compiler info reports the detected compiler');
  await vscode.commands.executeCommand('prabha.installCompiler');
  ok(answers.some(a => a.b.length >= 2), 'install command offers the right buttons (' + (answers.pop() || { b: [] }).b.join(' | ') + ')');

  console.log(`\n${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch(e => { console.error(e); process.exit(1); });
