/*
 * prabha_core.c — the whole Turbo C machine in one honest file.
 *
 * Everything graphics.h, conio.h and dos.h promise is implemented here
 * against a 640x480, 16-colour, 4-page framebuffer that is RLE-encoded and
 * streamed to the PRABHA panel. Nothing is simulated visually that is not
 * true in the buffer: getpixel reads what putpixel wrote, getimage/putimage
 * round-trip exactly, XOR_PUT really XORs.
 *
 * Protocol: one JSON object per line, prefixed "##PRABHA##", written to fd 3
 * when the extension provides it (so the program's own printf/scanf keep
 * stdout/stdin to themselves as far as text goes), falling back to stdout so
 * the runtime also works from a bare terminal for testing.
 *
 * MIT — Kanak Prabhakar.
 */
#define _DEFAULT_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdint.h>
#include <math.h>
#include <time.h>

#ifdef _WIN32
#  include <io.h>
#  include <windows.h>
#  define pr_write _write
#  define pr_read  _read
#  define pr_isatty _isatty
static void pr_sleep_ms(unsigned ms) { Sleep(ms); }
#else
#  include <unistd.h>
#  include <fcntl.h>
#  include <sys/select.h>
#  define pr_write write
#  define pr_read  read
#  define pr_isatty isatty
static void pr_sleep_ms(unsigned ms) { struct timespec t = { ms / 1000u, (long)(ms % 1000u) * 1000000L }; nanosleep(&t, NULL); }
#endif

#include "graphics.h"
#include "conio.h"
#include "font8x8_basic.h"

#define PR_W 640
#define PR_H 480
#define PR_PAGES 4
#define PR_VERSION "3.0.0-final"

/* ── state ───────────────────────────────────────────────────── */

static uint8_t *g_pages[PR_PAGES];
static int g_active_page = 0, g_visual_page = 0;
static uint8_t *g_fb = NULL;           /* pixels of the active page   */

static int g_inited = 0;
static int g_error = grOk;
static int g_mode = VGAHI;
static int g_crt = 0;                  /* restorecrtmode() flag       */

static int g_color = WHITE, g_bkcolor = BLACK;
static int g_cx = 0, g_cy = 0;         /* graphics cursor             */
static int g_write_mode = COPY_PUT;

static struct viewporttype g_vp = { 0, 0, PR_W - 1, PR_H - 1, 0 };
static struct arccoordstype g_arc = { 0, 0, 0, 0, 0, 0 };
static int g_aspx = 10000, g_aspy = 10000;

static int g_fill_pattern = SOLID_FILL, g_fill_color = WHITE;
static uint8_t g_user_fill[8] = { 0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF };

static int g_line_style = SOLID_LINE, g_line_thick = NORM_WIDTH;
static unsigned g_line_upattern = 0xFFFF;

static struct textsettingstype g_text = { DEFAULT_FONT, HORIZ_DIR, 1, LEFT_TEXT, TOP_TEXT };
static int g_user_multx = 1, g_user_divx = 1, g_user_multy = 1, g_user_divy = 1;

/* palette: BGI index -> BGI colour (identity until setpalette) */
static signed char g_palette[16] = { 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15 };
/* actual RGB for each palette slot (setrgbpalette can change these) */
static uint8_t g_rgb[16][3] = {
    {0,0,0},{0,0,170},{0,170,0},{0,170,170},{170,0,0},{170,0,170},
    {170,85,0},{170,170,170},{85,85,85},{85,85,255},{85,255,85},
    {85,255,255},{255,85,85},{255,85,255},{255,255,85},{255,255,255}
};
static int g_palette_dirty = 1;

/* conio */
#define TXT_COLS 80
#define TXT_ROWS 30                    /* 8x16 cells on 640x480       */
#define CELL_W 8
#define CELL_H 16
static int t_x = 1, t_y = 1;           /* 1-based cursor inside window */
static int t_attr = LIGHTGRAY;         /* fg | bg<<4                  */
static struct { int l, t, r, b; } t_win = { 1, 1, TXT_COLS, TXT_ROWS };
static int t_cursor = _NORMALCURSOR;
static int t_ungot = -1;

/* frame streaming */
static int g_proto_fd = -1;
static long g_frame_count = 0;
static int g_auto_flush_ms = 40;
static long g_last_flush_ms = 0;
static uint8_t *g_shadow = NULL;       /* last transmitted visual page */
static int g_shadow_valid = 0;

/* ── time & protocol plumbing ────────────────────────────────── */

static long now_ms(void) {
#ifdef _WIN32
    return (long)GetTickCount64();
#else
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long)(ts.tv_sec * 1000L + ts.tv_nsec / 1000000L);
#endif
}

static int proto_fd(void) {
    if (g_proto_fd != -1) return g_proto_fd;
    const char *env = getenv("PRABHA_PROTO_FD");
    if (env && *env) { g_proto_fd = atoi(env); return g_proto_fd; }
#ifndef _WIN32
    /* fd 3 exists when the extension opened the extra pipe */
    if (fcntl(3, F_GETFD) != -1) { g_proto_fd = 3; return 3; }
#endif
    g_proto_fd = 1;
    return 1;
}

static void proto_raw(const char *s, size_t n) {
    int fd = proto_fd();
    size_t off = 0;
    while (off < n) {
        long w = (long)pr_write(fd, s + off, (unsigned)(n - off));
        if (w <= 0) break;
        off += (size_t)w;
    }
}

static void proto_line(const char *json) {
    proto_raw("##PRABHA##", 10);
    proto_raw(json, strlen(json));
    proto_raw("\n", 1);
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char *b64(const uint8_t *data, size_t n, size_t *outlen) {
    size_t olen = 4 * ((n + 2) / 3);
    char *out = (char *)malloc(olen + 1);
    if (!out) return NULL;
    size_t i = 0, o = 0;
    while (i + 2 < n) {
        uint32_t v = (uint32_t)data[i] << 16 | (uint32_t)data[i+1] << 8 | data[i+2];
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = B64[(v >> 6) & 63];  out[o++] = B64[v & 63];
        i += 3;
    }
    if (i < n) {
        uint32_t v = (uint32_t)data[i] << 16 | (i + 1 < n ? (uint32_t)data[i+1] << 8 : 0);
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = (i + 1 < n) ? B64[(v >> 6) & 63] : '=';
        out[o++] = '=';
    }
    out[o] = 0;
    if (outlen) *outlen = o;
    return out;
}

/* RLE: (count 1..255, value) byte pairs. */
static uint8_t *rle(const uint8_t *src, size_t n, size_t *outn) {
    uint8_t *out = (uint8_t *)malloc(n ? 2 * n : 2);
    if (!out) return NULL;
    size_t o = 0, i = 0;
    while (i < n) {
        uint8_t v = src[i];
        size_t run = 1;
        while (i + run < n && src[i + run] == v && run < 255) run++;
        out[o++] = (uint8_t)run; out[o++] = v;
        i += run;
    }
    *outn = o;
    return out;
}

static void send_palette(void) {
    char buf[512];
    int o = snprintf(buf, sizeof buf, "{\"t\":\"palette\",\"rgb\":[");
    for (int i = 0; i < 16; i++) {
        int bgi = g_palette[i] & 15;
        o += snprintf(buf + o, sizeof buf - (size_t)o, "%s[%d,%d,%d]", i ? "," : "",
                      g_rgb[bgi][0], g_rgb[bgi][1], g_rgb[bgi][2]);
    }
    snprintf(buf + o, sizeof buf - (size_t)o, "]}");
    proto_line(buf);
    g_palette_dirty = 0;
}

/* Send the visual page: full on the first frame, bounding-box delta after. */
void prabha_flush(void) {
    if (!g_inited) return;
    if (g_palette_dirty) send_palette();
    uint8_t *vis = g_pages[g_visual_page];

    int y0 = 0, y1 = PR_H - 1, x0 = 0, x1 = PR_W - 1;
    int full = !g_shadow_valid;
    if (!full) {
        y0 = -1;
        for (int y = 0; y < PR_H; y++)
            if (memcmp(vis + y * PR_W, g_shadow + y * PR_W, PR_W)) { y0 = y; break; }
        if (y0 == -1) return;                     /* nothing changed */
        for (int y = PR_H - 1; y >= y0; y--)
            if (memcmp(vis + y * PR_W, g_shadow + y * PR_W, PR_W)) { y1 = y; break; }
        x0 = PR_W; x1 = -1;
        for (int y = y0; y <= y1; y++) {
            const uint8_t *a = vis + y * PR_W, *b = g_shadow + y * PR_W;
            int lo = 0, hi = PR_W - 1;
            while (lo < PR_W && a[lo] == b[lo]) lo++;
            if (lo == PR_W) continue;
            while (hi > lo && a[hi] == b[hi]) hi--;
            if (lo < x0) x0 = lo;
            if (hi > x1) x1 = hi;
        }
        if (x1 < x0) return;
    }

    int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    uint8_t *box = (uint8_t *)malloc((size_t)bw * (size_t)bh);
    if (!box) return;
    for (int y = 0; y < bh; y++)
        memcpy(box + (size_t)y * (size_t)bw, vis + (size_t)(y0 + y) * PR_W + x0, (size_t)bw);

    size_t rn = 0; uint8_t *r = rle(box, (size_t)bw * (size_t)bh, &rn);
    free(box);
    if (!r) return;
    size_t bn = 0; char *b = b64(r, rn, &bn);
    free(r);
    if (!b) return;

    size_t head = 160;
    char *line = (char *)malloc(bn + head);
    if (line) {
        int o = snprintf(line, head, "{\"t\":\"frame\",\"n\":%ld,\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"full\":%d,\"rle\":\"",
                         g_frame_count, x0, y0, bw, bh, full ? 1 : 0);
        memcpy(line + o, b, bn);
        memcpy(line + o + (long)bn, "\"}", 3);
        proto_line(line);
        free(line);
    }
    free(b);
    memcpy(g_shadow, vis, (size_t)PR_W * PR_H);
    g_shadow_valid = 1;
    g_frame_count++;
    g_last_flush_ms = now_ms();
}

static void maybe_flush(void) {
    if (g_auto_flush_ms > 0 && now_ms() - g_last_flush_ms >= g_auto_flush_ms) prabha_flush();
}

void prabha_set_auto_flush(int ms) { g_auto_flush_ms = ms; }
long prabha_frame_count(void) { return g_frame_count; }
const char *prabha_version(void) { return PR_VERSION; }

/* ── lifecycle ───────────────────────────────────────────────── */

static void prabha_atexit(void) {
    if (g_inited) {
        prabha_flush();
        proto_line("{\"t\":\"end\"}");
    }
}

void initgraph(int *graphdriver, int *graphmode, const char *pathtodriver) {
    (void)pathtodriver;
    if (g_inited) { g_error = grOk; return; }
    for (int p = 0; p < PR_PAGES; p++) {
        g_pages[p] = (uint8_t *)calloc((size_t)PR_W * PR_H, 1);
        if (!g_pages[p]) { g_error = grNoLoadMem; return; }
    }
    g_shadow = (uint8_t *)calloc((size_t)PR_W * PR_H, 1);
    if (!g_shadow) { g_error = grNoLoadMem; return; }
    g_fb = g_pages[0];
    g_inited = 1;
    g_error = grOk;
    if (graphdriver) *graphdriver = VGA;
    if (graphmode)   { if (*graphmode == DETECT || 1) *graphmode = VGAHI; g_mode = VGAHI; }
    graphdefaults();
    atexit(prabha_atexit);
    char buf[128];
    snprintf(buf, sizeof buf, "{\"t\":\"init\",\"w\":%d,\"h\":%d,\"version\":\"%s\"}", PR_W, PR_H, PR_VERSION);
    proto_line(buf);
    send_palette();
    prabha_flush();
}

void initwindow(int width, int height) {
    (void)width; (void)height;              /* one true mode: 640x480 */
    int d = DETECT, m = VGAHI;
    initgraph(&d, &m, "");
}

void closegraph(void) {
    if (!g_inited) return;
    prabha_flush();
    proto_line("{\"t\":\"end\"}");
    g_inited = 0;
    for (int p = 0; p < PR_PAGES; p++) { free(g_pages[p]); g_pages[p] = NULL; }
    free(g_shadow); g_shadow = NULL;
    g_fb = NULL;
}

void detectgraph(int *graphdriver, int *graphmode) {
    if (graphdriver) *graphdriver = VGA;
    if (graphmode)   *graphmode = VGAHI;
    g_error = grOk;
}

int graphresult(void) { int e = g_error; g_error = grOk; return e; }

const char *grapherrormsg(int errorcode) {
    switch (errorcode) {
        case grOk:            return "No error";
        case grNoInitGraph:   return "(BGI) graphics not installed (use initgraph)";
        case grNotDetected:   return "Graphics hardware not detected";
        case grFileNotFound:  return "Device driver file not found";
        case grInvalidDriver: return "Invalid device driver file";
        case grNoLoadMem:     return "Not enough memory to load driver";
        case grNoScanMem:     return "Out of memory in scan fill";
        case grNoFloodMem:    return "Out of memory in flood fill";
        case grFontNotFound:  return "Font file not found";
        case grNoFontMem:     return "Not enough memory to load font";
        case grInvalidMode:   return "Invalid graphics mode";
        case grError:         return "Graphics error";
        case grIOerror:       return "Graphics I/O error";
        case grInvalidFont:   return "Invalid font file";
        case grInvalidFontNum:return "Invalid font number";
        default:              return "Unknown graphics error";
    }
}

int  getgraphmode(void) { return g_mode; }
void setgraphmode(int mode) { g_mode = mode; g_crt = 0; if (g_inited) { cleardevice(); graphdefaults(); } }
void restorecrtmode(void) { g_crt = 1; }
int  getmaxmode(void) { return VGAHI; }
const char *getmodename(int m) { return m == VGAHI ? "640 x 480 VGA" : m == VGAMED ? "640 x 350 VGA" : "640 x 200 VGA"; }
const char *getdrivername(void) { return "PRABHA-VGA"; }

void graphdefaults(void) {
    g_color = WHITE; g_bkcolor = BLACK;
    g_cx = g_cy = 0;
    g_vp.left = 0; g_vp.top = 0; g_vp.right = PR_W - 1; g_vp.bottom = PR_H - 1; g_vp.clip = 0;
    g_fill_pattern = SOLID_FILL; g_fill_color = WHITE;
    g_line_style = SOLID_LINE; g_line_thick = NORM_WIDTH; g_line_upattern = 0xFFFF;
    g_write_mode = COPY_PUT;
    g_text.font = DEFAULT_FONT; g_text.direction = HORIZ_DIR; g_text.charsize = 1;
    g_text.horiz = LEFT_TEXT; g_text.vert = TOP_TEXT;
    for (int i = 0; i < 16; i++) g_palette[i] = (signed char)i;
    g_aspx = 10000; g_aspy = 10000;
    g_palette_dirty = 1;
}

/* ── viewport & cursor ───────────────────────────────────────── */

int getmaxx(void) { return PR_W - 1; }
int getmaxy(void) { return PR_H - 1; }
int getx(void) { return g_cx; }
int gety(void) { return g_cy; }
void moveto(int x, int y) { g_cx = x; g_cy = y; }
void moverel(int dx, int dy) { g_cx += dx; g_cy += dy; }

void setviewport(int left, int top, int right, int bottom, int clip) {
    if (left < 0 || top < 0 || right >= PR_W || bottom >= PR_H || left > right || top > bottom) {
        g_error = grError; return;
    }
    g_vp.left = left; g_vp.top = top; g_vp.right = right; g_vp.bottom = bottom; g_vp.clip = clip;
    g_cx = g_cy = 0;
}

void getviewsettings(struct viewporttype *v) { if (v) *v = g_vp; }

/* ── the pixel — everything above lands here ─────────────────── */

static void px(int x, int y, int color) {
    x += g_vp.left; y += g_vp.top;
    if (g_vp.clip) {
        if (x < g_vp.left || x > g_vp.right || y < g_vp.top || y > g_vp.bottom) return;
    }
    if (x < 0 || x >= PR_W || y < 0 || y >= PR_H) return;
    uint8_t *cell = g_fb + (size_t)y * PR_W + x;
    if (g_write_mode == XOR_PUT) *cell = (uint8_t)((*cell ^ color) & 15);
    else *cell = (uint8_t)(color & 15);
}

void putpixel(int x, int y, int color) { px(x, y, color); maybe_flush(); }

unsigned getpixel(int x, int y) {
    x += g_vp.left; y += g_vp.top;
    if (x < 0 || x >= PR_W || y < 0 || y >= PR_H) return 0;
    return g_fb[(size_t)y * PR_W + x];
}

/* ── lines ───────────────────────────────────────────────────── */

static unsigned style_bits(void) {
    switch (g_line_style) {
        case SOLID_LINE:   return 0xFFFF;
        case DOTTED_LINE:  return 0xCCCC;
        case CENTER_LINE:  return 0xF8F8;
        case DASHED_LINE:  return 0xF0F0;
        case USERBIT_LINE: return g_line_upattern & 0xFFFF;
        default:           return 0xFFFF;
    }
}

static void thick_dot(int x, int y, int color) {
    if (g_line_thick >= THICK_WIDTH) {
        for (int dy = -1; dy <= 1; dy++)
            for (int dx = -1; dx <= 1; dx++)
                px(x + dx, y + dy, color);
    } else px(x, y, color);
}

static void raw_line(int x1, int y1, int x2, int y2, int color) {
    unsigned bits = style_bits();
    int dx = abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
    int dy = -abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
    int err = dx + dy, step = 0;
    for (;;) {
        if (bits & (1u << (step & 15))) thick_dot(x1, y1, color);
        step++;
        if (x1 == x2 && y1 == y2) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x1 += sx; }
        if (e2 <= dx) { err += dx; y1 += sy; }
    }
}

void line(int x1, int y1, int x2, int y2) { raw_line(x1, y1, x2, y2, g_color); maybe_flush(); }
void lineto(int x, int y) { raw_line(g_cx, g_cy, x, y, g_color); g_cx = x; g_cy = y; maybe_flush(); }
void linerel(int dx, int dy) { lineto(g_cx + dx, g_cy + dy); }

void rectangle(int l, int t, int r, int b) {
    raw_line(l, t, r, t, g_color); raw_line(r, t, r, b, g_color);
    raw_line(r, b, l, b, g_color); raw_line(l, b, l, t, g_color);
    maybe_flush();
}

void drawpoly(int n, const int *p) {
    for (int i = 0; i + 1 < n; i++)
        raw_line(p[2*i], p[2*i+1], p[2*i+2], p[2*i+3], g_color);
    maybe_flush();
}

/* ── fill machinery ──────────────────────────────────────────── */

static const uint8_t PATTERNS[12][8] = {
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},   /* EMPTY      */
    {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF},   /* SOLID      */
    {0xFF,0xFF,0x00,0x00,0xFF,0xFF,0x00,0x00},   /* LINE       */
    {0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80},   /* LTSLASH    */
    {0x07,0x0E,0x1C,0x38,0x70,0xE0,0xC1,0x83},   /* SLASH      */
    {0xE0,0x70,0x38,0x1C,0x0E,0x07,0x83,0xC1},   /* BKSLASH    */
    {0x80,0x40,0x20,0x10,0x08,0x04,0x02,0x01},   /* LTBKSLASH  */
    {0xFF,0x88,0x88,0x88,0xFF,0x88,0x88,0x88},   /* HATCH      */
    {0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81},   /* XHATCH     */
    {0xCC,0x33,0xCC,0x33,0xCC,0x33,0xCC,0x33},   /* INTERLEAVE */
    {0x80,0x00,0x08,0x00,0x80,0x00,0x08,0x00},   /* WIDE_DOT   */
    {0x88,0x00,0x22,0x00,0x88,0x00,0x22,0x00}    /* CLOSE_DOT  */
};

static int fill_bit(int x, int y) {
    const uint8_t *pat = g_fill_pattern == USER_FILL ? g_user_fill
                        : PATTERNS[g_fill_pattern >= 0 && g_fill_pattern < 12 ? g_fill_pattern : SOLID_FILL];
    return (pat[y & 7] >> (7 - (x & 7))) & 1;
}

/* one horizontal span through the pattern; bg shows through the holes */
static void fill_span(int x1, int x2, int y) {
    if (x1 > x2) { int t = x1; x1 = x2; x2 = t; }
    for (int x = x1; x <= x2; x++)
        px(x, y, fill_bit(x, y) ? g_fill_color : g_bkcolor);
}

void setfillstyle(int pattern, int color) {
    if (pattern < EMPTY_FILL || pattern > USER_FILL) { g_error = grError; return; }
    g_fill_pattern = pattern; g_fill_color = color & 15;
}

void setfillpattern(const char *up, int color) {
    if (up) memcpy(g_user_fill, up, 8);
    g_fill_pattern = USER_FILL; g_fill_color = color & 15;
}

void getfillsettings(struct fillsettingstype *f) {
    if (f) { f->pattern = g_fill_pattern; f->color = g_fill_color; }
}

void getfillpattern(char *p) { if (p) memcpy(p, g_user_fill, 8); }

void setlinestyle(int linestyle, unsigned upattern, int thickness) {
    if (linestyle < SOLID_LINE || linestyle > USERBIT_LINE) { g_error = grError; return; }
    g_line_style = linestyle; g_line_upattern = upattern;
    g_line_thick = thickness == THICK_WIDTH ? THICK_WIDTH : NORM_WIDTH;
}

void getlinesettings(struct linesettingstype *l) {
    if (l) { l->linestyle = g_line_style; l->upattern = g_line_upattern; l->thickness = g_line_thick; }
}

void setwritemode(int mode) { g_write_mode = mode == XOR_PUT ? XOR_PUT : COPY_PUT; }

void setcolor(int color) { g_color = color & 15; }
int  getcolor(void) { return g_color; }
void setbkcolor(int color) {
    /* True BGI behaviour: background is palette slot 0 remapped, so pixels
     * that hold index 0 change colour without touching the framebuffer. */
    g_bkcolor = color & 15;
    g_palette[0] = (signed char)(color & 15);
    g_palette_dirty = 1;
    maybe_flush();
}
int  getbkcolor(void) { return g_bkcolor; }
int  getmaxcolor(void) { return 15; }

void setpalette(int colornum, int color) {
    if (colornum < 0 || colornum > 15) { g_error = grError; return; }
    g_palette[colornum] = (signed char)(color & 15);
    g_palette_dirty = 1;
    maybe_flush();
}

void getpalette(struct palettetype *p) {
    if (!p) return;
    p->size = 16;
    memcpy(p->colors, g_palette, 16);
}

int getpalettesize(void) { return 16; }

void setallpalette(const struct palettetype *p) {
    if (!p) return;
    int n = p->size > 16 ? 16 : p->size;
    for (int i = 0; i < n; i++)
        if (p->colors[i] != -1) g_palette[i] = p->colors[i];
    g_palette_dirty = 1;
    maybe_flush();
}

void setrgbpalette(int colornum, int red, int green, int blue) {
    if (colornum < 0 || colornum > 15) { g_error = grError; return; }
    g_rgb[colornum][0] = (uint8_t)(red & 255);
    g_rgb[colornum][1] = (uint8_t)(green & 255);
    g_rgb[colornum][2] = (uint8_t)(blue & 255);
    g_palette_dirty = 1;
    maybe_flush();
}

/* ── bars & polygons ─────────────────────────────────────────── */

void bar(int l, int t, int r, int b) {
    if (l > r) { int q = l; l = r; r = q; }
    if (t > b) { int q = t; t = b; b = q; }
    for (int y = t; y <= b; y++) fill_span(l, r, y);
    maybe_flush();
}

void bar3d(int l, int t, int r, int b, int depth, int topflag) {
    bar(l, t, r, b);
    raw_line(l, t, r, t, g_color); raw_line(r, t, r, b, g_color);
    raw_line(r, b, l, b, g_color); raw_line(l, b, l, t, g_color);
    if (depth > 0) {
        raw_line(r, b, r + depth, b - depth, g_color);
        raw_line(r + depth, b - depth, r + depth, t - depth, g_color);
        raw_line(r, t, r + depth, t - depth, g_color);
        if (topflag) {
            raw_line(l, t, l + depth, t - depth, g_color);
            raw_line(l + depth, t - depth, r + depth, t - depth, g_color);
        }
    }
    maybe_flush();
}

/* scanline polygon fill (even-odd), then the outline on top like BGI */
void fillpoly(int n, const int *p) {
    if (n < 3) { drawpoly(n, p); return; }
    int ymin = p[1], ymax = p[1];
    for (int i = 1; i < n; i++) {
        if (p[2*i+1] < ymin) ymin = p[2*i+1];
        if (p[2*i+1] > ymax) ymax = p[2*i+1];
    }
    int *xs = (int *)malloc(sizeof(int) * (size_t)n);
    if (!xs) { g_error = grNoScanMem; return; }
    for (int y = ymin; y <= ymax; y++) {
        int cnt = 0;
        for (int i = 0; i < n; i++) {
            int j = (i + 1) % n;
            int y1 = p[2*i+1], y2 = p[2*j+1];
            int x1 = p[2*i],   x2 = p[2*j];
            if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
                double t = (double)(y - y1) / (double)(y2 - y1);
                xs[cnt++] = (int)lround(x1 + t * (x2 - x1));
            }
        }
        for (int a = 1; a < cnt; a++) {            /* insertion sort */
            int v = xs[a], b2 = a - 1;
            while (b2 >= 0 && xs[b2] > v) { xs[b2+1] = xs[b2]; b2--; }
            xs[b2+1] = v;
        }
        for (int k = 0; k + 1 < cnt; k += 2) fill_span(xs[k], xs[k+1], y);
    }
    free(xs);
    for (int i = 0; i < n; i++) {
        int j = (i + 1) % n;
        raw_line(p[2*i], p[2*i+1], p[2*j], p[2*j+1], g_color);
    }
    maybe_flush();
}

/* ── circles, ellipses, arcs ─────────────────────────────────── */

static void plot4(int cx, int cy, int x, int y, int color) {
    thick_dot(cx + x, cy + y, color); thick_dot(cx - x, cy + y, color);
    thick_dot(cx + x, cy - y, color); thick_dot(cx - x, cy - y, color);
}

static void raw_ellipse_outline(int cx, int cy, int rx, int ry, int color) {
    if (rx <= 0 && ry <= 0) { thick_dot(cx, cy, color); return; }
    if (rx <= 0) { raw_line(cx, cy - ry, cx, cy + ry, color); return; }
    if (ry <= 0) { raw_line(cx - rx, cy, cx + rx, cy, color); return; }
    long a2 = (long)rx * rx, b2 = (long)ry * ry;
    long x = 0, y = ry;
    long dx = 0, dy = 2 * a2 * y;
    long err = b2 - a2 * ry + a2 / 4;
    while (dx < dy) {
        plot4(cx, cy, (int)x, (int)y, color);
        if (err >= 0) { y--; dy -= 2 * a2; err -= dy; }
        x++; dx += 2 * b2; err += b2 + dx;
    }
    err = b2 * (x * 2 + 1) * (x * 2 + 1) / 4 + a2 * (y - 1) * (y - 1) - a2 * b2;
    while (y >= 0) {
        plot4(cx, cy, (int)x, (int)y, color);
        if (err <= 0) { x++; dx += 2 * b2; err += dx; }
        y--; dy -= 2 * a2; err += a2 - dy;
    }
}

void circle(int x, int y, int radius) {
    /* BGI applied the aspect ratio; ours is 1:1 so a circle is a circle */
    raw_ellipse_outline(x, y, radius, radius, g_color);
    g_arc.x = x; g_arc.y = y;
    g_arc.xstart = x + radius; g_arc.ystart = y;
    g_arc.xend = x + radius;   g_arc.yend = y;
    maybe_flush();
}

static void arc_points(int cx, int cy, int rx, int ry, int a1, int a2, int draw_line_flag) {
    while (a2 < a1) a2 += 360;
    double step = 1.0 / (rx > ry ? rx : ry);
    if (step > 0.01745) step = 0.01745;           /* at least 1 degree  */
    int firstx = 0, firsty = 0, lastx = 0, lasty = 0, first = 1;
    for (double a = a1 * M_PI / 180.0; a <= a2 * M_PI / 180.0 + 1e-9; a += step) {
        int x = cx + (int)lround(rx * cos(a));
        int y = cy - (int)lround(ry * sin(a));
        if (first) { firstx = x; firsty = y; first = 0; }
        else if (draw_line_flag) raw_line(lastx, lasty, x, y, g_color);
        else thick_dot(x, y, g_color);
        lastx = x; lasty = y;
    }
    g_arc.x = cx; g_arc.y = cy;
    g_arc.xstart = firstx; g_arc.ystart = firsty;
    g_arc.xend = lastx;    g_arc.yend = lasty;
}

void arc(int x, int y, int stangle, int endangle, int radius) {
    arc_points(x, y, radius, radius, stangle, endangle, 1);
    maybe_flush();
}

void ellipse(int x, int y, int stangle, int endangle, int xradius, int yradius) {
    if (stangle == 0 && (endangle == 360 || endangle % 360 == 0) && endangle != 0)
        raw_ellipse_outline(x, y, xradius, yradius, g_color);
    else
        arc_points(x, y, xradius, yradius, stangle, endangle, 1);
    maybe_flush();
}

void getarccoords(struct arccoordstype *a) { if (a) *a = g_arc; }
void getaspectratio(int *xa, int *ya) { if (xa) *xa = g_aspx; if (ya) *ya = g_aspy; }
void setaspectratio(int xa, int ya) { g_aspx = xa; g_aspy = ya; }

static void fill_ellipse_spans(int cx, int cy, int rx, int ry) {
    if (rx <= 0 || ry <= 0) return;
    for (int dy = -ry; dy <= ry; dy++) {
        double f = 1.0 - (double)dy * dy / ((double)ry * ry);
        if (f < 0) continue;
        int half = (int)floor(rx * sqrt(f) + 0.5);
        fill_span(cx - half, cx + half, cy + dy);
    }
}

void fillellipse(int x, int y, int xradius, int yradius) {
    fill_ellipse_spans(x, y, xradius, yradius);
    raw_ellipse_outline(x, y, xradius, yradius, g_color);
    maybe_flush();
}

/* filled wedge shared by pieslice and sector */
static void wedge(int cx, int cy, int a1, int a2, int rx, int ry) {
    while (a2 < a1) a2 += 360;
    /* fill by triangle fan of thin polygons through the fill pattern */
    double step = 2.0;                           /* degrees            */
    double a = a1;
    int px1 = cx + (int)lround(rx * cos(a * M_PI / 180.0));
    int py1 = cy - (int)lround(ry * sin(a * M_PI / 180.0));
    while (a < a2) {
        double b = a + step; if (b > a2) b = a2;
        int px2 = cx + (int)lround(rx * cos(b * M_PI / 180.0));
        int py2 = cy - (int)lround(ry * sin(b * M_PI / 180.0));
        int tri[6] = { cx, cy, px1, py1, px2, py2 };
        /* local scanline fill of the triangle */
        int ymin = tri[1], ymax = tri[1];
        for (int i = 1; i < 3; i++) { if (tri[2*i+1] < ymin) ymin = tri[2*i+1]; if (tri[2*i+1] > ymax) ymax = tri[2*i+1]; }
        for (int y = ymin; y <= ymax; y++) {
            int xs[3], cnt = 0;
            for (int i = 0; i < 3; i++) {
                int j = (i + 1) % 3;
                int y1 = tri[2*i+1], y2 = tri[2*j+1], x1 = tri[2*i], x2 = tri[2*j];
                if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y))
                    xs[cnt++] = (int)lround(x1 + (double)(y - y1) / (y2 - y1) * (x2 - x1));
            }
            if (cnt >= 2) {
                if (xs[0] > xs[1]) { int t = xs[0]; xs[0] = xs[1]; xs[1] = t; }
                fill_span(xs[0], xs[1], y);
            }
        }
        px1 = px2; py1 = py2;
        a = b;
    }
}

void pieslice(int x, int y, int stangle, int endangle, int radius) {
    wedge(x, y, stangle, endangle, radius, radius);
    arc_points(x, y, radius, radius, stangle, endangle, 1);
    raw_line(x, y, g_arc.xstart, g_arc.ystart, g_color);
    raw_line(x, y, g_arc.xend, g_arc.yend, g_color);
    maybe_flush();
}

void sector(int x, int y, int stangle, int endangle, int xradius, int yradius) {
    wedge(x, y, stangle, endangle, xradius, yradius);
    arc_points(x, y, xradius, yradius, stangle, endangle, 1);
    raw_line(x, y, g_arc.xstart, g_arc.ystart, g_color);
    raw_line(x, y, g_arc.xend, g_arc.yend, g_color);
    maybe_flush();
}

/* ── flood fill (scanline, bounded by border colour) ─────────── */

void floodfill(int x, int y, int border) {
    border &= 15;
    int W = PR_W, H = PR_H;
    int ax = x + g_vp.left, ay = y + g_vp.top;
    if (ax < 0 || ax >= W || ay < 0 || ay >= H) return;
    uint8_t start = g_fb[(size_t)ay * W + ax];
    if (start == (uint8_t)border) return;

    /* seeds are absolute coordinates; capacity grows as needed */
    size_t cap = 4096, top = 0;
    int *stack = (int *)malloc(cap * 2 * sizeof(int));
    if (!stack) { g_error = grNoFloodMem; return; }
    uint8_t *seen = (uint8_t *)calloc((size_t)W * H, 1);
    if (!seen) { free(stack); g_error = grNoFloodMem; return; }

    stack[0] = ax; stack[1] = ay; top = 1;
    while (top) {
        top--;
        int sx = stack[top * 2], sy = stack[top * 2 + 1];
        if (sy < 0 || sy >= H) continue;
        int lo = sx, hi = sx;
        uint8_t *row = g_fb + (size_t)sy * W;
        if (seen[(size_t)sy * W + sx] || row[sx] == (uint8_t)border) continue;
        while (lo > 0 && row[lo - 1] != (uint8_t)border && !seen[(size_t)sy * W + lo - 1]) lo--;
        while (hi < W - 1 && row[hi + 1] != (uint8_t)border && !seen[(size_t)sy * W + hi + 1]) hi++;
        for (int i = lo; i <= hi; i++) {
            seen[(size_t)sy * W + i] = 1;
            row[i] = (uint8_t)(fill_bit(i - g_vp.left, sy - g_vp.top) ? g_fill_color : g_bkcolor);
        }
        for (int dir = -1; dir <= 1; dir += 2) {
            int ny = sy + dir;
            if (ny < 0 || ny >= H) continue;
            uint8_t *nrow = g_fb + (size_t)ny * W;
            for (int i = lo; i <= hi; i++) {
                if (nrow[i] != (uint8_t)border && !seen[(size_t)ny * W + i]) {
                    if (top + 1 > cap) {
                        cap *= 2;
                        int *ns = (int *)realloc(stack, cap * 2 * sizeof(int));
                        if (!ns) { free(stack); free(seen); g_error = grNoFloodMem; return; }
                        stack = ns;
                    }
                    stack[top * 2] = i; stack[top * 2 + 1] = ny; top++;
                    while (i <= hi && nrow[i] != (uint8_t)border && !seen[(size_t)ny * W + i]) i++;
                }
            }
        }
    }
    free(stack); free(seen);
    maybe_flush();
}

/* ── text (graphics) ─────────────────────────────────────────── */

static void char_size(int *cw, int *ch) {
    int s = g_text.charsize;
    if (s == USER_CHAR_SIZE) {
        *cw = 8 * g_user_multx / (g_user_divx ? g_user_divx : 1);
        *ch = 8 * g_user_multy / (g_user_divy ? g_user_divy : 1);
    } else {
        if (s < 1) s = 1;
        if (s > 10) s = 10;
        /* Stroked fonts sat a little larger than the bitmap font; scale them
         * up a step so old layouts land roughly where they used to. */
        int mul = (g_text.font == DEFAULT_FONT || g_text.font == SMALL_FONT) ? s : s + 1;
        *cw = 8 * mul; *ch = 8 * mul;
    }
    if (*cw < 1) *cw = 1;
    if (*ch < 1) *ch = 1;
}

int textwidth(const char *s)  { int cw, ch2; char_size(&cw, &ch2); return (int)strlen(s ? s : "") * (g_text.direction == HORIZ_DIR ? cw : ch2); }
int textheight(const char *s) { (void)s; int cw, ch2; char_size(&cw, &ch2); return g_text.direction == HORIZ_DIR ? ch2 : cw; }

static void draw_char(int x, int y, unsigned char c, int cw, int ch) {
    if (c > 127) c = '?';
    const char *glyph = font8x8_basic[c];
    for (int gy = 0; gy < ch; gy++) {
        int sy = gy * 8 / ch;
        unsigned char bits = (unsigned char)glyph[sy];
        for (int gx = 0; gx < cw; gx++) {
            int sx = gx * 8 / cw;
            if (bits & (1 << sx)) {
                if (g_text.direction == HORIZ_DIR) px(x + gx, y + gy, g_color);
                else px(x + gy, y - gx, g_color);      /* rotate 90° CCW */
            }
        }
    }
}

static void draw_string(int x, int y, const char *s) {
    int cw, ch; char_size(&cw, &ch);
    int len = (int)strlen(s);
    int w = len * cw;

    if (g_text.direction == HORIZ_DIR) {
        if (g_text.horiz == CENTER_TEXT) x -= w / 2;
        else if (g_text.horiz == RIGHT_TEXT) x -= w;
        if (g_text.vert == CENTER_TEXT) y -= ch / 2;
        else if (g_text.vert == BOTTOM_TEXT) y -= ch;
        for (int i = 0; i < len; i++) draw_char(x + i * cw, y, (unsigned char)s[i], cw, ch);
    } else {
        if (g_text.horiz == CENTER_TEXT) y += w / 2;
        else if (g_text.horiz == LEFT_TEXT) { /* baseline start */ }
        else if (g_text.horiz == RIGHT_TEXT) y += w;
        if (g_text.vert == CENTER_TEXT) x -= ch / 2;
        else if (g_text.vert == BOTTOM_TEXT) x -= ch;
        for (int i = 0; i < len; i++) draw_char(x, y - i * cw, (unsigned char)s[i], cw, ch);
    }
}

void outtextxy(int x, int y, const char *s) { if (s) draw_string(x, y, s); maybe_flush(); }

void outtext(const char *s) {
    if (!s) return;
    draw_string(g_cx, g_cy, s);
    if (g_text.direction == HORIZ_DIR && g_text.horiz == LEFT_TEXT)
        g_cx += textwidth(s);
    maybe_flush();
}

void settextstyle(int font, int direction, int charsize) {
    if (font < DEFAULT_FONT || font > BOLD_FONT) { g_error = grInvalidFontNum; return; }
    g_text.font = font;
    g_text.direction = direction == VERT_DIR ? VERT_DIR : HORIZ_DIR;
    g_text.charsize = charsize;
}

void settextjustify(int horiz, int vert) {
    if (horiz < 0 || horiz > 2 || vert < 0 || vert > 2) { g_error = grError; return; }
    g_text.horiz = horiz; g_text.vert = vert;
}

void setusercharsize(int multx, int divx, int multy, int divy) {
    g_user_multx = multx; g_user_divx = divx; g_user_multy = multy; g_user_divy = divy;
}

void gettextsettings(struct textsettingstype *t) { if (t) *t = g_text; }

/* ── images ──────────────────────────────────────────────────── */

typedef struct { int32_t w, h; } ImgHead;

unsigned imagesize(int l, int t, int r, int b) {
    int w = abs(r - l) + 1, h = abs(b - t) + 1;
    return (unsigned)(sizeof(ImgHead) + (size_t)w * (size_t)h);
}

void getimage(int l, int t, int r, int b, void *bitmap) {
    if (!bitmap) return;
    if (l > r) { int q = l; l = r; r = q; }
    if (t > b) { int q = t; t = b; b = q; }
    int w = r - l + 1, h = b - t + 1;
    ImgHead *hd = (ImgHead *)bitmap;
    hd->w = w; hd->h = h;
    uint8_t *dst = (uint8_t *)bitmap + sizeof(ImgHead);
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            dst[(size_t)y * w + x] = (uint8_t)getpixel(l + x, t + y);
}

void putimage(int l, int t, const void *bitmap, int op) {
    if (!bitmap) return;
    const ImgHead *hd = (const ImgHead *)bitmap;
    const uint8_t *srcp = (const uint8_t *)bitmap + sizeof(ImgHead);
    int save_mode = g_write_mode; g_write_mode = COPY_PUT;
    for (int y = 0; y < hd->h; y++) {
        for (int x = 0; x < hd->w; x++) {
            uint8_t s = srcp[(size_t)y * hd->w + x];
            uint8_t d = (uint8_t)getpixel(l + x, t + y);
            uint8_t v;
            switch (op) {
                case XOR_PUT: v = (uint8_t)((d ^ s) & 15); break;
                case OR_PUT:  v = (uint8_t)((d | s) & 15); break;
                case AND_PUT: v = (uint8_t)(d & s & 15);   break;
                case NOT_PUT: v = (uint8_t)((~s) & 15);    break;
                default:      v = s;                       break;
            }
            px(l + x, t + y, v);
        }
    }
    g_write_mode = save_mode;
    maybe_flush();
}

/* ── pages ───────────────────────────────────────────────────── */

void setactivepage(int page) {
    if (page < 0 || page >= PR_PAGES) { g_error = grError; return; }
    g_active_page = page;
    g_fb = g_pages[page];
}

void setvisualpage(int page) {
    if (page < 0 || page >= PR_PAGES) { g_error = grError; return; }
    g_visual_page = page;
    prabha_flush();                    /* flipping is meant to be seen now */
}

/* ── clears ──────────────────────────────────────────────────── */

void cleardevice(void) {
    memset(g_fb, 0, (size_t)PR_W * PR_H);   /* index 0 = background slot */
    g_cx = g_cy = 0;
    maybe_flush();
}

void clearviewport(void) {
    for (int y = g_vp.top; y <= g_vp.bottom; y++)
        memset(g_fb + (size_t)y * PR_W + g_vp.left, 0, (size_t)(g_vp.right - g_vp.left + 1));
    g_cx = g_cy = 0;
    maybe_flush();
}

/* ── honest stubs ────────────────────────────────────────────── */

int registerbgidriver(void *driver) { (void)driver; return grInvalidDriver; }
int registerbgifont(void *font)     { (void)font;   return grInvalidFont; }
int installuserdriver(const char *name, int (*detect)(void)) { (void)name; (void)detect; return grInvalidDriver; }
int installuserfont(const char *name) { (void)name; return grInvalidFont; }

/* ── timing & sound ──────────────────────────────────────────── */

void delay(unsigned ms) {
    prabha_flush();                    /* animations rely on this order */
    pr_sleep_ms(ms);
}

#ifdef _WIN32
void sleep(unsigned seconds) { delay(seconds * 1000u); }
#endif /* POSIX already has sleep() in unistd.h */

void sound(unsigned frequency) {
    char buf[64];
    snprintf(buf, sizeof buf, "{\"t\":\"sound\",\"hz\":%u}", frequency);
    proto_line(buf);
}

void nosound(void) { proto_line("{\"t\":\"sound\",\"hz\":0}"); }

/* ── keyboard (conio) ────────────────────────────────────────── */

static int stdin_ready(void) {
#ifdef _WIN32
    HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
    DWORD avail = 0;
    if (PeekNamedPipe(h, NULL, 0, NULL, &avail, NULL)) return avail > 0;
    return _kbhit();
#else
    fd_set fds; FD_ZERO(&fds); FD_SET(0, &fds);
    struct timeval tv = { 0, 0 };
    return select(1, &fds, NULL, NULL, &tv) > 0;
#endif
}

int kbhit(void) {
    if (t_ungot != -1) return 1;
    prabha_flush();                    /* game loops poll this — show them */
    return stdin_ready();
}

int getch(void) {
    if (t_ungot != -1) { int c = t_ungot; t_ungot = -1; return c; }
    prabha_flush();
    proto_line("{\"t\":\"input\",\"mode\":\"getch\"}");
    unsigned char c = 0;
    long n = (long)pr_read(0, &c, 1);
    if (n <= 0) return 27;             /* stream closed — behave like ESC */
    return c;
}

int getche(void) { int c = getch(); if (c >= 32 && c < 127) putch(c); return c; }
int ungetch(int ch) { t_ungot = ch; return ch; }

char *cgets(char *str) {
    if (!str) return NULL;
    int max = (unsigned char)str[0];
    int n = 0;
    for (;;) {
        int c = getch();
        if (c == '\r' || c == '\n') break;
        if (c == 8 || c == 127) { if (n > 0) { n--; putch(8); } continue; }
        if (n < max - 1 && c >= 32 && c < 127) { str[2 + n++] = (char)c; putch(c); }
    }
    str[1] = (char)n;
    str[2 + n] = 0;
    return str + 2;
}

/* ── console text (conio screen half) ────────────────────────── */

/* conio draws onto the visual page with 8x16 cells so text programs work
 * with no initgraph call at all — the first conio call boots the machine. */

static void ensure_console(void) {
    if (!g_inited) { int d = DETECT, m = VGAHI; initgraph(&d, &m, ""); }
}

static void cell_paint(int col, int row, unsigned char ch, int attr) {
    /* col,row 1-based screen coordinates */
    int x0 = (col - 1) * CELL_W, y0 = (row - 1) * CELL_H;
    int fg = attr & 15, bg = (attr >> 4) & 7;
    if (ch > 127) ch = '?';
    const char *glyph = font8x8_basic[ch];
    uint8_t *vis = g_pages[g_visual_page];
    for (int gy = 0; gy < CELL_H; gy++) {
        unsigned char bits = (unsigned char)glyph[gy / 2];   /* 8x8 doubled */
        uint8_t *rowp = vis + (size_t)(y0 + gy) * PR_W + x0;
        for (int gx = 0; gx < CELL_W; gx++)
            rowp[gx] = (uint8_t)((bits & (1 << gx)) ? fg : bg);
    }
}

static void console_scroll(void) {
    int l = t_win.l, t = t_win.t, r = t_win.r, b = t_win.b;
    uint8_t *vis = g_pages[g_visual_page];
    int px0 = (l - 1) * CELL_W, pw = (r - l + 1) * CELL_W;
    for (int row = t; row < b; row++) {
        int dst = (row - 1) * CELL_H, src = row * CELL_H;
        for (int gy = 0; gy < CELL_H; gy++)
            memmove(vis + (size_t)(dst + gy) * PR_W + px0,
                    vis + (size_t)(src + gy) * PR_W + px0, (size_t)pw);
    }
    int bg = (t_attr >> 4) & 7;
    for (int gy = 0; gy < CELL_H; gy++)
        memset(vis + (size_t)((b - 1) * CELL_H + gy) * PR_W + px0, bg, (size_t)pw);
}

static void console_advance(void) {
    t_x++;
    if (t_win.l - 1 + t_x > t_win.r) { t_x = 1; t_y++; }
    if (t_win.t - 1 + t_y > t_win.b) { console_scroll(); t_y = t_win.b - t_win.t + 1; }
}

int putch(int c) {
    ensure_console();
    if (c == '\n') { t_x = 1; t_y++; }
    else if (c == '\r') { t_x = 1; }
    else if (c == '\b' || c == 8) { if (t_x > 1) t_x--; }
    else if (c == '\t') { do { putch(' '); } while ((t_x - 1) % 8); return c; }
    else {
        cell_paint(t_win.l - 1 + t_x, t_win.t - 1 + t_y, (unsigned char)c, t_attr);
        console_advance();
        maybe_flush();
        return c;
    }
    if (t_win.t - 1 + t_y > t_win.b) { console_scroll(); t_y = t_win.b - t_win.t + 1; }
    maybe_flush();
    return c;
}

int cputs(const char *s) {
    if (!s) return 0;
    while (*s) putch((unsigned char)*s++);
    return 0;
}

int cprintf(const char *format, ...) {
    char buf[2048];
    va_list ap; va_start(ap, format);
    int n = vsnprintf(buf, sizeof buf, format, ap);
    va_end(ap);
    cputs(buf);
    prabha_flush();
    return n;
}

int cscanf(const char *format, ...) {
    /* read a line through getch (echoing), then sscanf it */
    ensure_console();
    char line[512]; int n = 0;
    for (;;) {
        int c = getch();
        if (c == '\r' || c == '\n') { putch('\n'); break; }
        if ((c == 8 || c == 127) && n > 0) { n--; putch(8); putch(' '); putch(8); continue; }
        if (n < (int)sizeof line - 1 && c >= 32 && c < 127) { line[n++] = (char)c; putch(c); }
    }
    line[n] = 0;
    va_list ap; va_start(ap, format);
    int r = vsscanf(line, format, ap);
    va_end(ap);
    return r;
}

void clrscr(void) {
    ensure_console();
    int bg = (t_attr >> 4) & 7;
    uint8_t *vis = g_pages[g_visual_page];
    for (int row = t_win.t; row <= t_win.b; row++)
        for (int gy = 0; gy < CELL_H; gy++)
            memset(vis + (size_t)((row - 1) * CELL_H + gy) * PR_W + (t_win.l - 1) * CELL_W,
                   bg, (size_t)(t_win.r - t_win.l + 1) * CELL_W);
    t_x = 1; t_y = 1;
    prabha_flush();
}

void clreol(void) {
    ensure_console();
    int bg = (t_attr >> 4) & 7;
    uint8_t *vis = g_pages[g_visual_page];
    int row = t_win.t - 1 + t_y;
    int px0 = (t_win.l - 1 + t_x - 1) * CELL_W;
    int pw = (t_win.r - (t_win.l - 1 + t_x) + 1) * CELL_W;
    if (pw <= 0) return;
    for (int gy = 0; gy < CELL_H; gy++)
        memset(vis + (size_t)((row - 1) * CELL_H + gy) * PR_W + px0, bg, (size_t)pw);
    maybe_flush();
}

void delline(void) {
    ensure_console();
    uint8_t *vis = g_pages[g_visual_page];
    int px0 = (t_win.l - 1) * CELL_W, pw = (t_win.r - t_win.l + 1) * CELL_W;
    for (int row = t_win.t - 1 + t_y; row < t_win.b; row++)
        for (int gy = 0; gy < CELL_H; gy++)
            memmove(vis + (size_t)((row - 1) * CELL_H + gy) * PR_W + px0,
                    vis + (size_t)(row * CELL_H + gy) * PR_W + px0, (size_t)pw);
    int bg = (t_attr >> 4) & 7;
    for (int gy = 0; gy < CELL_H; gy++)
        memset(vis + (size_t)((t_win.b - 1) * CELL_H + gy) * PR_W + px0, bg, (size_t)pw);
    maybe_flush();
}

void insline(void) {
    ensure_console();
    uint8_t *vis = g_pages[g_visual_page];
    int px0 = (t_win.l - 1) * CELL_W, pw = (t_win.r - t_win.l + 1) * CELL_W;
    for (int row = t_win.b; row > t_win.t - 1 + t_y; row--)
        for (int gy = 0; gy < CELL_H; gy++)
            memmove(vis + (size_t)((row - 1) * CELL_H + gy) * PR_W + px0,
                    vis + (size_t)((row - 2) * CELL_H + gy) * PR_W + px0, (size_t)pw);
    int bg = (t_attr >> 4) & 7;
    int row = t_win.t - 1 + t_y;
    for (int gy = 0; gy < CELL_H; gy++)
        memset(vis + (size_t)((row - 1) * CELL_H + gy) * PR_W + px0, bg, (size_t)pw);
    maybe_flush();
}

void gotoxy(int x, int y) {
    ensure_console();
    int w = t_win.r - t_win.l + 1, h = t_win.b - t_win.t + 1;
    if (x < 1) x = 1;
    if (x > w) x = w;
    if (y < 1) y = 1;
    if (y > h) y = h;
    t_x = x; t_y = y;
}

int wherex(void) { return t_x; }
int wherey(void) { return t_y; }

void window(int left, int top, int right, int bottom) {
    if (left < 1 || top < 1 || right > TXT_COLS || bottom > TXT_ROWS || left > right || top > bottom) return;
    t_win.l = left; t_win.t = top; t_win.r = right; t_win.b = bottom;
    t_x = 1; t_y = 1;
}

void textmode(int newmode) {
    (void)newmode;                     /* one true mode; clear like DOS did */
    ensure_console();
    t_win.l = 1; t_win.t = 1; t_win.r = TXT_COLS; t_win.b = TXT_ROWS;
    t_attr = LIGHTGRAY;
    clrscr();
}

void gettextinfo(struct text_info *r) {
    if (!r) return;
    r->winleft = (unsigned char)t_win.l;  r->wintop = (unsigned char)t_win.t;
    r->winright = (unsigned char)t_win.r; r->winbottom = (unsigned char)t_win.b;
    r->attribute = (unsigned char)t_attr; r->normattr = LIGHTGRAY;
    r->currmode = C80;
    r->screenheight = TXT_ROWS; r->screenwidth = TXT_COLS;
    r->curx = (unsigned char)t_x; r->cury = (unsigned char)t_y;
}

void _setcursortype(int cur_t) { t_cursor = cur_t; }

void textattr(int a) { t_attr = a & 0x7F; }
void textcolor(int c) { t_attr = (t_attr & 0x70) | (c & 15); }
void textbackground(int c) { t_attr = (t_attr & 0x0F) | ((c & 7) << 4); }
void highvideo(void) { t_attr |= 0x08; }
void lowvideo(void)  { t_attr &= ~0x08; }
void normvideo(void) { t_attr = LIGHTGRAY; }

/* ── dos.h: date, time, random ──────────────────────────────────────────
   Declared in runtime/dos.h. Turbo C read the clock and the random seed
   through these; here they come from the host via <time.h>.
   Marked prabha_dos_impl so a second definition is easy to spot.        */

#include <time.h>
#include "dos.h"   /* struct date, struct time, randomize, int86 */

void getdate(struct date *d)
{
    time_t now;
    struct tm *lt;

    if (!d) return;
    now = time(NULL);
    lt = localtime(&now);
    if (!lt) { d->da_year = 0; d->da_mon = 0; d->da_day = 0; return; }
    d->da_year = (int)(lt->tm_year + 1900);
    d->da_mon  = (char)(lt->tm_mon + 1);   /* Borland counts months from 1 */
    d->da_day  = (char)lt->tm_mday;
}

void gettime(struct time *t)
{
    time_t now;
    struct tm *lt;

    if (!t) return;
    now = time(NULL);
    lt = localtime(&now);
    if (!lt) { t->ti_hour = t->ti_min = t->ti_sec = t->ti_hund = 0; return; }
    t->ti_hour = (unsigned char)lt->tm_hour;
    t->ti_min  = (unsigned char)lt->tm_min;
    t->ti_sec  = (unsigned char)lt->tm_sec;
    t->ti_hund = 0;   /* second-resolution clock; hundredths are not available */
}

/* Setting the host clock needs root and is not something a student program
   should do by accident. Accepted so old code links, and ignored. */
void setdate(const struct date *d) { (void)d; }
void settime(const struct time *t) { (void)t; }

void randomize(void) { srand((unsigned)time(NULL)); }

/* No DOS interrupts here. Declared so a program using int86 still links;
   it changes nothing and reports failure. */
int int86(int intno, union REGS *inregs, union REGS *outregs)
{
    (void)intno;
    if (outregs && inregs) *outregs = *inregs;
    return 0;
}
