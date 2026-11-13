"""Génère un questionnaire fournisseur fictif (NORDAVIA NC-SUR-12) pour tester le workflow.

Usage : .venv/bin/python testdata/make_nc_sur12.py jobs/ncsur12/form.pdf
"""
import sys
from pathlib import Path

import pymupdf

NOTO = "/usr/share/fonts/truetype/noto/NotoSerif-{}.ttf"
DEJA = "/usr/share/fonts/truetype/dejavu/DejaVu{}.ttf"
FONTS = {
    "serif": NOTO.format("Regular"), "serif-b": NOTO.format("Bold"), "serif-i": NOTO.format("Italic"),
    "cond": DEJA.format("SansCondensed"), "cond-b": DEJA.format("SansCondensed-Bold"),
    "mono": DEJA.format("SansMono"), "mono-b": DEJA.format("SansMono-Bold"),
    "sans": DEJA.format("Sans"),
}
_METRICS = {k: pymupdf.Font(fontfile=v) for k, v in FONTS.items()}

TEAL = (0.04, 0.33, 0.38)
SAND = (0.96, 0.93, 0.86)
GREY = (0.92, 0.92, 0.92)
INK = (0.12, 0.12, 0.15)
MUTED = (0.38, 0.40, 0.44)
BLUE = (0.10, 0.20, 0.55)
TOTAL_PAGES = 4


class Pen:
    def __init__(self, page):
        self.page = page
        self.loaded = set()

    def _font(self, name):
        if name not in self.loaded:
            self.page.insert_font(fontname=name.replace("-", ""), fontfile=FONTS[name])
            self.loaded.add(name)
        return name.replace("-", "")

    def width(self, text, font, size):
        return _METRICS[font].text_length(text, size)

    def text(self, x, y, text, font="serif", size=9, color=INK, align="left"):
        if align == "right":
            x -= self.width(text, font, size)
        elif align == "center":
            x -= self.width(text, font, size) / 2
        self.page.insert_text((x, y), text, fontname=self._font(font), fontsize=size, color=color)

    def para(self, x, y, w, text, font="serif", size=9, color=INK, leading=1.35):
        line = ""
        for word in text.split():
            cand = f"{line} {word}".strip()
            if self.width(cand, font, size) > w and line:
                self.text(x, y, line, font, size, color)
                y += size * leading
                line = word
            else:
                line = cand
        if line:
            self.text(x, y, line, font, size, color)
            y += size * leading
        return y

    def rect(self, r, stroke=None, fill=None, width=0.6):
        self.page.draw_rect(pymupdf.Rect(r), color=stroke, fill=fill, width=width if stroke else 0)

    def line(self, a, b, color=INK, width=0.5, dashes=None):
        self.page.draw_line(a, b, color=color, width=width, dashes=dashes)

    def circle(self, cx, cy, r=4.2, color=INK):
        self.page.draw_circle((cx, cy), r, color=color, width=0.7)


def header(pen, pw, landscape=False):
    pen.rect((0, 0, pw, 62), fill=TEAL)
    pen.text(36, 30, "NORDAVIA", "serif-b", 20, (1, 1, 1))
    pen.text(36 + pen.width("NORDAVIA ", "serif-b", 20), 30, "Components AB", "serif-i", 13, (0.85, 0.95, 0.95))
    pen.text(36, 48, "Supplier Approval Survey", "serif", 10, (0.85, 0.95, 0.95))
    pen.text(pw - 36, 28, "NC-SUR-12  ·  Rev. C  ·  2026-03", "serif", 8.5, (1, 1, 1), "right")
    pen.text(pw - 36, 44, f"Page {pen.page.number + 1} / {TOTAL_PAGES}", "serif-b", 8.5, (1, 1, 1), "right")


def footer(pen, pw, ph):
    pen.line((36, ph - 34), (pw - 36, ph - 34), MUTED, 0.4)
    pen.text(36, ph - 22, "NORDAVIA Components AB — Box 1147, 581 11 Linköping, Sweden — Confidential once completed",
             "serif-i", 7, MUTED)


def part(pen, x, y, w, letter, title, font="serif-b"):
    pen.rect((x, y, x + w, y + 17), fill=SAND)
    pen.rect((x, y, x + 22, y + 17), fill=TEAL)
    pen.text(x + 11, y + 12.5, letter, font, 10, (1, 1, 1), "center")
    pen.text(x + 30, y + 12.5, title.upper(), font, 9.5, TEAL)
    return y + 27


def shaded_field(pen, x, y, w, label, h=17):
    """Libellé au-dessus d'une zone grisée sans bordure."""
    pen.text(x, y + 7, label, "serif", 7, MUTED)
    pen.rect((x, y + 10, x + w, y + 10 + h), fill=GREY)
    return y + 10 + h + 8


def page1(doc):
    pw, ph = 595, 842
    page = doc.new_page(width=pw, height=ph)
    pen = Pen(page)
    header(pen, pw)
    y = pen.para(36, 84, pw - 72,
                 "Please complete every part of this survey in English. Where a question does not apply, write "
                 "\"N/A\" rather than leaving it blank. Return the completed and signed survey, with copies of your "
                 "certificates, to supplier.quality@nordavia.example within 30 days of receipt.",
                 "serif-i", 8.5, MUTED)
    pen.rect((36, y + 2, pw - 36, y + 22), stroke=TEAL, width=0.5)
    pen.text(44, y + 15, "Survey reference:", "serif-b", 8, TEAL)
    pen.text(120, y + 15, "SUR-2026-0412", "mono", 8.5, BLUE)
    pen.text(300, y + 15, "Sent on:", "serif-b", 8, TEAL)
    pen.text(342, y + 15, "02 October 2026", "mono", 8.5, BLUE)
    y += 38

    y = part(pen, 36, y, pw - 72, "A", "Company identification")
    full = pw - 72
    half = (full - 14) / 2
    third = (full - 28) / 3
    y = shaded_field(pen, 36, y, full, "A1  Registered company name")
    shaded_field(pen, 36, y, half, "A2  Trading name (if different)")
    y = shaded_field(pen, 36 + half + 14, y, half, "A3  Company registration number")
    y = shaded_field(pen, 36, y, full, "A4  Street address")
    for i, lab in enumerate(["A5  Postal code", "A6  City", "A7  Country"]):
        yy = shaded_field(pen, 36 + i * (third + 14), y, third, lab)
    y = yy
    shaded_field(pen, 36, y, half, "A8  VAT / Tax identification number")
    y = shaded_field(pen, 36 + half + 14, y, half, "A9  DUNS number")
    shaded_field(pen, 36, y, half, "A10  Website")
    y = shaded_field(pen, 36 + half + 14, y, half, "A11  Year of foundation")

    for ref, label, opts in [
        ("A12", "Number of employees (all sites)", ["1 – 49", "50 – 249", "250 – 999", "1 000 or more"]),
        ("A13", "Annual turnover, last fiscal year", ["< 10 M EUR", "10 – 50 M EUR", "> 50 M EUR"]),
    ]:
        pen.text(36, y + 6, f"{ref}  {label}", "serif", 7, MUTED)
        x = 44
        for o in opts:
            pen.circle(x, y + 17)
            pen.text(x + 8, y + 20, o, "serif", 8.5)
            x += 26 + pen.width(o, "serif", 8.5) + 20
        y += 32

    y = part(pen, 36, y + 4, pw - 72, "B", "Key contacts")
    cols = [36, 150, 255, 360, 450, pw - 36]
    heads = ["Function", "Name", "Job title", "Telephone", "E-mail"]
    rows = ["General management", "Quality / Airworthiness", "Sales / Customer service", "Logistics / Shipping"]
    rh = 21
    pen.rect((cols[0], y, cols[-1], y + 15), fill=TEAL)
    for c, h in zip(cols, heads):
        pen.text(c + 4, y + 10.5, h, "serif-b", 8, (1, 1, 1))
    yt = y + 15
    for i, r in enumerate(rows):
        pen.rect((cols[0], yt + i * rh, cols[1], yt + (i + 1) * rh), fill=SAND)
        pen.text(cols[0] + 4, yt + i * rh + 13.5, r, "serif", 8)
    yb = yt + len(rows) * rh
    for i in range(len(rows) + 1):
        pen.line((cols[0], yt + i * rh), (cols[-1], yt + i * rh), INK, 0.5)
    for c in cols:
        pen.line((c, y), (c, yb), INK, 0.5)
    y = yb + 16

    y = part(pen, 36, y, pw - 72, "C", "Group structure")
    pen.text(36, y + 4, "C1  Is your company a subsidiary of a group?", "serif", 9)
    pen.text(300, y + 4, "Yes  (     )", "serif", 9)
    pen.text(370, y + 4, "No  (     )", "serif", 9)
    y += 22
    lead = "C2  If yes, name and country of the parent company:"
    pen.text(36, y, lead, "serif", 9)
    x0 = 40 + pen.width(lead, "serif", 9)
    pen.line((x0, y + 1.5), (pw - 36, y + 1.5), MUTED, 0.8, "[1 2] 0")
    y += 20
    lead = "C3  Shareholders holding more than 25 %:"
    pen.text(36, y, lead, "serif", 9)
    x0 = 40 + pen.width(lead, "serif", 9)
    pen.line((x0, y + 1.5), (pw - 36, y + 1.5), MUTED, 0.8, "[1 2] 0")
    pen.line((54, y + 19.5), (pw - 36, y + 19.5), MUTED, 0.8, "[1 2] 0")
    footer(pen, pw, ph)


QUESTIONS = [
    ("D.1", "Organisation", [
        "A quality manager is appointed, independent from production, with direct access to top management.",
        "An organisation chart is maintained and responsibilities for product conformity are defined.",
        "Personnel performing special processes are qualified and their qualification records are kept.",
    ]),
    ("D.2", "Documentation & records", [
        "A quality manual or equivalent describes the quality management system and its scope.",
        "Documents are controlled (approval, revision status, distribution, removal of obsolete issues).",
        "Quality records are retained for at least 10 years after delivery, or longer if required by contract.",
    ]),
    ("D.3", "Production & inspection", [
        "First Article Inspection is performed according to EN 9102 / AS9102 for new or modified parts.",
        "Measuring and test equipment is calibrated against traceable standards at defined intervals.",
        "Nonconforming product is identified, segregated and dispositioned by authorised personnel.",
        "Foreign Object Damage (FOD) prevention is in place in production and storage areas.",
    ]),
    ("D.4", "Purchasing & sub-tier suppliers", [
        "Sub-tier suppliers are evaluated, approved and monitored for quality and delivery performance.",
        "Customer requirements, including key characteristics and flow-down clauses, are passed to sub-tiers.",
        "A counterfeit part prevention process is implemented (AS5553 / AS6174 or equivalent).",
    ]),
    ("D.5", "Improvement", [
        "Internal audits covering the whole system are planned and performed at least once a year.",
        "Corrective actions use a root-cause method (8D, 5 Why, Ishikawa) and are verified for effectiveness.",
        "Customer satisfaction and on-time delivery are measured and reviewed by management.",
    ]),
]


def page2(doc):
    pw, ph = 842, 595
    page = doc.new_page(width=pw, height=ph)
    pen = Pen(page)
    header(pen, pw, True)
    y = part(pen, 36, 74, pw - 72, "D", "Quality management system — self-assessment", "cond-b")
    pen.para(36, y, pw - 72,
             "Mark one column per requirement with a cross. In the last column, give the reference of the "
             "procedure or record that demonstrates compliance (number and title).", "cond", 8, MUTED)
    y += 20
    cols = [36, 72, 470, 505, 540, 575, 610, pw - 36]
    pen.rect((cols[0], y, cols[-1], y + 26), fill=TEAL)
    for i, h in enumerate(["No.", "Requirement", "C", "P", "NC", "N/A", "Evidence / procedure reference"]):
        if 2 <= i <= 5:
            pen.text((cols[i] + cols[i + 1]) / 2, y + 16, h, "cond-b", 8.5, (1, 1, 1), "center")
        else:
            pen.text(cols[i] + 4, y + 16, h, "cond-b", 8.5, (1, 1, 1))
    top = y
    y += 26
    hlines = [top, y]
    rh = 19
    for ref, title, items in QUESTIONS:
        pen.rect((cols[0], y, cols[-1], y + 14), fill=SAND)
        pen.text(cols[0] + 4, y + 10, f"{ref}  {title}", "cond-b", 8, TEAL)
        y += 14
        hlines.append(y)
        for n, q in enumerate(items, 1):
            pen.text(cols[0] + 4, y + 12.5, f"{ref}.{n}", "cond", 8)
            pen.text(cols[1] + 4, y + 12.5, q, "cond", 7.6)
            y += rh
            hlines.append(y)
    for yy in hlines:
        pen.line((cols[0], yy), (cols[-1], yy), INK, 0.4)
    for c in cols:
        pen.line((c, top), (c, y), INK, 0.4)
    pen.text(36, y + 14, "C = compliant    P = partially compliant (explain)    NC = not compliant    "
             "N/A = not applicable to your activity", "cond", 7.5, MUTED)
    footer(pen, pw, ph)


def page3(doc):
    pw, ph = 595, 842
    page = doc.new_page(width=pw, height=ph)
    pen = Pen(page)
    header(pen, pw)
    y = part(pen, 36, 74, pw - 72, "E", "Approvals and certificates")
    pen.text(36, y, "Tick the approvals held and give the certificate number and expiry date (DD/MM/YYYY).",
             "serif-i", 8, MUTED)
    y += 18
    certs = ["EN 9100 / AS9100", "ISO 9001", "ISO 14001", "ISO 45001", "EASA Part 21G", "EASA Part 145",
             "Nadcap (process):"]
    for c in certs:
        pen.text(40, y, f"[  ] {c:<18}", "mono", 8.5)
        pen.text(240, y, "Cert. no. ______________", "mono", 8.5)
        pen.text(400, y, "Expiry __/__/____", "mono", 8.5)
        y += 17
    pen.text(40, y, "[  ] Other (specify) ____________________________________________", "mono", 8.5)
    y += 26

    y = part(pen, 36, y, pw - 72, "F", "Manufacturing capabilities")
    pen.text(36, y, "F1  Processes performed in-house (tick all that apply)", "serif", 9)
    y += 16
    procs = ["CNC machining", "Sheet metal forming", "Composite lay-up", "Heat treatment", "Surface treatment",
             "Painting", "Welding / brazing", "Non-destructive testing", "Mechanical assembly", "Cable harness",
             "PCB assembly", "Additive manufacturing", "Design office", "Test laboratory"]
    colw = (pw - 72) / 3
    for i, p in enumerate(procs):
        cx, cy = 44 + (i % 3) * colw, y + (i // 3) * 16
        pen.text(cx, cy, "\u2751", "sans", 10)
        pen.text(cx + 14, cy, p, "serif", 8.5)
    y += ((len(procs) + 2) // 3) * 16 + 8
    pen.text(36, y, "F2  Materials processed", "serif", 9)
    y += 16
    x = 44
    for m in ["Aluminium", "Titanium", "Steel / CRES", "Nickel alloys", "Composites", "Plastics"]:
        pen.text(x, y, "\u2751", "sans", 10)
        pen.text(x + 14, y, m, "serif", 8.5)
        x += 22 + pen.width(m, "serif", 8.5) + 12
    y += 28

    y = part(pen, 36, y, pw - 72, "G", "Capacity and delivery performance")
    for ref, lab, unit in [("G1", "Current capacity load", "%"),
                           ("G2", "Average lead time for a new part", "weeks"),
                           ("G3", "On-time delivery rate, last 12 months", "%")]:
        pen.text(36, y + 11, f"{ref}  {lab}", "serif", 9)
        pen.rect((330, y, 400, y + 16), stroke=INK, width=0.6)
        pen.text(406, y + 11, unit, "serif", 8.5, MUTED)
        y += 24
    pen.text(36, y + 6, "G4  Main aerospace customers and share of turnover (%)", "serif", 9)
    y += 14
    box = (36, y, pw - 36, y + 90)
    pen.rect(box, stroke=INK, width=0.6)
    for k in range(1, 5):
        pen.line((42, y + k * 18), (pw - 42, y + k * 18), (0.75, 0.75, 0.78), 0.4)
    footer(pen, pw, ph)


def page4(doc):
    pw, ph = 595, 842
    page = doc.new_page(width=pw, height=ph)
    pen = Pen(page)
    header(pen, pw)
    y = part(pen, 36, 74, pw - 72, "H", "Declaration")
    y = pen.para(36, y, pw - 72,
                 "I, the undersigned, declare that the information given in this survey is true and complete. "
                 "I accept that NORDAVIA Components AB may verify it during an on-site audit, and I undertake to "
                 "notify NORDAVIA of any significant change (ownership, site, approvals, key personnel) within "
                 "15 working days.", "serif", 9)
    y += 10
    full = pw - 72
    half = (full - 14) / 2
    shaded_field(pen, 36, y, half, "H1  Name of authorised signatory")
    y = shaded_field(pen, 36 + half + 14, y, half, "H2  Position")
    pen.text(36, y + 7, "H3  Date", "serif", 7, MUTED)
    x = 36
    cell = 15
    for group, n in [("D", 2), ("M", 2), ("Y", 4)]:
        for _ in range(n):
            pen.rect((x, y + 10, x + cell, y + 10 + cell + 3), stroke=INK, width=0.6)
            pen.text(x + cell / 2, y + 36, group, "serif", 6, MUTED, "center")
            x += cell
        if group != "Y":
            pen.text(x + 3, y + 23, "/", "serif", 11, MUTED)
            x += 12
    y += 48
    pen.text(36, y + 7, "H4  Signature", "serif", 7, MUTED)
    pen.text(36 + half + 14, y + 7, "H5  Company stamp", "serif", 7, MUTED)
    pen.rect((36, y + 10, 36 + half, y + 80), stroke=INK, width=0.6)
    pen.rect((36 + half + 14, y + 10, pw - 36, y + 80), stroke=INK, width=0.6)
    y += 104

    pen.rect((36, y, pw - 36, y + 150), fill=(0.95, 0.95, 0.95), stroke=MUTED, width=0.8)
    pen.text(46, y + 18, "RESERVED FOR NORDAVIA — DO NOT FILL IN", "serif-b", 9, MUTED)
    yy = y + 40
    for lab in ["Supplier code:", "Survey reviewed by:", "Audit required:"]:
        pen.text(46, yy, lab, "serif", 8.5, MUTED)
        pen.line((150, yy + 1.5), (330, yy + 1.5), MUTED, 0.5)
        yy += 20
    pen.text(350, y + 40, "Score:", "serif", 8.5, MUTED)
    pen.line((385, y + 41.5), (420, y + 41.5), MUTED, 0.5)
    pen.text(423, y + 40, "/ 100", "serif", 8.5, MUTED)
    pen.text(46, yy + 6, "Decision:", "serif", 8.5, MUTED)
    x = 100
    for d in ["Approved", "Conditionally approved", "Rejected"]:
        pen.text(x, yy + 6, "\u2610", "sans", 10, MUTED)
        pen.text(x + 14, yy + 6, d, "serif", 8.5, MUTED)
        x += 40 + pen.width(d, "serif", 8.5)
    pen.text(46, yy + 30, "Date / visa:", "serif", 8.5, MUTED)
    pen.line((110, yy + 31.5), (330, yy + 31.5), MUTED, 0.5)
    footer(pen, pw, ph)


def main(out):
    doc = pymupdf.open()
    for build in (page1, page2, page3, page4):
        build(doc)
    doc.set_metadata({"title": "NC-SUR-12 Supplier Approval Survey", "author": "NORDAVIA Components AB"})
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    doc.save(out, garbage=4, deflate=True)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "jobs/ncsur12/form.pdf")
