/*
 * lib/stream.js — program ke stdout ko do hisson mein baantna:
 *   "##PRABHA##{...}" protocol lines → panel (frames, input requests, sound)
 *   baaki sab (printf ka text)        → Output channel
 *
 * WHY:   Linux/macOS par protocol alag pipe (fd 3) par aata hai. Windows par fd 3
 *        nahi hota, isliye runtime protocol bhi stdout par likhta hai. Purana code
 *        har CHUNK ko dekhta tha: agar chunk mein marker hai to poora chunk protocol,
 *        warna poora text. Pipe chunks line ke beech mein toot-te hain → aadhi JSON
 *        line Output mein chhap jaati thi aur frame gayab; printf ka text jo marker
 *        wale chunk mein aaya woh gum ho jaata tha. Yeh router LINE level par kaam
 *        karta hai, aur line ke beech mein marker ho (printf("Enter:") ke baad
 *        protocol) to use bhi sahi jagah se kaatta hai.
 * FLOW:  extension.js → createRouter(onText, onProto) → child.stdout 'data' → push(chunk)
 */
'use strict';

const MARK = '##PRABHA##';

function createRouter(onText, onProto) {
  let buf = '';

  function line(l) {
    const k = l.indexOf(MARK);
    if (k === -1) { onText(l + '\n'); return; }
    if (k > 0) onText(l.slice(0, k));
    const json = l.slice(k + MARK.length).replace(/\r$/, '');
    try { onProto(JSON.parse(json)); } catch { /* adhoori line program exit par — ignore */ }
  }

  function push(chunk) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const l = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      line(l);
    }
    // Bacha hua tukda (newline nahi aayi):
    //  - marker se shuru → protocol line abhi poori nahi, rok ke rakho
    //  - marker beech mein → pehle wala text abhi dikhao, marker se rok ke rakho
    //  - marker nahi → prompt jaisa text ("Enter a: ") turant dikhao, sirf end ka
    //    woh hissa rok lo jo marker ki shuruaat ho sakta hai ("##PRA")
    const k = buf.indexOf(MARK);
    if (k > 0) { onText(buf.slice(0, k)); buf = buf.slice(k); }
    else if (k === -1 && buf) {
      let keep = 0;
      for (let L = Math.min(MARK.length - 1, buf.length); L > 0; L--) if (MARK.startsWith(buf.slice(-L))) { keep = L; break; }
      if (buf.length > keep) { onText(buf.slice(0, buf.length - keep)); buf = buf.slice(buf.length - keep); }
    }
  }

  function end() {
    if (buf) { line(buf); buf = ''; }
  }

  return { push, end };
}

module.exports = { createRouter, MARK };
