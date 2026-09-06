/* Smooth animation with page flipping — press ESC to quit. */
#include <graphics.h>
#include <conio.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    int x = 100, y = 100, dx = 6, dy = 4, r = 25, page = 0;
    while (1) {
        if (kbhit() && getch() == 27) break;
        setactivepage(page);
        cleardevice();
        setcolor(DARKGRAY); rectangle(0, 0, getmaxx(), getmaxy());
        setfillstyle(SOLID_FILL, YELLOW); fillellipse(x, y, r, r);
        setcolor(LIGHTRED); circle(x, y, r);
        x += dx; y += dy;
        if (x - r <= 0 || x + r >= getmaxx()) dx = -dx;
        if (y - r <= 0 || y + r >= getmaxy()) dy = -dy;
        setvisualpage(page);
        page = 1 - page;
        delay(16);
    }
    closegraph();
    return 0;
}
