/*
 * lib/crash.js — program crash hone par "exit code 139" ya "3221225477" ki jagah
 * student ko samajh aane wali baat batana.
 *
 * WHY:   Dev-C++ / Turbo C++ mein program crash ho to bas ek ajeeb number dikhta
 *        hai. Beginner ko pata hi nahi chalta ki array ke bahar likha ya 0 se divide
 *        kiya. PRABHA wajah + aksar hone wali galti + fix batata hai.
 * WHAT:  explainExit({code, signal, platform}) → null (normal exit) ya
 *        { title, why, fix } — Hinglish.
 * FLOW:  extension.js (panel run) / console-core.js (console run) / gdb-adapter.js
 *        (debugger "signal-received") → explainExit() → user ko message
 */
'use strict';

/* Linux/macOS signal → explanation */
const SIGNALS = {
  SIGSEGV: {
    title: 'Segmentation fault — program ne memory ki galat jagah chhui',
    why: 'Aksar wajah: array ki size se bahar index (arr[10] jab size 10 hai), uninitialized ya NULL pointer ko use karna, ya `scanf("%d", x)` mein `&` bhoolna.',
    fix: 'Loop ki condition `i < n` check karo (`<=` nahi), pointer ko use se pehle valid address do, scanf mein `&x` likho. Debugger (F5) se chala kar dekho program kis line par ruka.'
  },
  SIGFPE: {
    title: 'Arithmetic error — aksar 0 se divide (integer)',
    why: 'Integer ko 0 se divide ya `%` 0 se karne par CPU program rok deta hai. Float mein 0 se divide karne par `inf` aata hai, crash nahi.',
    fix: 'Divide karne se pehle check karo: `if (b != 0) c = a / b;`.'
  },
  SIGABRT: {
    title: 'Program ne khud abort kiya',
    why: 'Aksar `assert()` fail hua, memory do baar `free`/`delete` hui, ya C++ exception kisi ne catch nahi ki ("terminate called after throwing…").',
    fix: 'Upar Output mein aakhri error message padho; exception ho to `try { … } catch (…)` lagao.'
  },
  SIGBUS: {
    title: 'Bus error — galat (misaligned ya missing) memory access',
    why: 'Pointer kisi galat address par point kar raha hai — aksar dangling pointer ya galat cast.',
    fix: 'Pointer kahan se aaya, use check karo. Debugger se crash wali line dekho.'
  },
  SIGILL: {
    title: 'Illegal instruction',
    why: 'Function se value return nahi hui jahan return type `int` tha (C++ mein ye undefined behaviour hai aur crash de sakta hai), ya memory kharab ho gayi.',
    fix: 'Har non-void function ke har raaste mein `return` lagao. Compiler warnings (Problems tab) padho.'
  },
  SIGKILL: { title: 'Program ko roka gaya (stop / time limit)', why: 'Stop dabaya gaya ya program time limit se zyada chala.', fix: 'Infinite loop to nahi? Loop variable badal raha hai ya nahi, check karo.' },
  SIGTERM: { title: 'Program ko roka gaya', why: 'Stop dabaya gaya.', fix: '' },
  SIGINT: { title: 'Ctrl+C se roka gaya', why: '', fix: '' },
  SIGPIPE: { title: 'Output band pipe par likha gaya', why: 'Program ka output padhne wala band ho chuka tha.', fix: '' }
};

/* Windows NTSTATUS (process exit code) → signal jaisa naam */
const NTSTATUS = {
  0xC0000005: 'SIGSEGV',   // STATUS_ACCESS_VIOLATION
  0xC0000094: 'SIGFPE',    // STATUS_INTEGER_DIVIDE_BY_ZERO
  0xC0000095: 'SIGFPE',    // STATUS_INTEGER_OVERFLOW
  0xC000008E: 'SIGFPE',    // STATUS_FLOAT_DIVIDE_BY_ZERO
  0xC000001D: 'SIGILL',    // STATUS_ILLEGAL_INSTRUCTION
  0xC0000409: 'SIGABRT',   // STATUS_STACK_BUFFER_OVERRUN (also __fastfail / abort)
  0xC0000374: 'SIGABRT',   // STATUS_HEAP_CORRUPTION
  0xC00000FD: 'STACK',     // STATUS_STACK_OVERFLOW
  0xC000013A: 'SIGINT',    // STATUS_CONTROL_C_EXIT
  0xC0000135: 'DLL',       // STATUS_DLL_NOT_FOUND
  0xC0000139: 'DLL'        // STATUS_ENTRYPOINT_NOT_FOUND
};

const EXTRA = {
  STACK: {
    title: 'Stack overflow — recursion kabhi ruki nahi (ya bahut bada local array)',
    why: 'Function apne aap ko baar-baar call kar raha hai aur base case kabhi true nahi hota, ya function ke andar `int a[1000000];` jaisa bahut bada array hai.',
    fix: 'Recursion ka base case (`if (n == 0) return …;`) check karo. Bade array ko `static` ya global banao, ya `std::vector` use karo.'
  },
  DLL: {
    title: 'Zaroori DLL nahi mili',
    why: 'Program kisi library (DLL) par depend karta hai jo is PC par nahi hai.',
    fix: 'PRABHA programs ko `-static` link karta hai; ye error aaye to "PRABHA: Install / Choose Compiler" se PRABHA ka apna GCC use karo.'
  }
};

/* Linux shell style: 128 + signal number (jab program shell ke through chale) */
const SHELL_SIG = { 134: 'SIGABRT', 135: 'SIGBUS', 136: 'SIGFPE', 132: 'SIGILL', 137: 'SIGKILL', 139: 'SIGSEGV', 143: 'SIGTERM', 130: 'SIGINT' };

/**
 * @param {{code?: number|null, signal?: string|null, platform?: string, viaShell?: boolean}} r
 * @returns {null | {name:string, title:string, why:string, fix:string}}
 */
function explainExit(r) {
  const platform = r.platform || process.platform;
  let name = r.signal || null;
  const code = typeof r.code === 'number' ? r.code : null;
  if (!name && code !== null) {
    const u = code >>> 0;                         // negative int32 → unsigned NTSTATUS
    if (platform === 'win32' && NTSTATUS[u]) name = NTSTATUS[u];
    else if (r.viaShell && SHELL_SIG[code]) name = SHELL_SIG[code];
  }
  if (!name) return null;
  const e = SIGNALS[name] || EXTRA[name];
  if (!e) return { name, title: 'Program signal ' + name + ' se ruka', why: '', fix: '' };
  return { name, ...e };
}

/** Exit code ka ek line ka description (Dev-C++ style footer ke liye) */
function exitLine(r, seconds) {
  const t = seconds !== undefined ? ' after ' + seconds.toFixed(2) + ' s' : '';
  if (r.signal) return 'Process terminated by ' + r.signal + t;
  return 'Process exited' + t + ' with return value ' + r.code;
}

module.exports = { explainExit, exitLine, NTSTATUS, SIGNALS };
