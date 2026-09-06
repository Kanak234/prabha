/*
 * PRABHA C++ legacy prelude.
 *
 * Force-included (via the compiler's -include flag) before the student's own
 * C++ source, only in Turbo C++ compatibility mode. Its job is to let
 * unmodified Turbo C++ / Borland C++ programs compile on a modern g++:
 *
 *   - cout, cin, endl, setw ... work unqualified, because the standard
 *     namespace is pulled into global scope here, the way <iostream.h> did.
 *   - The common C and C++ headers legacy code assumes are already present.
 *   - gets(), a staple of old lab programs, was removed from modern C/C++.
 *     A safe replacement is provided so those programs still build and run.
 *
 * The other half of compatibility -- <iostream.h>-style headers and the
 * void main() form -- is handled by the shim headers in this folder and by a
 * tiny source rewrite PRABHA applies before compiling. Nothing here changes a
 * program that is already valid modern C++.
 */
#ifndef PRABHA_CPP_PRELUDE_H
#define PRABHA_CPP_PRELUDE_H
#ifdef __cplusplus

#include <iostream>
#include <iomanip>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <cstdio>

using namespace std;

/*
 * gets() was removed in C11/C++14 because it cannot be used safely. Old Turbo
 * C++ lab programs still call it. We provide a bounded stand-in so those
 * programs compile and run without a buffer-overflow footgun: it reads a line
 * with a hard cap and strips the newline, matching how gets() was used in
 * practice. Only defined if the toolchain does not already declare it.
 */
#ifndef PRABHA_HAVE_GETS
#define PRABHA_HAVE_GETS
static inline char *prabha_gets(char *s) {
    if (!s) return 0;
    /* cap at a generous line length; lab input is short */
    if (!fgets(s, 4096, stdin)) return 0;
    size_t n = strlen(s);
    if (n && s[n - 1] == '\n') s[n - 1] = '\0';
    return s;
}
#define gets prabha_gets
#endif

#endif /* __cplusplus */
#endif /* PRABHA_CPP_PRELUDE_H */
