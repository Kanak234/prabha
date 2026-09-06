/*
 * PRABHA graphics.h — complete Turbo C / Borland BGI compatible interface.
 *
 * Your old Turbo C program compiles against this header unchanged; the
 * implementation in prabha_core.c draws into a 640x480 16-colour framebuffer
 * and streams it to the PRABHA panel inside VS Code.
 *
 * Part of the PRABHA VS Code extension by Kanak Prabhakar. MIT licensed.
 */
#ifndef PRABHA_GRAPHICS_H
#define PRABHA_GRAPHICS_H

#ifdef __cplusplus
extern "C" {
#endif

/* ── colours (BGI order) ─────────────────────────────────────── */
#ifndef PRABHA_COLORS_DEFINED
#define PRABHA_COLORS_DEFINED
enum COLORS {
    BLACK = 0, BLUE, GREEN, CYAN, RED, MAGENTA, BROWN, LIGHTGRAY,
    DARKGRAY, LIGHTBLUE, LIGHTGREEN, LIGHTCYAN, LIGHTRED, LIGHTMAGENTA,
    YELLOW, WHITE
};
#endif
#define BLINK 128

/* ── drivers & modes (accepted, one mode really exists) ──────── */
enum graphics_drivers {
    DETECT = 0, CGA, MCGA, EGA, EGA64, EGAMONO, IBM8514, HERCMONO,
    ATT400, VGA, PC3270, CURRENT_DRIVER = -1
};
enum graphics_modes {
    CGAC0 = 0, CGAC1, CGAC2, CGAC3, CGAHI = 4,
    EGALO = 0, EGAHI = 1,
    VGALO = 0, VGAMED = 1, VGAHI = 2
};

/* ── errors ──────────────────────────────────────────────────── */
enum graphics_errors {
    grOk = 0, grNoInitGraph = -1, grNotDetected = -2, grFileNotFound = -3,
    grInvalidDriver = -4, grNoLoadMem = -5, grNoScanMem = -6, grNoFloodMem = -7,
    grFontNotFound = -8, grNoFontMem = -9, grInvalidMode = -10, grError = -11,
    grIOerror = -12, grInvalidFont = -13, grInvalidFontNum = -14,
    grInvalidVersion = -18
};

/* ── line styles ─────────────────────────────────────────────── */
enum line_styles { SOLID_LINE = 0, DOTTED_LINE, CENTER_LINE, DASHED_LINE, USERBIT_LINE };
enum line_widths { NORM_WIDTH = 1, THICK_WIDTH = 3 };

/* ── fill patterns ───────────────────────────────────────────── */
enum fill_patterns {
    EMPTY_FILL = 0, SOLID_FILL, LINE_FILL, LTSLASH_FILL, SLASH_FILL,
    BKSLASH_FILL, LTBKSLASH_FILL, HATCH_FILL, XHATCH_FILL,
    INTERLEAVE_FILL, WIDE_DOT_FILL, CLOSE_DOT_FILL, USER_FILL
};

/* ── text ────────────────────────────────────────────────────── */
enum font_names {
    DEFAULT_FONT = 0, TRIPLEX_FONT, SMALL_FONT, SANS_SERIF_FONT, GOTHIC_FONT,
    SCRIPT_FONT, SIMPLEX_FONT, TRIPLEX_SCR_FONT, COMPLEX_FONT, EUROPEAN_FONT,
    BOLD_FONT
};
enum text_directions { HORIZ_DIR = 0, VERT_DIR = 1 };
enum text_just { LEFT_TEXT = 0, CENTER_TEXT = 1, RIGHT_TEXT = 2,
                 BOTTOM_TEXT = 0, TOP_TEXT = 2 };
#define USER_CHAR_SIZE 0

/* ── putimage operators ──────────────────────────────────────── */
enum putimage_ops { COPY_PUT = 0, XOR_PUT, OR_PUT, AND_PUT, NOT_PUT };

/* ── info structs ────────────────────────────────────────────── */
struct arccoordstype  { int x, y, xstart, ystart, xend, yend; };
struct fillsettingstype { int pattern, color; };
struct linesettingstype { int linestyle; unsigned upattern; int thickness; };
struct palettetype    { unsigned char size; signed char colors[16]; };
struct textsettingstype { int font, direction, charsize, horiz, vert; };
struct viewporttype   { int left, top, right, bottom, clip; };

/* ── lifecycle ───────────────────────────────────────────────── */
void initgraph(int *graphdriver, int *graphmode, const char *pathtodriver);
void initwindow(int width, int height); /* WinBGIm convenience */
void closegraph(void);
void detectgraph(int *graphdriver, int *graphmode);
int  graphresult(void);
const char *grapherrormsg(int errorcode);
int  getgraphmode(void);
void setgraphmode(int mode);
void restorecrtmode(void);
int  getmaxmode(void);
const char *getmodename(int mode_number);
const char *getdrivername(void);
void graphdefaults(void);

/* ── screen & viewport ───────────────────────────────────────── */
void cleardevice(void);
void clearviewport(void);
void setviewport(int left, int top, int right, int bottom, int clip);
void getviewsettings(struct viewporttype *viewport);
int  getmaxx(void);
int  getmaxy(void);
int  getx(void);
int  gety(void);
void moveto(int x, int y);
void moverel(int dx, int dy);

/* ── pixels & lines ──────────────────────────────────────────── */
void putpixel(int x, int y, int color);
unsigned getpixel(int x, int y);
void line(int x1, int y1, int x2, int y2);
void lineto(int x, int y);
void linerel(int dx, int dy);
void rectangle(int left, int top, int right, int bottom);
void drawpoly(int numpoints, const int *polypoints);

/* ── curves ──────────────────────────────────────────────────── */
void circle(int x, int y, int radius);
void arc(int x, int y, int stangle, int endangle, int radius);
void ellipse(int x, int y, int stangle, int endangle, int xradius, int yradius);
void fillellipse(int x, int y, int xradius, int yradius);
void pieslice(int x, int y, int stangle, int endangle, int radius);
void sector(int x, int y, int stangle, int endangle, int xradius, int yradius);
void getarccoords(struct arccoordstype *arccoords);
void getaspectratio(int *xasp, int *yasp);
void setaspectratio(int xasp, int yasp);

/* ── filled shapes ───────────────────────────────────────────── */
void bar(int left, int top, int right, int bottom);
void bar3d(int left, int top, int right, int bottom, int depth, int topflag);
void fillpoly(int numpoints, const int *polypoints);
void floodfill(int x, int y, int border);

/* ── attributes ──────────────────────────────────────────────── */
void setcolor(int color);
int  getcolor(void);
void setbkcolor(int color);
int  getbkcolor(void);
int  getmaxcolor(void);
void setfillstyle(int pattern, int color);
void setfillpattern(const char *upattern, int color);
void getfillsettings(struct fillsettingstype *fillinfo);
void getfillpattern(char *pattern);
void setlinestyle(int linestyle, unsigned upattern, int thickness);
void getlinesettings(struct linesettingstype *lineinfo);
void setwritemode(int mode);
void setpalette(int colornum, int color);
void getpalette(struct palettetype *palette);
int  getpalettesize(void);
void setallpalette(const struct palettetype *palette);
void setrgbpalette(int colornum, int red, int green, int blue);

/* ── text ────────────────────────────────────────────────────── */
void outtext(const char *textstring);
void outtextxy(int x, int y, const char *textstring);
void settextstyle(int font, int direction, int charsize);
void settextjustify(int horiz, int vert);
void setusercharsize(int multx, int divx, int multy, int divy);
int  textheight(const char *textstring);
int  textwidth(const char *textstring);
void gettextsettings(struct textsettingstype *texttypeinfo);

/* ── images ──────────────────────────────────────────────────── */
unsigned imagesize(int left, int top, int right, int bottom);
void getimage(int left, int top, int right, int bottom, void *bitmap);
void putimage(int left, int top, const void *bitmap, int op);

/* ── pages ───────────────────────────────────────────────────── */
void setactivepage(int page);
void setvisualpage(int page);

/* ── honest stubs (no BGI files exist here) ──────────────────── */
int registerbgidriver(void *driver);
int registerbgifont(void *font);
int installuserdriver(const char *name, int (*detect)(void));
int installuserfont(const char *name);

/* ── PRABHA extras ───────────────────────────────────────────── */
void prabha_flush(void);              /* push the frame now            */
void prabha_set_auto_flush(int ms);   /* 0 = only on delay/getch/flush */
long prabha_frame_count(void);
const char *prabha_version(void);

/* delay lives in dos.h in Turbo C, but nearly every graphics program
 * uses it, so it is declared here as well. */
void delay(unsigned ms);

#ifdef __cplusplus
}
#endif
#endif /* PRABHA_GRAPHICS_H */
