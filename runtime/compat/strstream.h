/* PRABHA compatibility: Turbo C++ <strstream.h> (old string streams).

   The old classes wrote into a caller-supplied char buffer:

       char buf[100];
       ostrstream o(buf, sizeof buf);
       o << "value=" << 42 << ends;

   Modern <sstream> owns its buffer instead, so the names cannot simply be
   aliased -- ostrstream(char*, int) has no equivalent. These thin wrappers
   keep the old call shape and copy into the caller's buffer on ends/str(),
   which is what those programs then read.

   ostrstream/istrstream also existed in <strstream>, deprecated since C++98.
   Wrapping <sstream> avoids the deprecation warnings a student would
   otherwise see on every build. */
#ifndef PRABHA_COMPAT_STRSTREAM_H
#define PRABHA_COMPAT_STRSTREAM_H

#include <sstream>
#include <cstring>
#include <string>

using std::stringstream;
using std::istringstream;
using std::ostringstream;

/* `o << ends;` terminated the buffer in Turbo C++. Nothing extra is needed
   here: std::ends already exists, and every operator<< below flushes into
   the caller's buffer, so the NUL is written either way. Defining our own
   `ends` would collide with std::ends once the prelude does `using
   namespace std`. */

class ostrstream : public std::ostringstream {
public:
    ostrstream() : buf_(0), cap_(0) {}
    ostrstream(char *buffer, int size, int = 0) : buf_(buffer), cap_(size) {
        if (buf_ && cap_ > 0) buf_[0] = '\0';
    }

    /* Copy what has been written into the caller's buffer, NUL-terminated.

       std::ostringstream::str() is named explicitly. `this->str()` would
       resolve to the str() below, which calls back here -- infinite
       recursion and a stack overflow on the first `<<`. */
    void flush_to_buffer() {
        if (!buf_ || cap_ <= 0) return;
        const std::string s = std::ostringstream::str();
        std::size_t n = s.size();
        if (n > static_cast<std::size_t>(cap_) - 1) n = cap_ - 1;
        std::memcpy(buf_, s.data(), n);
        buf_[n] = '\0';
    }

    /* Turbo C++ handed back the same buffer you passed in. */
    char *str() {
        flush_to_buffer();
        if (buf_) return buf_;
        tmp_ = std::ostringstream::str();
        return const_cast<char *>(tmp_.c_str());
    }

    template <class T>
    ostrstream &operator<<(const T &v) {
        static_cast<std::ostringstream &>(*this) << v;
        flush_to_buffer();
        return *this;
    }

    ostrstream &operator<<(std::ostream &(*fn)(std::ostream &)) {
        static_cast<std::ostringstream &>(*this) << fn;
        flush_to_buffer();
        return *this;
    }

private:
    char *buf_;
    int cap_;
    std::string tmp_;
};

class istrstream : public std::istringstream {
public:
    explicit istrstream(const char *s) : std::istringstream(s ? s : "") {}
    istrstream(const char *s, int n)
        : std::istringstream(std::string(s ? s : "", s ? n : 0)) {}
};

typedef std::stringstream strstream;

#endif
