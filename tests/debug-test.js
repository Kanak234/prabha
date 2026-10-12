#!/usr/bin/env node
/*
 * tests/debug-test.js — PRABHA debugger ka asli test (VS Code ke bina).
 * Ek scripted DAP session jo bilkul VS Code jaisi requests bhejta hai:
 *   breakpoint → recursion stop → call stack → locals → array/struct expand →
 *   watch expression → step in / step out → crash par rukna → exit code.
 * Backends:
 *   gdb      → PRABHA ka apna adapter (lib/debug/gdb-adapter.js)   [Linux, Windows]
 *   lldb-dap → macOS ka raasta (Apple ka lldb-dap, PRABHA config ke saath) [macOS; Linux par bhi agar mile]
 * FLOW: node tests/debug-test.js [gdb|lldb] → exit 0 = pass (tool na ho to skip)
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GdbDebugSession } = require('../lib/debug/gdb-adapter');
const { findLldbDap } = require('../lib/toolchain');

const root = path.join(__dirname, '..');
const win = process.platform === 'win32';
let pass = 0, fail = 0;
const ok = (name, c, x) => { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (x ? '\n       ' + String(x).slice(0, 1500).split('\n').join('\n       ') : '')); } };
const has = c => { try { cp.execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };

/* DAP client: inline session ya adapter process (Content-Length framing) */
class Client {
  constructor(transport) {
    this.seq = 1; this.waiters = []; this.events = []; this.outputs = []; this.pendingReq = new Map();
    this.t = transport;
    transport.onMessage(m => this.onMessage(m));
  }
  onMessage(m) {
    if (m.type === 'response') { const p = this.pendingReq.get(m.request_seq); if (p) { this.pendingReq.delete(m.request_seq); p(m); } return; }
    if (m.type === 'request' && m.command === 'runInTerminal') { this.t.send({ type: 'response', request_seq: m.seq, command: m.command, success: false, seq: this.seq++ }); return; }
    if (m.type === 'event') {
      if (m.event === 'output') this.outputs.push(m.body.output);
      this.events.push(m);
      this.waiters = this.waiters.filter(w => { if (w.pred(m)) { w.res(m); return false; } return true; });
    }
  }
  req(command, args = {}) {
    const seq = this.seq++;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout: ' + command)), 30000);
      this.pendingReq.set(seq, m => { clearTimeout(to); m.success ? res(m.body || {}) : rej(new Error(command + ': ' + m.message)); });
      this.t.send({ type: 'request', seq, command, arguments: args });
    });
  }
  waitEvent(name, pred = () => true, ms = 30000) {
    const seen = this.events.findIndex(e => e.event === name && pred(e));
    if (seen >= 0) { const e = this.events[seen]; this.events.splice(seen, 1); return Promise.resolve(e); }
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('no "' + name + '" event in ' + ms + 'ms. outputs: ' + this.outputs.join('').slice(-400))), ms);
      this.waiters.push({ pred: e => e.event === name && pred(e), res: e => { clearTimeout(to); this.events.splice(this.events.indexOf(e), 1); res(e); } });
    });
  }
}

function inlineTransport(session) {
  return { onMessage: cb => session.onDidSendMessage(cb), send: m => session.handleMessage(m), close: () => session.dispose() };
}
function processTransport(bin, args) {
  const p = cp.spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0); let cb;
  p.stdout.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const h = buf.indexOf('\r\n\r\n'); if (h < 0) break;
      const len = Number(/Content-Length: (\d+)/i.exec(buf.slice(0, h).toString())[1]);
      if (buf.length < h + 4 + len) break;
      const msg = JSON.parse(buf.slice(h + 4, h + 4 + len).toString('utf8'));
      buf = buf.slice(h + 4 + len);
      cb && cb(msg);
    }
  });
  return { onMessage: f => { cb = f; }, send: m => { const s = JSON.stringify(m); p.stdin.write('Content-Length: ' + Buffer.byteLength(s) + '\r\n\r\n' + s); }, close: () => { try { p.kill(); } catch { /* */ } } };
}

const SRC = `#include <stdio.h>
struct P { int x; int y; };
int fact(int n) {
    if (n <= 1) return 1;
    int r = n * fact(n - 1);
    return r;
}
int main(void) {
    int a[3] = {5, 2, 9};
    struct P p = {3, 4};
    int x = fact(3);
    printf("x=%d\\n", x);
    return x + a[0] + p.x;
}
`;
const CRASH = `#include <stdio.h>
int main(void) {
    int *p = 0;
    printf("before crash\\n");
    *p = 42;
    return 0;
}
`;

async function scenario(backend) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha debug ' + backend + ' '));
  const file = path.join(dir, 'fact.c'), bin = path.join(dir, 'fact' + (win ? '.exe' : ''));
  fs.writeFileSync(file, SRC);
  const cc = ['gcc', 'clang', 'cc'].find(has);
  const c = cp.spawnSync(cc, ['-g', '-O0', '-include', path.join(root, 'runtime', 'prabha_unbuffered.h'), file, '-o', bin], { encoding: 'utf8' });
  if (c.status !== 0) { ok(backend + ': fixture compiles', false, c.stderr); return; }

  let client, launchArgs;
  if (backend === 'gdb') {
    const s = new GdbDebugSession({ trace: process.env.PRABHA_DEBUG_TRACE ? x => console.log('      ' + x) : undefined });
    client = new Client(inlineTransport(s));
    launchArgs = { program: bin, cwd: dir, gdbPath: 'gdb', console: 'internal' };
  } else {
    const dap = findLldbDap();
    client = new Client(processTransport(dap, []));
    launchArgs = { program: bin, cwd: dir };
  }
  try {
    const caps = await client.req('initialize', { adapterID: 'prabha', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
    ok(backend + ': initialize', !!caps);
    const launched = client.req('launch', launchArgs);
    await client.waitEvent('initialized');
    const bps = await client.req('setBreakpoints', { source: { path: file }, breakpoints: [{ line: 4 }] });
    ok(backend + ': breakpoint on line 4 verified', bps.breakpoints[0].verified && bps.breakpoints[0].line === 4, JSON.stringify(bps));
    await client.req('configurationDone');
    await launched;
    let st = await client.waitEvent('stopped');
    ok(backend + ': stops at the breakpoint', st.body.reason === 'breakpoint', JSON.stringify(st.body));
    const tid = st.body.threadId || 1;
    let stack = await client.req('stackTrace', { threadId: tid });
    ok(backend + ': top frame is fact() line 4', /fact/.test(stack.stackFrames[0].name) && stack.stackFrames[0].line === 4, JSON.stringify(stack.stackFrames.slice(0, 3)));
    await client.req('continue', { threadId: tid }); st = await client.waitEvent('stopped');
    await client.req('continue', { threadId: tid }); st = await client.waitEvent('stopped');
    stack = await client.req('stackTrace', { threadId: tid });
    const user = stack.stackFrames.filter(f => /^(fact|main)\b/.test(f.name));
    ok(backend + ': recursion depth 4 (fact×3 + main)', user.length === 4, JSON.stringify(stack.stackFrames.map(f => f.name + ':' + f.line)));
    let scopes = await client.req('scopes', { frameId: stack.stackFrames[0].id });
    let vars = await client.req('variables', { variablesReference: scopes.scopes[0].variablesReference });
    const n = vars.variables.find(v => v.name === 'n');
    ok(backend + ': local n = 1 in the deepest frame', n && n.value === '1', JSON.stringify(vars.variables));
    await client.req('setBreakpoints', { source: { path: file }, breakpoints: [{ line: 12 }] });
    await client.req('continue', { threadId: tid });
    st = await client.waitEvent('stopped');
    stack = await client.req('stackTrace', { threadId: tid });
    ok(backend + ': moved breakpoint → stops in main line 12', /main/.test(stack.stackFrames[0].name) && stack.stackFrames[0].line === 12, JSON.stringify(stack.stackFrames[0]));
    scopes = await client.req('scopes', { frameId: stack.stackFrames[0].id });
    vars = await client.req('variables', { variablesReference: scopes.scopes[0].variablesReference });
    const get = nm => vars.variables.find(v => v.name === nm);
    ok(backend + ': x = 6', get('x') && get('x').value === '6', JSON.stringify(vars.variables));
    const a = get('a');
    // gdb adapter poori value dikhata hai; Apple ka lldb-dap "int[3] @ 0x…" summary — dono expandable
    ok(backend + ': array a ' + (backend === 'gdb' ? 'shows {5, 2, 9} and ' : '') + 'is expandable', a && (backend !== 'gdb' || /5,\s*2,\s*9/.test(a.value)) && a.variablesReference > 0, JSON.stringify(a));
    if (a && a.variablesReference) {
      const kids = await client.req('variables', { variablesReference: a.variablesReference });
      ok(backend + ': a[2] = 9 when expanded', kids.variables.some(k => /\[?2\]?/.test(k.name) && k.value === '9'), JSON.stringify(kids.variables));
    }
    const p = get('p');
    if (p && p.variablesReference) {
      const kids = await client.req('variables', { variablesReference: p.variablesReference });
      ok(backend + ': struct p expands to x=3, y=4', kids.variables.some(k => k.name === 'x' && k.value === '3') && kids.variables.some(k => k.name === 'y' && k.value === '4'), JSON.stringify(kids.variables));
    } else ok(backend + ': struct p is expandable', false, JSON.stringify(p));
    const ev = await client.req('evaluate', { expression: 'a[2] * 2', frameId: stack.stackFrames[0].id, context: 'watch' });
    ok(backend + ': watch "a[2] * 2" = 18', ev.result === '18', JSON.stringify(ev));
    await client.req('next', { threadId: tid });
    await client.waitEvent('stopped');
    await client.req('continue', { threadId: tid });
    const ex = await client.waitEvent('exited');
    ok(backend + ': program output "x=6" reached the debug console', client.outputs.join('').includes('x=6'), JSON.stringify(client.outputs.join('').slice(-300)));
    ok(backend + ': exit code 14 (6 + 5 + 3)', ex.body.exitCode === 14, JSON.stringify(ex.body));
    await client.waitEvent('terminated');
  } catch (e) { ok(backend + ': session completed', false, e.stack); }
  client.t.close();

  // step in / step out from main, stop at entry
  {
    let c2, args2;
    if (backend === 'gdb') { const s = new GdbDebugSession(); c2 = new Client(inlineTransport(s)); args2 = { program: bin, cwd: dir, gdbPath: 'gdb', console: 'internal', stopAtEntry: true }; }
    else { c2 = new Client(processTransport(findLldbDap(), [])); args2 = { program: bin, cwd: dir, stopOnEntry: false }; }
    try {
      await c2.req('initialize', { adapterID: 'prabha', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
      const l = c2.req('launch', args2);
      await c2.waitEvent('initialized');
      await c2.req('setBreakpoints', { source: { path: file }, breakpoints: backend === 'gdb' ? [] : [{ line: 11 }] });
      await c2.req('configurationDone'); await l;
      let st = await c2.waitEvent('stopped');
      const T = st.body.threadId || 1;
      if (backend === 'gdb') ok('gdb: stop at entry (main)', st.body.reason === 'entry', JSON.stringify(st.body));
      // main ki line 11 (int x = fact(3)) tak aao
      for (let i = 0; i < 4; i++) {
        const s = await c2.req('stackTrace', { threadId: T });
        if (s.stackFrames[0].line === 11) break;
        await c2.req('next', { threadId: T }); await c2.waitEvent('stopped');
      }
      await c2.req('stepIn', { threadId: T }); await c2.waitEvent('stopped');
      let s = await c2.req('stackTrace', { threadId: T });
      ok(backend + ': step into fact()', /fact/.test(s.stackFrames[0].name), JSON.stringify(s.stackFrames[0]));
      await c2.req('stepOut', { threadId: T }); await c2.waitEvent('stopped');
      s = await c2.req('stackTrace', { threadId: T });
      ok(backend + ': step out back to main', /main/.test(s.stackFrames[0].name), JSON.stringify(s.stackFrames[0]));
      await c2.req('disconnect', { terminateDebuggee: true }).catch(() => null);
    } catch (e) { ok(backend + ': step session', false, e.stack); }
    c2.t.close();
  }

  // crash
  {
    const cf = path.join(dir, 'crash.c'), cbin = path.join(dir, 'crash' + (win ? '.exe' : ''));
    fs.writeFileSync(cf, CRASH);
    cp.spawnSync(['gcc', 'clang', 'cc'].find(has), ['-g', '-O0', cf, '-o', cbin]);
    let c3, args3;
    if (backend === 'gdb') { c3 = new Client(inlineTransport(new GdbDebugSession())); args3 = { program: cbin, cwd: dir, gdbPath: 'gdb', console: 'internal' }; }
    else { c3 = new Client(processTransport(findLldbDap(), [])); args3 = { program: cbin, cwd: dir }; }
    try {
      await c3.req('initialize', { adapterID: 'prabha', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
      const l = c3.req('launch', args3);
      await c3.waitEvent('initialized');
      await c3.req('configurationDone'); await l;
      const st = await c3.waitEvent('stopped');
      const s = await c3.req('stackTrace', { threadId: st.body.threadId || 1 });
      ok(backend + ': crash stops on the faulting line 5', st.body.reason === 'exception' && s.stackFrames[0].line === 5, JSON.stringify(st.body) + ' ' + JSON.stringify(s.stackFrames[0]));
      if (backend === 'gdb') ok('gdb: crash explained in Hinglish (Segmentation fault + Fix)', /Segmentation fault/.test(st.body.description || '') && /Fix/.test(c3.outputs.join('')), JSON.stringify(st.body));
      await c3.req('disconnect', { terminateDebuggee: true }).catch(() => null);
    } catch (e) { ok(backend + ': crash session', false, e.stack); }
    c3.t.close();
  }
  // Windows: gdb/program ke band hone tak folder locked rehta hai — retry, aur fail ho to chhod do
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 }); } catch { /* temp folder, OS saaf karega */ }
}

async function gdbGoneRegression() {
  console.log('\n[debug] gdb exits under the adapter');
  const s = new GdbDebugSession();
  s.emit = () => {};
  s.start('gdb');
  await new Promise(r => setTimeout(r, 300));
  s.gdb.kill('SIGKILL');
  await new Promise(r => s.gdb.on('exit', r));
  let rejected = false;
  try { await s.mi('-exec-next'); } catch { rejected = true; }
  try { await s.mi('-stack-list-frames'); } catch { rejected = rejected && true; }
  s.kill();
  await new Promise(r => setTimeout(r, 200));
  ok('commands after gdb died are rejected, no uncaught EPIPE', rejected);
}

(async () => {
  const want = process.argv[2];
  if ((!want || want === 'gdb') && has('gdb')) await gdbGoneRegression();
  if ((!want || want === 'gdb') && has('gdb')) { console.log('\n[debug] PRABHA gdb adapter'); await scenario('gdb'); }
  else if (!want || want === 'gdb') console.log('  - gdb not installed: skipped');
  if ((!want || want === 'lldb') && findLldbDap()) { console.log('\n[debug] lldb-dap (macOS path)'); await scenario('lldb'); }
  else if (!want || want === 'lldb') console.log('  - lldb-dap not found: skipped');
  console.log(`\n${pass} passed, ${fail} failed`);
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
})();
