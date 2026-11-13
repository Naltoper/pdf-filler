"""Human review report (markdown)."""
from collections import Counter

STATUS_FR = {
    "placed": "écrite",
    "already_filled": "déjà présente",
    "partial": "PARTIELLE",
    "no_zone": "SANS ZONE",
    "conflict": "CONFLIT",
    "empty": "vide",
    "skipped": "ignorée",
}
NEEDS_ACTION = {"no_zone", "conflict", "partial"}


def _ctx(z):
    return " ; ".join(f"{k}: {v[:50]}" for k, v in (z.get("ctx") or {}).items() if v and k != "line")[:160]


def build_report(job_name, zmap, plan, fill_results, warnings):
    zones = {z["id"]: z for z in zmap["zones"]}
    answers = plan["answers"]
    counts = Counter(a["status"] for a in answers)
    kinds = Counter(z["kind"] for z in zmap["zones"])
    L = [f"# Revue de remplissage : {job_name}", ""]
    L.append(f"Formulaire : `{zmap['source']}` ({zmap['kind']}), carte des zones {zmap['map_id']}")
    L.append(f"Zones détectées : {len(zmap['zones'])} ({kinds['check']} cases, {kinds['text']} textes, "
             f"{kinds['any']} cellules case-ou-texte)")
    L += [f"Note de détection : {n}" for n in zmap.get("notes", [])]
    L.append("")
    L.append("Réponses : " + ", ".join(f"{STATUS_FR.get(k, k)} {v}" for k, v in counts.most_common()))
    L.append("")

    todo = [a for a in answers if a["status"] in NEEDS_ACTION]
    L.append(f"## À corriger ({len(todo)})")
    L.append("")
    if not todo:
        L.append("Rien.")
    for a in todo:
        L.append(f"- **{a['ref']}** {a['label'][:70]} : {STATUS_FR[a['status']]}. " + " ".join(a["messages"]))
    L.append("")

    check = [a for a in answers if a["status"] not in NEEDS_ACTION | {"skipped", "empty"} and
             (a["confidence"] != "high" or a.get("note") or a["messages"])]
    overflow = [r for r in fill_results if r.get("overflow")]
    L.append(f"## À vérifier ({len(check)})")
    L.append("")
    for a in sorted(check, key=lambda a: (not a["messages"], a["index"])):
        bits = [f"confiance {a['confidence']}"]
        if a.get("note"):
            bits.append(f"note : {a['note']}")
        bits += a["messages"]
        where = ", ".join(a["zones"])
        L.append(f"- **{a['ref']}** {a['label'][:70]} ({where}) : " + " ; ".join(bits))
    if overflow:
        L.append("")
        L.append("Textes réduits au minimum mais trop longs pour leur zone :")
        for r in overflow:
            L.append(f"- {r['op']['zone']} : {r['op'].get('text', '')[:80]!r}")
    L.append("")

    L.append(f"## Zones de texte sans réponse ({len(plan['unused'])})")
    L.append("")
    for zid in plan["unused"]:
        z = zones[zid]
        page = f"p{z['page']} " if z.get("page") else ""
        L.append(f"- {zid} {page}: {_ctx(z) or '(aucun texte autour)'}")
    L.append("")
    if warnings:
        L.append("## Avertissements du validateur")
        L.append("")
        L += [f"- {w}" for w in warnings]
        L.append("")
    rest = [a for a in answers if a["status"] in ("skipped", "empty")]
    if rest:
        L.append(f"## Ignorées ou vides ({len(rest)})")
        L.append("")
        for a in rest:
            note = f" ({a['note']})" if a.get("note") else ""
            L.append(f"- {a['ref']} {a['label'][:60]} : {STATUS_FR[a['status']]}{note}")
    return "\n".join(L) + "\n"
