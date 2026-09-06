/* PRABHA compatibility: Turbo C++ <constream.h>. Console streams are
   approximated by ordinary iostream plus the PRABHA conio console. */
#ifndef PRABHA_COMPAT_CONSTREAM_H
#define PRABHA_COMPAT_CONSTREAM_H
#include <iostream>
#include "../conio.h"
using std::cout;
using std::cin;
using std::endl;
#endif
