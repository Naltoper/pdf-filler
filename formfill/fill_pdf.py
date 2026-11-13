"""Write the plan into a PDF: X marks in boxes, text fitted into zones, form widgets set."""
import re
from pathlib import Path

import pymupdf

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
INK = (0, 0, 0)
MAX_FS = 9.5
REMARK_FS = 8.0
MIN_FS = 5.0
LINE_GAP = 1.15
LINE_SHAPES = {"fill", "underline", "blank"}


def _font_file(cands):
    return next((c for c in cands if Path(c).exists()), None)


class Ink:
    def __init__(self):
        self.reg_file = _font_file(FONT_CANDIDATES)
        self.bold_file = _font_file(BOLD_CANDIDATES)
        self.reg = pymupdf.Font(fontfile=self.reg_file) if self.reg_file else pymupdf.Font("helv")
        self.bold = pymupdf.Font(fontfile=self.bold_file) if self.bold_file else pymupdf.Font("hebo")

    def put(self, page, point, text, fs, bold=False):
        fontfile = self.bold_file if bold else self.reg_file
        if fontfile:
            page.insert_text(point, text, fontsize=fs, color=INK, fontname="FFb" if bold else "FFr", fontfile=fontfile)
        else:
            page.insert_text(point, text, fontsize=fs, color=INK, fontname="hebo" if bold else "helv")


def wrap(font, text, width, fs):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split():
            cand = f"{cur} {word}".strip()
            if font.text_length(cand, fs) <= width:
                cur = cand
                continue
            if cur:
                lines.append(cur)
            while font.text_length(word, fs) > width and len(word) > 1:
                k = len(word)
                while k > 1 and font.text_length(word[:k], fs) > width:
                    k -= 1
                lines.append(word[:k])
                word = word[k:]
            cur = word
        lines.append(cur)
    return [ln for ln in lines if ln] or [""]


def draw_check(ink, page, rect, shape):
    r = pymupdf.Rect(rect)
    if shape == "bracket":
        trim = min(r.width * 0.22, r.height * 0.35)
        r = pymupdf.Rect(r.x0 + trim, r.y0, r.x1 - trim, r.y1)
        side = min(r.width, r.height * 0.8)
    elif shape == "cell":
        side = min(r.width, r.height, 10.0) * 0.85
    elif shape == "circle":
        side = min(r.width, r.height) * 0.85
    else:
        side = min(r.width, r.height)
    fs = side * 1.15
    w = ink.bold.text_length("X", fs)
    cap = 0.716 * fs
    ink.put(page, pymupdf.Point((r.x0 + r.x1) / 2 - w / 2, (r.y0 + r.y1) / 2 + cap / 2), "X", fs, bold=True)


def draw_box_text(ink, page, rect, text, max_fs):
    r = pymupdf.Rect(rect)
    pad = 1.5
    width, height = r.width - 2 * pad, r.height - 1
    fs = min(max_fs, max(MIN_FS, height / LINE_GAP))
    while True:
        lines = wrap(ink.reg, text, width, fs)
        total = len(lines) * fs * LINE_GAP
        if total <= height + 0.5 or fs <= MIN_FS:
            break
        fs = round(fs - 0.25, 2)
    overflow = total > height + 0.5
    if r.height > 4 * max_fs * LINE_GAP:
        y = r.y0 + 2
    else:
        y = r.y0 + max(0, (r.height - total) / 2)
    for k, ln in enumerate(lines):
        ink.put(page, pymupdf.Point(r.x0 + pad, y + fs * 0.88 + k * fs * LINE_GAP), ln, fs)
    return dict(fontsize=fs, lines=len(lines), overflow=overflow)


def draw_line_text(ink, page, rects, text, max_fs):
    """One text line per rect (underscore / underline blanks), baseline just above the line."""
    rects = [pymupdf.Rect(r) for r in rects]
    pad = 1.5
    fs = min(max_fs, min(r.height for r in rects) * 0.85)
    while True:
        remaining = text.split()
        placed = []
        for r in rects:
            cur = ""
            while remaining:
                cand = f"{cur} {remaining[0]}".strip()
                if ink.reg.text_length(cand, fs) <= r.width - 2 * pad:
                    cur = cand
                    remaining.pop(0)
                else:
                    break
            placed.append(cur)
        if not remaining or fs <= MIN_FS:
            break
        fs = round(fs - 0.25, 2)
    overflow = bool(remaining)
    if overflow:
        placed[-1] = (placed[-1] + " " + " ".join(remaining)).strip()
    for r, ln in zip(rects, placed):
        if ln:
            ink.put(page, pymupdf.Point(r.x0 + pad, r.y1 - 2), ln, fs)
    return dict(fontsize=fs, lines=sum(1 for p in placed if p), overflow=overflow)


def draw_comb(ink, page, cells, text):
    cells = [pymupdf.Rect(c) for c in cells]
    chars = list(text)
    if len(chars) != len(cells):
        chars = list(re.sub(r"[\s/.\-]", "", text))
    fs = min(11.0, min(c.height for c in cells) * 0.7)
    for c, ch in zip(cells, chars):
        w = ink.reg.text_length(ch, fs)
        ink.put(page, pymupdf.Point((c.x0 + c.x1) / 2 - w / 2, (c.y0 + c.y1) / 2 + 0.36 * fs), ch, fs)
    return dict(fontsize=fs, lines=1, overflow=len(chars) > len(cells))


def _widget(page, xref):
    return next((w for w in page.widgets() if w.xref == xref), None)


def fill_pdf(src, dst, ops, zones):
    doc = pymupdf.open(src)
    ink = Ink()
    results = []
    for op in ops:
        z = zones[op["zone"]]
        page = doc[z["page"] - 1]
        max_fs = REMARK_FS if op.get("role") == "remark" else MAX_FS
        if z["shape"] == "widget":
            wd = _widget(page, z["xref"])
            if wd is None:
                results.append(dict(op=op, ok=False, overflow=False, error="champ de formulaire introuvable"))
                continue
            wd.field_value = (wd.on_state() or True) if op["op"] == "check" else op["text"]
            wd.update()
            results.append(dict(op=op, ok=True, overflow=False))
            continue
        if op["op"] == "check":
            draw_check(ink, page, z["rect"], z["shape"])
            results.append(dict(op=op, ok=True, overflow=False))
            continue
        if z.get("cells"):
            info = draw_comb(ink, page, z["cells"], op["text"])
        elif z["shape"] in LINE_SHAPES:
            info = draw_line_text(ink, page, [z["rect"]] + z.get("extra", []), op["text"], max_fs)
        else:
            info = draw_box_text(ink, page, z["rect"], op["text"], max_fs)
        results.append(dict(op=op, ok=not info["overflow"], **info))
    doc.save(dst, garbage=3, deflate=True)
    return results
