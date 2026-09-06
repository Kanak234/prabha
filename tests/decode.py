#!/usr/bin/env python3
"""Decode PRABHA protocol output into PNG frames — the reference decoder."""
import json, base64, sys
from PIL import Image

def decode(path, out_prefix, last_only=True):
    W = H = 0
    fb = None
    rgb = [(0,0,0)]*16
    frames = []
    for line in open(path, encoding='utf-8', errors='replace'):
        if not line.startswith('##PRABHA##'):
            continue
        msg = json.loads(line[10:])
        t = msg['t']
        if t == 'init':
            W, H = msg['w'], msg['h']
            fb = bytearray(W*H)
        elif t == 'palette':
            rgb = [tuple(c) for c in msg['rgb']]
        elif t == 'frame':
            raw = base64.b64decode(msg['rle'])
            pix = bytearray()
            for i in range(0, len(raw), 2):
                pix += bytes([raw[i+1]])*raw[i]
            x,y,w,h = msg['x'],msg['y'],msg['w'],msg['h']
            assert len(pix) == w*h, f"rle size {len(pix)} != {w*h}"
            for r in range(h):
                fb[(y+r)*W+x:(y+r)*W+x+w] = pix[r*w:(r+1)*w]
            frames.append((msg['n'], bytes(fb), list(rgb)))
    outs = []
    todo = frames[-1:] if last_only else frames
    for n, buf, pal in todo:
        img = Image.new('RGB', (W,H))
        img.putdata([pal[v & 15] for v in buf])
        p = f"{out_prefix}_{n:03d}.png"
        img.save(p); outs.append(p)
    print(f"{len(frames)} frames decoded; saved {outs}")
    return outs

if __name__ == '__main__':
    decode(sys.argv[1], sys.argv[2], last_only=(len(sys.argv) < 4))
