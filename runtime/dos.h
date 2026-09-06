/* PRABHA dos.h — the pieces Turbo C programs actually use. */
#ifndef PRABHA_DOS_H
#define PRABHA_DOS_H
#ifdef __cplusplus
extern "C" {
#endif
void delay(unsigned ms);
#ifdef _WIN32
void sleep(unsigned seconds);
#else
#include <unistd.h>  /* sleep() comes from the system here */
#endif
void sound(unsigned frequency);   /* forwarded to the panel as a beep note */
void nosound(void);
#ifdef __cplusplus
}
#endif
#endif
