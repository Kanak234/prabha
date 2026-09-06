#include <graphics.h>
int main() {
    int gd = DETECT, gm; initgraph(&gd, &gm, "");
    /* page-flipped bouncing ball, 30 frames */
    int x = 60, y = 100, dx = 14, dy = 9, r = 22;
    for (int f = 0; f < 30; f++) {
        int page = f & 1;
        setactivepage(page);
        cleardevice();
        setcolor(WHITE); rectangle(0, 0, getmaxx(), getmaxy());
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(x, y, r, r);
        setcolor(LIGHTRED); circle(x, y, r);
        x += dx; y += dy;
        if (x - r < 1 || x + r > getmaxx() - 1) dx = -dx;
        if (y - r < 1 || y + r > getmaxy() - 1) dy = -dy;
        setvisualpage(page);
    }
    closegraph();
    return 0;
}
