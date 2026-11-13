"""Detect every fillable zone of a PDF, without trying to understand it.

A zone is a place where something can be written or ticked:
  check : box glyph, drawn square or circle, "[ ]" / "( )" brackets, form checkbox
  text  : underscore or dotted run, drawn underline, bordered or shaded empty box,
          free space next to a "Label:" in a cell, comb (one character per cell), form text field
  any   : small empty table cell (tick or short text, the column header tells)
Each zone carries the text around it (left, right, above, row, column) so that the gem
can tell what it is for. Detection is deliberately broad: unused zones are harmless.
"""
import statistics

import pymupdf

from .common import BOX_GLYPHS, CHECK_GLYPHS

FILL_CHARS = set("_.…")
DATE_JOINERS = set("/-")
R = lambda r: [round(v, 2) for v in r]  # noqa: E731

PRIORITY = {"widget": 0, "glyph": 1, "square": 1, "circle": 1, "bracket": 1, "comb": 2,
            "fill": 3, "label_space": 4, "cell": 5, "shaded": 6, "underline": 7, "blank": 8}


# ---------------------------------------------------------------- text

class Word:
    __slots__ = ("text", "x0", "y0", "x1", "y1", "oy", "size", "bold", "is_box")

    def __init__(self, chars, box=False):
        self.text = "".join(c["c"] for c in chars)
        self.x0 = min(c["x0"] for c in chars)
        self.x1 = max(c["x1"] for c in chars)
        self.y0 = min(c["y0"] for c in chars)
        self.y1 = max(c["y1"] for c in chars)
        self.oy = chars[0]["oy"]
        self.size = chars[0]["size"]
        self.bold = chars[0]["bold"]
        self.is_box = box

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2

    @property
    def cy(self):
        return self.oy - 0.35 * self.size

    @property
    def filler(self):
        return len(self.text) >= 3 and all(c in FILL_CHARS or c in DATE_JOINERS for c in self.text)


def text_lines(page):
    """Visual text lines: lists of chars sorted by x, with bbox, baseline, size and boldness."""
    lines = []
    for b in page.get_text("rawdict")["blocks"]:
        if b.get("type") != 0:
            continue
        for ln in b["lines"]:
            if abs(ln["dir"][1]) > 0.1:
                continue
            chars = []
            for s in ln["spans"]:
                bold = "bold" in s["font"].lower() or bool(s["flags"] & 16)
                for c in s["chars"]:
                    x0, y0, x1, y1 = c["bbox"]
                    chars.append(dict(c=c["c"], x0=x0, y0=y0, x1=x1, y1=y1, oy=c["origin"][1],
                                      size=s["size"], bold=bold))
            if chars:
                lines.append(sorted(chars, key=lambda c: c["x0"]))
    return lines


def words_of(lines):
    words = []
    for chars in lines:
        cur, prev = [], None
        for c in chars:
            ch = c["c"]
            gap = prev is not None and c["x0"] - prev["x1"] > 0.35 * c["size"]
            if ch.isspace() or ch in BOX_GLYPHS or gap or (prev is not None and prev["c"] in BOX_GLYPHS):
                if cur:
                    words.append(Word(cur))
                cur = []
            if ch in BOX_GLYPHS:
                words.append(Word([c], box=True))
            elif not ch.isspace():
                cur.append(c)
            prev = c
        if cur:
            words.append(Word(cur))
    return words


def text_of(words):
    return " ".join(w.text for w in words).strip()


# ---------------------------------------------------------------- drawings

def _luminance(rgb):
    if not rgb:
        return 1.0
    r, g, b = (list(rgb) + [0, 0, 0])[:3]
    return 0.3 * r + 0.59 * g + 0.11 * b


def vector_shapes(page):
    """Line segments, rectangles (stroked / filled), small squares and circles, diagonal strokes."""
    hs, vs, rects, smalls, diagonals = [], [], [], [], []
    for d in page.get_drawings():
        typ = d.get("type") or ""
        stroked = "s" in typ
        fill = d.get("fill") if "f" in typ else None
        items = d["items"]
        bbox = pymupdf.Rect(d["rect"])
        has_curve = any(it[0] == "c" for it in items)
        if has_curve:
            w, h = bbox.width, bbox.height
            if 5 <= w <= 16 and 5 <= h <= 16 and abs(w - h) <= 2.5:
                if stroked or (fill is not None and _luminance(fill) > 0.35):
                    smalls.append(("circle", bbox))
                continue
            if w > 12 and h > 6 and (stroked or fill is not None):
                rects.append(dict(rect=bbox, stroked=stroked, fill=fill))
                if stroked:
                    hs += [(bbox.x0, bbox.x1, bbox.y0), (bbox.x0, bbox.x1, bbox.y1)]
                    vs += [(bbox.x0, bbox.y0, bbox.y1), (bbox.x1, bbox.y0, bbox.y1)]
                continue
        for it in items:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.y - b.y) < 1.0:
                    hs.append((min(a.x, b.x), max(a.x, b.x), (a.y + b.y) / 2))
                elif abs(a.x - b.x) < 1.0:
                    vs.append(((a.x + b.x) / 2, min(a.y, b.y), max(a.y, b.y)))
                elif abs(a.x - b.x) > 1.5 and abs(a.y - b.y) > 1.5:
                    diagonals.append(pymupdf.Rect(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y)))
            elif it[0] in ("re", "qu"):
                r = pymupdf.Rect(it[1].rect if it[0] == "qu" else it[1])
                w, h = r.width, r.height
                if h <= 1.8 and w > 1.8:
                    hs.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
                elif w <= 1.8 and h > 1.8:
                    vs.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
                elif 5 <= w <= 16 and 5 <= h <= 16 and abs(w - h) <= 2.5:
                    if stroked or (fill is not None and _luminance(fill) > 0.35):
                        smalls.append(("square", r))
                elif w > 1.8 and h > 1.8:
                    rects.append(dict(rect=r, stroked=stroked, fill=fill))
                    if stroked:
                        hs += [(r.x0, r.x1, r.y0), (r.x0, r.x1, r.y1)]
                        vs += [(r.x0, r.y0, r.y1), (r.x1, r.y0, r.y1)]
    return merge_collinear(hs, True), merge_collinear(vs, False), rects, smalls, diagonals


def merge_collinear(segs, horizontal, gap=4.0, tol=0.8):
    """Join touching segments lying on the same line: (a0, a1, c) for h, (c, a0, a1) for v."""
    norm = [(s[2], s[0], s[1]) for s in segs] if horizontal else [(s[0], s[1], s[2]) for s in segs]
    norm.sort()
    out = []
    for c, a0, a1 in norm:
        if out and abs(out[-1][0] - c) <= tol and a0 <= out[-1][2] + gap:
            pc, p0, p1 = out[-1]
            out[-1] = (pc, p0, max(p1, a1))
        else:
            out.append((c, a0, a1))
    return [(a0, a1, c) for c, a0, a1 in out] if horizontal else out


def _cluster(values, tol=1.2):
    out = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]


def grid_cells(hs, vs, page_rect):
    """Closed rectangular cells formed by horizontal and vertical segments (merged cells included)."""
    xs = _cluster([v[0] for v in vs])
    ys = _cluster([h[2] for h in hs])
    if len(xs) < 2 or len(ys) < 2:
        return []
    h_at = {j: [(h[0], h[1]) for h in hs if abs(h[2] - y) <= 1.2] for j, y in enumerate(ys)}
    v_at = {i: [(v[1], v[2]) for v in vs if abs(v[0] - x) <= 1.2] for i, x in enumerate(xs)}

    def covered(spans, a, b):
        return any(s0 <= a + 2 and s1 >= b - 2 for s0, s1 in spans)

    nx, ny = len(xs) - 1, len(ys) - 1
    parent = list(range(nx * ny))

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for j in range(ny):
        for i in range(nx):
            k = j * nx + i
            if i + 1 < nx and not covered(v_at[i + 1], ys[j], ys[j + 1]):
                union(k, k + 1)
            if j + 1 < ny and not covered(h_at[j + 1], xs[i], xs[i + 1]):
                union(k, k + nx)
    groups = {}
    for k in range(nx * ny):
        groups.setdefault(find(k), []).append(k)
    cells = []
    page_area = page_rect.width * page_rect.height
    for ks in groups.values():
        ii = [k % nx for k in ks]
        jj = [k // nx for k in ks]
        i0, i1, j0, j1 = min(ii), max(ii), min(jj), max(jj)
        if len(ks) != (i1 - i0 + 1) * (j1 - j0 + 1):
            continue
        closed = all(covered(v_at[i0], ys[j], ys[j + 1]) and covered(v_at[i1 + 1], ys[j], ys[j + 1])
                     for j in range(j0, j1 + 1)) and \
            all(covered(h_at[j0], xs[i], xs[i + 1]) and covered(h_at[j1 + 1], xs[i], xs[i + 1])
                for i in range(i0, i1 + 1))
        if not closed:
            continue
        r = pymupdf.Rect(xs[i0], ys[j0], xs[i1 + 1], ys[j1 + 1])
        if r.width < 6 or r.height < 6 or r.width * r.height > 0.35 * page_area:
            continue
        cells.append(r)
    return cells


# ---------------------------------------------------------------- detection

def _zone(shape, kind, rect, **kw):
    return dict(shape=shape, kind=kind, rect=pymupdf.Rect(rect), **kw)


def _inside(word, rect, pad=0.5):
    return rect.x0 - pad <= word.cx <= rect.x1 + pad and rect.y0 - pad <= (word.y0 + word.y1) / 2 <= rect.y1 + pad


def _box_from_glyph(w):
    side = min(w.x1 - w.x0, 0.75 * w.size)
    return pymupdf.Rect(w.cx - side / 2, w.oy - side, w.cx + side / 2, w.oy)


def _char_runs(lines):
    """Underscore / dotted runs (dates like __/__/____ kept whole) and [ ] / ( ) brackets."""
    fills, brackets = [], []
    for chars in lines:
        n = len(chars)
        i = 0
        while i < n:
            c = chars[i]["c"]
            if c in FILL_CHARS:
                j = i
                while j + 1 < n and (chars[j + 1]["c"] in FILL_CHARS or
                                     (chars[j + 1]["c"] in DATE_JOINERS and j + 2 < n and chars[j + 2]["c"] in FILL_CHARS)):
                    j += 1
                run = chars[i:j + 1]
                unders = sum(ch["c"] == "_" for ch in run)
                dots = sum(ch["c"] == "." for ch in run) + 3 * sum(ch["c"] == "…" for ch in run)
                if unders >= 3 or dots >= 5:
                    size = max(ch["size"] for ch in run)
                    oy = run[0]["oy"]
                    fills.append(dict(rect=pymupdf.Rect(run[0]["x0"], oy - 1.05 * size, run[-1]["x1"], oy + 1),
                                      size=size, oy=oy))
                i = j + 1
                continue
            if c in "[(":
                close = "]" if c == "[" else ")"
                j = i + 1
                inner = []
                while j < n and chars[j]["c"] != close and j - i <= 6:
                    inner.append(chars[j]["c"])
                    j += 1
                if j < n and chars[j]["c"] == close:
                    content = "".join(inner).strip()
                    gap = chars[j]["x0"] - chars[i]["x1"]
                    width = chars[j]["x1"] - chars[i]["x0"]
                    blank = (inner and not content) or (not inner and gap >= 3)
                    ticked = content in CHECK_GLYPHS and len(content) == 1
                    if (blank or ticked) and 4 <= width <= 30:
                        brackets.append(dict(rect=pymupdf.Rect(chars[i]["x0"], min(chars[i]["y0"], chars[j]["y0"]),
                                                               chars[j]["x1"], max(chars[i]["y1"], chars[j]["y1"])),
                                             checked=ticked))
                        i = j + 1
                        continue
            i += 1
    return fills, brackets


def detect_page(page, pno):
    lines = text_lines(page)
    words = words_of(lines)
    text_words = [w for w in words if not w.is_box]
    hs, vs, rects, smalls, diagonals = vector_shapes(page)
    cells = grid_cells(hs, vs, page.rect)
    sizes = [w.size for w in text_words] or [10]
    med = statistics.median(sizes)
    cands = []

    def ticked(rect):
        if any(not w.is_box and len(w.text) == 1 and w.text in CHECK_GLYPHS and _inside(w, rect + (-3, -4, 3, 4))
               for w in words):
            return True
        return sum(1 for d in diagonals if rect.contains(pymupdf.Point((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2))) >= 2

    # checkboxes
    for w in words:
        if w.is_box:
            r = _box_from_glyph(w)
            cands.append(_zone("glyph", "check", r, checked=w.text in "☑☒" or ticked(r)))
    for shape, r in smalls:
        cands.append(_zone(shape, "check", r, checked=ticked(r)))
    fills, brackets = _char_runs(lines)
    for b in brackets:
        cands.append(_zone("bracket", "check", b["rect"], checked=b["checked"]))
    for f in fills:
        cands.append(_zone("fill", "text", f["rect"]))

    # table cells
    def words_in(rect):
        return [w for w in text_words if _inside(w, rect) and not w.filler]

    images = [pymupdf.Rect(i["bbox"]) for i in page.get_image_info()]

    def has_image(rect):
        return any(not (rect & im).is_empty and (rect & im).get_area() > 0.3 * rect.get_area() for im in images)

    comb_cells = []
    for c in cells:
        inner = pymupdf.Rect(c.x0 + 1.5, c.y0 + 1, c.x1 - 1.5, c.y1 - 1)
        ws = words_in(c)
        if any(w.is_box for w in words if _inside(w, c)) or has_image(c):
            continue
        if not ws:
            if c.width <= 22 and c.height <= 28:
                comb_cells.append(c)
            kind = "any" if c.width <= 60 and c.height <= 30 else "text"
            cands.append(_zone("cell", kind, inner))
            continue
        ws.sort(key=lambda w: (w.y0, w.x0))
        last_line = [w for w in ws if abs(w.oy - ws[-1].oy) <= 2.5]
        top = min(w.y0 for w in ws)
        bottom = max(w.y1 for w in ws)
        lx1 = max(w.x1 for w in last_line)
        small_or_bold = all(w.bold for w in ws) or max(w.size for w in ws) > 1.25 * med
        if text_of(sorted(last_line, key=lambda w: w.x0)).endswith(":") and c.x1 - lx1 >= 30 and not small_or_bold:
            same_line_top = min(w.y0 for w in last_line)
            y0 = c.y0 + 1 if len({round(w.oy) for w in ws}) == 1 else same_line_top - 1
            cands.append(_zone("label_space", "text", pymupdf.Rect(lx1 + 3, y0, c.x1 - 1.5, c.y1 - 1)))
        elif top - c.y0 < 7 and c.y1 - bottom >= 12 and c.height >= 22:
            cands.append(_zone("label_space", "text", pymupdf.Rect(c.x0 + 1.5, bottom + 1, c.x1 - 1.5, c.y1 - 1)))

    # combs: touching small empty cells or squares on one row, joined across "/" separators
    comb_src = comb_cells + [r for s, r in smalls if s == "square"]
    comb_src.sort(key=lambda r: (round(r.y0), r.x0))
    groups = []
    for r in comb_src:
        g = groups[-1] if groups else None
        if g and abs(g[-1].y0 - r.y0) <= 1.2 and abs(g[-1].y1 - r.y1) <= 1.2 and 0 <= r.x0 - g[-1].x1 <= 1.5:
            g.append(r)
        else:
            groups.append([r])
    groups = [g for g in groups if len(g) >= 2]
    merged = []
    for g in groups:
        p = merged[-1] if merged else None
        if p and abs(p[-1].y0 - g[0].y0) <= 1.2 and 0 < g[0].x0 - p[-1].x1 <= 16:
            gap = pymupdf.Rect(p[-1].x1, g[0].y0, g[0].x0, g[0].y1)
            if all(w.text in "/-." for w in text_words if _inside(w, gap)):
                p.extend(g)
                continue
        merged.append(list(g))
    for g in merged:
        heads = sum(1 for r in g if any(r.x0 <= w.cx <= r.x1 and r.y0 - 25 <= w.y1 <= r.y0 + 1 for w in text_words))
        if heads > len(g) / 2:
            continue
        box = pymupdf.Rect(g[0].x0, min(r.y0 for r in g), g[-1].x1, max(r.y1 for r in g))
        cands.append(_zone("comb", "text", box, cells=[R(r) for r in g]))

    # shaded boxes (fill only, no text inside)
    page_area = page.rect.width * page.rect.height
    for d in rects:
        r = d["rect"]
        if d["stroked"] or d["fill"] is None:
            continue
        lum = _luminance(d["fill"])
        if not (0.55 <= lum <= 0.975) or r.height < 8 or r.height > 60 or r.width < 25:
            continue
        if r.width * r.height > 0.25 * page_area or words_in(r) or has_image(r):
            continue
        cands.append(_zone("shaded", "text", pymupdf.Rect(r.x0 + 1.5, r.y0 + 1, r.x1 - 1.5, r.y1 - 1)))

    # drawn underlines
    def vertical_near(x, y, tol=4.0):
        return any(abs(v[0] - x) <= tol and v[1] - tol <= y <= v[2] + tol for v in vs)

    for (x0, x1, y) in hs:
        length = x1 - x0
        if length < 25 or length > 0.85 * page.rect.width:
            continue
        if vertical_near(x0, y) or vertical_near(x1, y):
            continue
        above = [w for w in text_words if w.y1 <= y - 1 and w.x1 > x0 and w.x0 < x1 and y - w.y1 < 30]
        y0 = max([y - 14] + [w.y1 + 0.5 for w in above if not (y - 13 <= w.y1 <= y + 1)])
        zone = pymupdf.Rect(x0 + 1, y0, x1 - 1, y - 0.6)
        inside = [w for w in text_words if _inside(w, zone) and not w.filler]
        if inside:
            span = max(w.x1 for w in inside) - min(w.x0 for w in inside)
            if span >= 0.85 * length or length > 0.6 * page.rect.width:
                continue
        cands.append(_zone("underline", "text", zone))

    # "Label:" followed by empty space on a free line
    for chars in lines:
        lw = words_of([chars])
        if not lw or lw[-1].is_box:
            continue
        last = lw[-1]
        if not last.text.endswith(":") or last.bold or last.size > 1.15 * med or len(text_of(lw)) > 80:
            continue
        nxt = [w.x0 for w in text_words if abs(w.oy - last.oy) <= 2.5 and w.x0 > last.x1 + 1]
        x1 = (min(nxt) - 4) if nxt else page.rect.x1 - 36
        if x1 - last.x1 >= 60:
            cands.append(_zone("blank", "text", pymupdf.Rect(last.x1 + 4, last.y0 - 1, x1, last.y1 + 1)))

    zones = _dedupe(cands)
    zones = _merge_continuations(zones, text_words)
    for z in zones:
        r = z["rect"]
        if z["kind"] != "check":
            pre = [w for w in text_words if _inside(w, r) and not w.filler]
            # Comb date boxes often contain printed "/" separators — not real content.
            if z.get("cells"):
                pre = [w for w in pre if any(c.isalnum() for c in w.text)]
            z["prefilled"] = text_of(sorted(pre, key=lambda w: (round(w.oy), w.x0))) or None
        z["page"] = pno
    _add_context(zones, text_words, cells, page)
    return zones


def _dedupe(cands):
    cands.sort(key=lambda z: (PRIORITY[z["shape"]], z["rect"].y0, z["rect"].x0))
    kept = []
    for z in cands:
        r = z["rect"]
        area = max(r.width * r.height, 0.01)
        clash = False
        for k in kept:
            inter = r & k["rect"]
            if inter.is_empty:
                continue
            ia = inter.width * inter.height
            karea = max(k["rect"].width * k["rect"].height, 0.01)
            if ia > 0.3 * min(area, karea):
                clash = True
                break
        if not clash:
            kept.append(z)
    return kept


def _merge_continuations(zones, words):
    """A line zone right under another one, with no label of its own, continues it (multi-line answer)."""
    lines_ = sorted([z for z in zones if z["shape"] in ("fill", "underline")], key=lambda z: (z["rect"].y0, z["rect"].x0))
    absorbed = set()
    for i, a in enumerate(lines_):
        if id(a) in absorbed:
            continue
        last = a["rect"]
        for b in lines_[i + 1:]:
            r = b["rect"]
            if id(b) in absorbed or abs(r.x1 - last.x1) > 20 or not (0 < r.y1 - last.y1 <= 2.6 * max(last.height, 8)):
                continue
            band_words = [w for w in words if r.y0 - 2 <= w.cy <= r.y1 + 2 and w.x1 <= r.x0 + 1 and r.x0 - w.x1 < 200
                          and not w.filler]
            if band_words:
                continue
            a.setdefault("extra", []).append(r)
            absorbed.add(id(b))
            last = r
    return [z for z in zones if id(z) not in absorbed]


def _phrase(words, start, direction, limit, stop_rects):
    """Grow a phrase from `start` towards left (-1) or right (+1) while gaps stay small."""
    out = [start]
    pool = sorted(words, key=lambda w: w.x0, reverse=direction < 0)
    for w in pool:
        if w is start or w in out:
            continue
        edge = out[-1]
        gap = (edge.x0 - w.x1) if direction < 0 else (w.x0 - edge.x1)
        if gap < -1:
            continue
        if gap > 2.2 * max(w.size, edge.size):
            break
        lo, hi = (w.x1, edge.x0) if direction < 0 else (edge.x1, w.x0)
        if any(lo - 1 < (s.x0 + s.x1) / 2 < hi + 1 for s in stop_rects):
            break
        out.append(w)
        if sum(len(x.text) + 1 for x in out) > limit:
            break
    if direction < 0:
        out.reverse()
    return text_of(out)


def _add_context(zones, words, cells, page):
    rects = [z["rect"] for z in zones]
    free = [w for w in words if not w.filler and not any(_inside(w, r, 0.2) for r in rects)]
    for z in zones:
        r = z["rect"]
        cy = (r.y0 + r.y1) / 2
        band = (cy - 5, cy + 5) if r.height <= 20 else (r.y0, min(r.y1, r.y0 + 16))
        same = [w for w in free if band[0] - 1 <= w.cy <= band[1] + 1]
        others = [o for o in rects if o is not r and o.y0 - 2 <= cy <= o.y1 + 2]
        ctx = {}
        left = [w for w in same if w.x1 <= r.x0 + 1 and r.x0 - w.x1 <= 250]
        if left:
            ctx["left"] = _phrase(left, max(left, key=lambda w: w.x1), -1, 90, others)
        right = [w for w in same if w.x0 >= r.x1 - 1 and w.x0 - r.x1 <= (25 if z["kind"] == "check" else 12)]
        if right:
            ctx["right"] = _phrase(right + [w for w in same if w.x0 > r.x1], min(right, key=lambda w: w.x0), 1, 70, others)
        above = [w for w in free if w.y1 <= r.y0 + 1 and r.y0 - w.y1 <= 24 and w.x1 > r.x0 - 4 and w.x0 < r.x1 + 4]
        if above:
            ly = max(w.oy for w in above)
            ctx["above"] = text_of(sorted([w for w in above if abs(w.oy - ly) <= 2.5], key=lambda w: w.x0))[:90]
        line = sorted([w for w in free if band[0] - 1 <= w.cy <= band[1] + 1], key=lambda w: w.x0)
        if line:
            ctx["line"] = text_of(line)[:160]
        cell = min((c for c in cells if c.contains(pymupdf.Point(r.x0 + r.width / 2, cy))),
                   key=lambda c: c.width * c.height, default=None)
        if cell is not None:
            row = sorted([w for w in free if cell.y0 - 1 <= w.cy <= cell.y1 + 1 and w.x1 <= cell.x0 + 1
                          and cell.x0 - w.x1 <= 450], key=lambda w: (round(w.oy / 3), w.x0))
            if row:
                ctx["row"] = text_of(row)[:110]
        if cell is not None or z["kind"] != "text":
            # Horizontal span may be the table cell (better column centre); vertical search
            # always starts from the zone itself so a header glyph that slightly overlaps the
            # cell border is not cut off (common for YES / N/A above checkbox cells).
            span = cell if cell is not None and cell.width < 3 * max(r.width, 12) else r
            cx = (span.x0 + span.x1) / 2
            top = r.y0

            def _x_hit(w):
                return w.x0 - 2 <= cx <= w.x1 + 2 or span.x0 - 1 <= w.cx <= span.x1 + 1

            def _above(w):
                return w.oy <= top + 2 or w.y1 <= top + 2

            # Short headers (YES / C / N/A) may sit far above a long table; longer labels stay near.
            near = [w for w in free if _above(w) and top - w.y1 <= 100 and _x_hit(w)]
            far_short = [w for w in free if _above(w) and 100 < top - w.y1 <= 420
                         and _x_hit(w) and len(w.text) <= 12]
            col_words = near or far_short
            if col_words:
                def _col_score(w):
                    return (max(0, top - w.y1) + (0 if len(w.text) <= 12 else 25), -w.y1)

                nearest = min(col_words, key=_col_score)
                hcell = min((c for c in cells if c.contains(pymupdf.Point(nearest.cx, (nearest.y0 + nearest.y1) / 2))),
                            key=lambda c: c.width * c.height, default=None)
                if hcell is not None and hcell.width < 4 * max(span.width, 20) and hcell.height < 40:
                    head = sorted([w for w in free if _inside(w, hcell)], key=lambda w: (round(w.oy), w.x0))
                    text = text_of(head)
                else:
                    same_line = [w for w in free if abs(w.oy - nearest.oy) <= 2.5]
                    left_txt = _phrase(same_line, nearest, -1, 40, [])
                    right_txt = _phrase(same_line, nearest, 1, 40, [])
                    prefix = left_txt[: -len(nearest.text)].rstrip() if left_txt.endswith(nearest.text) else left_txt
                    text = " ".join(x for x in (prefix, right_txt) if x).strip()
                text = " ".join(text.split())[:80]
                if text:
                    ctx["col"] = text
        z["ctx"] = ctx
    _propagate_col(zones)


def _propagate_col(zones):
    """Copy col down a vertical stack of check/any zones that share the same x (table columns)."""
    checks = [z for z in zones if z["kind"] in ("check", "any") and z.get("page")]
    checks.sort(key=lambda z: (z["page"], (z["rect"].x0 + z["rect"].x1) / 2, z["rect"].y0))
    i = 0
    while i < len(checks):
        j = i + 1
        cx = (checks[i]["rect"].x0 + checks[i]["rect"].x1) / 2
        while j < len(checks) and checks[j]["page"] == checks[i]["page"] \
                and abs((checks[j]["rect"].x0 + checks[j]["rect"].x1) / 2 - cx) <= 4:
            j += 1
        col = next((z["ctx"].get("col") for z in checks[i:j] if z["ctx"].get("col")), None)
        if col:
            for z in checks[i:j]:
                z["ctx"].setdefault("col", col)
        i = j


def acroform_zones(page, pno):
    words = [w for w in words_of(text_lines(page)) if not w.is_box]
    zones = []
    for wd in page.widgets():
        r = pymupdf.Rect(wd.rect)
        ft = wd.field_type
        if ft == pymupdf.PDF_WIDGET_TYPE_SIGNATURE or ft == pymupdf.PDF_WIDGET_TYPE_BUTTON:
            continue
        is_check = ft in (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON)
        z = _zone("widget", "check" if is_check else "text", r, xref=wd.xref, field_name=wd.field_name)
        if is_check:
            z["checked"] = bool(wd.field_value) and wd.field_value not in ("Off", False, "")
        else:
            z["prefilled"] = (wd.field_value or "").strip() or None
            if ft in (pymupdf.PDF_WIDGET_TYPE_COMBOBOX, pymupdf.PDF_WIDGET_TYPE_LISTBOX):
                z["choices"] = [c if isinstance(c, str) else c[0] for c in (wd.choice_values or [])]
        z["page"] = pno
        z["tooltip"] = wd.field_label or None
        zones.append(z)
    _add_context(zones, words, [], page)
    for z in zones:
        if z.get("tooltip"):
            z["ctx"]["tooltip"] = z.pop("tooltip")
        else:
            z.pop("tooltip", None)
        z["ctx"]["field_name"] = z.pop("field_name")
    return zones


def detect_pdf(path):
    doc = pymupdf.open(path)
    zones, notes = [], []
    for pno, page in enumerate(doc, start=1):
        if page.rotation:
            notes.append(f"page {pno} : rotation {page.rotation}°, positions à vérifier")
        widget_zones = acroform_zones(page, pno)
        flat = detect_page(page, pno)
        if widget_zones:
            flat = [z for z in flat if not any((z["rect"] & w["rect"]).get_area() > 0.3 * z["rect"].get_area()
                                               for w in widget_zones)]
        if not page.get_text("text").strip() and page.get_images():
            notes.append(f"page {pno} : page scannée (image sans texte), aucune zone détectable")
        page_zones = widget_zones + flat
        page_zones.sort(key=lambda z: (round(z["rect"].y0 / 3), z["rect"].x0))
        zones += page_zones
    for z in zones:
        z["rect"] = R(z["rect"])
        if "extra" in z:
            z["extra"] = [R(r) for r in z["extra"]]
    kind = "pdf_acroform" if any(z["shape"] == "widget" for z in zones) else "pdf_flat"
    return dict(kind=kind, pages=doc.page_count, zones=zones, notes=notes)
