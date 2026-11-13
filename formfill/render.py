"""Page images for visual QA, docx->pdf conversion and the annotated review PDF."""
import shutil
import subprocess
import tempfile
from pathlib import Path

import pymupdf


def docx_to_pdf(docx_path, out_pdf):
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([soffice, f"-env:UserInstallation=file://{tmp}/lo", "--headless", "--convert-to", "pdf",
                        "--outdir", tmp, str(docx_path)], check=True, capture_output=True, timeout=180)
        produced = Path(tmp) / (Path(docx_path).stem + ".pdf")
        shutil.move(produced, out_pdf)
    return out_pdf


def render_pages(pdf_path, out_dir, dpi=110, prefix="page"):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{prefix}-*.png"):
        old.unlink()
    paths = []
    doc = pymupdf.open(pdf_path)
    for i, page in enumerate(doc, start=1):
        p = out_dir / f"{prefix}-{i:02d}.png"
        page.get_pixmap(dpi=dpi).save(p)
        paths.append(p)
    return paths


def crop(pdf_path, page_no, rect, out_png, dpi=200, margin=20):
    doc = pymupdf.open(pdf_path)
    page = doc[page_no - 1]
    r = pymupdf.Rect(rect) + (-margin, -margin, margin, margin)
    page.get_pixmap(clip=r & page.rect, dpi=dpi).save(out_png)
    return out_png


def _zone_rect(z):
    r = pymupdf.Rect(z["rect"])
    for extra in z.get("extra", []):
        r |= pymupdf.Rect(extra)
    return r


def _mark(page, rect, text, color, fill=None):
    a = page.add_rect_annot(rect)
    if fill:
        a.set_colors(stroke=color, fill=fill)
        a.set_opacity(0.35)
    else:
        a.set_colors(stroke=color)
        a.set_border(width=1.2)
    a.set_info(content=text, title="Revue")
    a.update()


def review_pdf(filled_pdf, out_pdf, plan, zmap, fill_results):
    """Annotated copy: yellow = written but to check, red = empty / conflict / answered without zone."""
    zones = {z["id"]: z for z in zmap["zones"]}
    doc = pymupdf.open(filled_pdf)
    overflow = {(r["op"]["answer"], r["op"]["zone"]) for r in fill_results if r.get("overflow")}
    for ans in plan["answers"]:
        head = f"[{ans['ref']}] {ans['label'][:60]}"
        written = [op for op in plan["ops"] if op["answer"] == ans["index"]]
        for op in written:
            z = zones[op["zone"]]
            over = (ans["index"], op["zone"]) in overflow
            if not (op.get("flag") or over) or not z.get("page"):
                continue
            parts = [head, f"{op['zone']} — confiance : {ans['confidence']}"]
            if ans.get("note"):
                parts.append(f"note : {ans['note']}")
            parts += ans["messages"]
            if over:
                parts.append("texte trop long pour la zone")
            _mark(doc[z["page"] - 1], _zone_rect(z) + (-1.5, -1.5, 1.5, 1.5), "\n".join(parts),
                  (0.95, 0.65, 0), (1, 0.93, 0.3))
        if ans["status"] in ("conflict", "empty"):
            for zid in ans["zones"]:
                z = zones[zid]
                if z.get("page"):
                    why = ans.get("note") or " ".join(ans["messages"]) or ans["status"]
                    _mark(doc[z["page"] - 1], _zone_rect(z) + (-3, -3, 3, 3), f"{head}\n{why}", (0.85, 0.1, 0.1))
    for zid in plan["unused"]:
        z = zones[zid]
        if z.get("page"):
            ctx = " ; ".join(f"{k}: {v}" for k, v in (z.get("ctx") or {}).items() if v and k != "line")
            _mark(doc[z["page"] - 1], _zone_rect(z) + (-3, -3, 3, 3), f"{zid} : zone sans réponse\n{ctx[:200]}",
                  (0.85, 0.1, 0.1))
    doc.save(out_pdf, garbage=3, deflate=True)
    return out_pdf
