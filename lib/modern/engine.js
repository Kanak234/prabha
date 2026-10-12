/*
 * lib/modern/engine.js — Turbo C/C++ code ko Modern C/C++ banane wala engine.
 * Punarnava ke engine jaisa: rules ek-ek karke, har pass ke baad dobara lex,
 * overlap aur bracket-balance safety net, har badlaav explanation ke saath.
 *
 * modernize(src, {fileName, enabled, lang}) → { code, changes[], available[], warnings[], lang }
 * FLOW: extension.js (Modern panel) / tests → modernize() → media/modern-panel.js
 */
'use strict';

const { lex, lineStart, lineEnd, lineOf } = require('./lexer');
const { RULES } = require('./rules');
const { explain } = require('./explain');

function defaultEnabled() { return RULES.filter(r => r.safety === 'safe').map(r => r.id); }

/** .c → C; .cpp/.cc/.cxx → C++; bina naam: C++ ke nishaan (cout, iostream, class) dekh kar */
function detectLang(src, fileName) {
  if (fileName) {
    if (/\.c$/i.test(fileName)) return 'c';
    if (/\.(cpp|cc|cxx|c\+\+|hpp)$/i.test(fileName)) return 'cpp';
  }
  return /\b(cout|cin|iostream|namespace|class|template)\b/.test(src) ? 'cpp' : 'c';
}

function modernize(source, opts = {}) {
  const crlf = /\r\n/.test(source);
  let src = source.replace(/\r\n/g, '\n');
  const lang = opts.lang || detectLang(src, opts.fileName);
  const enabled = new Set(opts.enabled || defaultEnabled());
  const ui = opts.ui === 'en' ? 'en' : 'hi';
  const changes = [], available = [], warnings = [];

  for (const rule of RULES) {
    if (!rule.lang.includes(lang)) continue;
    const lx = lex(src);
    const ctx = { src, masked: lx.masked, preproc: lx.preproc, strings: lx.strings, lang, graphics: /^\s*#\s*include\s*[<"]graphics\.h[>"]/m.test(src) };
    let edits;
    try { edits = rule.run(ctx) || []; } catch (e) { warnings.push(rule.id + ': ' + e.message); continue; }
    if (!edits.length) continue;
    if (!enabled.has(rule.id)) {
      const ex = explain(rule.id, ui);
      available.push({ id: rule.id, count: edits.length, safety: rule.safety, title: ex && ex.title });
      continue;
    }
    edits = dedupe(edits).sort((a, b) => a.start - b.start || a.end - b.end);
    let overlap = false;
    for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) { overlap = true; break; }
    if (overlap) { warnings.push(rule.id + ': overlapping edits — skipped'); continue; }
    const next = apply(src, edits);
    if (!balanced(next)) { warnings.push(rule.id + ': unbalanced result — skipped'); continue; }
    for (const g of group(src, edits)) {
      changes.push({ rule: rule.id, java: explain(rule.id, ui).std, safety: rule.safety, line: lineOf(src, g.start), before: g.before, after: g.after, explanation: explain(rule.id, ui) });
    }
    src = next;
  }
  if (changes.length) src = src.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
  return { code: crlf ? src.replace(/\n/g, '\r\n') : src, changes, available, warnings, lang, minJava: lang === 'cpp' ? 'C++17' : 'C11' };
}

function dedupe(edits) { const s = new Set(); return edits.filter(e => { const k = e.start + ':' + e.end + ':' + e.text; if (s.has(k)) return false; s.add(k); return true; }); }
function apply(src, edits) { let o = src; for (const e of [...edits].sort((a, b) => b.start - a.start)) o = o.slice(0, e.start) + e.text + o.slice(e.end); return o; }

function group(src, edits) {
  const gs = [];
  for (const e of edits) {
    const ls = lineStart(src, e.start), le = lineEnd(src, Math.max(e.start, e.end - 1));
    const g = gs[gs.length - 1];
    if (g && lineOf(src, ls) - lineOf(src, g.le) <= 1) { g.le = Math.max(g.le, le); g.edits.push(e); }
    else gs.push({ start: e.start, ls, le, edits: [e] });
  }
  return gs.map(g => {
    const before = src.slice(g.ls, g.le);
    const after = apply(before, g.edits.map(e => ({ start: e.start - g.ls, end: Math.min(e.end - g.ls, before.length), text: e.text })));
    const [b, a] = dedentPair(before.replace(/\s+$/, ''), after.replace(/\s+$/, ''));
    return { start: g.start, before: b, after: a };
  });
}

function dedentPair(a, b) {
  const ind = t => t.split('\n').filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length);
  const all = [...ind(a), ...ind(b)];
  const min = all.length ? Math.min(...all) : 0;
  const cut = t => t.split('\n').map(l => l.slice(Math.min(min, l.match(/^[ \t]*/)[0].length))).join('\n');
  return [cut(a), cut(b)];
}

function balanced(src) {
  const { masked, preproc } = lex(src);
  let m = masked.split('');
  for (const p of preproc) for (let k = p.start; k < p.end; k++) m[k] = ' ';   // #include <..> ke brackets ignore
  let a = 0, b = 0, c = 0;
  for (const ch of m) {
    if (ch === '{') a++; else if (ch === '}') a--;
    else if (ch === '(') b++; else if (ch === ')') b--;
    else if (ch === '[') c++; else if (ch === ']') c--;
    if (a < 0 || b < 0 || c < 0) return false;
  }
  return a === 0 && b === 0 && c === 0;
}

/** Line diff (LCS, indentation-insensitive) — panel ke side-by-side view ke liye */
function diffLines(oldText, newText) {
  const A = oldText.replace(/\r\n/g, '\n').split('\n'), B = newText.replace(/\r\n/g, '\n').split('\n');
  const kA = A.map(l => l.trim()), kB = B.map(l => l.trim());
  const n = A.length, m = B.length;
  if (n * m > 16e6) return [...A.map((t, i) => ({ type: 'del', a: i + 1, text: t })), ...B.map((t, i) => ({ type: 'add', b: i + 1, text: t }))];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = kA[i] === kB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (kA[i] === kB[j]) { out.push({ type: 'same', a: i + 1, b: j + 1, text: A[i], textB: B[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', a: i + 1, text: A[i] }); i++; }
    else { out.push({ type: 'add', b: j + 1, text: B[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', a: i + 1, text: A[i] }); i++; }
  while (j < m) { out.push({ type: 'add', b: j + 1, text: B[j] }); j++; }
  return out;
}

module.exports = { modernize, diffLines, defaultEnabled, detectLang, RULES };
