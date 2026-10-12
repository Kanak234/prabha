#!/usr/bin/env node
/*
 * tests/extension-test.js — PRABHA 6.0.0 ka wiring test, mock VS Code par
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
  ok(pkg.version === '6.0.0', 'version is 6.0.0');
  ok(/PR_VERSION "6\.0\.0"/.test(fs.readFileSync(path.join(root, 'runtime', 'prabha_core.c'), 'utf8')), 'runtime version is 6.0.0');
  const keys = pkg.contributes.keybindings.map(k => k.key + '→' + k.command);
  ok(keys.includes('ctrl+f9→prabha.run') && keys.includes('alt+f9→prabha.compile') && keys.includes('f7→workbench.action.debug.stepInto') && keys.includes('f8→workbench.action.debug.stepOver'), 'Turbo keys: Ctrl+F9 run, Alt+F9 compile, F7/F8 step');
  ok(pkg.contributes.debuggers[0].type === 'prabha' && pkg.contributes.breakpoints.length === 2, 'debugger + breakpoints contributed');
  ok(fs.existsSync(path.join(root, 'media', 'modern-panel.js')) && fs.existsSync(path.join(root, 'media', 'modern-panel.css')), 'Modern panel assets packaged');
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

  const os = require('os');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await wait(50); } return false; };

  /* ── 4. PRABHA Console (Ctrl+F9 on a scanf program) ── */
  console.log('\n[console] Dev-C++ style run');
  const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha console परीक्षा '));
  const cfile = path.join(cdir, 'jod.cpp');
  fs.writeFileSync(cfile, '#include <iostream.h>\nvoid main()\n{\n  int a, b;\n  cout << "Enter two numbers: ";\n  cin >> a >> b;\n  cout << "Sum = " << a + b << endl;\n}\n');
  const cdoc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfile));
  await vscode.window.showTextDocument(cdoc);
  await vscode.commands.executeCommand('prabha.run', cdoc.uri);
  const term = vscode._terminals.find(t => t.options && t.options.pty);
  ok(!!term && /PRABHA Console/.test(term.name), 'PRABHA Console terminal opens');
  ok(term && await until(() => /Enter two numbers: /.test(term.output)), 'prompt shows before input (unbuffered stdout)', term && JSON.stringify(term.output));
  if (term) { term.type('12 '); term.type('x\x7f'); term.type('30\r'); }
  ok(term && await until(() => /Press any key/.test(term.output)), 'program finishes with "Press any key"', term && JSON.stringify(term.output.slice(-300)));
  ok(term && /Sum = 42/.test(term.output), 'input reached the program (backspace handled): Sum = 42', term && JSON.stringify(term.output));
  ok(term && /Process exited after [\d.]+ s(econds)? with return value 0/.test(term.output.replace(/\x1b\[[0-9;]*m/g, '')), 'Dev-C++ exit line', term && JSON.stringify(term.output.slice(-200)));
  if (term) term.type('k');
  ok(term && term.closed === 0, 'any key closes the console');

  // crash → Hinglish explanation
  const crf = path.join(cdir, 'crash.c');
  fs.writeFileSync(crf, '#include <stdio.h>\nint main(void) {\n  int *p = 0;\n  printf("start\\n");\n  *p = 5;\n  return 0;\n}\n');
  const crdoc = await vscode.workspace.openTextDocument(vscode.Uri.file(crf));
  await vscode.commands.executeCommand('prabha.run', crdoc.uri);
  const term2 = vscode._terminals.filter(t => t.options && t.options.pty).pop();
  ok(term2 && await until(() => /Press any key/.test(term2.output)), 'crashing program ends cleanly');
  ok(term2 && /Segmentation|NULL|pointer|memory/i.test(term2.output), 'crash explained (segfault / NULL pointer)', term2 && JSON.stringify(term2.output.slice(-400)));

  /* ── 5. Alt+F9 compile → Problems with Hinglish tip ── */
  console.log('\n[diagnostics] errors in Problems tab');
  const bad = path.join(cdir, 'galti.cpp');
  fs.writeFileSync(bad, '#include <iostream.h>\nvoid main()\n{\n  int a = 5\n  cout << a;\n}\n');
  const bdoc = await vscode.workspace.openTextDocument(vscode.Uri.file(bad));
  await vscode.commands.executeCommand('prabha.compile', bdoc.uri);
  const errMsg = vscode._messages.filter(m => m.level === 'error').pop();
  ok(errMsg && /Line [45]/.test(errMsg.m) && /💡/.test(errMsg.m), 'error popup names the line + Hinglish tip', errMsg && errMsg.m);
  const outLines = (ext._out && ext._out().lines.join('\n')) || '';
  ok(/Errors: [1-9]/.test(outLines), 'Dev-C++ style "Compilation results" in output', outLines.slice(-300));
  const diags = ext._diag ? ext._diag()._m.get(vscode.Uri.file(bad).toString()) : null;
  ok(diags && diags.length && diags[0].source === 'PRABHA' && /💡/.test(diags[0].message) && [3, 4].includes(diags[0].range.start.line), 'diagnostic on user file, 0-based line 3/4, with tip', diags && JSON.stringify(diags[0]));
  fs.writeFileSync(bad, '#include <iostream.h>\nvoid main()\n{\n  int a = 5;\n  cout << a;\n}\n');
  bdoc._text = fs.readFileSync(bad, 'utf8');
  await vscode.commands.executeCommand('prabha.compile', bdoc.uri);
  const after = ext._diag()._m.get(vscode.Uri.file(bad).toString());
  ok(!after || !after.some(d => d.severity === 0), 'fixed file → errors cleared');
  ok(vscode._messages.some(m => /compile ho gaya/.test(m.m)), 'Alt+F9 success message');

  /* ── 6. Turbo → Modern panel ── */
  console.log('\n[modern] Turbo → Modern panel');
  const mfile = path.join(cdir, 'marks.cpp');
  fs.copyFileSync(path.join(__dirname, 'modern', 'marks.cpp'), mfile);
  fs.copyFileSync(path.join(__dirname, 'modern', 'marks.stdin'), path.join(cdir, 'marks.stdin'));
  const mdoc = await vscode.workspace.openTextDocument(vscode.Uri.file(mfile));
  await vscode.window.showTextDocument(mdoc);
  await vscode.commands.executeCommand('prabha.modernize', mdoc.uri);
  const mp = vscode._panels.find(p => p.viewType === 'prabhaModern');
  ok(!!mp && /modern-panel\.js/.test(mp.webview.html) && /nonce-/.test(mp.webview.html), 'Modern panel opens with CSP + script');
  await mp.send({ t: 'ready' });
  await until(() => mp.posted.some(m => m.t === 'render'));
  const rend = mp.posted.filter(m => m.t === 'render').pop();
  ok(rend && rend.changes.length >= 2 && rend.changes.every(c => c.explanation && c.explanation.why), 'changes with explanations (' + (rend && rend.changes.map(c => c.rule).join(',')) + ')');
  ok(rend && rend.diff.some(d => d.type === 'add'), 'side-by-side diff rows');
  await mp.send({ t: 'lang', lang: 'en' });
  ok(await until(() => mp.posted.some(m => m.t === 'render' && m.lang === 'en' && m.changes[0].explanation.why !== rend.changes[0].explanation.why)), 'English toggle re-renders with English text');
  await mp.send({ t: 'check' });
  await until(() => mp.posted.some(m => m.t === 'check'), 60000);
  const chk = mp.posted.find(m => m.t === 'check');
  ok(chk && chk.ok && /same/.test(chk.text), 'same-output check: Turbo build == strict modern build', chk && chk.text);
  const before = mdoc.getText();
  await mp.send({ t: 'apply' });
  ok(mdoc.getText() === before, 'apply asks first (no answer → file unchanged)');

  /* ── 7. Debugger wiring (F5) ── */
  console.log('\n[debug] F5 wiring');
  const prov = vscode.debug.providers.prabha, fac = vscode.debug.factories.prabha;
  ok(!!prov && !!fac, 'debug provider + adapter factory registered');
  const init = prov.provideDebugConfigurations();
  ok(init[0].source === '${file}', 'launch.json template uses ${file}');
  const dfile = path.join(cdir, 'fact.c');
  fs.writeFileSync(dfile, '#include <stdio.h>\nint fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }\nint main(void) {\n  int x = fact(5);\n  printf("%d\\n", x);\n  return 0;\n}\n');
  const hasDbg = require('../lib/toolchain').findGdb(tc) || require('../lib/toolchain').findLldbDap();
  if (!hasDbg) console.log('  - no gdb / lldb-dap here: debug wiring skipped');
  else {
    const conf = await prov.resolveDebugConfigurationWithSubstitutedVariables(undefined, { type: 'prabha', request: 'launch', name: 'x', source: dfile, console: 'internal' });
    ok(conf && fs.existsSync(conf.program) && ['gdb', 'lldb'].includes(conf.backend), 'F5 compiles with -g and picks ' + (conf && conf.backend), JSON.stringify(conf && { program: conf.program, backend: conf.backend }));
    const desc = fac.createDebugAdapterDescriptor({ configuration: conf });
    ok(desc && (desc.implementation || desc.command), 'adapter descriptor (' + (desc.implementation ? 'inline gdb' : desc.command) + ')');
    if (desc.implementation) {
      const s = desc.implementation; const evs = []; let seq = 1; const pend = new Map();
      s.onDidSendMessage(m => { if (m.type === 'response') { const f = pend.get(m.request_seq); if (f) f(m); } else evs.push(m); });
      const req = (command, args) => new Promise(r => { const q = seq++; pend.set(q, r); s.handleMessage({ type: 'request', seq: q, command, arguments: args }); });
      await req('initialize', { adapterID: 'prabha', linesStartAt1: true, columnsStartAt1: true });
      const l = await req('launch', conf);
      ok(l.success, 'gdb launch', l.message);
      const bp = await req('setBreakpoints', { source: { path: dfile }, breakpoints: [{ line: 4 }] });
      ok(bp.success && bp.body.breakpoints[0].verified, 'breakpoint verified on line 4');
      await req('configurationDone', {});
      ok(await until(() => evs.some(e => e.event === 'stopped'), 20000), 'stopped at breakpoint');
      await req('continue', { threadId: 1 });
      ok(await until(() => evs.some(e => e.event === 'terminated' || e.event === 'exited'), 20000), 'program runs to the end');
      s.dispose();
    }
    if (conf) require('../lib/build').cleanup({ work: conf.prabhaWork });
  }

  // compiler info + install flow (Linux/macOS: terminal command; Windows: GCC prompt)
  await vscode.commands.executeCommand('prabha.compilerInfo');
  ok(vscode._messages.some(m => /PRABHA compiler:/.test(m.m)), 'compiler info reports the detected compiler');
  await vscode.commands.executeCommand('prabha.installCompiler');
  const last = answers.pop() || { b: [] };
  ok(last.b.includes('Install PRABHA compiler') && last.b.length >= 2, 'install command offers PRABHA compiler on every OS (' + last.b.join(' | ') + ')');

  console.log(`\n${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch(e => { console.error(e); process.exit(1); });
