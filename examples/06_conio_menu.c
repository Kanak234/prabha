/* Pure conio.h program — no initgraph anywhere. */
#include <conio.h>
int main() {
    textbackground(BLUE);
    clrscr();
    textcolor(YELLOW);
    gotoxy(28, 2);  cprintf("== STUDENT  MENU ==");
    textcolor(WHITE);
    gotoxy(25, 5);  cprintf("1. Add student");
    gotoxy(25, 6);  cprintf("2. Show students");
    gotoxy(25, 7);  cprintf("3. Exit");
    textcolor(LIGHTCYAN);
    gotoxy(25, 10); cprintf("choice: ");
    char c = getch(); putch(c);
    gotoxy(25, 12);
    textcolor(LIGHTGREEN);
    cprintf("you picked %c - press any key", c);
    getch();
    return 0;
}
