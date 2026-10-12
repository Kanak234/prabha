/*
 * lib/modern/turbo-adapt.js — Turbo mode: purana code BINA user ki file badle
 * modern compiler par chalane ke liye temp copy mein chhote badlaav.
 *
 * WHY (5.x ke do bugs):
 *   1. `void main` → `int main` ek simple regex tha jo STRING ke andar bhi badal
 *      deta tha: `cout << "void main()"` ka output `int main()` ho jaata tha.
 *   2. Turbo C ka `far` / `near` / `huge` (`int far *p`) modern compiler nahi
 *      jaanta — aise programs PRABHA mein compile hi nahi hote the.
 * WHAT: masked lexer se sirf ASLI code mein badlaav; line count kabhi nahi
 *       badalta (taaki compiler errors ki line numbers user ki file se match karein).
 * FLOW: extension.js (Turbo mode compile) / tests → adaptTurbo(src) → temp file
 */
'use strict';

const { lex } = require('./lexer');

/** @returns {{code:string, changed:string[]}} */
function adaptTurbo(src) {
  const { masked } = lex(src);
  const edits = [];
  const changed = [];
  // 1) void main( → int main(   (sirf code mein; length bhi same rakhni zaroori nahi, line same rehti hai)
  const { matchBracket } = require('./lexer');
  for (const m of masked.matchAll(/\bvoid(\s+)main(\s*)\(/g)) {
    edits.push({ start: m.index, end: m.index + m[0].length, text: 'int' + m[1] + 'main' + m[2] + '(' });
    // body ke andar `return;` → `return 0;` — clang (macOS, Zig) `int` function mein
    // khaali return ko ERROR maanta hai, GCC sirf warning. Line wahi rehti hai.
    const open = m.index + m[0].length - 1, close = matchBracket(masked, open);
    let k = close + 1; while (k < masked.length && /\s/.test(masked[k])) k++;
    if (close > 0 && masked[k] === '{') {
      const end = matchBracket(masked, k);
      for (const r of masked.slice(k, end).matchAll(/\breturn\s*;/g)) edits.push({ start: k + r.index, end: k + r.index + r[0].length, text: 'return 0;' });
    }
  }
  // Turbo ka bina type wala `main()` (purana "implicit int") — GCC -fpermissive chala
  // leta hai, clang (macOS/Zig) error deta hai → `int main()`
  for (const m of masked.matchAll(/(^|[;}])([ \t]*)main(\s*)\(/gm)) {
    const at = m.index + m[1].length + m[2].length;
    const open = masked.indexOf('(', at), close = matchBracket(masked, open);
    let k = close + 1; while (k < masked.length && /\s/.test(masked[k])) k++;
    if (close < 0 || masked[k] !== '{') continue;            // call ya prototype — definition nahi
    edits.push({ start: at, end: at, text: 'int ' });
    const end = matchBracket(masked, k);
    for (const r of masked.slice(k, end).matchAll(/\breturn\s*;/g)) edits.push({ start: k + r.index, end: k + r.index + r[0].length, text: 'return 0;' });
  }
  if (edits.length) changed.push('void main() adapted to int main()');
  // 2) far / near / huge pointer qualifiers → hata do (sirf jab '*' se pehle hon)
  let fn = 0;
  for (const m of masked.matchAll(/\b(far|near|huge|_far|_near|_huge)\b\s*(?=\*)/g)) { edits.push({ start: m.index, end: m.index + m[0].length, text: '' }); fn++; }
  if (fn) changed.push('far/near/huge pointer qualifiers removed');
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, changed };
}

module.exports = { adaptTurbo };
