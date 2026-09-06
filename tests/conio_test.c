#include <conio.h>
int main() {
    textbackground(BLUE); clrscr();
    textcolor(YELLOW);
    cprintf("PRABHA conio  ");
    textcolor(LIGHTGREEN); textbackground(RED);
    cprintf("attr blocks\r\n");
    normvideo();
    gotoxy(10, 5); cprintf("at 10,5  wherex=%d wherey=%d", wherex(), wherey());
    window(20, 10, 60, 20);
    textbackground(GREEN); clrscr();
    textcolor(WHITE);
    cprintf("inside window 20,10..60,20\r\n");
    for (int i = 0; i < 15; i++) cprintf("scroll line %d\r\n", i);
    gotoxy(1, 3); insline(); cprintf("INSERTED");
    gotoxy(1, 5); delline();
    char c = getch();
    cprintf("\r\ngot key: %c (%d)", c, c);
    int hit = kbhit();
    cprintf(" kbhit-after=%d", hit);
    return 0;
}
