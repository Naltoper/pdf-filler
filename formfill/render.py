"""Page images for visual QA and the annotated review PDF."""
from pathlib import Path

import pymupdf

# /C (stroke) = hover popup chrome — viewers force white text on it, so keep dark.
# /IC (fill) = page highlight — very pale so underlying ink stays readable.
# No /CA opacity: viewers apply it to the popup and wash dark /C into light blue.
STYLE = {
    "ok": dict(
        title="OK",
        popup=(0.08, 0.28, 0.58),
        fill=(0.88, 0.93, 1.0),
        border=1.0,
    ),
    "check": dict(
        title="À vérifier",
        popup=(0.55, 0.32, 0.04),
        fill=(1.0, 0.95, 0.82),
        border=1.2,
    ),
    "error": dict(
        title="À traiter",
        popup=(0.58, 0.10, 0.08),
        fill=(1.0, 0.90, 0.90),
        border=1.4,
    ),
}


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


def _pdf_rgb(rgb):
    return "[%.3f %.3f %.3f]" % tuple(rgb)


def _popup_title(kind, lines):
    base = STYLE[kind]["title"]
    for line in lines:
        if not line:
            continue
        if line.startswith("Zone "):
            return f"{base} · {line.split()[1]}"
        if line[0] == "Z" and len(line) > 1 and line[1].isdigit():
            return f"{base} · {line.split()[0].rstrip('—').strip()}"
    return base


def _mark(page, rect, lines, kind="ok"):
    """Pale page wash (content stream) + dark-stroke annot for the hover popup.

    Fill must not live on the annotation: viewers apply annot opacity to the
    popup chrome and wash dark /C into an unreadable light tint; an opaque
    annot fill also hides the written answers underneath.
    """
    style = STYLE[kind]
    body = "\n".join(p for p in (ln.strip() for ln in lines) if p)
    title = _popup_title(kind, lines)
    r = pymupdf.Rect(rect)
    # Translucent wash in page content — independent of annot / popup colours.
    page.draw_rect(r, color=None, fill=style["fill"], fill_opacity=0.45, overlay=True)
    page.draw_rect(r, color=style["popup"], width=style["border"], overlay=True)

    a = page.add_rect_annot(r)
    a.set_colors(stroke=style["popup"])
    a.set_border(width=style["border"])
    a.set_info(content=body, title=title, subject=kind)
    pr = r
    pop = pymupdf.Rect(pr.x1 + 8, pr.y0, pr.x1 + 260, pr.y0 + max(70, 16 * (body.count("\n") + 2)))
    page_rect = page.rect
    if pop.x1 > page_rect.x1 - 4:
        pop = pymupdf.Rect(max(page_rect.x0 + 4, pr.x0 - 260), pr.y0, pr.x0 - 8, pop.y1)
    if pop.x0 < page_rect.x0 + 4:
        pop = pymupdf.Rect(page_rect.x0 + 4, pop.y0, min(page_rect.x1 - 4, page_rect.x0 + 256), pop.y1)
    if pop.y1 > page_rect.y1 - 4:
        dy = page_rect.y1 - 4 - pop.y1
        pop += (0, dy, 0, dy)
    if pop.y0 < page_rect.y0 + 4:
        dy = page_rect.y0 + 4 - pop.y0
        pop += (0, dy, 0, dy)
    a.set_popup(pop)
    a.update()
    doc = page.parent
    rgb = _pdf_rgb(style["popup"])
    doc.xref_set_key(a.xref, "C", rgb)
    if a.popup_xref:
        doc.xref_set_key(a.popup_xref, "C", rgb)


def check_plan_zones(plan, zmap):
    """Raise ValueError if the plan was built for a different zone map."""
    plan_id = plan.get("map_id")
    zmap_id = zmap.get("map_id")
    if plan_id and zmap_id and plan_id != zmap_id:
        raise ValueError(
            f"carte de zones incompatible : plan map_id={plan_id} "
            f"mais zones/ map_id={zmap_id} "
            f"(relancer `python -m formfill run` avec un answers.json "
            f"aligné sur le zones.txt / zones.pdf actuel)"
        )
    known = {z["id"] for z in zmap["zones"]}
    missing = sorted({
        zid for zid in (
            [o.get("zone") for o in plan.get("ops") or []]
            + [z for z in plan.get("unused") or []]
        )
        if zid and zid not in known
    })
    if missing:
        hint = (
            f" (plan map_id={plan_id}, zones map_id={zmap_id})"
            if plan_id or zmap_id else ""
        )
        raise ValueError(
            f"plan.json référence des zones absentes de la carte actuelle : "
            f"{', '.join(missing[:12])}{'…' if len(missing) > 12 else ''}{hint}. "
            f"Relancer `formfill run` après un nouveau answers.json."
        )
    if not plan_id and zmap_id:
        # Old plan format: geometry may still be wrong even if ids exist.
        import sys
        print(
            f"avertissement : plan.json sans map_id (ancien format) — "
            f"vérifier qu'il correspond à la carte {zmap_id}",
            file=sys.stderr,
        )


def review_pdf(filled_pdf, out_pdf, plan, zmap, fill_results):
    """Annotated copy: blue = written OK, amber = to check, red = empty / conflict / unused.

    Raises ValueError if ``plan`` does not match ``zmap`` (stale Zn map).
    """
    check_plan_zones(plan, zmap)
    zones = {z["id"]: z for z in zmap["zones"]}
    doc = pymupdf.open(filled_pdf)
    overflow = {(r["op"]["answer"], r["op"]["zone"]) for r in fill_results if r.get("overflow")}
    ops_by_answer = {}
    for op in plan["ops"]:
        ops_by_answer.setdefault(op["answer"], []).append(op)

    for ans in plan["answers"]:
        head = f"[{ans['ref']}] {ans['label'][:70]}"
        for op in ops_by_answer.get(ans["index"], []):
            z = zones.get(op["zone"])
            if not z or not z.get("page"):
                continue
            over = (ans["index"], op["zone"]) in overflow
            to_check = op.get("flag") or over
            conf = ans.get("confidence") or "—"
            lines = [head, f"Zone {op['zone']}", f"Confiance  {conf}"]
            if to_check:
                lines.append("Statut  à vérifier")
                if ans.get("note"):
                    lines.append(f"Note  {ans['note']}")
                lines += [f"• {m}" for m in ans["messages"] if m]
                if over:
                    lines.append("• texte trop long pour la zone")
                kind = "check"
            else:
                lines.append("Statut  ajout OK")
                kind = "ok"
            _mark(doc[z["page"] - 1], _zone_rect(z) + (-1.5, -1.5, 1.5, 1.5), lines, kind)
        if ans["status"] in ("conflict", "empty"):
            for zid in ans["zones"]:
                z = zones.get(zid)
                if z and z.get("page"):
                    why = ans.get("note") or " ".join(ans["messages"]) or ans["status"]
                    _mark(
                        doc[z["page"] - 1],
                        _zone_rect(z) + (-3, -3, 3, 3),
                        [head, f"Zone {zid}", f"Statut  {ans['status']}", why],
                        "error",
                    )
    for zid in plan["unused"]:
        z = zones.get(zid)
        if z and z.get("page"):
            ctx = " · ".join(f"{k}: {v}" for k, v in (z.get("ctx") or {}).items() if v and k != "line")
            lines = [f"Zone {zid}", "Statut  sans réponse"]
            if ctx:
                lines.append(ctx[:220])
            _mark(doc[z["page"] - 1], _zone_rect(z) + (-3, -3, 3, 3), lines, "error")
    doc.save(out_pdf, garbage=3, deflate=True)
    return out_pdf
