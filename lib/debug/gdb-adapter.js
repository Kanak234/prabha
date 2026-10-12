/*
 * lib/debug/gdb-adapter.js — PRABHA ka apna debug adapter.
 *
 * WHY:   Dev-C++ / Turbo C++ jaisa debugging (breakpoint, F7/F8 step, variables)
 *        VS Code ke Debug panel mein — bina Microsoft C/C++ extension, bina
 *        launch.json, bina koi setup. VS Code "DAP" (Debug Adapter Protocol) bolta
 *        hai, gdb "MI" bolta hai; ye class beech ka translator hai.
 * WHAT:  GdbDebugSession — DAP request lo → gdb/MI command bhejo → MI jawab/event
 *        → DAP response/event. Pure Node (vscode import nahi): VS Code ise
 *        DebugAdapterInlineImplementation se chalata hai, tests seedha.
 * FLOW:  VS Code Debug UI ⇄ handleMessage()/onDidSendMessage ⇄ GdbDebugSession
 *        ⇄ gdb --interpreter=mi2 ⇄ student ka program
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRecord, q } = require('./mi');
const { explainExit } = require('../crash');

const THREAD = 1;

class GdbDebugSession {
  constructor(opts = {}) {
    this.opts = opts;
    this.listeners = [];
    this.seq = 1;
    this.token = 1;
    this.pending = new Map();      // MI token → {resolve, reject}
    this.reverse = new Map();      // reverse request seq → resolve
    this.gdb = null;
    this.buf = '';
    this.breakpoints = new Map();  // file path → [gdb bkpt numbers]
    this.vars = new Map();         // variablesReference → {kind, frame?, varobj?}
    this.nextRef = 1;
    this.varobjs = [];
    this.args = null;
    this.exited = false;
    this.started = false;
    this.lastStop = null;
    this.tempMainBp = null;
  }

  /* ── VS Code DebugAdapter interface ── */
  onDidSendMessage(listener) { this.listeners.push(listener); return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } }; }
  emit(msg) { msg.seq = this.seq++; for (const l of this.listeners) l(msg); }
  event(event, body) { this.emit({ type: 'event', event, body }); }
  respond(req, body, err) {
    this.emit({ type: 'response', request_seq: req.seq, command: req.command, success: !err, message: err ? String(err.message || err) : undefined, body: body || {} });
  }
  output(text, category = 'console') { this.event('output', { category, output: text }); }

  handleMessage(msg) {
    if (msg.type === 'response') { const r = this.reverse.get(msg.request_seq); if (r) { this.reverse.delete(msg.request_seq); r(msg); } return; }
    if (msg.type !== 'request') return;
    const fn = this['on_' + msg.command];
    if (!fn) { this.respond(msg, {}, new Error('PRABHA debugger: "' + msg.command + '" supported nahi hai')); return; }
    Promise.resolve().then(() => fn.call(this, msg, msg.arguments || {}))
      .then(body => { if (body !== undefined) this.respond(msg, body); })
      .catch(e => this.respond(msg, {}, e));
  }

  dispose() { this.kill(); }

  /** Client (VS Code) se reverse request — jaise runInTerminal */
  request(command, args) {
    return new Promise(res => {
      const seq = this.seq;
      this.reverse.set(seq, res);
      this.emit({ type: 'request', command, arguments: args });
    });
  }

  /* ── gdb process ── */
  mi(cmd) {
    if (!this.gdb || this.exited && /exec-(next|step|continue|finish)/.test(cmd)) return Promise.reject(new Error('program chal nahi raha'));
    if (!this.gdb.stdin.writable || this.gdb.exitCode !== null) return Promise.reject(new Error('gdb band ho gaya'));
    const t = this.token++;
    if (this.opts.trace) this.opts.trace('→ ' + t + cmd);
    return new Promise((resolve, reject) => {
      this.pending.set(t, { resolve, reject, cmd });
      try { this.gdb.stdin.write(t + cmd + '\n'); } catch (e) { this.pending.delete(t); reject(e); }
    });
  }

  onLine(line) {
    if (this.opts.trace) this.opts.trace('← ' + line);
    const r = parseRecord(line);
    if (!r) {
      // program ka apna output (internal console mode) — `(gdb)` prompt chhod kar
      if (line && !/^\(gdb\)\s*$/.test(line)) this.output(line + '\n', 'stdout');
      return;
    }
    if (r.kind === 'result' && r.token !== null && this.pending.has(r.token)) {
      const p = this.pending.get(r.token); this.pending.delete(r.token);
      if (r.cls === 'error') p.reject(new Error(friendlyMiError(r.results.msg || 'gdb error', p.cmd)));
      else p.resolve(r);
      return;
    }
    if (r.kind === 'exec' && r.cls === 'stopped') { this.onStopped(r.results).catch(e => this.output('[PRABHA] ' + e.message + '\n')); return; }
    if (r.kind === 'exec' && r.cls === 'running') { this.event('continued', { threadId: THREAD, allThreadsContinued: true }); return; }
    if (r.kind === 'stream') {
      if (r.stream === 'target') this.output(r.text, 'stdout');
      else if (r.stream === 'console' && this.consoleCapture) this.consoleCapture.push(r.text);
      else if (r.stream === 'log' && this.opts.trace) this.opts.trace('log: ' + r.text);
    }
  }

  start(gdbPath, env) {
    this.gdb = cp.spawn(gdbPath, ['--interpreter=mi2', '-q', '-nx'], { env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.gdb.stdout.setEncoding('utf8');
    this.gdb.stdout.on('data', d => {
      this.buf += d;
      let nl;
      while ((nl = this.buf.indexOf('\n')) !== -1) { const line = this.buf.slice(0, nl).replace(/\r$/, ''); this.buf = this.buf.slice(nl + 1); this.onLine(line); }
    });
    this.gdb.stderr.on('data', d => this.output(d.toString(), 'stderr'));
    // gdb band hone ke baad likha gaya command async 'error' (EPIPE) deta hai. Handler
    // na ho to Node use uncaught exception bana deta hai — VS Code mein poora extension
    // host gir jaata (Windows CI ne pakda). Pending commands 'exit' handler reject karta hai.
    this.gdb.stdin.on('error', e => { if (this.opts.trace) this.opts.trace('gdb stdin: ' + e.message); });
    this.gdb.on('error', e => { this.output('[PRABHA] gdb start nahi hua: ' + e.message + '\n', 'stderr'); this.finish(null); });
    this.gdb.on('exit', () => { for (const p of this.pending.values()) p.reject(new Error('gdb band ho gaya')); this.pending.clear(); this.finish(null); });
  }

  kill() {
    if (this.ttyPidFile) { try { const pid = Number(fs.readFileSync(this.ttyPidFile, 'utf8')); if (pid) process.kill(pid); } catch { /* */ } }
    if (!this.gdb) return;
    try { if (this.gdb.stdin.writable) this.gdb.stdin.write('-gdb-exit\n'); } catch { /* */ }
    const g = this.gdb;
    setTimeout(() => { try { g.kill('SIGKILL'); } catch { /* */ } }, 800);
  }

  finish(exitCode) {
    if (this.finished) return;
    this.finished = true;
    this.exited = true;
    if (exitCode !== null && exitCode !== undefined) this.event('exited', { exitCode });
    this.event('terminated', {});
  }

  /* ── DAP requests ── */
  on_initialize() {
    return {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsTerminateRequest: true,
      supportsSetVariable: true,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: false,
      supportsRestartRequest: false,
      supportsSteppingGranularity: false,
      exceptionBreakpointFilters: []
    };
  }

  async on_launch(req, a) {
    this.args = a;
    if (!a.program || !fs.existsSync(a.program)) throw new Error('Program nahi mila: ' + a.program);
    this.start(a.gdbPath || 'gdb', a.env);
    const ok = c => this.mi(c).catch(() => null);
    await ok('-gdb-set confirm off');
    await ok('-gdb-set pagination off');
    await ok('-gdb-set print pretty off');
    await ok('-gdb-set mi-async on');
    await ok('-enable-pretty-printing');                         // std::string / vector sahi dikhte hain
    await ok('-gdb-set disassemble-next-line off');
    await this.mi('-file-exec-and-symbols ' + q(a.program));
    if (a.cwd) await ok('-environment-cd ' + q(a.cwd));
    if (a.env && a.env.PRABHA_PROTO_FD) await ok('-gdb-set environment PRABHA_PROTO_FD=' + a.env.PRABHA_PROTO_FD);

    const mode = a.console || 'internal';
    if (process.platform === 'win32' && mode !== 'internal') {
      await ok('-gdb-set new-console on');                       // Dev-C++ jaisa alag console window
    } else if (mode === 'integratedTerminal') {
      const tty = await this.makeTerminal(a.cwd);
      if (tty) await ok('-inferior-tty-set ' + tty);
      else this.output('[PRABHA] terminal nahi mila — program ka input/output Debug Console mein aayega.\n');
    }
    if (mode === 'internal' && a.stdinFile && fs.existsSync(a.stdinFile)) await ok('-exec-arguments < ' + q(a.stdinFile));
    this.event('initialized', {});
    return {};
  }

  /** Linux/macOS: VS Code terminal kholo, uska tty gdb ko do (program wahan input/output karega) */
  async makeTerminal(cwd) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-tty-'));
    const ttyFile = path.join(dir, 'tty'), pidFile = path.join(dir, 'pid');
    this.ttyPidFile = pidFile;
    const script = 'echo $$ > ' + shq(pidFile) + '; tty > ' + shq(ttyFile) + '; clear; trap "" INT; while :; do sleep 3600; done';
    const resp = await Promise.race([
      this.request('runInTerminal', { kind: 'integrated', title: 'PRABHA · program', cwd: cwd || os.homedir(), args: ['/bin/sh', '-c', script] }),
      new Promise(r => setTimeout(() => r(null), 8000))
    ]);
    if (!resp || !resp.success) return null;
    for (let i = 0; i < 100; i++) {
      try { const t = fs.readFileSync(ttyFile, 'utf8').trim(); if (/^\/dev\//.test(t)) return t; } catch { /* abhi nahi bana */ }
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  async on_setBreakpoints(req, a) {
    const file = a.source && a.source.path;
    const old = this.breakpoints.get(file) || [];
    if (old.length) await this.mi('-break-delete ' + old.join(' ')).catch(() => null);
    const nums = [], out = [];
    for (const bp of a.breakpoints || []) {
      // basename:line — single-file programs ke liye sabse bharosemand (symlink /tmp, drive letters…)
      const loc = path.basename(file) + ':' + bp.line;
      try {
        const cond = bp.condition ? ' -c ' + q(bp.condition) : '';
        const r = await this.mi('-break-insert -f' + cond + ' ' + q(loc));
        const b = r.results.bkpt || {};
        nums.push(b.number);
        out.push({ id: Number(b.number), verified: !!b.line || b.pending === undefined, line: b.line ? Number(b.line) : bp.line });
      } catch (e) {
        out.push({ verified: false, line: bp.line, message: e.message });
      }
    }
    this.breakpoints.set(file, nums);
    return { breakpoints: out };
  }

  on_setExceptionBreakpoints() { return {}; }

  async on_configurationDone() {
    if (this.args.stopAtEntry) {
      const r = await this.mi('-break-insert -t main').catch(() => null);
      this.tempMainBp = r && r.results.bkpt && r.results.bkpt.number;
    }
    this.started = true;
    await this.mi('-exec-run');
    return {};
  }

  on_threads() { return { threads: [{ id: THREAD, name: 'main' }] }; }

  async onStopped(r) {
    await this.clearVarobjs();
    const reason = r.reason || '';
    if (/^exited/.test(reason)) {
      const code = r['exit-code'] !== undefined ? parseInt(r['exit-code'], 8) : 0;  // MI exit-code octal hota hai
      if (reason === 'exited-signalled') {
        const why = explainExit({ signal: r['signal-name'] });
        if (why) this.output('\n✖ ' + why.title + '\n  ' + why.why + '\n  Fix: ' + why.fix + '\n', 'stderr');
      }
      this.output('\n[PRABHA] Program khatam — return value ' + code + '\n');
      this.finish(code);
      this.kill();
      return;
    }
    let dapReason = 'pause', description, text;
    if (reason === 'breakpoint-hit') dapReason = (r.disp === 'del' || r.bkptno === this.tempMainBp) ? 'entry' : 'breakpoint';
    else if (reason === 'end-stepping-range' || reason === 'function-finished' || reason === 'location-reached') dapReason = 'step';
    else if (reason === 'signal-received') {
      dapReason = 'exception';
      const why = explainExit({ signal: r['signal-name'] });
      description = why ? why.title : (r['signal-meaning'] || r['signal-name']);
      text = why ? why.why + ' Fix: ' + why.fix : '';
      this.output('\n✖ ' + description + '\n  ' + text + '\n  (Program us line par ruka hai jahan crash hua — Call Stack aur Variables dekho.)\n', 'stderr');
    }
    this.lastStop = r;
    this.event('stopped', { reason: dapReason, threadId: THREAD, allThreadsStopped: true, description, text });
  }

  async on_stackTrace(req, a) {
    const r = await this.mi('-stack-list-frames --thread ' + THREAD);
    const frames = (r.results.stack || []).map(x => x.frame || x);
    const start = a.startFrame || 0, levels = a.levels || frames.length;
    const out = frames.slice(start, start + levels).map(f => {
      const level = Number(f.level);
      const file = f.fullname || f.file;
      const userCode = !!f.line && !!file;
      return {
        id: level + 1,
        name: (f.func || '??') + (userCode ? '' : ' [library]'),
        line: f.line ? Number(f.line) : 0,
        column: 1,
        source: userCode ? { name: path.basename(file), path: this.mapPath(file) } : undefined,
        presentationHint: userCode ? 'normal' : 'subtle'
      };
    });
    return { stackFrames: out, totalFrames: frames.length };
  }

  /** debug info ka path → user file (Turbo mode temp copy ke liye) */
  mapPath(p) {
    const m = this.args && this.args.sourceMap;
    if (m && m.from && path.resolve(p) === path.resolve(m.from)) return m.to;
    if (m && m.from && path.basename(p) === path.basename(m.from) && m.to) return m.to;
    return p;
  }

  on_scopes(req, a) {
    const ref = this.nextRef++;
    this.vars.set(ref, { kind: 'locals', frame: a.frameId - 1 });
    return { scopes: [{ name: 'Locals', variablesReference: ref, expensive: false, presentationHint: 'locals' }] };
  }

  async on_variables(req, a) {
    const v = this.vars.get(a.variablesReference);
    if (!v) return { variables: [] };
    if (v.kind === 'locals') {
      const r = await this.mi('-stack-list-variables --thread ' + THREAD + ' --frame ' + v.frame + ' --simple-values');
      const out = [];
      for (const item of r.results.variables || []) {
        const name = item.name;
        if (item.value !== undefined) {
          // simple value; pointer bhi simple hota hai par expand ho sakta hai
          const expandable = /\*\s*$/.test(item.type || '') && !/char\s*\*/.test(item.type || '') && item.value !== '0x0';
          out.push({ name, value: tidy(item.value), type: item.type, variablesReference: expandable ? await this.varobjRef(name, v.frame) : 0, evaluateName: name });
        } else {
          // array / struct / class → varobj se children
          const ref = await this.varobjRef(name, v.frame);
          const full = await this.mi('-data-evaluate-expression --thread ' + THREAD + ' --frame ' + v.frame + ' ' + q(name)).then(x => x.results.value).catch(() => '{…}');
          out.push({ name, value: tidy(full), type: item.type, variablesReference: ref, evaluateName: name });
        }
      }
      return { variables: out };
    }
    if (v.kind === 'varobj') {
      const children = await this.listChildren(v.varobj);
      const out = [];
      for (const c of children) {
        const num = Number(c.numchild || 0);
        let ref = 0;
        if (num > 0) { ref = this.nextRef++; this.vars.set(ref, { kind: 'varobj', varobj: c.name }); }
        const label = /^\d+$/.test(c.exp) ? '[' + c.exp + ']' : c.exp;
        out.push({ name: label, value: tidy(c.value !== undefined ? c.value : (num ? '{…}' : '')), type: c.type, variablesReference: ref });
      }
      return { variables: out };
    }
    return { variables: [] };
  }

  async varobjRef(expr, frame) {
    try {
      const r = await this.mi('-var-create --thread ' + THREAD + ' --frame ' + frame + ' - * ' + q(expr));
      this.varobjs.push(r.results.name);
      if (Number(r.results.numchild || 0) === 0 && !r.results.dynamic) return 0;
      const ref = this.nextRef++;
      this.vars.set(ref, { kind: 'varobj', varobj: r.results.name });
      return ref;
    } catch { return 0; }
  }

  /** C++ class ke "public/private" pseudo-children ko flatten karo */
  async listChildren(varobj) {
    const r = await this.mi('-var-list-children --all-values ' + q(varobj) + ' 0 200');
    const kids = (r.results.children || []).map(x => x.child || x);
    const out = [];
    for (const k of kids) {
      if (/^(public|private|protected)$/.test(k.exp) && !k.type) out.push(...await this.listChildren(k.name));
      else out.push(k);
    }
    return out;
  }

  async clearVarobjs() {
    const list = this.varobjs; this.varobjs = [];
    this.vars.clear();
    for (const n of list) await this.mi('-var-delete ' + q(n)).catch(() => null);
  }

  async on_evaluate(req, a) {
    const frame = a.frameId ? a.frameId - 1 : 0;
    if (a.context === 'repl' && /^-exec\s+/.test(a.expression)) {
      // Debug Console mein seedha gdb command: "-exec info locals"
      this.consoleCapture = [];
      await this.mi('-interpreter-exec console ' + q(a.expression.replace(/^-exec\s+/, '')));
      const text = this.consoleCapture.join(''); this.consoleCapture = null;
      return { result: text.trimEnd(), variablesReference: 0 };
    }
    const r = await this.mi('-data-evaluate-expression --thread ' + THREAD + ' --frame ' + frame + ' ' + q(a.expression));
    const ref = await this.varobjRef(a.expression, frame);
    return { result: tidy(r.results.value), variablesReference: ref };
  }

  async on_setVariable(req, a) {
    const v = this.vars.get(a.variablesReference);
    const frame = v && v.frame !== undefined ? v.frame : 0;
    const expr = v && v.kind === 'varobj' ? null : a.name;
    if (!expr) throw new Error('Is variable ko yahan se badla nahi ja sakta');
    const r = await this.mi('-data-evaluate-expression --thread ' + THREAD + ' --frame ' + frame + ' ' + q(expr + ' = ' + a.value));
    return { value: tidy(r.results.value) };
  }

  async resume(cmd) {
    await this.clearVarobjs();
    await this.mi(cmd + ' --thread ' + THREAD);
    return { allThreadsContinued: true };
  }
  on_continue() { return this.resume('-exec-continue'); }
  on_next() { return this.resume('-exec-next'); }
  on_stepIn() { return this.resume('-exec-step'); }
  async on_stepOut() {
    try { return await this.resume('-exec-finish'); }
    catch (e) {
      // main se bahar step-out ka matlab nahi — Turbo C ki tarah agli line par chalo
      if (/outermost/.test(e.message)) return this.resume('-exec-next');
      throw e;
    }
  }
  async on_pause() { await this.mi('-exec-interrupt --all').catch(() => this.mi('-exec-interrupt')); return {}; }
  async on_terminate() { this.finish(null); this.kill(); return {}; }
  async on_disconnect() { this.finish(null); this.kill(); return {}; }
}

function tidy(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}

function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

function friendlyMiError(msg, cmd) {
  if (/No symbol "([^"]+)" in current context/.test(msg)) return '"' + RegExp.$1 + '" naam ka variable is jagah nahi hai';
  if (/not meaningful in the outermost frame/.test(msg)) return 'outermost: main se bahar step out nahi ho sakta';
  if (/No executable file specified|No such file/.test(msg)) return 'Program file nahi mili';
  if (/Cannot access memory at address/.test(msg)) return 'Is pointer par valid memory nahi hai (' + msg + ')';
  void cmd;
  return msg;
}

module.exports = { GdbDebugSession };
