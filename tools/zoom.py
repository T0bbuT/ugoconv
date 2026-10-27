# 手順画像の赤枠まわりを切り抜いた「拡大図」を docs/img/zoom/ に作る。
# 赤枠の位置は guide-screenshots/preview/annotate.py の spec（表示座標）と同じもの。
from PIL import Image, ImageDraw
import os
D = os.path.join(os.path.dirname(__file__), '..', 'docs', 'img')
# 名前: (元画像の表示幅, 切り抜き上端, [(x0, y0, x1, y1), ...])
SPEC = {
 'a-share': (923, 0, [(720,115,820,215),(278,1665,404,1870)]),
 'a-open': (923, 100, [(122,112,545,222)]),
 'a-type': (923, 100, [(150,125,330,210),(30,1105,895,1218)]),
 'a-format': (923, 100, [(172,1640,852,1758)]),
 'a-save': (923, 100, [(172,1642,852,1758)]),
 'a-star': (923, 100, [(505,135,620,250)]),
 'a-edit': (923, 100, [(40,1632,882,1922)]),
 'a-fields': (923, 100, [(40,290,882,435),(40,505,882,645)]),
 'a-back': (923, 100, [(25,115,125,215)]),
 'i-add': (920, 110, [(50,1800,870,1928)]),
 'i-fav': (920, 110, [(280,1705,440,1940)]),
 'i-appmenu': (920, 110, [(300,1105,790,1225)]),
 'i-safaripage': (920, 110, [(200,1815,290,1920)]),
 'i-safarimenu': (920, 110, [(250,760,730,850)]),
 'i-safarifav': (920, 110, [(80,1705,240,1940)]),
 'i-panel': (920, 110, [(248,1492,858,1596)]),
 'i-allow-send': (920, 110, [(46,692,872,828)]),
 'i-allow-pixiv': (920, 110, [(468,682,872,816)]),
 'i-sc-share': (920, 110, [(38,500,505,790),(90,1148,560,1232)]),
 'i-sc-more': (920, 110, [(682,1705,842,1940)]),
 'i-sc-editbtn': (920, 110, [(280,1745,640,1832)]),
 'i-sc-plus': (920, 110, [(40,1488,880,1600),(778,175,890,285)]),
 'i-sc-done': (920, 110, [(80,1705,240,1940)]),
 'i-video': (920, 110, [(80,1705,240,1940)]),
}
PAD, MINW, MINH, JOIN = 36, 340, 230, 420

def boxes(name):
    w, top, bs = SPEC[name]
    k = 540 / w
    return [tuple(round((v - (top if i % 2 else 0)) * k) for i, v in enumerate(b)) for b in bs]

def region(bs, W, H):
    x0 = min(b[0] for b in bs) - PAD; y0 = min(b[1] for b in bs) - PAD
    x1 = max(b[2] for b in bs) + PAD; y1 = max(b[3] for b in bs) + PAD
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = max(x1 - x0, MINW), max(y1 - y0, MINH)
    x0 = min(max(0, cx - w / 2), W - w); y0 = min(max(0, cy - h / 2), H - h)
    return tuple(round(v) for v in (max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)))

os.makedirs(os.path.join(D, 'zoom'), exist_ok=True)
for name in SPEC:
    im = Image.open(os.path.join(D, name + '.jpg')).convert('RGB')
    bs = sorted(boxes(name), key=lambda b: b[1])
    # 離れた赤枠は別々に切り抜いて縦に並べる
    groups = [[bs[0]]]
    for b in bs[1:]:
        g = groups[-1]
        if max(x[3] for x in g + [b]) - min(x[1] for x in g + [b]) <= JOIN: g.append(b)
        else: groups.append([b])
    parts = [im.crop(region(g, *im.size)) for g in groups]
    GAP = 10
    out = Image.new('RGB', (max(p.width for p in parts), sum(p.height for p in parts) + GAP * (len(parts) - 1)), (26, 26, 26))
    y = 0
    for p in parts:
        out.paste(p, ((out.width - p.width) // 2, y)); y += p.height + GAP
    out.save(os.path.join(D, 'zoom', name + '.jpg'), quality=86)
    print(name, out.size, len(parts))
