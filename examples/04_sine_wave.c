/* Live sine wave using putpixel and moveto/lineto. */
#include <graphics.h>
#include <conio.h>
#include <math.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    setcolor(DARKGRAY);
    line(0, 240, 639, 240); line(320, 0, 320, 479);
    setcolor(LIGHTCYAN);
    for (double phase = 0; !kbhit(); phase += 0.15) {
        setfillstyle(SOLID_FILL, BLACK);
        for (int x = 0; x < 640; x++) {
            double y = 240 - 120 * sin((x - 320) * 0.02 + phase);
            putpixel(x, (int)y, LIGHTCYAN);
        }
        delay(33);
        cleardevice();
        setcolor(DARKGRAY);
        line(0, 240, 639, 240); line(320, 0, 320, 479);
    }
    closegraph();
    return 0;
}
