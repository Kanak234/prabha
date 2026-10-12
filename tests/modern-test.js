#!/usr/bin/env node
/*
 * tests/modern-test.js — Turbo C/C++ → Modern engine ka proof.
 *   [1] unit: comments/strings untouched, "leave alone" cases
 *   [2] har tests/modern/* program:
 *       purana  → PRABHA Turbo mode (wahi flags jo extension lagata hai)
 *       naya    → strict: C++ `-std=c++17 -pedantic-errors -Wall`, C `-std=c11 -pedantic-errors -Wall`,
 *                 PRABHA ke compat headers ke BINA
 *       dono same stdin ke saath chalao → stdout byte-by-byte same (PRABHA protocol lines
 *       aur ANSI escape hata kar)
 * FLOW: node tests/modern-test.js → exit 0 = pass
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { modernize, RULES } = require('../lib/modern/engine');
const { adaptTurbo } = require('../lib/modern/turbo-adapt');

const root = path.join(__dirname, '..');
const rt = path.join(root, 'runtime');
const win = process.platform === 'win32';
const ALL = RULES.map(r => r.id);
let pass = 0, fail = 0;
const ok = (name, c, x) => { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (x ? '\n       ' + String(x).split('\n').join('\n       ') : '')); } };
const has = c => { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const CC = process.env.PRABHA_TEST_CC || ['gcc', 'clang', 'cc'].find(has);
const CXX = process.env.PRABHA_TEST_CXX || ['g++', 'clang++', 'c++'].find(has);
const conv = (src, name = 'a.cpp', all = true) => modernize(src, { fileName: name, enabled: all ? ALL : undefined }).code;

console.log('\n[1] unit — Turbo → Modern engine');
ok('code in comments is never touched', conv('#include <iostream.h>\n// void main() cout getch();\nvoid main(){ cout << 1; }\n').includes('// void main() cout getch();'));
ok('code in strings is never touched', conv('#include <iostream.h>\nvoid main(){ cout << "cout NULL getch();"; }\n').includes('"cout NULL getch();"'));
ok('`if (x) clrscr();` is left alone (removing it would break the if)', conv('#include <conio.h>\nint main(){ int x=1; if (x) clrscr(); return 0; }\n').includes('if (x) clrscr();'));
ok('getch() used mid-program (menu) is left alone', /int c = getch\(\);/.test(conv('#include <conio.h>\nint main(){ int c = getch(); return c; }\n')));
ok('conio.h stays while conio functions remain', conv('#include <conio.h>\nint main(){ gotoxy(1,1); return 0; }\n').includes('#include <conio.h>'));
ok('`using namespace std;` → no std:: added', !conv('#include <iostream>\nusing namespace std;\nint main(){ cout << 1; }\n').includes('std::cout'));
ok('char array used with strlen is NOT turned into std::string', conv('#include <iostream.h>\n#include <string.h>\nvoid main(){ char s[20]; cin >> s; cout << strlen(s); }\n').includes('char s[20]'));
ok('char array indexed (s[0]) is NOT turned into std::string', conv('#include <iostream.h>\nvoid main(){ char s[20]; cin >> s; cout << s[0]; }\n').includes('char s[20]'));
ok('graphics.h program keeps PRABHA delay()', conv('#include <graphics.h>\n#include <dos.h>\nvoid main(){ delay(10); }\n').includes('delay(10)'));
ok('POSIX random() with no argument is untouched', conv('#include <stdlib.h>\nint main(){ long x = random(); return (int)x; }\n', 'a.c').includes('random()'));
ok('void main → int main, and bare `return;` → `return 0;`', /int main\(\)\s*\{\s*return 0;/.test(conv('void main(){ return; }\n', 'a.cpp')));
ok('C: `void main()` → `int main(void)`', /int main\(void\)/.test(conv('void main(){ return; }\n', 'a.c')));
ok('implicit-int `main()` → `int main(void)` in C', /^int main\(void\)/m.test(conv('main()\n{\n  return 0;\n}\n', 'a.c')));
ok('Turbo mode: `return;` in void main → `return 0;` (clang/macOS error otherwise)', adaptTurbo('void main()\n{\n if (1) return;\n}').code === 'int main()\n{\n if (1) return 0;\n}');
ok('a user variable named `left` is not std-qualified', conv('#include <iostream.h>\nvoid main(){ int left = 3; cout << left; }\n').includes('<< left'));
ok('C file never gets std::', !/std::/.test(conv('#include <stdio.h>\n#include <conio.h>\nvoid main(){ printf("x"); getch(); }\n', 'a.c')));
ok('clrscr is a review rule (off by default)', /clrscr\(\)/.test(conv('#include <conio.h>\nvoid main(){ clrscr(); }\n', 'a.c', false)));
ok('Windows CRLF line endings are kept', conv('#include <iostream.h>\r\nvoid main(){ cout << 1; }\r\n').includes('\r\n') && !/[^\r]\n/.test(conv('#include <iostream.h>\r\nvoid main(){ cout << 1; }\r\n')));
{ let threw = false; try { modernize('void main( { cout <<', { fileName: 'x.cpp' }); } catch { threw = true; } ok('half-typed code never crashes the engine', !threw); }

ok('Turbo mode: "void main()" inside a string is NOT rewritten (5.x bug)', adaptTurbo('void main(){ puts("void main()"); }').code === 'int main(){ puts("void main()"); }');
ok('Turbo mode: far/near/huge pointer qualifiers compile (5.x bug)', adaptTurbo('int far *p; char huge *q;').code === 'int *p; char *q;');
ok('Turbo mode: implicit-int `main()` → `int main()` (clang/macOS error otherwise)', adaptTurbo('#include <x.h>\nmain()\n{\n}\n').code === '#include <x.h>\nint main()\n{\n}\n');
ok('Turbo mode keeps the line count (error lines match the user file)', adaptTurbo('void main()\n{\n int far *p;\n}\n').code.split('\n').length === 5);

console.log('\n[2] compile + same output (compilers: ' + CC + ' / ' + CXX + ')');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-modern-'));
const core = path.join(tmp, 'core.o');
const cc = cp.spawnSync(CC, ['-std=c99', '-O2', '-I', rt, '-c', path.join(rt, 'prabha_core.c'), '-o', core], { encoding: 'utf8' });
ok('PRABHA runtime compiles', cc.status === 0, cc.stderr);

const dir = path.join(__dirname, 'modern');
for (const f of fs.readdirSync(dir).filter(x => /\.(c|cpp)$/.test(x))) {
  const isCpp = f.endsWith('.cpp');
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const stdinFile = path.join(dir, f.replace(/\.\w+$/, '.stdin'));
  const input = fs.existsSync(stdinFile) ? fs.readFileSync(stdinFile, 'utf8') : '';
  for (const mode of ['default', 'all']) {
    const res = modernize(src, { fileName: f, enabled: mode === 'all' ? ALL : undefined });
    // OLD: exactly what the extension does in Turbo mode
    const oldSrc = path.join(tmp, mode + '-old-' + f);
    fs.writeFileSync(oldSrc, adaptTurbo(src).code);   // exactly the extension's Turbo-mode adaptation
    const oldBin = path.join(tmp, mode + '-old-' + f.replace(/\./g, '_') + (win ? '.exe' : ''));
    const oldArgs = isCpp
      ? ['-std=c++14', '-fpermissive', '-w', '-I', path.join(rt, 'compat'), '-include', path.join(rt, 'compat', 'prabha_cpp_prelude.h'), '-I', rt, oldSrc, core, '-o', oldBin, '-lm']
      : ['-std=c99', '-w', '-I', rt, oldSrc, core, '-o', oldBin, '-lm'];
    const o = cp.spawnSync(isCpp ? CXX : CC, oldArgs, { encoding: 'utf8' });
    ok(mode + '/' + f + ': original compiles in PRABHA Turbo mode', o.status === 0, o.stderr);
    // NEW: strict, no compat headers
    const newSrc = path.join(tmp, mode + '-new-' + f);
    fs.writeFileSync(newSrc, res.code);
    const newBin = path.join(tmp, mode + '-new-' + f.replace(/\./g, '_') + (win ? '.exe' : ''));
    const needsRt = /#\s*include\s*[<"](conio|graphics|dos)\.h[>"]/.test(res.code);
    const strict = isCpp ? ['-std=c++17', '-pedantic-errors', '-Wall'] : ['-std=c11', '-pedantic-errors', '-Wall'];
    const newArgs = [...strict, ...(needsRt ? ['-I', rt] : []), newSrc, ...(needsRt ? [core] : []), '-o', newBin, '-lm'];
    const n = cp.spawnSync(isCpp ? CXX : CC, newArgs, { encoding: 'utf8' });
    const errs = (n.stderr || '').split('\n').filter(l => /error/.test(l)).join('\n');
    ok(mode + '/' + f + ': modern version compiles strictly (' + (isCpp ? 'C++17' : 'C11') + ', -pedantic-errors' + (needsRt ? ', still uses conio' : ', no Turbo headers') + ', ' + res.changes.length + ' changes)', n.status === 0, errs + '\n--- code ---\n' + res.code);
    if (o.status !== 0 || n.status !== 0) continue;
    // PRABHA protocol (##PRABHA##{...}) line ke beech mein bhi ho sakta hai — wahi stream router ka niyam
    const clean = s => (s || '').replace(/##PRABHA##[^\n]*\n?/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const ro = cp.spawnSync(oldBin, [], { input, encoding: 'utf8', timeout: 20000 });
    const rn = cp.spawnSync(newBin, [], { input, encoding: 'utf8', timeout: 20000 });
    ok(mode + '/' + f + ': same output as the Turbo original', clean(ro.stdout) === clean(rn.stdout) && ro.status === rn.status,
      'old(' + ro.status + '): ' + JSON.stringify(clean(ro.stdout)) + '\nnew(' + rn.status + '): ' + JSON.stringify(clean(rn.stdout)));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
