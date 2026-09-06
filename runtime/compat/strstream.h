/* PRABHA compatibility: Turbo C++ <strstream.h> (old string streams).
   Maps the common names onto modern <sstream>. */
#ifndef PRABHA_COMPAT_STRSTREAM_H
#define PRABHA_COMPAT_STRSTREAM_H
#include <sstream>
using std::stringstream;
using std::istringstream;
using std::ostringstream;
#endif
