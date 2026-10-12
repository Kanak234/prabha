/*
 * lib/console-core.js — PRABHA Console ka dimaag (VS Code Pseudoterminal isko
 * bas screen ki tarah use karta hai).
 *
 * WHY:   Dev-C++ jaisa console: program chalo, input do, end mein
 *        "Process exited after 0.42 s with return value 0" aur "Press any key".
 *        Crash ho to Hinglish mein wajah. Ye sab PRABHA ka apna hai — kisi
 *        "Code Runner" ya bahar ke terminal par depend nahi.
 * WHAT:  ConsoleSession — child process chalata hai, keystrokes ko line-by-line
 *        (echo + backspace ke saath) program ke stdin mein bhejta hai, output ko
 *        terminal format (\r\n) mein likhta hai.
 * NOTE:  `vscode` import nahi — tests seedha Node mein chalate hain
 *        (tests/console-test.js), extension.js isse Pseudoterminal se jodta hai.
 * FLOW:  extension.js runConsole() → new ConsoleSession({...}).start(bin)
 *        → terminal.handleInput → session.input(data) → child.stdin
 */
'use strict';

const cp = require('child_process');
const { explainExit, exitLine } = require('./crash');

const C = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };

class ConsoleSession {
  /**
   * @param {{write:(s:string)=>void, close:(code?:number)=>void, spawn?:Function,
   *          env?:object, cwd?:string, timeoutSec?:number, platform?:string}} o
   */
  constructor(o) {
    this.o = o;
    this.child = null;
    this.line = '';            // jo user abhi type kar raha hai (Enter se pehle)
    this.finished = false;
    this.started = 0;
    this.result = null;
  }

  /** Terminal par likho — "\n" ko "\r\n" (terminal ko carriage return chahiye) */
  out(s) { this.o.write(String(s).replace(/\r?\n/g, '\r\n')); }

  start(cmd, args = []) {
    const spawn = this.o.spawn || cp.spawn;
    this.started = Date.now();
    this.child = spawn(cmd, args, { cwd: this.o.cwd, env: this.o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', d => this.out(d.toString('utf8')));
    this.child.stderr.on('data', d => this.out(C.red + d.toString('utf8') + C.reset));
    this.child.stdin.on('error', () => { /* program ne stdin band kar diya — theek hai */ });
    this.child.on('error', e => this.done({ code: null, signal: null, error: e.message }));
    this.child.on('close', (code, signal) => this.done({ code, signal }));
    if (this.o.timeoutSec > 0) {
      this.timer = setTimeout(() => {
        if (this.finished) return;
        this.out('\n' + C.yellow + '[PRABHA] ' + this.o.timeoutSec + ' second se zyada chala — infinite loop? Program roka gaya.' + C.reset + '\n');
        this.kill();
      }, this.o.timeoutSec * 1000);
    }
    return this;
  }

  /** VS Code se aaye keystrokes (ek key ya paste kiya hua text) */
  input(data) {
    if (this.finished) { this.o.close(this.result ? this.result.code : 0); return; }   // "Press any key"
    for (const ch of String(data)) {
      if (ch === '\x03') { this.out('^C\n'); this.kill(); return; }               // Ctrl+C
      if (ch === '\x04' || ch === '\x1a') {                                        // Ctrl+D / Ctrl+Z = input khatam
        if (this.line) { this.send(this.line); this.line = ''; }
        try { this.child.stdin.end(); } catch { /* */ }
        continue;
      }
      if (ch === '\r' || ch === '\n') { this.out('\n'); this.send(this.line + '\n'); this.line = ''; continue; }
      if (ch === '\x7f' || ch === '\b') {                                          // Backspace
        if (this.line.length) { this.line = [...this.line].slice(0, -1).join(''); this.o.write('\b \b'); }
        continue;
      }
      if (ch === '\x1b') continue;                                                // arrow keys etc. ignore
      if (ch < ' ' && ch !== '\t') continue;
      this.line += ch;
      this.o.write(ch);                                                           // echo (pipe khud echo nahi karta)
    }
  }

  send(text) { try { this.child.stdin.write(text); } catch { /* closed */ } }

  kill() {
    if (!this.child || this.finished) return;
    try {
      if (process.platform === 'win32') cp.spawn('taskkill', ['/pid', String(this.child.pid), '/f', '/t']);
      else this.child.kill('SIGKILL');
    } catch { /* already gone */ }
  }

  done(r) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.result = r;
    const secs = (Date.now() - this.started) / 1000;
    this.out('\n' + C.dim + '────────────────────────────────────────' + C.reset + '\n');
    if (r.error) {
      this.out(C.red + '[PRABHA] Program start nahi ho saka: ' + r.error + C.reset + '\n');
    } else {
      const ok = r.code === 0 && !r.signal;
      this.out((ok ? C.green : C.yellow) + exitLine(r, secs) + C.reset + '\n');
      const why = explainExit({ code: r.code, signal: r.signal, platform: this.o.platform || process.platform });
      if (why) {
        this.out(C.red + C.bold + '✖ ' + why.title + C.reset + '\n');
        if (why.why) this.out('  ' + why.why + '\n');
        if (why.fix) this.out(C.cyan + '  Fix: ' + why.fix + C.reset + '\n');
      }
    }
    this.out(C.dim + 'Press any key to close this window . . .' + C.reset);
    if (this.o.onDone) this.o.onDone(r, secs);
  }
}

module.exports = { ConsoleSession };
