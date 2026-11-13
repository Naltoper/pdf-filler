"""Validate a gem answers.json against the schema and the zone map."""
import json
import re
from pathlib import Path

import jsonschema

from .common import norm, similarity

SCHEMA = json.loads((Path(__file__).resolve().parent.parent / "schema" / "answers.schema.json").read_text())

RANGE_RE = re.compile(r"\d\s*(?:to|-|–|à|bis)\s*\d+\.\d", re.I)
MARKDOWN_RE = re.compile(r"\*\*|__|\[[^\]]*\]\([^)]*\)|^#+\s", re.M)
REDIRECT_RE = re.compile(r"google\.[a-z.]+/search|/url\?q=", re.I)
PLACEHOLDER_RE = re.compile(r"\[(?:draft|todo|tbd|à compléter|to be filled)[^\]]*\]", re.I)
ROLE_FR = {"value": "la valeur", "choice": "la case", "option": "l'option", "remark": "la remarque",
           "inline": "le texte dans la question"}
FIT_MIN = 55


def writes_of(a):
    """(role, zone, op, payload) for everything an answer asks to write."""
    out = []
    if a["type"] in ("text", "date") and a.get("value"):
        out.append(("value", a.get("zone"), "text", a["value"]))
    elif a["type"] == "choice" and a.get("choice"):
        out.append(("choice", a.get("zone"), "check", a["choice"]))
    elif a["type"] == "multi_choice":
        zones = a.get("zones") or []
        for k, opt in enumerate(a.get("options_checked") or []):
            out.append(("option", zones[k] if k < len(zones) else None, "check", opt))
    if a.get("remark"):
        out.append(("remark", a.get("remark_zone"), "text", a["remark"]))
    if a.get("inline_text"):
        out.append(("inline", a.get("inline_zone"), "text", a["inline_text"]))
    return out


def _fit(a, role, payload, zone):
    """Does the text printed around the zone look like what the answer is about?"""
    ctx = zone.get("ctx") or {}
    around = [v for v in ctx.values() if v]
    if not around:
        return None
    blob = norm(" ".join(around))
    ref = norm(a["ref"])
    if role in ("choice", "option"):
        # Prefer column / side labels for the tick; row/left are the question text.
        side = [ctx[k] for k in ("col", "above", "right") if ctx.get(k)] or around
        col = max(similarity(payload, v) for v in side)
        if col < FIT_MIN:
            return f"{zone['id']} : « {payload} » ne figure pas autour de la case ({_short(ctx)})"
        if role == "choice":
            row_vals = [ctx[k] for k in ("row", "left", "line") if ctx.get(k)] or around
            row = max([similarity(a["label"], v) for v in row_vals] +
                      [similarity(a.get("context") or "", v) for v in row_vals])
            if row < FIT_MIN and not (len(ref) >= 2 and f" {ref} " in f" {blob} "):
                return f"{zone['id']} : la ligne de cette case ne ressemble pas à la question ({_short(ctx)})"
        return None
    cands = [a["label"], a.get("context") or ""]
    score = max(similarity(c, v) for c in cands if c for v in around)
    if role in ("remark", "inline") or score >= FIT_MIN:
        return None
    if len(ref) >= 2 and f" {ref} " in f" {blob} ":
        return None
    return f"{zone['id']} : le texte autour de la zone ne ressemble pas au libellé « {a['label'][:50]} » ({_short(ctx)})"


def _short(ctx):
    return " ; ".join(f"{k}: {v[:40]}" for k, v in ctx.items() if v and k not in ("line", "field_name"))[:160]


def validate_answers(data, zmap=None):
    """Return (errors, warnings, fit) where fit maps answer index -> list of review messages."""
    errors, warnings, fit = [], [], {}
    v = jsonschema.Draft202012Validator(SCHEMA)
    for e in sorted(v.iter_errors(data), key=lambda e: list(e.path)):
        loc = "/".join(str(p) for p in e.path) or "(racine)"
        errors.append(f"{loc}: {e.message}")
    if errors:
        return errors, warnings, fit

    zones = {z["id"]: z for z in zmap["zones"]} if zmap else {}
    if zmap and data["form"]["zone_map"] != zmap["map_id"]:
        errors.append(f"form.zone_map vaut {data['form']['zone_map']!r} mais la carte des zones actuelle est "
                      f"{zmap['map_id']!r} : réponses produites sur un autre zones.txt, refaire avec les fichiers actuels")
    used = {}
    for i, a in enumerate(data["answers"]):
        where = f"answers[{i}] (ref {a['ref']!r}, {a['label'][:40]!r})"
        if RANGE_RE.search(a["ref"]) or "," in a["ref"]:
            errors.append(f"{where}: ref regroupe plusieurs questions; une entrée par question est exigée")
        for fld in ("value", "remark", "inline_text", "choice"):
            s = a.get(fld)
            if not s:
                continue
            if MARKDOWN_RE.search(s):
                errors.append(f"{where}.{fld}: contient du markdown ({s[:40]!r}); texte brut exigé")
            if REDIRECT_RE.search(s):
                errors.append(f"{where}.{fld}: lien de redirection Google ({s[:60]!r}); mettre l'URL réelle")
            if PLACEHOLDER_RE.search(s):
                errors.append(f"{where}.{fld}: placeholder ({s[:40]!r}); mettre null + note_for_reviewer")
        if a["type"] == "choice" and a.get("options_checked"):
            errors.append(f"{where}: options_checked interdit pour type 'choice'")
        if a["type"] in ("text", "date") and a.get("choice"):
            errors.append(f"{where}: champ 'choice' inattendu pour type {a['type']!r}")
        if a["type"] == "multi_choice" and len(a.get("zones") or []) != len(a.get("options_checked") or []):
            errors.append(f"{where}: 'zones' doit avoir une zone par élément de options_checked, dans le même ordre")
        if a.get("value") is None and a["type"] in ("text", "date") and not a.get("note_for_reviewer") \
                and not a.get("do_not_fill"):
            warnings.append(f"{where}: valeur vide sans note_for_reviewer")
        if a.get("do_not_fill") or a["type"] == "signature":
            continue
        for role, zid, op, payload in writes_of(a):
            if zid is None:
                warnings.append(f"{where}: aucune zone pour {ROLE_FR[role]} « {payload[:40]} » (à reporter à la main)")
                continue
            if zmap is None:
                continue
            z = zones.get(zid)
            if z is None:
                errors.append(f"{where}: zone {zid} inexistante dans zones.txt")
                continue
            if op == "check" and z["kind"] == "text":
                errors.append(f"{where}: {zid} est une zone de texte, pas une case à cocher")
            elif op == "text" and z["kind"] == "check":
                errors.append(f"{where}: {zid} est une case à cocher, pas une zone de texte ({ROLE_FR[role]})")
            if zid in used:
                errors.append(f"{where}: zone {zid} déjà utilisée par answers[{used[zid]}] ; une zone = une réponse")
            used[zid] = i
            if op == "text" and z.get("max_length") and len(payload) > z["max_length"]:
                warnings.append(f"{where}: {zid} limitée à {z['max_length']} caractères ({len(payload)} fournis)")
            if op == "text" and z.get("cells"):
                n = len(z["cells"])
                compact = re.sub(r"[\s/.\-]", "", payload)
                if len(payload) != n and len(compact) != n:
                    warnings.append(f"{where}: {zid} a {n} cases, la valeur « {payload} » n'y tient pas exactement")
            if op == "text" and z.get("choices") and payload not in z["choices"]:
                errors.append(f"{where}: {zid} n'accepte que : {' / '.join(z['choices'][:12])}")
            msg = _fit(a, role, payload, z)
            if msg:
                fit.setdefault(i, []).append(msg)
        if a.get("remark") and len(a["remark"]) > 160:
            warnings.append(f"{where}: remark longue ({len(a['remark'])} car.), risque de débordement")
    return errors, warnings, fit


def format_for_gem(errors):
    lines = ["Le JSON produit ne respecte pas le format attendu. Corrige uniquement ces points et renvoie le JSON complet :"]
    lines += [f"- {e}" for e in errors]
    return "\n".join(lines)
