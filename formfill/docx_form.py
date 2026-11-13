"""Legacy Word form fields (FORMCHECKBOX / FORMTEXT): zones, numbered copy and filling."""
import re
from copy import deepcopy

import docx
from docx.oxml.ns import qn

W_FLD = qn("w:fldChar")
W_TYPE = qn("w:fldCharType")
W_VAL = qn("w:val")
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def iter_fields(document):
    """Yield (index, begin_fldChar, ffData) for each legacy form field in document order."""
    idx = 0
    for el in document.element.body.iter(W_FLD):
        if el.get(W_TYPE) != "begin":
            continue
        ff = el.find(qn("w:ffData"))
        if ff is None:
            continue
        yield idx, el, ff
        idx += 1


def _ancestor(el, tag):
    p = el.getparent()
    while p is not None and p.tag != qn(tag):
        p = p.getparent()
    return p


def _run_of(fld):
    return fld.getparent()


def _result_runs(begin_run):
    """Runs between the 'separate' and 'end' fldChar following begin_run (same paragraph)."""
    runs, state = [], "instr"
    for r in begin_run.itersiblings(qn("w:r")):
        fc = r.find(W_FLD)
        if fc is not None:
            t = fc.get(W_TYPE)
            if t == "separate":
                state = "result"
                continue
            if t in ("end", "begin"):
                break
        if state == "result":
            runs.append(r)
    return runs


def _texts_in_order(container):
    """Flatten container into tokens ('text', str) or ('field', begin_el), skipping field results."""
    tokens = []
    in_result = 0
    for el in container.iter(W_FLD, qn("w:t"), qn("w:tab"), qn("w:br"), qn("w:p")):
        if el.tag == W_FLD:
            t = el.get(W_TYPE)
            if t == "begin":
                if el.find(qn("w:ffData")) is not None:
                    tokens.append(("field", el))
                in_result += 1
            elif t == "end":
                in_result = max(0, in_result - 1)
        elif el.tag == qn("w:p"):
            tokens.append(("text", "\n"))
        elif el.tag == qn("w:t"):
            if in_result == 0:
                tokens.append(("text", el.text or ""))
        else:
            tokens.append(("text", " "))
    return tokens


def _clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip()


def _cell_text(tc):
    return _clean("".join(t for k, t in _texts_in_order(tc) if k == "text"))


def _grid_cols(tr):
    """(tc, first grid column, end grid column) for each cell of a row."""
    col = 0
    trpr = tr.find(qn("w:trPr"))
    if trpr is not None:
        gb = trpr.find(qn("w:gridBefore"))
        if gb is not None:
            col = int(gb.get(W_VAL))
    out = []
    for tc in tr.findall(qn("w:tc")):
        span = 1
        tcpr = tc.find(qn("w:tcPr"))
        if tcpr is not None and tcpr.find(qn("w:gridSpan")) is not None:
            span = int(tcpr.find(qn("w:gridSpan")).get(W_VAL))
        out.append((tc, col, col + span))
        col += span
    return out


def _labels_around(container, fld):
    """Text immediately before (since the previous field) and after (until the next field) a field."""
    tokens = _texts_in_order(container)
    pos = next(i for i, t in enumerate(tokens) if t[0] == "field" and t[1] is fld)
    before = []
    for k, t in reversed(tokens[:pos]):
        if k == "field":
            break
        before.insert(0, t)
    after = []
    for k, t in tokens[pos + 1:]:
        if k == "field":
            break
        after.append(t)
    b_lines = [x for x in (_clean(s) for s in "".join(before).split("\n")) if x]
    a_lines = [x for x in (_clean(s) for s in "".join(after).split("\n")) if x]
    return (b_lines[-1] if b_lines else ""), (a_lines[0] if a_lines else "")


def _checked(ff):
    cb = ff.find(qn("w:checkBox"))
    c = cb.find(qn("w:checked"))
    if c is not None:
        return c.get(W_VAL) not in ("0", "false")
    d = cb.find(qn("w:default"))
    return d is not None and d.get(W_VAL) in ("1", "true")


def _max_len(ff):
    ti = ff.find(qn("w:textInput"))
    ml = ti.find(qn("w:maxLength")) if ti is not None else None
    return int(ml.get(W_VAL)) if ml is not None else None


def _current_text(fld):
    runs = _result_runs(_run_of(fld))
    return _clean("".join(t.text or "" for r in runs for t in r.iter(qn("w:t"))))


def _has_field(tr):
    return any(el.get(W_TYPE) == "begin" and el.find(qn("w:ffData")) is not None for el in tr.iter(W_FLD))


def _column_header(tr, tc, row_checks):
    """Text of the nearest field-free row above whose cell covers the same grid column (by order if needed)."""
    tbl = _ancestor(tr, "w:tbl")
    if tbl is None:
        return None
    rows = tbl.findall(qn("w:tr"))
    pos = next((i for i, r in enumerate(rows) if r is tr), None)
    if pos is None:
        return None
    grid = _grid_cols(tr)
    c0 = next((a for c, a, b in grid if c is tc), None)
    for hdr in reversed(rows[max(0, pos - 40):pos]):
        if _has_field(hdr):
            continue
        cols = [(a, b, _cell_text(c)) for c, a, b in _grid_cols(hdr)]
        texts = [t for a, b, t in cols if t]
        if len(texts) < 2 or any(len(t) > 60 for t in texts[1:]):
            continue
        choices = [t for a, b, t in cols[1:] if t]
        if row_checks and len(choices) == len(row_checks) and tc in row_checks:
            return choices[row_checks.index(tc)]
        hit = next((t for a, b, t in cols if c0 is not None and a <= c0 < b and t), None)
        if hit:
            return hit
        return None
    return None


def docx_zones(path):
    document = docx.Document(str(path))
    fields = list(iter_fields(document))
    checks_by_row = {}
    for idx, fld, ff in fields:
        tr, tc = _ancestor(fld, "w:tr"), _ancestor(fld, "w:tc")
        if tr is not None and ff.find(qn("w:checkBox")) is not None and not _cell_text(tc):
            checks_by_row.setdefault(id(tr), []).append(tc)
    zones = []
    for idx, fld, ff in fields:
        is_check = ff.find(qn("w:checkBox")) is not None
        tc, tr = _ancestor(fld, "w:tc"), _ancestor(fld, "w:tr")
        before, after = _labels_around(tc if tc is not None else _ancestor(fld, "w:p"), fld)
        ctx = {}
        if tr is not None:
            first = tr.findall(qn("w:tc"))[0]
            if first is not tc:
                row = _cell_text(first)
                if row:
                    ctx["row"] = row[:110]
            col = _column_header(tr, tc, checks_by_row.get(id(tr), []))
            if col:
                ctx["col"] = col[:80]
        if before:
            ctx["left"] = before[-90:]
        if after:
            ctx["right"] = after[:70]
        z = dict(shape="docx", kind="check" if is_check else "text", page=None, field=idx, ctx=ctx)
        if is_check:
            z["checked"] = _checked(ff)
        else:
            z["prefilled"] = _current_text(fld) or None
            z["max_length"] = _max_len(ff)
        zones.append(z)
    return dict(kind="docx_fields", pages=None, zones=zones, notes=[])


def _run_props(parent, props):
    rpr = parent.makeelement(qn("w:rPr"), {})
    for tag, val in props:
        rpr.append(rpr.makeelement(qn(tag), {W_VAL: val} if val else {}))
    return rpr


def numbered_docx(src, dst, zones):
    """Copy of the document with a coloured 'Zn' tag in front of every form field."""
    document = docx.Document(str(src))
    ids = {z["field"]: z["id"] for z in zones}
    for idx, fld, ff in list(iter_fields(document)):
        begin_run = _run_of(fld)
        r = begin_run.makeelement(qn("w:r"), {})
        r.append(_run_props(r, [("w:b", None), ("w:color", "C8006A"), ("w:sz", "13"), ("w:highlight", "yellow")]))
        t = r.makeelement(qn("w:t"), {})
        t.text = f"{ids[idx]} "
        t.set(XML_SPACE, "preserve")
        r.append(t)
        begin_run.addprevious(r)
    document.save(str(dst))


def fill_docx(src, dst, ops):
    document = docx.Document(str(src))
    fields = {idx: (fld, ff) for idx, fld, ff in iter_fields(document)}
    for op in ops:
        fld, ff = fields[op["field"]]
        if op["op"] == "check":
            cb = ff.find(qn("w:checkBox"))
            c = cb.find(qn("w:checked"))
            if c is None:
                c = cb.makeelement(qn("w:checked"), {})
                cb.append(c)
            c.set(W_VAL, "1")
        elif op["op"] == "text":
            _set_text(fld, op["text"], highlight=op.get("flag"))
    document.save(str(dst))


def _set_text(fld, text, highlight=False):
    begin_run = _run_of(fld)
    runs = _result_runs(begin_run)
    if not runs:
        end_run = next(r for r in begin_run.itersiblings(qn("w:r"))
                       if r.find(W_FLD) is not None and r.find(W_FLD).get(W_TYPE) == "end")
        new = end_run.makeelement(qn("w:r"), {})
        rpr = begin_run.find(qn("w:rPr"))
        if rpr is not None:
            new.append(deepcopy(rpr))
        end_run.addprevious(new)
        runs = [new]
    first = runs[0]
    for r in runs[1:]:
        r.getparent().remove(r)
    for child in list(first):
        if child.tag != qn("w:rPr"):
            first.remove(child)
    if highlight:
        rpr = first.find(qn("w:rPr"))
        if rpr is None:
            rpr = first.makeelement(qn("w:rPr"), {})
            first.insert(0, rpr)
        if rpr.find(qn("w:highlight")) is None:
            hl = rpr.makeelement(qn("w:highlight"), {W_VAL: "yellow"})
            after = [qn(t) for t in ("w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl",
                                     "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath")]
            nxt = next((c for c in rpr if c.tag in after), None)
            if nxt is not None:
                nxt.addprevious(hl)
            else:
                rpr.append(hl)
    t = first.makeelement(qn("w:t"), {})
    t.text = text
    t.set(XML_SPACE, "preserve")
    first.append(t)
