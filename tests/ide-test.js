#!/usr/bin/env node
/*
 * tests/ide-test.js — PRABHA 6.0 ke IDE features ka test (har OS par same):
 *   1. diagnostics: ASLI compiler (gcc/g++/clang, jo mile) ke errors parse + Hinglish tip
 *   2. crash:       asli programs jo segfault / 0 se divide / stack overflow / abort karte hain
 *   3. console:     asli program jo prompt deta hai aur input padhta hai — prompt input
 *                   se PEHLE dikhna chahiye (unbuffered prelude), echo, backspace, footer
 * FLOW: node tests/ide-test.js → exit 0 = pass
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDiagnostics, tipFor } = require('../lib/diagnostics');
const { explainExit } = require('../lib/crash');
const { ConsoleSession } = require('../lib/console-core');

const root = path.join(__dirname, '..');
const win = process.platform === 'win32';
let pass = 0, fail = 0;
// ok(name, cond, detail) ya ok(cond, name, detail) — dono order chalte hain
const ok = (a, b, x) => { const [n, c] = typeof a === 'string' ? [a, b] : [b, a]; if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n       ' + String(x).split('\n').join('\n       ') : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha ide test हिंदी '));   // space + Hindi path on purpose
// Ye test khud compiler seedha chalata hai (PRABHA ke build() ke bina). MinGW Unicode
// path nahi likh pata — isliye Windows par raw compiles ASCII folder mein. Hindi-path
// handling PRABHA ke build() ka kaam hai, woh tests/build-test.js check karta hai.
const rawTmp = process.platform === 'win32' ? fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-ide-raw-')) : tmp;
const has = c => { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const CC = process.env.PRABHA_TEST_CC || ['gcc', 'clang', 'cc'].find(has);
const CXX = process.env.PRABHA_TEST_CXX || ['g++', 'clang++', 'c++'].find(has);

(async () => {
  console.log('\n[diagnostics] parser + tips (compiler: ' + CC + ' / ' + CXX + ')');
  // Real compiler output
  const cases = [
    ['missing_semi.c', 'int main(void){ int a = 5\n return a; }\n', /`;` chhoot gaya/],
    ['no_std.cpp', '#include <iostream>\nint main(){ cout << "hi"; }\n', /std namespace/],
    ['void_main.cpp', '#include <cstdio>\nvoid main(){ printf("x"); }\n', /void main/],
    ['old_header.cpp', '#include <iostream.h>\nint main(){ return 0; }\n', /Turbo C\+\+ ka purana header/],
    ['scanf_amp.c', '#include <stdio.h>\nint main(void){ int x; scanf("%d", x); return x; }\n', /&/],
    ['undeclared.c', 'int main(void){ return summ; }\n', /declare nahi hai/],
    ['brace.c', 'int main(void){ if (1) { return 0;\n', /`\{` khula/]
  ];
  for (const [name, src, tipRe] of cases) {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, src);
    const drv = name.endsWith('.cpp') ? CXX : CC;
    const r = cp.spawnSync(drv, ['-Wall', '-fsyntax-only', f], { encoding: 'utf8' });
    const ds = parseDiagnostics((r.stderr || '') + (r.stdout || ''), { mapFile: p => (path.resolve(p) === path.resolve(f) ? f : null) });
    const hit = ds.find(d => d.file === f && d.tip && tipRe.test(d.tip));
    ok(name + ': line ' + (hit ? hit.line : '?') + ' + Hinglish tip', !!hit, JSON.stringify(ds.slice(0, 3)) + '\n' + r.stderr);
  }
  // Known formats (so both GCC and Clang wording are covered whichever is installed)
  ok('Windows path with drive letter parses', parseDiagnostics('C:\\Users\\x y\\a.c:3:9: error: expected \';\' before \'}\' token')[0].line === 3);
  ok('clang wording: undeclared cout', /std namespace/.test(tipFor("use of undeclared identifier 'cout'")));
  ok('gcc wording: undeclared cout', /std namespace/.test(tipFor("'cout' was not declared in this scope")));
  ok('linker: undefined reference → line 1 of the file', parseDiagnostics("/usr/bin/ld: /tmp/x.o: in function `main':\nx.c:(.text+0x9): undefined reference to `foo'", { mainFile: '/a.c' }).some(d => d.file === '/a.c' && /definition/.test(d.tip)));
  ok('smart quotes from WhatsApp', /smart quotes/.test(tipFor("stray '\\342' in program")));
  ok('note: lines attach to the previous error', parseDiagnostics('a.c:1:1: error: x\na.c:1:1: note: y').length === 1);

  console.log('\n[crash] real crashing programs');
  const crashes = [
    ['segv.c', '#include <stdio.h>\nint main(void){ int *p = 0; *p = 5; return 0; }\n', 'SIGSEGV', /Segmentation fault/],
    // ARM: PRABHA ka divide-by-zero trap → SIGTRAP (x86 par CPU khud SIGFPE deta hai)
    ['divzero.c', '#include <stdio.h>\nint main(int c, char **v){ volatile int z = c - 1; printf("%d\\n", 10 / z); return 0; }\n', process.arch === 'arm64' && !win ? 'SIGTRAP' : 'SIGFPE', /0 se divide/],
    ['stack.c', 'int f(int n){ volatile char big[4096]; big[0] = (char)n; return f(n + 1) + big[0]; }\nint main(void){ return f(0); }\n', win ? 'STACK' : 'SIGSEGV', win ? /Stack overflow/ : /Segmentation fault/],
    ['abort.c', '#include <stdlib.h>\nint main(void){ abort(); }\n', 'SIGABRT', /abort/]
  ];
  for (const [name, src, want, re] of crashes) {
    const f = path.join(rawTmp, name), bin = path.join(rawTmp, name.replace(/\.c$/, '') + (win ? '.exe' : ''));
    fs.writeFileSync(f, src);
    // Same flags as PRABHA's build (ARM: divide-by-zero trap)
    const { trapFlags } = require('../lib/build');
    const isClangCC = /clang/.test(CC) || process.platform === 'darwin';
    const c = cp.spawnSync(CC, ['-O0', ...trapFlags(isClangCC), f, '-o', bin], { encoding: 'utf8' });
    if (c.status !== 0) { ok(name + ' compiles', false, c.stderr); continue; }
    const r = cp.spawnSync(bin, [], { encoding: 'utf8', timeout: 20000 });
    const e = explainExit({ code: r.status, signal: r.signal, platform: process.platform });
    ok(name + ' → ' + (e ? e.name : 'none') + ' (code ' + r.status + ', signal ' + r.signal + ')', e && (e.name === want || (want === 'SIGABRT' && /ABRT/.test(e.name))) && re.test(e.title), JSON.stringify(e));
  }
  ok('normal exit 0 → no crash text', explainExit({ code: 0, signal: null }) === null);
  ok('normal exit 3 → no crash text', explainExit({ code: 3, signal: null, platform: 'linux' }) === null);
  ok('Windows 0xC0000005 → segfault text', explainExit({ code: 3221225477, platform: 'win32' }).name === 'SIGSEGV');
  ok('Windows 0xC00000FD → stack overflow', explainExit({ code: -1073741571, platform: 'win32' }).name === 'STACK');
  ok('SIGTRAP mentions both divide-by-zero and NULL pointer', /0 se divide/.test(explainExit({ signal: 'SIGTRAP' }).title) && /NULL/.test(explainExit({ signal: 'SIGTRAP' }).title));

  console.log('\n[console] PRABHA Console with a real interactive program');
  {
    const f = path.join(rawTmp, 'ask.c'), bin = path.join(rawTmp, 'ask' + (win ? '.exe' : ''));
    fs.writeFileSync(f, '#include <stdio.h>\nint main(void){ int a, b; printf("Enter a: "); scanf("%d", &a); printf("Enter b: "); scanf("%d", &b); printf("Sum = %d\\n", a + b); return 7; }\n');
    const c = cp.spawnSync(CC, ['-include', path.join(root, 'runtime', 'prabha_unbuffered.h'), f, '-o', bin], { encoding: 'utf8' });
    ok('unbuffered prelude compiles in', c.status === 0, c.stderr);
    let screen = ''; let closed = null; const doneP = new Promise(res => { this_done = res; });
    var this_done;
    const s = new ConsoleSession({ write: t => { screen += t; }, close: code => { closed = code; }, onDone: () => this_done() });
    s.start(bin);
    // Prompt input se PEHLE aana chahiye (buffering bug nahi)
    const t0 = Date.now();
    while (!/Enter a: /.test(screen) && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 20));
    ok('prompt "Enter a: " shows before any input is given', /Enter a: /.test(screen), JSON.stringify(screen));
    s.input('1'); s.input('5'); s.input('\x7f'); s.input('2');   // "12" → backspace → "1" + "2" = "12"
    ok('typed characters are echoed, backspace erases', screen.includes('Enter a: 15\b \b2'), JSON.stringify(screen));
    s.input('\r');
    const t1 = Date.now();
    while (!/Enter b: /.test(screen) && Date.now() - t1 < 5000) await new Promise(r => setTimeout(r, 20));
    s.input('30\r');
    await doneP;
    ok('program output reaches the console (12 + 30)', /Sum = 42/.test(screen), JSON.stringify(screen));
    ok('Dev-C++ style footer with return value', /Process exited after [\d.]+ s with return value 7/.test(screen), JSON.stringify(screen.slice(-200)));
    ok('"Press any key" shown', /Press any key/.test(screen));
    ok('output uses \\r\\n for the terminal', /Sum = 42\r\n/.test(screen));
    s.input('x');
    ok('any key closes the console', closed === 7);
  }
  {
    const f = path.join(rawTmp, 'boom.c'), bin = path.join(rawTmp, 'boom' + (win ? '.exe' : ''));
    fs.writeFileSync(f, '#include <stdio.h>\nint main(void){ int a[3]; int *p = 0; printf("before\\n"); *p = a[0]; return 0; }\n');
    cp.spawnSync(CC, ['-include', path.join(root, 'runtime', 'prabha_unbuffered.h'), f, '-o', bin]);
    let screen = ''; let res; const p = new Promise(r => { res = r; });
    new ConsoleSession({ write: t => { screen += t; }, close: () => {}, onDone: () => res() }).start(bin);
    await p;
    ok('crash in console → output kept + Hinglish explanation', /before/.test(screen) && /Segmentation fault/.test(screen) && /Fix:/.test(screen), JSON.stringify(screen.slice(-300)));
  }
  {
    let screen = ''; let res; const p = new Promise(r => { res = r; });
    const s = new ConsoleSession({ write: t => { screen += t; }, close: () => {}, onDone: () => res(), timeoutSec: 1 });
    s.start(process.execPath, ['-e', 'setInterval(()=>{}, 1000)']);
    await p;
    ok('infinite loop is stopped by the time limit with a message', /infinite loop/.test(screen));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
