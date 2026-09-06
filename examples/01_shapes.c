/* Every BGI shape on one screen — the classic first program. */
#include <graphics.h>
#include <conio.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    setbkcolor(BLACK); cleardevice();

    setcolor(YELLOW);      circle(100, 100, 50);
    setcolor(LIGHTRED);    rectangle(180, 50, 300, 150);
    setcolor(LIGHTGREEN);  line(330, 50, 450, 150);
    setcolor(LIGHTCYAN);   ellipse(520, 100, 0, 360, 60, 35);

    setfillstyle(SOLID_FILL, RED);        bar(60, 200, 160, 300);
    setfillstyle(HATCH_FILL, LIGHTBLUE);  bar3d(200, 200, 300, 300, 15, 1);
    setfillstyle(SLASH_FILL, MAGENTA);    pieslice(400, 250, 0, 120, 60);
    setfillstyle(SOLID_FILL, GREEN);      fillellipse(530, 250, 55, 40);

    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    settextjustify(CENTER_TEXT, TOP_TEXT);
    outtextxy(320, 380, "PRABHA - Turbo C in VS Code");
    settextjustify(LEFT_TEXT, TOP_TEXT);
    outtextxy(10, 440, "press any key to exit");

    getch();
    closegraph();
    return 0;
}
