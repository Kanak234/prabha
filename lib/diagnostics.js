/*
 * lib/diagnostics.js — compiler (GCC / Clang / Zig) ka output padh kar
 * VS Code Problems tab ke liye {file, line, col, severity, message, tip} banana.
 *
 * WHY:   Dev-C++ ki sabse kaam ki cheez: error par double-click → seedha us line par.
 *        Aur beginner ke liye "'cout' was not declared in this scope" ka matlab
 *        Hinglish mein — PRABHA ka apna hissa.
 * WHAT:  parseDiagnostics(text, {mapFile}) → Diagnostic[]
 *        tipFor(message) → Hinglish tip ya null
 * FLOW:  extension.js compile fail/warn → parseDiagnostics() → vscode.Diagnostic[]
 */
'use strict';

/*
 * Common beginner errors → Hinglish explanation. Order matters: pehla match jeet-ta.
 * GCC aur Clang dono ke wording cover kiye gaye hain.
 */
const TIPS = [
  [/(iostream|fstream|iomanip|strstream)\.h['"]?:? (No such file|file not found)/i,
    'This is an old Turbo C++ header. Modern C++ drops the `.h`: `#include <iostream>`. PRABHA\'s Turbo mode (setting `prabha.turboCppCompatibility`) runs it unchanged — or use "PRABHA: Turbo C++ → Modern C++" to update the code.'],
  [/'(cout|cin|endl|cerr|string|setw|setprecision|vector|getline|fixed)' was not declared|use of undeclared identifier '(cout|cin|endl|cerr|string|setw|setprecision|vector|getline|fixed)'|'(cout|cin|endl)' (is not a member|undeclared)/,
    '`cout`, `cin` and `endl` live in the `std` namespace. Write `std::cout`, or add `using namespace std;` after the `#include` lines.'],
  [/'::main' must return 'int'|'main' must return 'int'/,
    '`void main()` was never valid standard C/C++ (only Turbo C accepted it). Write `int main()`; `return 0;` at the end is optional.'],
  [/'(gets)' was not declared|implicit declaration of function 'gets'|use of undeclared identifier 'gets'/,
    '`gets()` was removed in C11/C++14 because it overflows buffers. C++: `std::cin.getline(s, size);`  C: `fgets(s, sizeof s, stdin);`'],
  [/'(clrscr|getch|getche|gotoxy|textcolor|kbhit)' was not declared|implicit declaration of function '(clrscr|getch|getche|gotoxy|textcolor|kbhit)'|use of undeclared identifier '(clrscr|getch|getche|gotoxy|textcolor|kbhit)'/,
    'These are Turbo C `conio.h` functions. Add `#include <conio.h>` at the top — PRABHA\'s own conio.h provides them.'],
  [/implicit declaration of function '(\w+)'|call to undeclared function '(\w+)'/,
    'This function is used before it is declared. Include the right header (`<stdio.h>` for `printf`, `<string.h>` for `strlen`, `<math.h>` for `sqrt`), or move your function above `main` / add its prototype.'],
  [/expected (?:',' or )?';' (before|after|at end)|expected ';' or ',' (before|after)/,
    'A `;` is missing at the end of the previous line. The error is often reported on the line AFTER the mistake — check the line above.'],
  [/expected '\}' at end of input|expected '\}'$|expected declaration or statement at end of input/,
    'A `{` was never closed. Count the braces of every function, `if`, `for` and `while`.'],
  [/expected '\)'|expected ‘\)’/,
    'A `(` was never closed. Count the brackets in the function call or `if (...)`.'],
  [/stray '\\(342|302|303)' in program|non-ASCII characters are not allowed outside of literals/,
    'A "fancy" character got into the code — usually smart quotes (“ ” ‘ ’) or an en-dash (–) copied from WhatsApp, a PDF or Word. Replace them with plain `"` `\'` `-`.'],
  [/missing terminating (") character|missing terminating ' character/,
    'A string\'s closing `"` is missing. Every string `"…"` must end on the same line.'],
  [/lvalue required as left operand of assignment|expression is not assignable/,
    'The left side of `=` must be a variable. If you meant to compare, write `==`.'],
  [/suggest parentheses around assignment used as truth value|using the result of an assignment as a condition/,
    '`if (a = 5)` assigns (`=`) instead of comparing (`==`). To compare, write `if (a == 5)`.'],
  [/format '%(d|f|c|s|ld|lf)' expects argument of type '(int|float|char|double|long int)\s*\*'|format specifies type '(int|float|char|double)\s*\*'/,
    '`scanf` needs the variable\'s address: `scanf("%d", &x);` — the `&` is missing.'],
  [/format '%(d|f|s|c|lf)' expects argument of type|format specifies type/,
    'The `printf`/`scanf` format does not match the variable\'s type: `int` → `%d`, `float` → `%f`, `double` → `%lf` (in scanf), `char` → `%c`, string → `%s`.'],
  [/undefined reference to `?'?main'?|undefined symbol: _?main/,
    'The program has no `main()` function (or it is misspelled, e.g. `Main`). Every C/C++ program needs an `int main()`.'],
  [/undefined reference to|undefined symbol|ld: symbol\(s\) not found/,
    'The function is declared but its body (definition) is missing, or its name is misspelled. Math functions (`sqrt`, `pow`) are fine — PRABHA adds `-lm` itself.'],
  [/redefinition of|redeclaration of|conflicting declaration/,
    'The same name is declared twice. Declare each variable once, or give the second one a different name.'],
  [/conflicting types for/,
    'The function\'s prototype and its definition do not match (return type or parameters differ). Make them the same.'],
  [/too few arguments to function|too many arguments to function|no matching function for call/,
    'The function needs a different number of arguments (or different types). Check its definition and fix the call.'],
  [/does not name a type|unknown type name/,
    'The compiler does not know this type: check the spelling, include the needed header (`<string>` for `string`), or declare the class/struct before using it.'],
  [/was not declared in this scope|use of undeclared identifier|undeclared \(first use in this function\)|undeclared here/,
    'This name (variable/function) is not declared here: check the spelling (C/C++ is case-sensitive — `Sum` ≠ `sum`), whether it is used before its declaration, or outside the `{ }` block it belongs to.'],
  [/invalid conversion from 'const char\*' to 'char\*'|ISO C\+\+ forbids converting a string constant to 'char\*'/,
    'A string literal ("hello") cannot be changed, so it is `const char*`. Write `const char *s = "hello";`, or use `std::string` in C++.'],
  [/control reaches end of non-void function|non-void function does not return a value/,
    'The function returns `int` (or another type) but some path has no `return`. Return a value on every path.'],
  [/division by zero/,
    'Division by zero — the program will crash at run time (integers) or give `inf` (floats).'],
  [/array subscript is (above|below) array bounds|array index \d+ is past the end of the array/,
    'An index outside the array\'s size. For an array of size 10, only indexes 0 to 9 are valid.'],
  [/unused variable/,
    'A variable is declared but never used — only a warning, the program still runs. Remove it if it is not needed.'],
  [/comparison of integer expressions of different signedness|comparison of integers of different signs/,
    'Comparing `int` with `unsigned` (like `.size()`). Only a warning; use `size_t i` in the loop.']
];

function tipFor(message) {
  // GCC UTF-8 locale mein ‘;’ jaise curly quotes deta hai (CI aur zyada tar Linux PCs
  // par yahi hota hai) — patterns ASCII quotes ke liye likhe hain, isliye pehle normalise.
  const m = String(message).replace(/[\u2018\u2019\u201b`]/g, "'").replace(/[\u201c\u201d]/g, '"');
  for (const [re, tip] of TIPS) if (re.test(m)) return tip;
  return null;
}

/*
 * GCC:   /path/a.c:12:5: error: expected ';' before 'return'
 * Clang: /path/a.c:12:5: error: expected ';' after expression
 * Windows: C:\Users\x\a.c:12:5: error: ...   (drive letter mein ':' hota hai)
 * Linker: /usr/bin/ld: /tmp/cc.o: in function `main': a.c:(.text+0x1e): undefined reference to `foo'
 */
const LINE_RE = /^(?<file>(?:[A-Za-z]:)?[^:\n]+?):(?<line>\d+):(?:(?<col>\d+):)?\s*(?<sev>fatal error|error|warning|note):\s*(?<msg>.*)$/;
const LINK_RE = /undefined reference to|undefined symbol|ld: symbol\(s\) not found|ld returned \d exit status|collect2: error/;

/**
 * @param {string} text   compiler stdout+stderr
 * @param {{mapFile?: (f:string)=>string|null, mainFile?: string}} [o]
 *        mapFile: temp copy ka path → user file ka path (ya null = is file ka nahi)
 * @returns {Array<{file:string|null, line:number, col:number, severity:'error'|'warning'|'info', message:string, tip:string|null}>}
 */
function parseDiagnostics(text, o = {}) {
  const out = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (const raw of lines) {
    const l = raw.replace(/\x1b\[[0-9;]*m/g, '');    // colour codes (clang -fcolor-diagnostics)
    const m = LINE_RE.exec(l);
    if (m) {
      const g = m.groups;
      let file = g.file.trim();
      if (o.mapFile) file = o.mapFile(file);
      const sev = g.sev === 'warning' ? 'warning' : g.sev === 'note' ? 'info' : 'error';
      const msg = g.msg.trim();
      // "note:" lines pichhle diagnostic se jude hote hain — alag dikhane ka fayda nahi
      if (sev === 'info' && out.length) { out[out.length - 1].notes = (out[out.length - 1].notes || []).concat(msg); continue; }
      const d = { file, line: Number(g.line), col: g.col ? Number(g.col) : 1, severity: sev, message: msg, tip: tipFor(msg) };
      out.push(d);
      continue;
    }
    // Linker errors: file/line nahi hote — user file ki line 1 par dikhao
    if (LINK_RE.test(l) && !/ld returned|collect2/.test(l)) {
      const msg = l.replace(/^.*?(undefined reference to|undefined symbol)/, '$1').trim();
      out.push({ file: o.mainFile || null, line: 1, col: 1, severity: 'error', message: msg || l.trim(), tip: tipFor(l) });
    }
  }
  return out;
}

module.exports = { parseDiagnostics, tipFor, TIPS };
