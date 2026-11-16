"""Zone map of a PDF form: detection, numbering (Z1..Zn) and the files given to the gem.

jobs/<job>/zones/
  zones.json   full map used by the filler (geometry, widget xref)
  zones.txt    compact list for the gem: id, page, type, surrounding text
  zones.pdf    the form with every zone outlined and labelled with its id
"""
import hashlib
from pathlib import Path

import pymupdf

from .common import load_json, save_json
from .pdf_zones import detect_pdf

DETECTOR_VERSION = "zones-4"
KIND_FR = {"check": "case", "text": "texte", "any": "case ou texte"}
CTX_ORDER = ("row", "col", "left", "above", "right", "tooltip", "field_name")
COLORS = {"check": (0.95, 0.4, 0.0), "text": (0.0, 0.35, 0.9), "any": (0.55, 0.0, 0.7)}
TAG_COLOR = (0.8, 0.0, 0.4)


def map_id(form_path):
    h = hashlib.sha256(Path(form_path).read_bytes())
    h.update(DETECTOR_VERSION.encode())
    return h.hexdigest()[:8]


def detect(form_path):
    form_path = Path(form_path)
    zmap = detect_pdf(form_path)
    for n, z in enumerate(zmap["zones"], start=1):
        z["id"] = f"Z{n}"
    zmap.update(map_id=map_id(form_path), source=form_path.name, detector=DETECTOR_VERSION)
    return zmap


def zone_line(z):
    bits = [z["id"], f"p{z['page']}" if z.get("page") else "", KIND_FR[z["kind"]]]
    ctx = z.get("ctx") or {}
    for k in CTX_ORDER:
        if ctx.get(k):
            bits.append(f'{k}: "{ctx[k]}"')
    if z.get("cells"):
        bits.append(f"peigne {len(z['cells'])} cases")
    if z.get("extra"):
        bits.append(f"{len(z['extra']) + 1} lignes")
    if z.get("max_length"):
        bits.append(f"max {z['max_length']} car.")
    if z.get("choices"):
        bits.append("valeurs possibles: " + " / ".join(z["choices"][:12]))
    if z.get("checked"):
        bits.append("DÉJÀ COCHÉE")
    if z.get("prefilled"):
        bits.append(f'DÉJÀ REMPLIE: "{z["prefilled"][:60]}"')
    return " | ".join(b for b in bits if b)


def zones_txt(zmap):
    counts = {k: sum(z["kind"] == k for z in zmap["zones"]) for k in KIND_FR}
    head = [
        f"ZONE_MAP {zmap['map_id']}",
        f"Formulaire : {zmap['source']} ({zmap['pages'] or '?'} pages)",
        f"{len(zmap['zones'])} zones : {counts['check']} cases, {counts['text']} textes, {counts['any']} cellules case-ou-texte",
        "Format : id | page | type | texte autour (row = début de la ligne du tableau, col = en-tête de colonne,",
        "left / right / above = texte à gauche / à droite / au-dessus).",
    ]
    head += [f"Note : {n}" for n in zmap.get("notes", [])]
    return "\n".join(head + [""] + [zone_line(z) for z in zmap["zones"]]) + "\n"


def _tag_spots(z, w, fs):
    """Candidate baselines for the id tag, best first."""
    r = pymupdf.Rect(z["rect"])
    mid = (r.y0 + r.y1) / 2 + fs * 0.35
    left, right = (r.x0 - w - 1.5, mid), (r.x1 + 1.5, mid)
    above, below = (r.x0, r.y0 - 1), (r.x0, r.y1 + fs * 0.8 + 0.5)
    if z["kind"] == "check":
        return [left, right, above, below]
    inside = (r.x0 + 1, r.y0 + fs * 0.9 + 0.5 if r.height >= fs + 1 else r.y1 - 1)
    inside_right = (r.x1 - w - 1, inside[1])
    return [inside, inside_right, above, left, right, below]


def _tag(page, z, text, obstacles):
    r = pymupdf.Rect(z["rect"])
    fs = 5.5 if r.height < 12 or z["kind"] == "check" else 6.5
    w = pymupdf.get_text_length(text, "hebo", fs)
    spots = _tag_spots(z, w, fs)
    chosen = None
    for x, y in spots:
        bg = pymupdf.Rect(x - 0.6, y - fs * 0.8, x + w + 0.6, y + fs * 0.22)
        if bg.x0 < 0 or bg.x1 > page.rect.x1 or bg.y0 < 0:
            continue
        if not any(bg.intersects(o) for o in obstacles):
            chosen = (x, y, bg)
            break
    if chosen is None:
        x, y = spots[0]
        chosen = (x, y, pymupdf.Rect(x - 0.6, y - fs * 0.8, x + w + 0.6, y + fs * 0.22))
    x, y, bg = chosen
    obstacles.append(bg)
    page.draw_rect(bg, color=None, fill=(1, 1, 1), fill_opacity=0.9, overlay=True)
    page.insert_text((x, y), text, fontname="hebo", fontsize=fs, color=TAG_COLOR, overlay=True)


def annotate_pdf(pdf_path, zones, out_pdf):
    doc = pymupdf.open(pdf_path)
    obstacles = {}
    for pno, page in enumerate(doc, start=1):
        obstacles[pno] = [pymupdf.Rect(w[:4]) for w in page.get_text("words")]
        obstacles[pno] += [pymupdf.Rect(z["rect"]) for z in zones if z.get("page") == pno and z["kind"] == "check"]
    for z in zones:
        if not z.get("page"):
            continue
        page = doc[z["page"] - 1]
        color = COLORS[z["kind"]]
        for r in [z["rect"]] + z.get("extra", []):
            page.draw_rect(pymupdf.Rect(r), color=color, width=0.7, overlay=True)
        for c in z.get("cells", []):
            page.draw_rect(pymupdf.Rect(c), color=color, width=0.4, dashes="[1 1] 0", overlay=True)
    for z in zones:
        if z.get("page"):
            _tag(doc[z["page"] - 1], z, z["id"], obstacles[z["page"]])
    doc.save(out_pdf, garbage=3, deflate=True)


def prepare(job, form):
    zdir = Path(job) / "zones"
    zdir.mkdir(exist_ok=True)
    zmap = detect(form)
    save_json(zdir / "zones.json", zmap)
    (zdir / "zones.txt").write_text(zones_txt(zmap), encoding="utf-8")
    annotate_pdf(form, zmap["zones"], zdir / "zones.pdf")
    return zmap


def load_zone_map(job, form):
    path = Path(job) / "zones" / "zones.json"
    if not path.exists():
        return None, "zones/zones.json absent : lancer d'abord `python -m formfill prepare`"
    zmap = load_json(path)
    if zmap.get("map_id") != map_id(form) or zmap.get("detector") != DETECTOR_VERSION:
        return None, ("le formulaire ou le détecteur a changé depuis `prepare` : relancer prepare "
                      "et redonner zones.pdf / zones.txt au gem")
    return zmap, None
