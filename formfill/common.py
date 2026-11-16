import json
import re
import unicodedata
from pathlib import Path

from rapidfuzz import fuzz

BOX_GLYPHS = set("☐☑☒□▢❑❒❏❐◻⬜○◯❍")
CHECK_GLYPHS = set("☑☒✓✔✗✘xX")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def similarity(a, b):
    """0-100: how much text a is found in text b (order-insensitive, tolerant to partial matches)."""
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    return max(fuzz.token_set_ratio(a, b), fuzz.partial_ratio(a, b) if len(a) >= 4 else 0)


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def find_form(job_dir):
    job = Path(job_dir)
    hits = sorted(p for p in job.glob("*.pdf") if not p.name.startswith("~$"))
    if hits:
        return hits[0]
    raise FileNotFoundError(f"Aucun formulaire .pdf dans {job}")
