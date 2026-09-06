/* PRABHA compatibility shim: forward to the real PRABHA conio.
   Turbo C++ programs include <conio.h> for clrscr/getch/gotoxy etc.
   PRABHA already ships a full conio.h next to this folder; this file
   simply forwards so both include paths resolve to the same API. */
#ifndef PRABHA_COMPAT_CONIO_FORWARD
#define PRABHA_COMPAT_CONIO_FORWARD
#include "../conio.h"
#endif
