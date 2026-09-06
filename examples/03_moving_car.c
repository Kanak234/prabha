/* The exam-classic moving car. */
#include <graphics.h>
#include <conio.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    for (int x = -150; x < 700 && !kbhit(); x += 5) {
        cleardevice();
        setcolor(WHITE); line(0, 330, 639, 330);
        setfillstyle(SOLID_FILL, RED);
        bar(x, 270, x + 120, 300);
        bar(x + 25, 240, x + 95, 270);
        setfillstyle(SOLID_FILL, DARKGRAY);
        fillellipse(x + 30, 305, 14, 14);
        fillellipse(x + 90, 305, 14, 14);
        setcolor(YELLOW);
        outtextxy(230, 60, "PRABHA MOTORS");
        delay(30);
    }
    closegraph();
    return 0;
}
