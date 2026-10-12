/*
 * lib/debug/mi.js — gdb ki "MI" (Machine Interface) output language ka parser.
 *
 * WHY:   PRABHA ka debugger gdb ko `--interpreter=mi2` mode mein chalata hai. gdb
 *        har jawab ek structured line mein deta hai, jaise:
 *          ^done,bkpt={number="1",file="a.c",line="5"}
 *          *stopped,reason="breakpoint-hit",frame={func="main",line="5"}
 *          ~"text for the console\n"
 *        Ye file us line ko JavaScript object mein badalti hai.
 * WHAT:  parseRecord(line) → { kind, token, cls, results } ya { kind:'stream', stream, text }
 *        ya null (program ka apna output / `(gdb)` prompt).
 * FLOW:  gdb-adapter.js → gdb stdout ki har line → parseRecord() → DAP events/responses
 */
'use strict';

/** MI c-string: "..." with C escapes → JS string. i = opening quote index. */
function readCString(s, i) {
  // gdb non-ASCII ko octal UTF-8 bytes mein deta hai ("\340\244\250" = "न") —
  // isliye bytes jama karke aakhir mein UTF-8 decode karte hain (Hindi text sahi aaye).
  const parts = [];
  let j = i + 1;
  const push = str => parts.push(Buffer.from(str, 'utf8'));
  while (j < s.length) {
    const c = s[j];
    if (c === '"') return { value: Buffer.concat(parts).toString('utf8'), end: j + 1 };
    if (c === '\\') {
      const n = s[j + 1];
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' };
      if (n in map) { push(map[n]); j += 2; continue; }
      if (/[0-7]/.test(n)) {
        const m = /^[0-7]{1,3}/.exec(s.slice(j + 1));
        parts.push(Buffer.from([parseInt(m[0], 8) & 0xff])); j += 1 + m[0].length; continue;
      }
      push(n || ''); j += 2; continue;
    }
    push(c); j++;
  }
  return { value: Buffer.concat(parts).toString('utf8'), end: j };
}

/** value := c-string | tuple {…} | list […] */
function readValue(s, i) {
  const c = s[i];
  if (c === '"') return readCString(s, i);
  if (c === '{') return readTuple(s, i);
  if (c === '[') return readList(s, i);
  // MI kabhi-kabhi bina quotes ka token deta hai (galti se) — comma tak padh lo
  let j = i; while (j < s.length && !',}]'.includes(s[j])) j++;
  return { value: s.slice(i, j), end: j };
}

function readResult(s, i) {
  const eq = s.indexOf('=', i);
  const name = s.slice(i, eq);
  const v = readValue(s, eq + 1);
  return { name, value: v.value, end: v.end };
}

function readTuple(s, i) {
  const obj = {};
  let j = i + 1;
  if (s[j] === '}') return { value: obj, end: j + 1 };
  while (j < s.length) {
    const r = readResult(s, j);
    // duplicate keys (frame list mein `frame=` baar-baar) → array bana do
    if (r.name in obj) obj[r.name] = [].concat(obj[r.name], [r.value]); else obj[r.name] = r.value;
    j = r.end;
    if (s[j] === ',') { j++; continue; }
    if (s[j] === '}') return { value: obj, end: j + 1 };
    break;
  }
  return { value: obj, end: j };
}

function readList(s, i) {
  const arr = [];
  let j = i + 1;
  if (s[j] === ']') return { value: arr, end: j + 1 };
  while (j < s.length) {
    // list mein ya to values (`"a","b"`) hoti hain ya results (`frame={…},frame={…}`)
    if (/^[A-Za-z_][\w-]*=/.test(s.slice(j, j + 40))) {
      const r = readResult(s, j);
      arr.push({ [r.name]: r.value }); j = r.end;
    } else {
      const v = readValue(s, j);
      arr.push(v.value); j = v.end;
    }
    if (s[j] === ',') { j++; continue; }
    if (s[j] === ']') return { value: arr, end: j + 1 };
    break;
  }
  return { value: arr, end: j };
}

/** results: "a=1,b={…},c=[…]" → object */
function readResults(s, i) {
  const obj = {};
  let j = i;
  while (j < s.length) {
    if (s[j] === ',') j++;
    if (j >= s.length) break;
    const r = readResult(s, j);
    if (r.name in obj) obj[r.name] = [].concat(obj[r.name], [r.value]); else obj[r.name] = r.value;
    if (r.end <= j) break;
    j = r.end;
  }
  return obj;
}

/**
 * @param {string} line  gdb stdout ki ek line (newline ke bina)
 */
function parseRecord(line) {
  const l = line.replace(/\r$/, '');
  if (!l || /^\(gdb\)\s*$/.test(l)) return null;
  const m = /^(\d*)([\^*+=])([a-zA-Z-]+)(?:,(.*))?$/.exec(l);
  if (m) {
    const kindMap = { '^': 'result', '*': 'exec', '+': 'status', '=': 'notify' };
    let results = {};
    try { results = m[4] ? readResults(m[4], 0) : {}; } catch { results = { raw: m[4] }; }
    return { kind: kindMap[m[2]], token: m[1] ? Number(m[1]) : null, cls: m[3], results };
  }
  const s = /^([~@&])(".*")$/.exec(l);
  if (s) return { kind: 'stream', stream: { '~': 'console', '@': 'target', '&': 'log' }[s[1]], text: readCString(s[2], 0).value };
  return null;                                     // program ka apna output
}

/** MI command ke andar ki string ko quote karo */
function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

module.exports = { parseRecord, readCString, q };
