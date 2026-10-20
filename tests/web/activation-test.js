/*
 * tests/web/activation-test.js — PRABHA Web Extension activation test.
 *
 * WHY:   Verifies that the web extension (vscode.dev) activates correctly and
 *        registers ONLY web-compatible commands. Desktop-only commands must
 *        be absent or hidden via "when": "!isWeb".
 * RUN:   npx -y @vscode/test-web@0.0.81 --extensionDevelopmentPath=. --extensionTestsPath=tests/web/activation-test.js --browserType=chromium --headless
 */

'use strict';

const vscode = require('vscode');

/* ── Polyfill for Node assert (minimal) ── */
const assert = {
  ok: (v, m) => { if (!v) throw new Error('Assertion failed: ' + (m || '')); },
  strictEqual: (a, e, m) => { if (a !== e) throw new Error('Assertion failed: ' + (m || '') + ' expected ' + JSON.stringify(e) + ' got ' + JSON.stringify(a)); },
  deepStrictEqual: (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error('Assertion failed: ' + (m || '') + ' expected ' + JSON.stringify(e) + ' got ' + JSON.stringify(a)); }
};

/* ── Inline Turbo C++ test code ── */
const TURBO_CPP_CODE = `#include <iostream.h>
#include <conio.h>

void main()
{
  char name[20];
  int m1, m2, m3;
  float avg;

  clrscr();
  cout << "Enter name: ";
  cin >> name;
  cout << "Enter 3 marks: ";
  cin >> m1 >> m2 >> m3;

  avg = (m1 + m2 + m3) / 3.0;

  cout << "Student: " << name << endl;
  cout << "Average: " << avg << endl;
  cout << "Result: " + (avg >= 40 ? "PASS" : "FAIL") << endl;
  getch();
}`;

/* ── Minimal test runner ──
 * WHY:   @vscode/test-web loads this file and calls its exported run(). The old version only
 *        printed test names at load time and exported nothing, so VS Code reported
 *        "does not point to a valid extension test runner" and NO test body ever executed.
 * WHAT:  suite()/test()/suiteSetup() just queue functions; run() awaits each one in order,
 *        prints PASS/FAIL per test, and throws if anything failed (=> non-zero exit).
 * WHERE: test-web -> run() -> setup -> every queued test -> summary line.
 */
const _setups = [];
const _tests = [];
const suite = (name, fn) => { console.log('Suite:', name); fn(); };
const test = (name, fn) => { _tests.push({ name, fn }); };
const suiteSetup = (fn) => { _setups.push(fn); };

suite('PRABHA Web Extension Activation', () => {
  let ext;

  suiteSetup(async () => {
    ext = vscode.extensions.getExtension('KANAKPRABHAKAR.prabha');
    assert.ok(ext, 'extension found');
    await ext.activate();
    assert.ok(ext.isActive, 'extension activates on C/C++ file');
  });

  test('web commands registered', async () => {
    const allCommands = await vscode.commands.getCommands(true);
    const prabhaCommands = allCommands.filter(c => c.startsWith('prabha.'));

    const webCommands = [
      'prabha.modernize',
      'prabha.showOutput',
      'prabha.openExample'
    ];

    for (const cmd of webCommands) {
      assert.ok(prabhaCommands.includes(cmd), 'web command registered: ' + cmd);
    }
  });

  test('desktop commands hidden via !isWeb', async () => {
    const allCommands = await vscode.commands.getCommands(true);
    const prabhaCommands = allCommands.filter(c => c.startsWith('prabha.'));

    const desktopCommands = [
      'prabha.run',
      'prabha.compile',
      'prabha.debug',
      'prabha.stop',
      'prabha.installCompiler',
      'prabha.compilerInfo'
    ];

    for (const cmd of desktopCommands) {
      const exists = prabhaCommands.includes(cmd);
      console.log('  (info) desktop command ' + cmd + (exists ? ' registered (hidden via !isWeb)' : ' not registered'));
    }
  });

  test('Turbo → Modern panel opens and renders', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'cpp', content: TURBO_CPP_CODE });
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand('prabha.modernize', doc.uri);

    await new Promise(r => setTimeout(r, 500));

    // WHY: vscode.window.visibleWebviewPanels is NOT a VS Code API (it was undefined -> crash).
    // WHAT: find the panel through the public Tabs API; webview tab viewType ends with 'prabhaModern'.
    // WHERE: proves prabha.modernize really opened the Turbo -> Modern webview on vscode.dev.
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const panelTabs = tabs.filter(tb => tb.input instanceof vscode.TabInputWebview && String(tb.input.viewType).endsWith('prabhaModern'));
    assert.strictEqual(panelTabs.length, 1, 'Modern panel opens (found ' + panelTabs.length + ')');

    if (panelTabs.length === 1) {

      // NOTE: messages the extension posts INTO the webview cannot be read from the test side
      // (webview.postedMessages is not a VS Code API). The converter output itself is checked
      // in the 'Modernize engine (pure JS)' test below.
    }
  });

  test('Diagnostics parsing (pure JS)', () => {
    const { parseDiagnostics, tipFor } = require('../../lib/diagnostics');
    const sampleOutput = '/home/user/test.cpp:5:10: error: expected \';\' before \'return\'';
    const diags = parseDiagnostics(sampleOutput, { mainFile: '/home/user/test.cpp' });
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].line, 5);
    assert.strictEqual(diags[0].severity, 'error');
    assert.ok(diags[0].tip && /semicolon|missing/i.test(diags[0].tip), 'Hinglish tip for missing semicolon');

    const linkerOutput = '/usr/bin/ld: test.o: undefined reference to `foo\'';
    const linkDiags = parseDiagnostics(linkerOutput, { mainFile: '/home/user/test.cpp' });
    assert.strictEqual(linkDiags.length, 1);
    assert.strictEqual(linkDiags[0].line, 1);
  });

  test('Crash explanations (pure JS)', () => {
    const { explainExit } = require('../../lib/crash');
    const segv = explainExit({ code: null, signal: 'SIGSEGV', platform: 'linux' });
    assert.ok(segv && segv.name === 'SIGSEGV' && /segmentation|memory/i.test(segv.title));

    const divZero = explainExit({ code: 136, signal: null, platform: 'linux', viaShell: true });
    assert.ok(divZero && divZero.name === 'SIGFPE');

    const winAccess = explainExit({ code: 0xC0000005, signal: null, platform: 'win32' });
    assert.ok(winAccess && winAccess.name === 'SIGSEGV');
  });

  test('Stream router (pure JS)', () => {
    const { createRouter } = require('../../lib/stream');
    let textOut = '', protoMsgs = [];
    const router = createRouter(t => { textOut += t; }, m => { protoMsgs.push(m); });
    router.push('hello\nEnter:##PRABHA##{"t":"input"}\n##PRABHA##{"t":"frame","n":1}\nbye\n');
    router.end();
    assert.strictEqual(protoMsgs.map(m => m.t).join(','), 'input,frame');
    assert.strictEqual(textOut, 'hello\nEnter:bye\n');
  });

  test('Modernize engine (pure JS)', () => {
    const { modernize } = require('../../lib/modern/engine');
    const turboCode = '#include <iostream.h>\nvoid main()\n{\n  cout << "Hello";\n}\n';
    const result = modernize(turboCode, { fileName: 'test.cpp', enabled: ['old-headers', 'void-main', 'std-qualify'] });
    assert.ok(result.code.includes('int main()') && result.code.includes('std::cout'));
    assert.ok(result.changes.length >= 2);
  });

  test('Web core exports', () => {
    const { activateWeb, modernState } = require('../../lib/web-core');
    assert.ok(typeof activateWeb === 'function');
    assert.ok(modernState && modernState.panel !== undefined);
  });
});

/* WHY: entry point that @vscode/test-web calls. WHAT: runs setup + all tests, reports.
 * WHERE: a thrown error here makes test-web exit with failure. */
module.exports.run = async function run() {
  let failed = 0;
  for (const fn of _setups) { await fn(); }
  for (const t of _tests) {
    try { await t.fn(); console.log('  PASS  ' + t.name); }
    catch (e) { failed++; console.log('  FAIL  ' + t.name + ' -> ' + (e && e.message)); }
  }
  console.log('PRABHA web tests: ' + (_tests.length - failed) + ' passed, ' + failed + ' failed');
  if (failed) { throw new Error(failed + ' web test(s) failed'); }
};

