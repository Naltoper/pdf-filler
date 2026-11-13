"""formfill: fill PDF/DOCX questionnaires from gem answers addressed to numbered zones.

Usage:
  python -m formfill prepare JOB_DIR     detect zones -> JOB_DIR/zones/zones.pdf + zones.txt (for the gem)
  python -m formfill run JOB_DIR         validate answers.json, fill, review PDF, report
  python -m formfill validate JOB_DIR    only check answers.json
  python -m formfill crop JOB_DIR PAGE X0 Y0 X1 Y1 [--original]   zoom on a zone of the filled PDF

Options: --answers PATH (default JOB_DIR/answers.json), --no-render, --pages (run: also out/pages/*.png)
JOB_DIR contains the blank form (one .pdf or .docx).
"""
import argparse
import sys
from pathlib import Path

from .common import find_form, load_json, save_json
from .validate import format_for_gem, validate_answers
from .zones import load_zone_map, prepare


def cmd_prepare(job):
    form = find_form(job)
    zmap = prepare(job, form)
    kinds = {k: sum(z["kind"] == k for z in zmap["zones"]) for k in ("check", "text", "any")}
    print(f"formulaire : {form.name} ({zmap['kind']})")
    print(f"{len(zmap['zones'])} zones : {kinds['check']} cases, {kinds['text']} textes, "
          f"{kinds['any']} cellules case-ou-texte — carte {zmap['map_id']}")
    for n in zmap["notes"]:
        print(f"  note : {n}")
    zdir = job / "zones"
    gem_files = [p.name for p in (zdir / "zones.pdf", zdir / "zones.txt") if p.exists()]
    print(f"-> à donner au gem : {', '.join(str(zdir / f) for f in gem_files)}")
    return 0


def cmd_validate(job, answers_path):
    form = find_form(job)
    zmap, err = load_zone_map(job, form)
    if zmap is None:
        print(f"erreur : {err}")
        return None, None, None, None
    data = load_json(answers_path)
    errors, warnings, fit = validate_answers(data, zmap)
    for w in warnings:
        print(f"  avertissement : {w}")
    if errors:
        msg = format_for_gem(errors)
        (job / "out").mkdir(exist_ok=True)
        (job / "out" / "gem_feedback.txt").write_text(msg, encoding="utf-8")
        print(msg)
        print(f"\n-> message à renvoyer au gem : {job / 'out' / 'gem_feedback.txt'}")
        return None, zmap, warnings, fit
    print(f"{answers_path.name} valide ({len(data['answers'])} réponses, carte {zmap['map_id']})")
    return data, zmap, warnings, fit


def cmd_run(job, answers_path, render=True, pages=False):
    from .plan import build_plan
    from .report import build_report

    out = job / "out"
    out.mkdir(exist_ok=True)
    data, zmap, warnings, fit = cmd_validate(job, answers_path)
    if data is None:
        return 2
    form = find_form(job)
    plan = build_plan(zmap, data, fit)
    save_json(out / "plan.json", plan)
    zones = {z["id"]: z for z in zmap["zones"]}

    if form.suffix.lower() == ".docx":
        from .docx_form import fill_docx
        from .render import docx_to_pdf
        filled = out / "filled.docx"
        fill_docx(form, filled, plan["ops"])
        fill_results = [dict(op=op, ok=True, overflow=False) for op in plan["ops"]]
        filled_pdf = out / "filled.pdf"
        if render:
            docx_to_pdf(filled, filled_pdf)
    else:
        from .fill_pdf import fill_pdf
        filled_pdf = out / "filled.pdf"
        fill_results = fill_pdf(form, filled_pdf, plan["ops"], zones)

    if render and filled_pdf.exists():
        from .render import render_pages, review_pdf
        review_pdf(filled_pdf, out / "review.pdf", plan, zmap, fill_results)
        if pages:
            render_pages(filled_pdf, out / "pages")

    report = build_report(job.name, zmap, plan, fill_results, warnings)
    (out / "report.md").write_text(report, encoding="utf-8")
    counts = {}
    for a in plan["answers"]:
        counts[a["status"]] = counts.get(a["status"], 0) + 1
    print("réponses :", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print(f"écritures : {len(plan['ops'])} ; à vérifier (zone douteuse) : {len(fit)} ; "
          f"zones de texte sans réponse : {len(plan['unused'])}")
    print(f"sorties : {out}/ (filled, review.pdf, report.md{', pages/' if pages else ''})")
    return 0


def cmd_crop(job, page, rect, original=False):
    from .render import crop
    src = find_form(job) if original else job / "out" / "filled.pdf"
    p = job / "out" / f"crop-p{page}-{'-'.join(str(int(v)) for v in rect)}.png"
    crop(src, page, rect, p)
    print(p)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="formfill")
    ap.add_argument("command", choices=["prepare", "run", "validate", "crop"])
    ap.add_argument("job")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--answers")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--pages", action="store_true")
    ap.add_argument("--original", action="store_true")
    a = ap.parse_args(argv)
    job = Path(a.job)
    answers = Path(a.answers) if a.answers else job / "answers.json"
    if a.command == "prepare":
        return cmd_prepare(job)
    if a.command == "validate":
        return 0 if cmd_validate(job, answers)[0] is not None else 2
    if a.command == "crop":
        page, *rect = a.args
        return cmd_crop(job, int(page), [float(v) for v in rect], a.original) or 0
    return cmd_run(job, answers, render=not a.no_render, pages=a.pages)


if __name__ == "__main__":
    sys.exit(main())
