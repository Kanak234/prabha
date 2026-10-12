/*
 * lib/modern/rules.js — Turbo C/C++ → Modern C/C++ ke rules.
 *
 * Har rule ka contract (Punarnava jaisa):
 *   { id, lang: ['c','cpp'], safety: 'safe'|'review', run(ctx) → Edit[] }
 *   Edit = { start, end, text }  (ctx.src ke offsets)
 *   ctx = { src, masked, preproc[], lang, graphics }
 *
 * SAFETY ka siddhant: shak ho to mat badlo. Har rule ka "safe" hona
 * tests/modern-test.js prove karta hai — purana (PRABHA Turbo mode) aur naya
 * (strict -std=c++17 -pedantic-errors) program same output dete hain.
 * FLOW: engine.js → rule.run(ctx) → edits → engine apply + safety net
 */
'use strict';

const { matchBracket, lineStart, lineEnd, deleteStatement } = require('./lexer');

const CONIO_FNS = ['clrscr', 'getch', 'getche', 'kbhit', 'gotoxy', 'textcolor', 'textbackground', 'cprintf', 'cputs', 'cgets', 'cscanf', 'putch', 'clreol', 'delline', 'insline', 'wherex', 'wherey', 'window', 'textattr', 'textmode', 'highvideo', 'lowvideo', 'normvideo', '_setcursortype', 'gettext', 'puttext'];
const DOS_FNS = ['delay', 'sound', 'nosound', 'getdate', 'gettime', 'setdate', 'settime', 'int86', 'sleep'];
const STD_NAMES = ['cout', 'cin', 'cerr', 'clog', 'endl', 'ends', 'flush', 'setw', 'setprecision', 'setfill', 'fixed', 'scientific', 'showpoint', 'left', 'right', 'ifstream', 'ofstream', 'fstream', 'ios', 'istream', 'ostream'];

/* ─── helpers ─── */

const re = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `main` ka header aur body (top-level `main(` jo call nahi, definition hai) */
function findMain(masked) {
  const R = /(^|[\s;}])((?:void|int)\s+)?main\s*\(/g;
  let m;
  while ((m = R.exec(masked))) {
    const nameAt = m.index + m[1].length + (m[2] ? m[2].length : 0);
    const open = masked.indexOf('(', nameAt);
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    let k = close + 1;
    while (k < masked.length && /\s/.test(masked[k])) k++;
    if (masked[k] !== '{') continue;                        // prototype ya call — definition nahi
    const bodyClose = matchBracket(masked, k);
    if (bodyClose < 0) continue;
    return { typeStart: m.index + m[1].length, type: (m[2] || '').trim(), nameAt, bodyOpen: k, bodyClose };
  }
  return null;
}

/** ek identifier ke saare (masked) uses, `.x`, `->x`, `::x` chhod kar */
function uses(masked, name) {
  const out = [];
  const R = new RegExp('\\b' + re(name) + '\\b', 'g');
  let m;
  while ((m = R.exec(masked))) {
    const before = masked.slice(Math.max(0, m.index - 2), m.index);
    if (/(\.|->|::)$/.test(before) || /\.$/.test(before)) continue;
    out.push(m.index);
  }
  return out;
}

function hasInclude(src, header) {
  return new RegExp('^\\s*#\\s*include\\s*[<"]' + re(header) + '[>"]', 'm').test(src);
}

/** header add karo aakhri #include ke baad (ya file ke shuru mein) */
function includeEdit(src, header) {
  if (hasInclude(src, header)) return null;
  const all = [...src.matchAll(/^[ \t]*#[ \t]*include[^\n]*\n?/gm)];
  if (all.length) {
    const last = all[all.length - 1];
    const at = last.index + last[0].length;
    const nl = last[0].endsWith('\n') ? '' : '\n';
    return { start: at, end: at, text: nl + '#include <' + header + '>\n' };
  }
  return { start: 0, end: 0, text: '#include <' + header + '>\n' };
}

/** statement jisme offset hai: pichhle ; { } se agle ; tak */
function statementAt(masked, at) {
  let s = at;
  while (s > 0 && !';{}'.includes(masked[s - 1])) s--;
  let e = at, depth = 0;
  while (e < masked.length) {
    const c = masked[e];
    if (c === '(') depth++; else if (c === ')') depth--;
    else if (c === ';' && depth <= 0) { e++; break; }
    e++;
  }
  return { start: s, end: e };
}

/* ─── rules ─── */

const oldHeaders = {
  id: 'old-headers', lang: ['cpp'], safety: 'safe',
  run({ src }) {
    const edits = [];
    for (const m of src.matchAll(/^([ \t]*#[ \t]*include[ \t]*)([<"])(iostream|fstream|iomanip)\.h([>"])/gm)) {
      edits.push({ start: m.index, end: m.index + m[0].length, text: m[1] + '<' + m[3] + '>' });
    }
    return edits;
  }
};

const stdQualify = {
  id: 'std-qualify', lang: ['cpp'], safety: 'safe',
  run({ masked, preproc }) {
    if (/\busing\s+namespace\s+std\s*;/.test(masked)) return [];
    const inPre = off => preproc.some(p => off >= p.start && off < p.end);
    const edits = [];
    for (const name of STD_NAMES) {
      // user ne khud is naam ka variable/function banaya? (jaise `int left;`) → skip
      if (new RegExp('\\b(?:int|char|float|double|long|short|bool|auto|void|unsigned|signed|const)\\s+(?:\\*\\s*)?' + name + '\\b').test(masked)) continue;
      for (const at of uses(masked, name)) {
        if (inPre(at)) continue;
        const before = masked.slice(Math.max(0, at - 5), at);
        if (/std::$/.test(before)) continue;
        edits.push({ start: at, end: at, text: 'std::' });
      }
    }
    return edits;
  }
};

const voidMain = {
  id: 'void-main', lang: ['c', 'cpp'], safety: 'safe',
  run({ masked, lang }) {
    const m = findMain(masked);
    if (!m || m.type === 'int') return [];
    const edits = [];
    // `void main(` ya sirf `main(` (purana implicit int) → `int main(`
    edits.push({ start: m.typeStart, end: m.nameAt, text: 'int ' });
    // C mein khaali `()` ka matlab "koi bhi arguments" (purana K&R style) hai — modern C
    // (aur clang -pedantic) `int main(void)` chahta hai. C++ mein `()` hi sahi hai.
    if (lang === 'c') {
      const open = masked.indexOf('(', m.nameAt), close = matchBracket(masked, open);
      if (close > open && masked.slice(open + 1, close).trim() === '') edits.push({ start: open, end: close + 1, text: '(void)' });
    }
    // void main ke andar `return;` → `return 0;`
    const body = masked.slice(m.bodyOpen, m.bodyClose);
    for (const r of body.matchAll(/\breturn\s*;/g)) {
      const at = m.bodyOpen + r.index;
      // nested lambda/function ke andar ka `return;` ? main ke andar nested functions C/C++ mein nahi hote; lambda C++11 — skip if inside a lambda
      const pre = masked.slice(m.bodyOpen, at);
      if (/\[[^\]]*\]\s*\([^)]*\)\s*\{[^}]*$/.test(pre)) continue;
      edits.push({ start: at, end: at + r[0].length, text: 'return 0;' });
    }
    return edits;
  }
};

const getchHold = {
  id: 'getch-hold', lang: ['c', 'cpp'], safety: 'safe',
  run({ src, masked, lang }) {
    const m = findMain(masked);
    if (!m) return [];
    // main ka aakhri statement (ya `return …;` se theek pehle wala) `getch();`/`getche();` ho
    const body = masked.slice(m.bodyOpen + 1, m.bodyClose);
    const stmts = [];
    let depth = 0, s = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '{' || c === '(') depth++;
      else if (c === '}' || c === ')') { depth--; if (depth === 0 && c === '}') { stmts.push({ s, e: i + 1 }); s = i + 1; } }
      else if (c === ';' && depth === 0) { stmts.push({ s, e: i + 1 }); s = i + 1; }
    }
    const txt = x => body.slice(x.s, x.e).trim();
    let k = stmts.length - 1;
    if (k >= 0 && /^return\b/.test(txt(stmts[k]))) k--;
    if (k < 0 || !/^getche?\s*\(\s*\)\s*;$/.test(txt(stmts[k]))) return [];
    const st = stmts[k];
    const lead = body.slice(st.s, st.e).search(/\S/);
    const start = m.bodyOpen + 1 + st.s + lead, end = m.bodyOpen + 1 + st.e;
    const repl = lang === 'cpp' ? 'std::cin.get();' : 'getchar();';
    const edits = [{ start, end, text: repl }];
    if (lang === 'cpp') { const inc = includeEdit(src, 'iostream'); if (inc) edits.push(inc); }
    else { const inc = includeEdit(src, 'stdio.h'); if (inc) edits.push(inc); }
    return edits;
  }
};

const clrscr = {
  id: 'clrscr', lang: ['c', 'cpp'], safety: 'review',
  run({ src, masked }) {
    const edits = [];
    for (const m of masked.matchAll(/\bclrscr\s*\(\s*\)\s*;/g)) {
      const st = statementAt(masked, m.index);
      if (masked.slice(st.start, st.end).trim().replace(/\s+/g, '') !== 'clrscr();') continue;   // `if (x) clrscr();` → skip
      // `if (x)` ke turant baad wala statement ho to hataya nahi ja sakta
      const prev = masked.slice(0, st.start).trimEnd();
      if (/\)\s*$/.test(prev) && /\b(if|for|while)\s*\([^;{}]*\)$/.test(prev.slice(-200))) continue;
      if (/\belse$/.test(prev)) continue;
      edits.push(deleteStatement(src, m.index, st.end));
    }
    return edits;
  }
};

const gets = {
  id: 'gets', lang: ['c', 'cpp'], safety: 'safe',
  run({ src, masked, lang }) {
    const edits = [];
    for (const m of masked.matchAll(/\bgets\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;/g)) {
      const v = m[1];
      // char v[N] declared hona chahiye (pointer nahi — sizeof galat hota)
      if (!new RegExp('\\bchar\\s+' + v + '\\s*\\[\\s*[\\w\\s+*]+\\]').test(masked)) continue;
      const st = statementAt(masked, m.index);
      if (masked.slice(st.start, st.end).trim().replace(/\s+/g, '') !== 'gets(' + v + ');') continue;   // `if (gets(s))` skip
      const prev = masked.slice(0, st.start).trimEnd();
      if (/\)\s*$/.test(prev) && /\b(if|for|while)\s*\([^;{}]*\)$/.test(prev.slice(-200))) continue;
      if (lang === 'cpp') {
        edits.push({ start: m.index, end: m.index + m[0].length, text: 'std::cin.getline(' + v + ', sizeof ' + v + ');' });
      } else {
        edits.push({ start: m.index, end: m.index + m[0].length, text: 'fgets(' + v + ', sizeof ' + v + ', stdin); ' + v + '[strcspn(' + v + ', "\\n")] = \'\\0\';' });
      }
    }
    if (edits.length) {
      for (const h of lang === 'cpp' ? ['iostream'] : ['stdio.h', 'string.h']) { const inc = includeEdit(src, h); if (inc) edits.push(inc); }
    }
    return edits;
  }
};

const charArrayString = {
  id: 'char-array-string', lang: ['cpp'], safety: 'safe',
  run({ src, masked }) {
    const edits = [];
    for (const m of masked.matchAll(/\bchar\s+([A-Za-z_]\w*)\s*\[\s*\d+\s*\]\s*;/g)) {
      const v = m[1];
      const all = uses(masked, v).filter(at => at !== m.index + m[0].indexOf(v));
      if (!all.length) continue;
      // har use: `cin >> v` ya `cout << v` chain ka hissa (pichhla token `>>`/`<<`)
      let okAll = true, sawIn = false;
      for (const at of all) {
        const before = masked.slice(0, at).trimEnd();
        const after = masked.slice(at + v.length).trimStart();
        if (/>>$/.test(before)) {
          sawIn = true;
          const st = statementAt(masked, at);
          if (!/^\s*(std::)?cin\b/.test(masked.slice(st.start, st.end))) { okAll = false; break; }
        } else if (/<<$/.test(before)) {
          const st = statementAt(masked, at);
          if (!/^\s*(std::)?(cout|cerr)\b/.test(masked.slice(st.start, st.end))) { okAll = false; break; }
        } else { okAll = false; break; }
        if (/^\[/.test(after)) { okAll = false; break; }   // name[0] — char access
      }
      if (!okAll || !sawIn) continue;
      edits.push({ start: m.index, end: m.index + m[0].length, text: 'std::string ' + v + ';' });
    }
    if (edits.length) { const inc = includeEdit(src, 'string'); if (inc) edits.push(inc); }
    return edits;
  }
};

const random = {
  id: 'random', lang: ['c', 'cpp'], safety: 'safe',
  run({ src, masked, lang }) {
    const edits = [];
    const cpp = lang === 'cpp';
    for (const m of masked.matchAll(/\brandomize\s*\(\s*\)/g)) {
      edits.push({ start: m.index, end: m.index + m[0].length, text: cpp ? 'std::srand(static_cast<unsigned>(std::time(nullptr)))' : 'srand((unsigned)time(NULL))' });
    }
    for (const m of masked.matchAll(/\brandom\s*\(/g)) {
      const before = masked.slice(Math.max(0, m.index - 2), m.index);
      if (/(\.|->|::)$/.test(before)) continue;
      const open = m.index + m[0].length - 1;
      const close = matchBracket(masked, open);
      if (close < 0) continue;
      const arg = src.slice(open + 1, close).trim();
      if (!arg) continue;                                     // POSIX random() (bina argument) — chhedo mat
      edits.push({ start: m.index, end: close + 1, text: (cpp ? '(std::rand() % (' : '(rand() % (') + arg + '))' });
    }
    if (edits.length) {
      for (const h of cpp ? ['cstdlib', 'ctime'] : ['stdlib.h', 'time.h']) { const inc = includeEdit(src, h); if (inc) edits.push(inc); }
    }
    return edits;
  }
};

const delay = {
  id: 'delay', lang: ['cpp'], safety: 'safe',
  run({ src, masked, graphics }) {
    if (graphics) return [];                    // graphics.h: PRABHA ka delay frames bhi flush karta hai
    const edits = [];
    for (const m of masked.matchAll(/\bdelay\s*\(/g)) {
      const before = masked.slice(Math.max(0, m.index - 2), m.index);
      if (/(\.|->|::)$/.test(before)) continue;
      const open = m.index + m[0].length - 1;
      const close = matchBracket(masked, open);
      if (close < 0) continue;
      const arg = src.slice(open + 1, close).trim();
      edits.push({ start: m.index, end: close + 1, text: 'std::this_thread::sleep_for(std::chrono::milliseconds(' + arg + '))' });
    }
    if (edits.length) for (const h of ['thread', 'chrono']) { const inc = includeEdit(src, h); if (inc) edits.push(inc); }
    return edits;
  }
};

const nullRule = {
  id: 'null', lang: ['cpp'], safety: 'safe',
  run({ masked, preproc }) {
    const inPre = off => preproc.some(p => off >= p.start && off < p.end);
    const edits = [];
    for (const m of masked.matchAll(/\bNULL\b/g)) if (!inPre(m.index)) edits.push({ start: m.index, end: m.index + 4, text: 'nullptr' });
    return edits;
  }
};

const farNear = {
  id: 'far-near', lang: ['c', 'cpp'], safety: 'safe',
  run({ masked }) {
    const edits = [];
    // `char far *p` / `int huge *a` / `void far *` — keyword ke baad '*' aana chahiye
    for (const m of masked.matchAll(/\b(far|near|huge|_far|_near|_huge)\b(\s*)(?=\*)/g)) edits.push({ start: m.index, end: m.index + m[0].length, text: '' });
    return edits;
  }
};

/** conio.h tab hatao jab koi conio function na bacha ho (baaki rules ke BAAD chalta hai) */
const conioInclude = {
  id: 'conio-include', lang: ['c', 'cpp'], safety: 'safe',
  run({ src, masked }) {
    const used = CONIO_FNS.some(f => new RegExp('\\b' + f + '\\s*\\(').test(masked));
    if (used) return [];
    const m = /^[ \t]*#[ \t]*include[ \t]*[<"]conio\.h[>"][^\n]*\n?/m.exec(src);
    return m ? [{ start: m.index, end: m.index + m[0].length, text: '' }] : [];
  }
};

const dosInclude = {
  id: 'dos-include', lang: ['c', 'cpp'], safety: 'safe',
  run({ src, masked }) {
    const used = DOS_FNS.some(f => new RegExp('\\b' + f + '\\s*\\(').test(masked)) || /\bstruct\s+(date|time)\b/.test(masked);
    if (used) return [];
    const m = /^[ \t]*#[ \t]*include[ \t]*[<"]dos\.h[>"][^\n]*\n?/m.exec(src);
    return m ? [{ start: m.index, end: m.index + m[0].length, text: '' }] : [];
  }
};

/*
 * ORDER: gets → char-array (gets wale arrays getline mein jaate hain, string nahi banenge),
 * std-qualify sabse aakhri C++ naming rule (naye `std::cin.get` dobara na jude),
 * conio/dos include hatana bilkul aakhir mein.
 */
const RULES = [oldHeaders, voidMain, farNear, gets, getchHold, clrscr, random, delay, charArrayString, nullRule, stdQualify, conioInclude, dosInclude];

module.exports = { RULES, findMain, includeEdit, CONIO_FNS };
