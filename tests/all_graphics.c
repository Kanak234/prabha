/* Exercises every drawing API once. */
#include <graphics.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    prabha_set_auto_flush(0);                 /* deterministic frames */

    setbkcolor(BLUE);
    cleardevice();

    setcolor(YELLOW);
    line(10, 10, 200, 10);
    setlinestyle(DASHED_LINE, 0, NORM_WIDTH);
    line(10, 20, 200, 20);
    setlinestyle(DOTTED_LINE, 0, THICK_WIDTH);
    line(10, 30, 200, 30);
    setlinestyle(USERBIT_LINE, 0xF00F, NORM_WIDTH);
    line(10, 40, 200, 40);
    setlinestyle(SOLID_LINE, 0, NORM_WIDTH);

    rectangle(220, 10, 320, 60);
    circle(370, 35, 25);
    arc(430, 35, 0, 180, 25);
    ellipse(500, 35, 0, 360, 40, 20);

    setfillstyle(SOLID_FILL, RED);
    bar(10, 80, 90, 140);
    setfillstyle(HATCH_FILL, LIGHTGREEN);
    bar3d(110, 80, 190, 140, 12, 1);
    setfillstyle(XHATCH_FILL, LIGHTCYAN);
    fillellipse(260, 110, 45, 30);
    setfillstyle(SLASH_FILL, LIGHTMAGENTA);
    pieslice(370, 110, 30, 300, 35);
    setfillstyle(WIDE_DOT_FILL, WHITE);
    sector(470, 110, 0, 270, 40, 25);

    int poly[10] = { 530,80, 600,95, 620,140, 560,150, 520,120 };
    setfillstyle(INTERLEAVE_FILL, YELLOW);
    fillpoly(5, poly);

    int tri[8] = { 40,170, 120,170, 80,230, 40,170 };
    setcolor(WHITE);                      /* border colour must match */
    drawpoly(4, tri);
    setfillstyle(SOLID_FILL, LIGHTRED);
    floodfill(80, 190, WHITE);            /* stays inside the triangle */

    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(150, 180, "PRABHA default 1x");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(150, 195, "size 2");
    settextstyle(TRIPLEX_FONT, HORIZ_DIR, 1);
    outtextxy(150, 220, "triplex-ish");
    settextstyle(DEFAULT_FONT, VERT_DIR, 1);
    outtextxy(600, 300, "VERTICAL");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    settextjustify(CENTER_TEXT, CENTER_TEXT);
    outtextxy(320, 260, "centered on 320,260");
    settextjustify(LEFT_TEXT, TOP_TEXT);
    moveto(10, 280); outtext("moveto+outtext ");
    outtext("continues");

    putpixel(5, 470, WHITE);
    unsigned imgsz = imagesize(10, 80, 90, 140);
    void *img = malloc(imgsz);
    getimage(10, 80, 90, 140, img);
    putimage(10, 320, img, COPY_PUT);
    putimage(110, 320, img, XOR_PUT);
    putimage(210, 320, img, NOT_PUT);
    free(img);

    setviewport(400, 320, 560, 420, 1);
    setcolor(LIGHTGREEN);
    rectangle(0, 0, 159, 99);
    line(-50, -50, 300, 200);           /* must clip */
    outtextxy(8, 8, "viewport");
    setviewport(0, 0, getmaxx(), getmaxy(), 0);

    struct arccoordstype ac; getarccoords(&ac);
    struct fillsettingstype fsx; getfillsettings(&fsx);
    struct linesettingstype ls; getlinesettings(&ls);
    struct textsettingstype ts; gettextsettings(&ts);
    struct viewporttype vp; getviewsettings(&vp);
    struct palettetype pal; getpalette(&pal);
    char okline[128];
    sprintf(okline, "gm=%s drv=%s maxx=%d maxy=%d colors=%d",
            getmodename(getgraphmode()), getdrivername(), getmaxx(), getmaxy(), getmaxcolor()+1);
    setcolor(WHITE);
    outtextxy(10, 440, okline);

    prabha_flush();
    closegraph();
    return 0;
}
