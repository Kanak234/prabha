/* PRABHA compatibility: Turbo C++ <iostream.h> on a modern compiler.
   Old code used unqualified cout/cin/endl and #include <iostream.h>.
   We include the real header and lift the standard names into the
   global namespace so that legacy code compiles unchanged. */
#ifndef PRABHA_COMPAT_IOSTREAM_H
#define PRABHA_COMPAT_IOSTREAM_H
#include <iostream>
using std::cout; using std::cin; using std::cerr; using std::clog;
using std::endl; using std::ends; using std::flush;
using std::ostream; using std::istream; using std::iostream;
using std::streambuf; using std::ios;
using std::hex; using std::dec; using std::oct;
#endif
