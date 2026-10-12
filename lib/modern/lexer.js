/*
 * lib/modern/lexer.js — C/C++ source ka "masked" view.
 *
 * WHY:   Rules regex se kaam karte hain. Comment `// void main()` ya string
 *        "cout" ke andar ka text kabhi nahi badalna chahiye.
 * WHAT:  comments, string literals, char literals ko same length ke spaces se
 *        badal deta hai (newlines rakhta hai) → offsets original ke barabar.
 *        Preprocessor lines (#include …) ki list alag deta hai.
 * FLOW:  engine.js → lex(src) → {masked, strings[], preproc[]} → rules
 */
'use strict';

function lex(src) {
  const out = src.split('');
  const strings = [];
  const preproc = [];
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  let i = 0;
  let lineStart = true;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { lineStart = true; i++; continue; }
    if (lineStart && (c === ' ' || c === '\t')) { i++; continue; }
    // Preprocessor line: # se shuru, backslash-newline se aage badh sakti hai
    if (lineStart && c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\' && src[j + 1] === '\n') j++; j++; }
      preproc.push({ start: i, end: j, text: src.slice(i, j) });
      // include ke andar <iostream.h> wagairah strings nahi hain; comments mask karo
      const seg = src.slice(i, j);
      const ci = seg.search(/\/\/|\/\*/);
      if (ci >= 0) blank(i + ci, j);
      i = j; lineStart = false; continue;
    }
    lineStart = false;
    if (c === '/' && d === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j === -1 ? n : j + 2; blank(i, j); i = j; continue; }
    // C++11 raw string R"delim( ... )delim"
    if (c === 'R' && d === '"' && !/[\w$]/.test(src[i - 1] || '')) {
      const m = /^R"([^(\s]{0,16})\(/.exec(src.slice(i, i + 20));
      if (m) {
        const close = ')' + m[1] + '"';
        let j = src.indexOf(close, i + m[0].length);
        j = j === -1 ? n : j + close.length;
        strings.push({ start: i + 1, end: j, kind: 'raw' });
        blank(i + 2, j - 1); i = j; continue;
      }
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      strings.push({ start: i, end: j, kind: 'string' });
      blank(i + 1, j - 1); i = j; continue;
    }
    if (c === '\'') {
      // digit separator 1'000'000 (C++14) — pichhla char digit ho to literal nahi
      if (/[0-9A-Fa-f]/.test(src[i - 1] || '') && /[0-9A-Fa-f]/.test(d || '')) { i++; continue; }
      let j = i + 1;
      while (j < n && src[j] !== '\'' && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      strings.push({ start: i, end: j, kind: 'char' });
      blank(i + 1, j - 1); i = j; continue;
    }
    i++;
  }
  return { masked: out.join(''), strings, preproc };
}

function matchBracket(masked, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const o = masked[open], cl = pairs[o];
  if (!cl) return -1;
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === o) depth++;
    else if (masked[k] === cl) { depth--; if (depth === 0) return k; }
  }
  return -1;
}

function lineStart(s, off) { while (off > 0 && s[off - 1] !== '\n') off--; return off; }
function lineEnd(s, off) { while (off < s.length && s[off] !== '\n') off++; return off; }
function lineOf(s, off) { let l = 1; for (let k = 0; k < off && k < s.length; k++) if (s[k] === '\n') l++; return l; }
function indentAt(s, off) { const a = lineStart(s, off); let e = a; while (e < s.length && (s[e] === ' ' || s[e] === '\t')) e++; return s.slice(a, e); }

/** Statement wali line poori hatao (agar line par sirf wahi hai), warna sirf statement */
function deleteStatement(src, start, end) {
  const ls = lineStart(src, start), le = lineEnd(src, Math.max(start, end - 1));
  if (src.slice(ls, start).trim() === '' && src.slice(end, le).trim() === '') return { start: ls, end: Math.min(src.length, le + 1), text: '' };
  return { start, end, text: '' };
}

module.exports = { lex, matchBracket, lineStart, lineEnd, lineOf, indentAt, deleteStatement };
