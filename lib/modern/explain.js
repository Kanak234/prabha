/*
 * lib/modern/explain.js — Turbo C++ → Modern C++ ke har rule ki padhai:
 * kya badla, kyun, students ki common galti, aur ek quiz question.
 * Saara teaching text ek jagah — teacher ko review ke liye sirf yeh file padhni hai.
 * FLOW: rules.js (id) → engine.js → explain(id, lang) → media/modern-panel.js cards
 */
'use strict';

const R = {
  'old-headers': {
    std: 'C++98',
    title: { hi: '`<iostream.h>` → `<iostream>`', en: '`<iostream.h>` → `<iostream>`' },
    why: {
      hi: '`.h` wale C++ headers (`iostream.h`, `fstream.h`, `iomanip.h`) 1998 ke C++ standard se pehle ke hain. Turbo C++ unhe chalata tha, par GCC, Clang, MSVC — koi modern compiler unhe nahi jaanta. Naye headers mein `.h` nahi lagta.',
      en: 'The `.h` C++ headers (`iostream.h`, `fstream.h`, `iomanip.h`) predate the 1998 C++ standard. Turbo C++ accepted them; no modern compiler (GCC, Clang, MSVC) ships them. Standard headers have no `.h`.'
    },
    mistake: {
      hi: 'Galti: `<stdio.h>` aur `<string.h>` ko bhi galat samajh lena. Woh C ke headers hain aur ab bhi valid hain (C++ mein unke naye naam `<cstdio>`, `<cstring>` bhi hain).',
      en: 'Mistake: thinking `<stdio.h>` and `<string.h>` are also wrong. They are C headers and still valid (C++ also offers `<cstdio>`, `<cstring>`).'
    },
    practice: {
      q: { hi: 'Modern C++ mein inme se kaunsa include ERROR dega?', en: 'Which include fails on a modern C++ compiler?' },
      options: ['#include <iostream>', '#include <stdio.h>', '#include <iostream.h>', '#include <cmath>'],
      answer: 2,
      explain: { hi: '`<iostream.h>` sirf Turbo C++ mein tha. Baaki teeno standard hain.', en: '`<iostream.h>` only existed in Turbo C++. The other three are standard.' }
    }
  },
  'std-qualify': {
    std: 'C++98',
    title: { hi: '`cout` → `std::cout`', en: '`cout` → `std::cout`' },
    why: {
      hi: 'Standard library ke saare naam (`cout`, `cin`, `endl`, `setw`, …) `std` namespace mein rehte hain, taaki tumhare apne variables se na takrayein. Turbo C++ mein namespace hote hi nahi the. Ya to har jagah `std::` likho (professional style), ya ek baar `using namespace std;`.',
      en: 'Every standard library name (`cout`, `cin`, `endl`, `setw`, …) lives in the `std` namespace so it cannot clash with your own names. Turbo C++ had no namespaces. Write `std::` (professional style) or once `using namespace std;`.'
    },
    mistake: {
      hi: 'Galti: header file mein `using namespace std;` likhna — jo bhi us header ko include kare, uske saare naam std se takra sakte hain. `.cpp` mein chhote programs ke liye theek hai.',
      en: 'Mistake: putting `using namespace std;` in a header — every file that includes it inherits the clash risk. In a small `.cpp` it is fine.'
    },
    practice: {
      q: { hi: '`#include <iostream>` ke baad bina `using` ke kya likhoge?', en: 'After `#include <iostream>` with no `using`, what do you write?' },
      options: ['cout << "hi";', 'std::cout << "hi";', 'std.cout << "hi";', 'iostream::cout << "hi";'],
      answer: 1,
      explain: { hi: 'Namespace ka naam aur member `::` se jodte hain: `std::cout`.', en: 'Namespace and member are joined with `::`: `std::cout`.' }
    }
  },
  'void-main': {
    std: 'C89 / C++98',
    title: { hi: '`void main()` → `int main()`', en: '`void main()` → `int main()`' },
    why: {
      hi: 'C aur C++ standard dono kehte hain `main` ko `int` return karna hai — ye number operating system ko batata hai program theek khatam hua (0) ya error se. `void main` sirf Turbo C ki chhoot thi. `main` ke end mein `return 0;` likhna optional hai — compiler khud 0 maan leta hai. C mein khaali brackets ki jagah `int main(void)` likhte hain (C mein `()` ka matlab "koi bhi arguments" hota hai).',
      en: 'Both the C and C++ standards require `main` to return `int` — the number tells the operating system whether the program succeeded (0) or failed. `void main` was a Turbo C allowance. `return 0;` at the end of `main` is optional; the compiler assumes 0. In C, write `int main(void)` — empty brackets in C mean "any arguments".'
    },
    mistake: {
      hi: 'Galti: `int main()` banane ke baad bhi andar `return;` (bina value) chhod dena — ab `return 0;` chahiye. PRABHA ye bhi badal deta hai.',
      en: 'Mistake: keeping a bare `return;` inside after switching to `int main()` — it must become `return 0;`. PRABHA changes that too.'
    },
    practice: {
      q: { hi: '`int main()` mein end par `return 0;` na likho to kya hoga?', en: 'What happens without `return 0;` at the end of `int main()`?' },
      options: ['Compile error', 'Program 0 return karta hai', 'Random value return hoti hai', 'Program crash'],
      answer: 1,
      explain: { hi: 'Sirf `main` ke liye standard kehta hai ki end tak pahunchna = `return 0;`.', en: 'For `main` only, reaching the end is the same as `return 0;`.' }
    }
  },
  'getch-hold': {
    std: 'C89 / C++98',
    title: { hi: 'Aakhri `getch();` → `std::cin.get();`', en: 'Final `getch();` → `std::cin.get();`' },
    why: {
      hi: 'Turbo C mein output window turant band ho jaati thi, isliye end mein `getch()` likhte the "screen rokne" ke liye. `getch` `conio.h` ka hai jo standard nahi. Standard tareeka: C++ mein `std::cin.get();`, C mein `getchar();` — farak sirf itna ki ye Enter ka intezaar karte hain.',
      en: 'Turbo C closed the output window at once, so programs ended with `getch()` to hold the screen. `getch` comes from non-standard `conio.h`. The standard way is `std::cin.get();` (C++) or `getchar();` (C) — they wait for Enter instead of any key.'
    },
    mistake: {
      hi: 'Galti: `cin >> x;` ke baad `cin.get()` turant aage badh jaata hai — kyunki pichhla Enter abhi buffer mein hai. Tab `cin.ignore();` pehle lagao. (PRABHA Console khud "Press any key" dikhata hai, isliye wahan iski zaroorat hi nahi.)',
      en: 'Mistake: after `cin >> x;` a `cin.get()` returns at once — the previous Enter is still buffered. Add `cin.ignore();` first. (PRABHA Console already shows "Press any key", so it is not needed there.)'
    },
    practice: {
      q: { hi: '`getch()` kis header se aata hai?', en: 'Which header provides `getch()`?' },
      options: ['<stdio.h>', '<iostream>', '<conio.h>', '<stdlib.h>'],
      answer: 2,
      explain: { hi: '`conio.h` — DOS ka header, standard C/C++ ka hissa nahi.', en: '`conio.h` — a DOS header, not part of standard C/C++.' }
    }
  },
  'clrscr': {
    std: '—',
    title: { hi: '`clrscr();` hataya', en: '`clrscr();` removed' },
    why: {
      hi: 'Standard C/C++ mein screen saaf karne ka koi function nahi hai — terminal OS ka hissa hai, language ka nahi. `system("cls")` / `system("clear")` chalta hai par slow aur OS-specific hai, isliye seekhte waqt use na karna hi behtar. Modern IDEs har run par naya output dikhate hain.',
      en: 'Standard C/C++ has no clear-screen function — the terminal belongs to the OS, not the language. `system("cls")` / `system("clear")` work but are slow and OS-specific, so avoid them while learning. Modern IDEs show fresh output on every run.'
    },
    mistake: {
      hi: 'DHYAAN DO (review): ye badlaav output ka dikhna badalta hai — purana program screen saaf karta tha, naya nahi karega. Isliye ye rule default OFF hai.',
      en: 'REVIEW: this changes what the user sees — the old program cleared the screen, the new one does not. That is why the rule is off by default.'
    },
    practice: {
      q: { hi: 'Standard C++ mein screen clear karne ka function?', en: 'Standard C++ function to clear the screen?' },
      options: ['clrscr()', 'std::clear()', 'Koi nahi / None', 'cls()'],
      answer: 2,
      explain: { hi: 'Standard mein aisa koi function nahi. `clrscr` Turbo ka tha.', en: 'There is none in the standard. `clrscr` was Turbo-only.' }
    }
  },
  'conio-include': {
    std: '—',
    title: { hi: '`#include <conio.h>` hataya', en: '`#include <conio.h>` removed' },
    why: {
      hi: 'Program mein ab `conio.h` ka koi function nahi bacha, isliye ye include bekaar hai. `conio.h` DOS ka header tha — Linux aur macOS par hota hi nahi.',
      en: 'No `conio.h` function is left in the program, so the include is unused. `conio.h` was a DOS header — Linux and macOS do not have it.'
    },
    mistake: {
      hi: 'Galti: `getch()` / `gotoxy()` abhi bhi use ho rahe hon aur include hata dena. PRABHA tabhi hatata hai jab koi conio function na bache.',
      en: 'Mistake: removing it while `getch()` / `gotoxy()` are still used. PRABHA removes it only when none is left.'
    },
    practice: {
      q: { hi: 'Inme se kaunsa `conio.h` ka function NAHI hai?', en: 'Which is NOT a `conio.h` function?' },
      options: ['getch()', 'clrscr()', 'printf()', 'gotoxy()'],
      answer: 2,
      explain: { hi: '`printf` `<stdio.h>` ka standard function hai.', en: '`printf` is a standard `<stdio.h>` function.' }
    }
  },
  'dos-include': {
    std: '—',
    title: { hi: '`#include <dos.h>` hataya', en: '`#include <dos.h>` removed' },
    why: {
      hi: 'Program mein ab `dos.h` ka kuch (delay, sound, getdate…) nahi bacha. `dos.h` sirf DOS par tha.',
      en: 'Nothing from `dos.h` (delay, sound, getdate…) is left. `dos.h` only existed on DOS.'
    },
    mistake: { hi: '—', en: '—' },
    practice: {
      q: { hi: '`delay()` ka modern C++ version kis header mein hai?', en: 'Which header has the modern C++ replacement for `delay()`?' },
      options: ['<dos.h>', '<thread>', '<time.h>', '<conio.h>'],
      answer: 1,
      explain: { hi: '`std::this_thread::sleep_for` `<thread>` mein hai (time ke liye `<chrono>`).', en: '`std::this_thread::sleep_for` is in `<thread>` (durations in `<chrono>`).' }
    }
  },
  'gets': {
    std: 'C11 / C++14',
    title: { hi: '`gets()` → `getline` / `fgets`', en: '`gets()` → `getline` / `fgets`' },
    why: {
      hi: '`gets()` ko pata hi nahi ki array kitna bada hai — user zyada type kare to memory ke bahar likh deta hai (yahi bug 1988 ke Morris Worm ne use kiya tha). Isliye C11 aur C++14 se `gets` standard se HATA diya gaya. C++: `std::cin.getline(s, sizeof s);`, C: `fgets(s, sizeof s, stdin);` — dono size ka dhyaan rakhte hain.',
      en: '`gets()` does not know how big the array is — typing more than fits writes past it (the 1988 Morris Worm used exactly this). C11 and C++14 removed `gets` from the standard. C++: `std::cin.getline(s, sizeof s);`, C: `fgets(s, sizeof s, stdin);` — both respect the size.'
    },
    mistake: {
      hi: 'Galti: `fgets` line ke end ka `\\n` bhi rakh leta hai. PRABHA uske baad `s[strcspn(s, "\\n")] = \'\\0\';` jodta hai taaki output pehle jaisa rahe.',
      en: 'Mistake: `fgets` keeps the trailing `\\n`. PRABHA adds `s[strcspn(s, "\\n")] = \'\\0\';` so the output stays the same.'
    },
    practice: {
      q: { hi: '`gets()` kyun hataya gaya?', en: 'Why was `gets()` removed?' },
      options: ['Slow tha', 'Array ki size check nahi karta (buffer overflow)', 'Sirf Windows par tha', 'Unicode support nahi'],
      answer: 1,
      explain: { hi: 'Size na jaanne se overflow — security bug.', en: 'Not knowing the size causes overflows — a security bug.' }
    }
  },
  'char-array-string': {
    std: 'C++98',
    title: { hi: '`char name[20]` → `std::string`', en: '`char name[20]` → `std::string`' },
    why: {
      hi: '`char name[20]` mein 19 se lamba naam aaye to memory kharab hoti hai. `std::string` apne aap badhti hai, aur `cin >>` / `cout <<` dono ke saath bilkul waise hi chalti hai. PRABHA ye tabhi badalta hai jab variable sirf `cin >>` aur `cout <<` mein use ho.',
      en: '`char name[20]` corrupts memory when a name longer than 19 characters is typed. `std::string` grows on its own and works with `cin >>` / `cout <<` exactly the same. PRABHA only changes it when the variable is used just with `cin >>` and `cout <<`.'
    },
    mistake: {
      hi: 'Galti: `std::string` ke saath `strcpy`/`strlen` lagana. String mein `=` aur `.length()` use hote hain.',
      en: 'Mistake: using `strcpy`/`strlen` on a `std::string`. Strings use `=` and `.length()`.'
    },
    practice: {
      q: { hi: '`std::string s = "Kanak";` ki length kaise nikaloge?', en: 'How do you get the length of `std::string s = "Kanak";`?' },
      options: ['strlen(s)', 's.length()', 'sizeof(s)', 'len(s)'],
      answer: 1,
      explain: { hi: '`s.length()` (ya `s.size()`) = 5.', en: '`s.length()` (or `s.size()`) = 5.' }
    }
  },
  'random': {
    std: 'C89 / C++98',
    title: { hi: '`randomize()` / `random(n)` → `srand` / `rand`', en: '`randomize()` / `random(n)` → `srand` / `rand`' },
    why: {
      hi: '`randomize()` aur `random(n)` Borland (Turbo) ke apne functions the. Standard tareeka: `std::srand(std::time(nullptr));` ek baar, phir `std::rand() % n` (0 se n-1). Bade projects ke liye `<random>` (`std::mt19937`) aur behtar hai.',
      en: '`randomize()` and `random(n)` were Borland-only. The standard way: `std::srand(std::time(nullptr));` once, then `std::rand() % n` (0 to n-1). For serious work `<random>` (`std::mt19937`) is better.'
    },
    mistake: {
      hi: 'Galti: `srand(time(0))` ko loop ke andar likhna — har baar same seed, same number.',
      en: 'Mistake: calling `srand(time(0))` inside a loop — the same seed gives the same number.'
    },
    practice: {
      q: { hi: '`std::rand() % 6` kin values ke beech aata hai?', en: 'What range does `std::rand() % 6` give?' },
      options: ['1 se 6', '0 se 5', '0 se 6', '1 se 5'],
      answer: 1,
      explain: { hi: '`% 6` ka result 0, 1, 2, 3, 4 ya 5. Dice ke liye `+ 1` karo.', en: '`% 6` yields 0–5. Add 1 for a dice roll.' }
    }
  },
  'delay': {
    std: 'C++11',
    title: { hi: '`delay(ms)` → `std::this_thread::sleep_for`', en: '`delay(ms)` → `std::this_thread::sleep_for`' },
    why: {
      hi: '`delay()` `dos.h` ka tha. C++11 se standard tareeka: `std::this_thread::sleep_for(std::chrono::milliseconds(500));` — Windows, Linux, macOS sab par same. (graphics.h programs mein PRABHA ka `delay` hi rehta hai, kyunki woh animation frames bhi bhejta hai.)',
      en: '`delay()` came from `dos.h`. Since C++11 the standard way is `std::this_thread::sleep_for(std::chrono::milliseconds(500));` — the same on Windows, Linux and macOS. (graphics.h programs keep PRABHA\'s `delay`, which also sends animation frames.)'
    },
    mistake: { hi: 'Galti: `sleep(1)` ko milliseconds samajhna — POSIX `sleep` seconds leta hai.', en: 'Mistake: treating `sleep(1)` as milliseconds — POSIX `sleep` takes seconds.' },
    practice: {
      q: { hi: 'Aadhe second ke liye ruko:', en: 'Wait for half a second:' },
      options: ['sleep_for(500)', 'sleep_for(std::chrono::milliseconds(500))', 'delay(0.5)', 'wait(500)'],
      answer: 1,
      explain: { hi: 'Duration ka type batana padta hai: `std::chrono::milliseconds(500)`.', en: 'The duration type must be explicit: `std::chrono::milliseconds(500)`.' }
    }
  },
  'null': {
    std: 'C++11',
    title: { hi: '`NULL` → `nullptr`', en: '`NULL` → `nullptr`' },
    why: {
      hi: 'C++ mein `NULL` asal mein `0` hai — ek integer. Isliye `f(NULL)` galat overload (int wala) chuna ja sakta hai. C++11 ka `nullptr` sirf pointer ho sakta hai, galti ki gunjaish nahi.',
      en: 'In C++ `NULL` is really `0` — an integer, so `f(NULL)` can pick the wrong (int) overload. C++11 `nullptr` can only be a pointer, so no mix-up is possible.'
    },
    mistake: { hi: 'Galti: `int x = nullptr;` — nullptr integer nahi ban sakta (compile error, aur yahi achhi baat hai).', en: 'Mistake: `int x = nullptr;` — nullptr cannot become an integer (a compile error, which is the point).' },
    practice: {
      q: { hi: 'Modern C++ mein null pointer kaise likhte hain?', en: 'How do you write a null pointer in modern C++?' },
      options: ['NULL', '0', 'nullptr', 'void'],
      answer: 2,
      explain: { hi: '`nullptr` (C++11).', en: '`nullptr` (C++11).' }
    }
  },
  'far-near': {
    std: '—',
    title: { hi: '`far` / `near` / `huge` hataye', en: '`far` / `near` / `huge` removed' },
    why: {
      hi: 'Ye DOS ke 16-bit "segmented memory" ke keywords the (64 KB ke segments). Aaj ke 64-bit computers par memory ek flat address space hai — in keywords ka koi matlab nahi, aur modern compiler unhe jaante bhi nahi.',
      en: 'These were keywords for DOS 16-bit segmented memory (64 KB segments). Today\'s 64-bit machines have one flat address space — the keywords mean nothing and modern compilers do not know them.'
    },
    mistake: { hi: '—', en: '—' },
    practice: {
      q: { hi: '`char far *p` aaj kya hoga?', en: 'What does `char far *p` become today?' },
      options: ['char far *p', 'char *p', 'long *p', 'far char *p'],
      answer: 1,
      explain: { hi: 'Bas `char *p` — pointer waisa hi kaam karta hai.', en: 'Just `char *p` — the pointer works the same.' }
    }
  }
};

function explain(id, lang) {
  const r = R[id];
  if (!r) return null;
  const L = lang === 'en' ? 'en' : 'hi';
  return { id, java: r.std, std: r.std, title: r.title[L], why: r.why[L], mistake: r.mistake[L],
    practice: { q: r.practice.q[L], options: r.practice.options, answer: r.practice.answer, explain: r.practice.explain[L] } };
}

module.exports = { RULES: R, explain };
