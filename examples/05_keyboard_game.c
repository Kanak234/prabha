/* Move the box with arrow keys; ESC exits — shows getch scan codes. */
#include <graphics.h>
#include <conio.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    int x = 300, y = 220, s = 30;
    while (1) {
        cleardevice();
        setcolor(WHITE);
        outtextxy(10, 10, "arrow keys move - ESC quits");
        setfillstyle(SOLID_FILL, LIGHTGREEN);
        bar(x, y, x + s, y + s);
        int c = getch();
        if (c == 27) break;
        if (c == 0) {
            c = getch();
            if (c == KEY_LEFT)  x -= 12;
            if (c == KEY_RIGHT) x += 12;
            if (c == KEY_UP)    y -= 12;
            if (c == KEY_DOWN)  y += 12;
        }
    }
    closegraph();
    return 0;
}
