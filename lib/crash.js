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
    title: 'Segmentation fault — the program touched memory it does not own',
    why: 'Usual causes: an array index past its size (arr[10] when the size is 10), using an uninitialized or NULL pointer, or forgetting `&` in `scanf("%d", x)`.',
    fix: 'Check loop conditions (`i < n`, not `<=`), give pointers a valid address before use, write `&x` in scanf. Run it in the debugger (F5) to see the line where it stopped.'
  },
  SIGFPE: {
    title: 'Arithmetic error — usually integer division by zero',
    why: 'Dividing an integer by 0 (or `%` by 0) makes the CPU stop the program. Floating-point division by 0 gives `inf` instead of crashing.',
    fix: 'Check before dividing: `if (b != 0) c = a / b;`.'
  },
  SIGTRAP: {
    title: 'Program stopped by a trap — usually integer division by zero, or a NULL / invalid pointer',
    why: 'On ARM CPUs (Apple Silicon Macs) PRABHA stops the program on division by zero (otherwise the result would silently be 0). Compilers also insert this trap for definite errors such as using a NULL pointer.',
    fix: 'Check `if (b != 0)` before dividing, and give pointers a valid address before use. Run it in the debugger (F5) to see the crashing line.'
  },
  SIGABRT: {
    title: 'The program aborted itself',
    why: 'Usually an `assert()` failed, memory was freed / deleted twice, or a C++ exception was never caught ("terminate called after throwing…").',
    fix: 'Read the last error message in the output above; for an exception, add `try { … } catch (…)`.'
  },
  SIGBUS: {
    title: 'Bus error — invalid (misaligned or missing) memory access',
    why: 'A pointer points to a wrong address — usually a dangling pointer or a bad cast.',
    fix: 'Check where the pointer came from. Use the debugger to see the crashing line.'
  },
  SIGILL: {
    title: 'Illegal instruction',
    why: 'A function with return type `int` ended without returning a value (undefined behaviour in C++, it can crash), or memory got corrupted.',
    fix: 'Add a `return` on every path of every non-void function. Read the compiler warnings in the Problems tab.'
  },
  SIGKILL: { title: 'Program was stopped (Stop button / time limit)', why: 'Stop was pressed or the program ran longer than the time limit.', fix: 'Is there an infinite loop? Check that the loop variable actually changes.' },
  SIGTERM: { title: 'Program was stopped', why: 'Stop was pressed.', fix: '' },
  SIGINT: { title: 'Stopped with Ctrl+C', why: '', fix: '' },
  SIGPIPE: { title: 'Wrote to a closed pipe', why: 'Whatever was reading the program\'s output had already closed.', fix: '' }
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
    title: 'Stack overflow — recursion never stopped (or a very large local array)',
    why: 'A function keeps calling itself and its base case is never reached, or a function declares a huge local array like `int a[1000000];`.',
    fix: 'Check the recursion\'s base case (`if (n == 0) return …;`). Make big arrays `static` or global, or use `std::vector`.'
  },
  DLL: {
    title: 'A required DLL was not found',
    why: 'The program depends on a library (DLL) that is not on this PC.',
    fix: 'PRABHA links programs with `-static`; if you still see this, use PRABHA\'s own compiler via "PRABHA: Install / Choose Compiler".'
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
  if (!e) return { name, title: 'Program stopped by signal ' + name, why: '', fix: '' };
  return { name, ...e };
}

/** Exit code ka ek line ka description (Dev-C++ style footer ke liye) */
function exitLine(r, seconds) {
  const t = seconds !== undefined ? ' after ' + seconds.toFixed(2) + ' s' : '';
  if (r.signal) return 'Process terminated by ' + r.signal + t;
  return 'Process exited' + t + ' with return value ' + r.code;
}

module.exports = { explainExit, exitLine, NTSTATUS, SIGNALS };
