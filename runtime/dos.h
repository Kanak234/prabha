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

/* Date and time.

   Turbo C programs read the clock through these structs -- attendance
   registers, billing programs, anything that stamps a record. The field
   names are Borland's and cannot be changed: programs write d.da_year
   directly. Values come from the host clock via localtime(). */
struct date {
    int  da_year;   /* full year, e.g. 2026 */
    char da_day;
    char da_mon;    /* 1 = January */
};

struct time {
    unsigned char ti_min;
    unsigned char ti_hour;
    unsigned char ti_hund;  /* hundredths of a second */
    unsigned char ti_sec;
};

void getdate(struct date *d);
void setdate(const struct date *d);   /* accepted and ignored: see note below */
void gettime(struct time *t);
void settime(const struct time *t);   /* accepted and ignored */

/* setdate/settime set the system clock under DOS. Here they do nothing and
   return, rather than failing to link. Changing the host clock needs root and
   is not something a student program should do by accident. */

/* Random numbers. Turbo C spelled these differently from standard C.

   random() is a macro here, as it was in Borland's dos.h. It cannot be a
   function: glibc already declares `long random(void)`, and a second
   `int random(int)` conflicts with it. */
void randomize(void);
#ifndef random
#define random(limit) ((limit) > 0 ? (rand() % (int)(limit)) : 0)
#endif

/* Register-level DOS calls appear in old code but have no meaning here.
   Declared so such a program still links; they set no registers. */
union REGS { struct { unsigned int ax, bx, cx, dx, si, di, cflag, flags; } x;
             struct { unsigned char al, ah, bl, bh, cl, ch, dl, dh; } h; };
int int86(int intno, union REGS *inregs, union REGS *outregs);

#ifdef __cplusplus
}
#endif
#endif
