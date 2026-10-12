/*
 * media/modern-panel.js — PRABHA Turbo → Modern C/C++ learning panel (Punarnava ka bhai) (webview ke andar chalta hai).
 *
 * WHY:   Student ko ek hi jagah dikhe: Turbo C++ code | Modern C/C++ (side-by-side,
 *        badli lines highlighted), har badlaav ka "kyun", common galti, aur ek
 *        chhota quiz. Saath mein: dono version compile karke output match karna.
 * SAFETY: Saara text DOM mein `textContent` se jaata hai (innerHTML kabhi user
 *        code ke saath nahi) — code mein `<script>` ho tab bhi kuch execute nahi hoga.
 * FLOW:  extension.js → postMessage({t:'render', ...}) → render() → user click →
 *        vsc.postMessage({t:'apply'|'check'|...}) → extension.js
 */
(function () {
  'use strict';
  const vsc = acquireVsCodeApi();
  const app = document.getElementById('app');
  let last = null;

  // chhota DOM helper: el('div', {class:'x'}, child1, 'text', ...)
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }

  // Inline `code` markers ko <code> mein badlo (explanations mein backticks hote hain)
  function rich(text) {
    const frag = document.createDocumentFragment();
    String(text).split(/(`[^`]+`)/).forEach(part => {
      if (/^`[^`]+`$/.test(part)) frag.append(el('code', {}, part.slice(1, -1)));
      else if (part) frag.append(document.createTextNode(part));
    });
    return frag;
  }

  /* ───── tiny C/C++ syntax highlight (DOM nodes, no innerHTML) ───── */
  const KW = /^(auto|bool|break|case|catch|char|class|const|constexpr|continue|default|delete|do|double|else|enum|extern|false|float|for|goto|if|inline|int|long|namespace|new|nullptr|private|protected|public|return|short|signed|sizeof|static|struct|switch|template|this|throw|true|try|typedef|union|unsigned|using|virtual|void|volatile|while|far|near|huge)$/;
  const TOKEN = /(^\s*#\s*\w+.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b)/g;
  function highlight(line) {
    const frag = document.createDocumentFragment();
    let i = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(line))) {
      if (m.index > i) frag.append(document.createTextNode(line.slice(i, m.index)));
      const t = m[0];
      let cls = null;
      if (/^\s*#/.test(t)) cls = 'tk-type';
      else if (t.startsWith('//')) cls = 'tk-com';
      else if (t[0] === '"' || t[0] === '\'') cls = 'tk-str';
      else if (/^\d/.test(t)) cls = 'tk-num';
      else if (KW.test(t)) cls = 'tk-kw';
      else if (/^(std|string|cout|cin|endl|printf|scanf|vector|size_t|FILE)$/.test(t)) cls = 'tk-type';
      frag.append(cls ? el('span', { class: cls }, t) : document.createTextNode(t));
      i = m.index + t.length;
    }
    if (i < line.length) frag.append(document.createTextNode(line.slice(i)));
    return frag;
  }

  /* ───── side-by-side rows from line diff ───── */
  function rowsFromDiff(diff) {
    // same → dono taraf; del/add ke lagataar blocks ko aamne-saamne jodo
    const rows = [];
    let i = 0;
    while (i < diff.length) {
      const d = diff[i];
      if (d.type === 'same') { rows.push({ l: d, r: d }); i++; continue; }
      const dels = [], adds = [];
      while (i < diff.length && diff[i].type !== 'same') { (diff[i].type === 'del' ? dels : adds).push(diff[i]); i++; }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) rows.push({ l: dels[k] || null, r: adds[k] || null, changed: true });
    }
    return rows;
  }

  function codePane(rows, side) {
    const pane = el('div', { class: 'pane' });
    for (const row of rows) {
      const d = row[side];
      const cls = 'ln ' + (!d ? 'empty' : d.type === 'del' ? 'del' : d.type === 'add' ? 'add' : '');
      const num = d ? (side === 'l' ? d.a : d.b) : '';
      // 'same' line: right side par naye code ka text (indent badla ho sakta hai)
      const text = d ? (side === 'r' && d.textB !== undefined ? d.textB : d.text) : '';
      pane.append(el('div', { class: cls }, el('span', { class: 'no' }, num || ''), el('span', { class: 'tx' }, d ? highlight(text) : '')));
    }
    return pane;
  }

  /* ───── quiz card ───── */
  function quiz(p) {
    const box = el('div', { class: 'quiz' }, el('div', { class: 'q' }, '🧠 ', rich(p.q)));
    const result = el('div', { class: 'qres' });
    const opts = el('div', { class: 'opts' });
    p.options.forEach((o, idx) => {
      const b = el('button', { class: 'opt', onclick: () => {
        [...opts.children].forEach((c, j) => { c.disabled = true; if (j === p.answer) c.classList.add('right'); });
        if (idx !== p.answer) b.classList.add('wrong');
        result.textContent = '';
        result.append(el('b', {}, idx === p.answer ? (last.lang === 'en' ? 'Correct! ' : 'Sahi jawab! ') : (last.lang === 'en' ? 'Not quite. ' : 'Galat — koi baat nahi. ')), rich(p.explain));
      } }, rich(o));
      opts.append(b);
    });
    box.append(opts, result);
    return box;
  }

  function changeCard(c, idx) {
    const e = c.explanation;
    return el('article', { class: 'card' + (c.safety === 'review' ? ' review' : '') },
      el('header', {},
        el('span', { class: 'badge java' }, c.java),
        c.safety === 'review' ? el('span', { class: 'badge warn' }, last.lang === 'en' ? 'review' : 'dhyaan do') : null,
        el('h3', {}, (idx + 1) + '. ', rich(e.title)),
        el('span', { class: 'muted line' }, 'line ' + c.line)),
      el('div', { class: 'ba' },
        el('div', {}, el('div', { class: 'lbl' }, last.lang === 'en' ? 'Before' : 'Pehle'), pre(c.before, 'del')),
        el('div', {}, el('div', { class: 'lbl' }, last.lang === 'en' ? 'After' : 'Ab'), pre(c.after, 'add'))),
      el('p', { class: 'why' }, el('b', {}, last.lang === 'en' ? 'Why: ' : 'Kyun: '), rich(e.why)),
      el('p', { class: 'mistake' }, el('b', {}, '⚠ '), rich(e.mistake)),
      c.note ? el('p', { class: 'muted' }, 'ℹ ', c.note) : null,
      quiz(e.practice));
  }

  function pre(text, cls) {
    const p = el('pre', { class: 'snip ' + cls });
    String(text || (last.lang === 'en' ? '(removed)' : '(hata diya)')).split('\n').forEach((l, i, a) => { p.append(highlight(l)); if (i < a.length - 1) p.append('\n'); });
    return p;
  }

  /* ───── main render ───── */
  function render(m) {
    last = m;
    const en = m.lang === 'en';
    app.textContent = '';
    const T = (hi, enT) => (en ? enT : hi);

    // header + controls
    const langSel = el('select', { onchange: e => vsc.postMessage({ t: 'lang', lang: e.target.value }) },
      el('option', { value: 'hi', selected: !en }, 'Hinglish'), el('option', { value: 'en', selected: en }, 'English'));
    app.append(el('div', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'logo' }, 'P'), el('div', {}, el('h1', {}, 'PRABHA · Turbo → Modern'), el('div', { class: 'muted' }, m.file))),
      el('div', { class: 'controls' },
        el('label', {}, T('Bhasha ', 'Language '), langSel))));

    // summary
    const n = m.changes.length;
    app.append(el('div', { class: 'summary' },
      n ? el('span', {}, el('b', {}, String(n)), T(' badlaav · naya code standard ', ' changes · new code is standard '), el('b', {}, m.minJava), T(' hai — kisi bhi modern compiler par chalega', ' — runs on any modern compiler'))
        : el('span', {}, T('Yeh code pehle se modern hai ✓', 'This code is already modern ✓')),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', disabled: !n, onclick: () => vsc.postMessage({ t: 'apply' }) }, T('File par lagao', 'Apply to file')),
        el('button', { disabled: !n, onclick: () => vsc.postMessage({ t: 'newFile' }) }, T('Nayi tab mein kholo', 'Open in new tab')),
        el('button', { disabled: !n, onclick: () => vsc.postMessage({ t: 'copy' }) }, T('Copy', 'Copy')),
        el('button', { onclick: () => { checkBox.textContent = T('dono version compile karke chala raha hoon…', 'compiling and running both versions…'); checkBox.className = 'check'; vsc.postMessage({ t: 'check' }); } }, T('✔ Dono ka output match karo', '✔ Check: same output?')),
        el('button', { onclick: () => vsc.postMessage({ t: 'run', which: 'old' }) }, T('▶ Purana chalao', '▶ Run old')),
        el('button', { onclick: () => vsc.postMessage({ t: 'run', which: 'new' }) }, T('▶ Naya chalao', '▶ Run new')))));
    const checkBox = el('pre', { class: 'check hidden' });
    app.append(checkBox);

    // review toggles
    if (m.reviewRules.length) {
      const box = el('div', { class: 'review-box' }, el('div', { class: 'rhead' }, T('Review wale badlaav (behaviour thoda badal sakta hai — samajh kar ON karo):', 'Review changes (may change behaviour slightly — turn on once you understand):')));
      for (const r of m.reviewRules) {
        const avail = m.available.find(a => a.id === r.id);
        const cb = el('input', { type: 'checkbox', checked: r.on, onchange: e => vsc.postMessage({ t: 'toggleReview', id: r.id, on: e.target.checked }) });
        box.append(el('label', { class: 'toggle' + (avail || r.on ? '' : ' dim') }, cb, ' ', rich(r.title), ' ',
          
          avail ? el('span', { class: 'muted' }, ' · ' + T('is file mein ' + avail.count + ' jagah', avail.count + ' place(s) here')) : null));
      }
      app.append(box);
    }

    // side-by-side
    const rows = rowsFromDiff(m.diff);
    const left = codePane(rows, 'l'), right = codePane(rows, 'r');
    // dono panes ka scroll saath chale
    let lock = false;
    const sync = (a, b) => a.addEventListener('scroll', () => { if (lock) return; lock = true; b.scrollTop = a.scrollTop; b.scrollLeft = a.scrollLeft; requestAnimationFrame(() => { lock = false; }); });
    sync(left, right); sync(right, left);
    app.append(el('div', { class: 'sbs' },
      el('div', { class: 'col' }, el('div', { class: 'colh old' }, T('Turbo C/C++ (purana)', 'Turbo C/C++ (old)')), left),
      el('div', { class: 'col' }, el('div', { class: 'colh new' }, T('Modern', 'Modern') + ' (' + m.minJava + ')'), right)));

    // cards
    if (n) {
      app.append(el('h2', {}, T('Har badlaav samjho', 'Understand every change')));
      m.changes.forEach((c, i) => app.append(changeCard(c, i)));
    }
    for (const w of m.warnings) app.append(el('p', { class: 'muted' }, '! ' + w));

    // watermark
    app.append(el('footer', {}, el('span', { class: 'logo sm' }, 'KP'),
      ' PRABHA — by ', el('b', {}, 'Kanak Prabhakar'), ' · Cooding with Kanak'));
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.t === 'render') render(m);
    else if (m.t === 'check') {
      const box = document.querySelector('pre.check');
      if (box) { box.className = 'check ' + (m.ok ? 'ok' : 'bad'); box.textContent = m.text; }
    }
  });
  vsc.postMessage({ t: 'ready' });
})();
