/*
 * PRABHA conio.h — complete Turbo C console interface.
 * Text renders into the same PRABHA panel; getch/kbhit read real
 * keystrokes from the panel. Include order with graphics.h does not
 * matter — both guards cooperate.
 */
#ifndef PRABHA_CONIO_H
#define PRABHA_CONIO_H

#ifdef __cplusplus
extern "C" {
#endif

#ifndef PRABHA_COLORS_DEFINED
#define PRABHA_COLORS_DEFINED
enum COLORS {
    BLACK = 0, BLUE, GREEN, CYAN, RED, MAGENTA, BROWN, LIGHTGRAY,
    DARKGRAY, LIGHTBLUE, LIGHTGREEN, LIGHTCYAN, LIGHTRED, LIGHTMAGENTA,
    YELLOW, WHITE
};
#endif

enum text_modes { LASTMODE = -1, BW40 = 0, C40, BW80, C80, MONO = 7, C4350 = 64 };
enum CURSORTYPE { _NOCURSOR = 0, _SOLIDCURSOR = 1, _NORMALCURSOR = 2 };

struct text_info {
    unsigned char winleft, wintop, winright, winbottom;
    unsigned char attribute, normattr;
    unsigned char currmode;
    unsigned char screenheight, screenwidth;
    unsigned char curx, cury;
};

/* keyboard */
int  kbhit(void);
int  getch(void);
int  getche(void);
int  ungetch(int ch);
char *cgets(char *str);

/* screen */
void clrscr(void);
void clreol(void);
void delline(void);
void insline(void);
void gotoxy(int x, int y);
int  wherex(void);
int  wherey(void);
void window(int left, int top, int right, int bottom);
void textmode(int newmode);
void gettextinfo(struct text_info *r);
void _setcursortype(int cur_t);

/* attributes */
void textattr(int newattr);
void textcolor(int newcolor);
void textbackground(int newcolor);
void highvideo(void);
void lowvideo(void);
void normvideo(void);

/* output */
int  cprintf(const char *format, ...);
int  cputs(const char *str);
int  putch(int c);
int  cscanf(const char *format, ...);

/* scan codes getch() returns after a leading 0 */
#define KEY_HOME  71
#define KEY_UP    72
#define KEY_PGUP  73
#define KEY_LEFT  75
#define KEY_RIGHT 77
#define KEY_END   79
#define KEY_DOWN  80
#define KEY_PGDN  81
#define KEY_INS   82
#define KEY_DEL   83
#define KEY_F1 59
#define KEY_F2 60
#define KEY_F3 61
#define KEY_F4 62
#define KEY_F5 63
#define KEY_F6 64
#define KEY_F7 65
#define KEY_F8 66
#define KEY_F9 67
#define KEY_F10 68

void delay(unsigned ms);

#ifdef __cplusplus
}
#endif
#endif /* PRABHA_CONIO_H */
