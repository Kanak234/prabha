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
    'Ye Turbo C++ ka purana header hai. Modern C++ mein `.h` nahi lagta: `#include <iostream>`. PRABHA ka Turbo mode (setting `prabha.turboCppCompatibility`) ise bina badle chala deta hai — ya "PRABHA: Turbo C++ → Modern C++" se code naya bana lo.'],
  [/'(cout|cin|endl|cerr|string|setw|setprecision|vector|getline|fixed)' was not declared|use of undeclared identifier '(cout|cin|endl|cerr|string|setw|setprecision|vector|getline|fixed)'|'(cout|cin|endl)' (is not a member|undeclared)/,
    '`cout`, `cin`, `endl` std namespace mein rehte hain. Ya to `std::cout` likho, ya `#include` ke baad `using namespace std;` likho.'],
  [/'::main' must return 'int'|'main' must return 'int'/,
    '`void main()` standard C/C++ mein kabhi valid tha hi nahi (sirf Turbo C chalata tha). `int main()` likho; end mein `return 0;` optional hai.'],
  [/'(gets)' was not declared|implicit declaration of function 'gets'|use of undeclared identifier 'gets'/,
    '`gets()` buffer overflow ki wajah se C11/C++14 mein hata diya gaya. C++: `std::cin.getline(s, size);`  C: `fgets(s, sizeof s, stdin);`'],
  [/'(clrscr|getch|getche|gotoxy|textcolor|kbhit)' was not declared|implicit declaration of function '(clrscr|getch|getche|gotoxy|textcolor|kbhit)'|use of undeclared identifier '(clrscr|getch|getche|gotoxy|textcolor|kbhit)'/,
    'Ye Turbo C ke `conio.h` ke functions hain. File ke upar `#include <conio.h>` likho — PRABHA ka apna conio.h inhe chalata hai.'],
  [/implicit declaration of function '(\w+)'|call to undeclared function '(\w+)'/,
    'Ye function use karne se pehle declare nahi hua. Sahi header include karo (jaise `printf` ke liye `<stdio.h>`, `strlen` ke liye `<string.h>`, `sqrt` ke liye `<math.h>`), ya apne function ko `main` se upar likho / uska prototype do.'],
  [/expected (?:',' or )?';' (before|after|at end)|expected ';' or ',' (before|after)/,
    'Pichhli line ke end mein `;` chhoot gaya hai. Error aksar galti wali line ke AGLI line par dikhta hai — upar wali line dekho.'],
  [/expected '\}' at end of input|expected '\}'$|expected declaration or statement at end of input/,
    'Koi `{` khula reh gaya — uska `}` nahi hai. Har function, `if`, `for`, `while` ke braces gin kar milao.'],
  [/expected '\)'|expected ‘\)’/,
    'Koi `(` band nahi hua. Function call ya `if (...)` mein brackets ginno.'],
  [/stray '\\(342|302|303)' in program|non-ASCII characters are not allowed outside of literals/,
    'Code mein koi "fancy" character aa gaya — aksar WhatsApp/PDF/Word se copy kiye "smart quotes" (“ ” ‘ ’) ya en-dash (–). Unhe normal `"` `\'` `-` se badlo.'],
  [/missing terminating (") character|missing terminating ' character/,
    'String ka `"` band nahi hua. Har string `"…"` ek hi line mein khatam honi chahiye.'],
  [/lvalue required as left operand of assignment|expression is not assignable/,
    'Assignment (`=`) ke left mein variable hona chahiye. Agar compare karna tha to `==` likho.'],
  [/suggest parentheses around assignment used as truth value|using the result of an assignment as a condition/,
    '`if (a = 5)` mein `=` (assign) hai, `==` (compare) nahi. Compare karna tha to `if (a == 5)` likho.'],
  [/format '%(d|f|c|s|ld|lf)' expects argument of type '(int|float|char|double|long int)\s*\*'|format specifies type '(int|float|char|double)\s*\*'/,
    '`scanf` ko variable ka address chahiye: `scanf("%d", &x);` — `&` bhool gaye ho.'],
  [/format '%(d|f|s|c|lf)' expects argument of type|format specifies type/,
    '`printf`/`scanf` ka format variable ke type se match nahi karta: `int` → `%d`, `float` → `%f`, `double` → `%lf` (scanf mein), `char` → `%c`, string → `%s`.'],
  [/undefined reference to `?'?main'?|undefined symbol: _?main/,
    'Program mein `main()` function nahi mila (ya naam galat hai, jaise `Main`). Har C/C++ program ko ek `int main()` chahiye.'],
  [/undefined reference to|undefined symbol|ld: symbol\(s\) not found/,
    'Function declare to hua par uski body (definition) kahin nahi likhi, ya naam mein spelling galat hai. Agar math function hai (`sqrt`, `pow`) to PRABHA `-lm` khud jodta hai.'],
  [/redefinition of|redeclaration of|conflicting declaration/,
    'Ek hi naam do baar declare hua. Variable ko ek hi baar declare karo, ya alag naam do.'],
  [/conflicting types for/,
    'Function ka prototype aur definition match nahi karte (return type ya parameters alag). Dono ko same karo.'],
  [/too few arguments to function|too many arguments to function|no matching function for call/,
    'Function ko jitne parameters chahiye, utne nahi diye (ya type alag hai). Function ki definition dekh kar call theek karo.'],
  [/does not name a type|unknown type name/,
    'Ye type compiler nahi jaanta: spelling check karo, zaroori header include karo (`string` ke liye `<string>`), ya class/struct ko use se pehle declare karo.'],
  [/was not declared in this scope|use of undeclared identifier|undeclared \(first use in this function\)|undeclared here/,
    'Ye naam (variable/function) is jagah declare nahi hai: spelling (C/C++ case-sensitive hai — `Sum` ≠ `sum`), declare hone se pehle use, ya kisi `{ }` block ke bahar use to nahi?'],
  [/invalid conversion from 'const char\*' to 'char\*'|ISO C\+\+ forbids converting a string constant to 'char\*'/,
    'String literal ("hello") badla nahi ja sakta, isliye `const char*` hai. `const char *s = "hello";` likho, ya C++ mein `std::string`.'],
  [/control reaches end of non-void function|non-void function does not return a value/,
    'Function ka return type `int` (ya koi aur) hai par kisi raaste mein `return` nahi hai. Har raaste mein value return karo.'],
  [/division by zero/,
    '0 se divide ho raha hai — run hone par program crash karega (integer) ya `inf` dega (float).'],
  [/array subscript is (above|below) array bounds|array index \d+ is past the end of the array/,
    'Array ki size se bahar ka index use ho raha hai. Size 10 hai to index 0 se 9 tak hi valid hai.'],
  [/unused variable/,
    'Variable banaya par kahin use nahi kiya — ye sirf warning hai, program chalega. Zaroorat nahi to hata do.'],
  [/comparison of integer expressions of different signedness|comparison of integers of different signs/,
    '`int` aur `unsigned` (jaise `.size()`) ka compare. Sirf warning; loop mein `size_t i` use karo.']
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
