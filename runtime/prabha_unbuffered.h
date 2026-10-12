/*
 * prabha_unbuffered.h — PRABHA Console / debugger ke liye `-include` kiya jaata hai.
 *
 * WHY: stdout jab terminal nahi balki pipe hota hai (PRABHA Console, debugger),
 *      C library use poora buffer karti hai — `printf("Enter a: ")` dikhta hi nahi
 *      jab tak program `scanf` par ruka hai. Student ko lagta hai program atak gaya.
 * WHAT: main() se pehle (constructor) stdout/stderr ko unbuffered kar deta hai.
 *       C++ `cout` default mein stdio se synced hai, isliye woh bhi turant dikhta hai.
 */
#ifndef PRABHA_UNBUFFERED_H
#define PRABHA_UNBUFFERED_H
#include <stdio.h>
__attribute__((constructor)) static void prabha_unbuffer_stdio(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}
#endif
