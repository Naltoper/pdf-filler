"""Turn zone-addressed answers into write operations."""
from .common import norm
from .validate import ROLE_FR, writes_of


def _same(prefilled, value):
    a, b = norm(prefilled), norm(value)
    return bool(a and b) and (a == b or b in a)


def build_plan(zmap, data, fit=None):
    zones = {z["id"]: z for z in zmap["zones"]}
    fit = fit or {}
    ops, answers = [], []
    used, ignored = set(), set()
    for i, a in enumerate(data["answers"]):
        info = dict(index=i, ref=a["ref"], label=a["label"], context=a.get("context"), type=a["type"],
                    confidence=a.get("confidence", "medium"), note=a.get("note_for_reviewer"),
                    zones=[], messages=list(fit.get(i, [])))
        answers.append(info)
        if a.get("do_not_fill") or a["type"] == "signature":
            info["status"] = "skipped"
            for zid in [a.get("zone")] + (a.get("zones") or []):
                if zid:
                    ignored.add(zid)
            continue
        writes = writes_of(a)
        if not writes:
            info["status"] = "empty"
            if a.get("zone"):
                info["zones"].append(a["zone"])
            continue
        flag = info["confidence"] != "high" or bool(info["note"]) or bool(info["messages"])
        placed = already = conflict = missing = 0
        for role, zid, op, payload in writes:
            if not zid:
                missing += 1
                info["messages"].append(f"aucune zone pour {ROLE_FR[role]} « {payload[:60]} » : à reporter à la main")
                continue
            z = zones[zid]
            info["zones"].append(zid)
            used.add(zid)
            if op == "check":
                if z.get("checked"):
                    already += 1
                    continue
                ops.append(dict(op="check", zone=zid, answer=i, role=role, flag=flag))
            else:
                pre = z.get("prefilled")
                if pre:
                    if _same(pre, payload):
                        already += 1
                    else:
                        conflict += 1
                        info["messages"].append(f"{zid} contient déjà « {pre[:60]} » : « {payload[:60]} » non écrit")
                    continue
                ops.append(dict(op="text", zone=zid, answer=i, role=role, text=payload, flag=flag))
            placed += 1
        if conflict:
            info["status"] = "conflict"
        elif missing:
            info["status"] = "partial" if placed or already else "no_zone"
        elif placed:
            info["status"] = "placed"
        else:
            info["status"] = "already_filled"

    return dict(
        ops=ops,
        answers=answers,
        unused=_unused(zmap["zones"], used | ignored),
        map_id=zmap.get("map_id"),
        detector=zmap.get("detector"),
    )


def _unused(zones, taken):
    """Empty text zones nobody answered. 'any' cells sharing their row with other 'any' cells are choice
    columns: leaving them unticked is normal."""
    any_rects = [(z["id"], z["page"], z["rect"]) for z in zones if z["kind"] == "any" and z.get("page")]
    out = []
    for z in zones:
        if z["id"] in taken or z["kind"] == "check" or z.get("prefilled"):
            continue
        if z["kind"] == "any" and z.get("page"):
            y0, y1 = z["rect"][1], z["rect"][3]
            if any(zid != z["id"] and p == z["page"] and r[1] < y1 and r[3] > y0 for zid, p, r in any_rects):
                continue
        out.append(z["id"])
    return out
