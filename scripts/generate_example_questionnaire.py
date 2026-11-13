#!/usr/bin/env python3
"""Generate a blank example supplier questionnaire PDF (fictional company)."""

from __future__ import annotations

from pathlib import Path

import pymupdf

OUT = Path(__file__).resolve().parents[1] / "ARS-SQA-012_Aether_Rotor_Support_Supplier_Questionnaire.pdf"

# Charte: teal + sand (distinct from FO61 / QA-FO-069 / HO-616)
TEAL = (13 / 255, 79 / 255, 79 / 255)
TEAL_MID = (26 / 255, 120 / 255, 115 / 255)
SAND = (196 / 255, 165 / 255, 116 / 255)
INK = (28 / 255, 32 / 255, 36 / 255)
MUTED = (90 / 255, 98 / 255, 104 / 255)
LINE = (180 / 255, 188 / 255, 190 / 255)
ROW_ALT = (245 / 255, 248 / 255, 247 / 255)
WHITE = (1, 1, 1)
LIGHT_TEAL = (232 / 255, 242 / 255, 240 / 255)

PAGE_W, PAGE_H = pymupdf.paper_size("a4")  # 595 x 842
ML, MR, MT, MB = 48, 42, 72, 48
CONTENT_W = PAGE_W - ML - MR


def checkbox(page: pymupdf.Page, x: float, y: float, size: float = 9) -> None:
    page.draw_rect(pymupdf.Rect(x, y - size + 1.5, x + size, y + 1.5), color=TEAL, width=0.8)


def underline(page: pymupdf.Page, x0: float, y: float, x1: float) -> None:
    page.draw_line(pymupdf.Point(x0, y + 2), pymupdf.Point(x1, y + 2), color=LINE, width=0.6)


def text(
    page: pymupdf.Page,
    s: str,
    x: float,
    y: float,
    *,
    size: float = 9,
    color=INK,
    font: str = "helv",
    bold: bool = False,
) -> None:
    page.insert_text(
        pymupdf.Point(x, y),
        s,
        fontsize=size,
        fontname="hebo" if bold else font,
        color=color,
    )


def wrap_text(
    page: pymupdf.Page,
    s: str,
    x: float,
    y: float,
    max_w: float,
    *,
    size: float = 8.5,
    color=INK,
    leading: float = 11,
) -> float:
    words = s.split()
    line = ""
    cy = y
    for w in words:
        trial = f"{line} {w}".strip()
        if pymupdf.get_text_length(trial, fontname="helv", fontsize=size) <= max_w:
            line = trial
        else:
            if line:
                text(page, line, x, cy, size=size, color=color)
                cy += leading
            line = w
    if line:
        text(page, line, x, cy, size=size, color=color)
        cy += leading
    return cy


def header(page: pymupdf.Page, page_no: int, total: int) -> None:
    # Top band
    page.draw_rect(pymupdf.Rect(0, 0, PAGE_W, 56), color=TEAL, fill=TEAL)
    page.draw_rect(pymupdf.Rect(0, 56, PAGE_W, 60), color=SAND, fill=SAND)
    text(page, "AETHER ROTOR SUPPORT B.V.", 16, 22, size=11, color=WHITE, bold=True)
    text(page, "Vendor Quality & Capability Questionnaire", 16, 36, size=8.5, color=(0.85, 0.92, 0.90))
    text(page, "ARS-SQA-012", PAGE_W - 110, 20, size=9, color=SAND, bold=True)
    text(page, "Rev. 03  |  01 Nov 2025", PAGE_W - 110, 34, size=7.5, color=WHITE)
    text(page, f"Page {page_no} of {total}", PAGE_W - 110, 46, size=7.5, color=(0.8, 0.88, 0.86))


def footer(page: pymupdf.Page) -> None:
    page.draw_line(
        pymupdf.Point(ML, PAGE_H - 32),
        pymupdf.Point(PAGE_W - MR, PAGE_H - 32),
        color=LINE,
        width=0.5,
    )
    text(
        page,
        "Controlled document — return completed form to quality@aether-rotor.nl  |  Confidential",
        ML,
        PAGE_H - 20,
        size=7,
        color=MUTED,
    )


def section_title(page: pymupdf.Page, title: str, y: float) -> float:
    page.draw_rect(pymupdf.Rect(ML, y - 12, PAGE_W - MR, y + 6), color=LIGHT_TEAL, fill=LIGHT_TEAL)
    page.draw_rect(pymupdf.Rect(ML, y - 12, ML + 4, y + 6), color=TEAL, fill=TEAL)
    text(page, title, ML + 12, y, size=10, color=TEAL, bold=True)
    return y + 18


def field_row(page: pymupdf.Page, label: str, y: float, line_to: float | None = None) -> float:
    text(page, label, ML, y, size=8.5, color=MUTED)
    x0 = ML + max(120, pymupdf.get_text_length(label, fontname="helv", fontsize=8.5) + 8)
    underline(page, x0, y, line_to or (PAGE_W - MR))
    return y + 16


def yn_header(page: pymupdf.Page, y: float, remarks_w: float = 118) -> float:
    # Column headers for Yes/No/N/A tables
    qx = ML
    yes_x = PAGE_W - MR - remarks_w - 78
    no_x = yes_x + 26
    na_x = no_x + 26
    rem_x = na_x + 26
    text(page, "Assessment item", qx, y, size=7.5, color=MUTED, bold=True)
    text(page, "Yes", yes_x, y, size=7.5, color=MUTED, bold=True)
    text(page, "No", no_x, y, size=7.5, color=MUTED, bold=True)
    text(page, "N/A", na_x, y, size=7.5, color=MUTED, bold=True)
    text(page, "Evidence / remarks", rem_x, y, size=7.5, color=MUTED, bold=True)
    page.draw_line(
        pymupdf.Point(ML, y + 4),
        pymupdf.Point(PAGE_W - MR, y + 4),
        color=TEAL_MID,
        width=0.7,
    )
    return y + 14


def yn_row(
    page: pymupdf.Page,
    ref: str,
    question: str,
    y: float,
    *,
    remarks_w: float = 118,
    alt: bool = False,
) -> float:
    row_h = 28
    yes_x = PAGE_W - MR - remarks_w - 78
    no_x = yes_x + 26
    na_x = no_x + 26
    rem_x = na_x + 26
    q_w = yes_x - ML - 8

    if alt:
        page.draw_rect(
            pymupdf.Rect(ML - 2, y - 10, PAGE_W - MR + 2, y - 10 + row_h),
            color=ROW_ALT,
            fill=ROW_ALT,
        )

    text(page, ref, ML, y, size=7.5, color=TEAL, bold=True)
    # wrap question
    words = question.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if pymupdf.get_text_length(trial, fontname="helv", fontsize=7.8) <= q_w - 36:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    for i, ln in enumerate(lines[:2]):
        text(page, ln, ML + 36, y + i * 9, size=7.8, color=INK)

    checkbox(page, yes_x + 2, y, 8)
    checkbox(page, no_x + 2, y, 8)
    checkbox(page, na_x + 2, y, 8)
    underline(page, rem_x, y, PAGE_W - MR)

    return y + row_h


def cat_box(page: pymupdf.Page, items: list[str], y: float, cols: int = 3) -> float:
    col_w = CONTENT_W / cols
    for i, item in enumerate(items):
        col = i % cols
        row = i // cols
        x = ML + col * col_w
        yy = y + row * 16
        checkbox(page, x, yy, 8)
        text(page, item, x + 14, yy, size=8, color=INK)
    rows = (len(items) + cols - 1) // cols
    return y + rows * 16 + 8


def build() -> None:
    doc = pymupdf.open()
    total = 5

    # ---------- PAGE 1 ----------
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    header(p, 1, total)
    footer(p)
    y = MT + 8

    # Intro block
    p.draw_rect(pymupdf.Rect(ML, y, PAGE_W - MR, y + 78), color=LIGHT_TEAL, fill=LIGHT_TEAL)
    text(p, "Purpose", ML + 10, y + 14, size=9, color=TEAL, bold=True)
    y = wrap_text(
        p,
        "Aether Rotor Support B.V. (EASA Part-145 NL.145.XXXX, Continuing Airworthiness "
        "support for light & medium rotorcraft) evaluates suppliers, distributors, "
        "calibration labs, special-process providers and maintenance contractors before "
        "and during approval. Please answer every applicable item. Mark N/A where the "
        "scope does not apply. Attach certificates, capability lists and sample release "
        "documents. ARS may request further evidence or perform an on-site audit.",
        ML + 10,
        y + 28,
        CONTENT_W - 20,
        size=8,
        color=INK,
        leading=10.5,
    )
    y += 18

    y = section_title(p, "1. Vendor identification", y)
    y = field_row(p, "Legal company name", y)
    y = field_row(p, "Trading name (if different)", y)
    y = field_row(p, "Registered address", y)
    # dual fields
    text(p, "City / Postal code", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 100, y, ML + 280)
    text(p, "Country", ML + 300, y, size=8.5, color=MUTED)
    underline(p, ML + 345, y, PAGE_W - MR)
    y += 16
    text(p, "Phone", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 45, y, ML + 220)
    text(p, "Website", ML + 240, y, size=8.5, color=MUTED)
    underline(p, ML + 290, y, PAGE_W - MR)
    y += 16
    text(p, "VAT / Chamber of Commerce no.", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 155, y, ML + 320)
    text(p, "CAGE / NCAGE", ML + 335, y, size=8.5, color=MUTED)
    underline(p, ML + 415, y, PAGE_W - MR)
    y += 16
    text(p, "Years in aviation business", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 135, y, ML + 220)
    text(p, "Total employees / aviation staff", ML + 240, y, size=8.5, color=MUTED)
    underline(p, ML + 410, y, PAGE_W - MR)
    y += 20

    y = section_title(p, "2. Key contacts", y)
    for label in (
        "Quality / Compliance contact (name, title, e-mail, phone)",
        "Commercial / Order desk contact (name, e-mail, phone)",
        "Technical / Engineering contact (name, e-mail, phone)",
        "After-sales / Claims contact (name, e-mail, phone)",
    ):
        y = field_row(p, label, y)
    y += 4

    y = section_title(p, "3. Nature of business (tick all that apply)", y)
    y = cat_box(
        p,
        [
            "OEM / Design",
            "Part-145 / MRO",
            "Part-21G Production",
            "Part-21J Design",
            "CAMO / Part-CAO",
            "Distributor / Broker",
            "Material supplier",
            "Calibration laboratory",
            "NDT / Special process",
            "Tooling / GSE supplier",
            "Logistics / freight",
            "Software / avionics svc",
            "Training organisation",
            "Other (specify below)",
        ],
        y,
        cols=3,
    )
    text(p, "Primary goods / services offered to ARS:", ML, y, size=8.5, color=MUTED)
    y += 12
    for _ in range(3):
        underline(p, ML, y, PAGE_W - MR)
        y += 14

    # ---------- PAGE 2 ----------
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    header(p, 2, total)
    footer(p)
    y = MT + 8

    y = section_title(p, "4. Approvals, certifications & accreditations", y)
    text(
        p,
        "List applicable approvals. Attach copies. If none, tick N/A on the table below.",
        ML,
        y,
        size=8,
        color=MUTED,
    )
    y += 14

    # Certificate mini-table header
    headers = ["Authority / standard", "Certificate / approval no.", "Scope (short)", "Expiry"]
    widths = [120, 140, 160, 85]
    x = ML
    p.draw_rect(pymupdf.Rect(ML, y - 10, PAGE_W - MR, y + 6), color=TEAL, fill=TEAL)
    for h, w in zip(headers, widths):
        text(p, h, x + 4, y, size=7.5, color=WHITE, bold=True)
        x += w
    y += 16
    for i in range(5):
        if i % 2 == 0:
            p.draw_rect(
                pymupdf.Rect(ML, y - 10, PAGE_W - MR, y + 8),
                color=ROW_ALT,
                fill=ROW_ALT,
            )
        x = ML
        for w in widths:
            underline(p, x + 4, y, x + w - 6)
            x += w
        y += 18

    y += 6
    y = yn_header(p, y)
    q4 = [
        ("4.1", "Relevant aviation authority approval is held and remains current for the intended scope."),
        ("4.2", "ISO 9001 / EN 9100 / AS9100 (or equivalent) certification is held and current."),
        ("4.3", "Specialised accreditation exists where required (ISO/IEC 17025, NADCAP, NDT, etc.)."),
        ("4.4", "No relevant approval is currently suspended, limited, expired or under enforcement action."),
        ("4.5", "Copies of certificates, ratings and capability lists can be provided with this form."),
        ("4.6", "Date of last authority, certification-body or major customer audit is known and recorded."),
    ]
    for i, (ref, q) in enumerate(q4):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 6
    y = section_title(p, "5. Scope of supply to Aether Rotor Support", y)
    y = yn_header(p, y)
    q5 = [
        ("5.1", "Goods/services proposed for ARS are clearly described (P/N, ATA, process, location)."),
        ("5.2", "Approval / capability ratings cover the intended ARS purchase or contract scope."),
        ("5.3", "Limitations, exclusions and work locations applicable to ARS are identified."),
        ("5.4", "Critical or safety-relevant processes remain under the vendor’s own control."),
        ("5.5", "Further subcontracting of ARS work is controlled, monitored and disclosed when required."),
        ("5.6", "A current list (or equivalent control) of significant sub-suppliers is maintained."),
    ]
    for i, (ref, q) in enumerate(q5):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    # ---------- PAGE 3 ----------
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    header(p, 3, total)
    footer(p)
    y = MT + 8

    y = section_title(p, "6. Quality management system", y)
    y = yn_header(p, y)
    q6 = [
        ("6.1", "A documented QMS appropriate to the aviation scope is implemented and maintained."),
        ("6.2", "Quality policy / manual / procedures are available to personnel who need them."),
        ("6.3", "An independent internal audit / compliance monitoring programme is in place."),
        ("6.4", "Findings are recorded, corrective actions assigned, verified and closed effectively."),
        ("6.5", "Customer, regulatory and contractual requirements are flowed into procedures."),
        ("6.6", "Quality records are retained and protected for the required retention period."),
        ("6.7", "Management responsibility for quality is clearly assigned and resourced."),
    ]
    for i, (ref, q) in enumerate(q6):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 4
    y = section_title(p, "7. Safety management & occurrence reporting", y)
    y = yn_header(p, y)
    q7 = [
        ("7.1", "A safety / risk management process appropriate to the aviation activity is implemented."),
        ("7.2", "Hazards related to products/services supplied to ARS are identified and controlled."),
        ("7.3", "An internal occurrence / hazard reporting channel exists (including confidential options)."),
        ("7.4", "Occurrences are investigated; causes and contributing factors are addressed."),
        ("7.5", "Safety or quality issues affecting ARS products/services are notified without undue delay."),
        ("7.6", "Just culture principles are applied so personnel are not punished for honest mistakes."),
    ]
    for i, (ref, q) in enumerate(q7):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 4
    y = section_title(p, "8. Facilities, environment & security", y)
    y = yn_header(p, y)
    q8 = [
        ("8.1", "Facilities suit the work and protect parts/products from adverse environmental conditions."),
        ("8.2", "Specialised areas are segregated to prevent contamination or cross-interference."),
        ("8.3", "Serviceable and unserviceable items are clearly segregated."),
        ("8.4", "Customer property is secured against damage, loss, theft or unauthorised access."),
        ("8.5", "Lighting, cleanliness, temperature/humidity are controlled where process-critical."),
        ("8.6", "Hazardous materials and waste are handled under documented HSE controls."),
    ]
    for i, (ref, q) in enumerate(q8):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    # ---------- PAGE 4 ----------
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    header(p, 4, total)
    footer(p)
    y = MT + 8

    y = section_title(p, "9. Release documentation, materials & traceability", y)
    y = yn_header(p, y)
    q9 = [
        ("9.1", "Required release / conformity documents can be supplied with each delivery or job."),
        ("9.2", "Where applicable, EASA Form 1 / FAA 8130-3 / accepted equivalent can be provided."),
        ("9.3", "Certificates of Conformity and material certs (e.g. EN 10204) can be provided as required."),
        ("9.4", "Documentation is traceable to the delivered item, batch/serial and purchase order."),
        ("9.5", "Incoming inspection procedures exist for parts, materials and customer-furnished items."),
        ("9.6", "Shelf-life / life-limited items are controlled; expired stock cannot be issued for use."),
        ("9.7", "ESD-sensitive devices are handled and stored under controlled procedures."),
        ("9.8", "Quarantine / rejected items are segregated pending disposition."),
        ("9.9", "Unsalvageable parts are permanently mutilated or controlled to prevent re-entry."),
        ("9.10", "A process exists to detect, quarantine and report suspected unapproved parts (SUPs)."),
    ]
    for i, (ref, q) in enumerate(q9):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 4
    y = section_title(p, "10. Tools, measuring equipment & calibration", y)
    y = yn_header(p, y)
    q10 = [
        ("10.1", "Tools and equipment used on aviation work are identified, maintained and serviceable."),
        ("10.2", "Measuring / test equipment requiring calibration is registered and within calibration."),
        ("10.3", "Calibration is traceable to national / international standards."),
        ("10.4", "A recall process exists if equipment is found out of tolerance after work release."),
        ("10.5", "Tool accountability / FOD control procedures exist (including personal tools if allowed)."),
    ]
    for i, (ref, q) in enumerate(q10):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 4
    y = section_title(p, "11. Personnel competence & training", y)
    y = yn_header(p, y)
    q11 = [
        ("11.1", "Personnel performing aviation work are trained, assessed and authorised for their tasks."),
        ("11.2", "Human Factors awareness is included in initial and recurrent training where applicable."),
        ("11.3", "Training records are maintained and retained for the required period."),
        ("11.4", "Certifying / release staff limitations and authorisations are controlled."),
        ("11.5", "Workload is monitored so resources remain adequate for planned work."),
    ]
    for i, (ref, q) in enumerate(q11):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    # ---------- PAGE 5 ----------
    p = doc.new_page(width=PAGE_W, height=PAGE_H)
    header(p, 5, total)
    footer(p)
    y = MT + 8

    # Distinctive / additional sections vs the other sample forms
    y = section_title(p, "12. Counterfeit, illicit parts & supply-chain integrity  (ARS-specific)", y)
    y = yn_header(p, y)
    q12 = [
        ("12.1", "Sources of aeronautical parts are restricted to approved / known suppliers."),
        ("12.2", "Purchasing procedures define required accompanying documentation for each commodity."),
        ("12.3", "There is a process to escalate and notify ARS of suspected counterfeit or illicit parts."),
        ("12.4", "Military surplus / scrap channels are controlled or prohibited for ARS deliveries."),
    ]
    for i, (ref, q) in enumerate(q12):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 2
    y = section_title(p, "13. Data protection, IT security & digital records  (ARS-specific)", y)
    y = yn_header(p, y)
    q13 = [
        ("13.1", "Customer technical data / drawings are controlled against unauthorised copy or disclosure."),
        ("13.2", "Electronic maintenance / quality records are backed up and protected against loss."),
        ("13.3", "Access to quality / production IT systems is role-based and reviewed periodically."),
        ("13.4", "Cyber / ransomware incidents that could affect ARS data or deliveries are reportable."),
    ]
    for i, (ref, q) in enumerate(q13):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 2
    y = section_title(p, "14. Business continuity, export control & change notification", y)
    y = yn_header(p, y)
    q14 = [
        ("14.1", "A business continuity / disaster recovery arrangement covers critical aviation processes."),
        ("14.2", "Export-control / dual-use restrictions applicable to ARS deliveries are identified."),
        ("14.3", "Changes to approvals, ownership, location or key processes are notified to ARS promptly."),
        ("14.4", "Suspension, limitation or withdrawal of a relevant approval is notified immediately."),
        ("14.5", "Significant quality escapes, delivery failures or safety issues affecting ARS are notified."),
    ]
    for i, (ref, q) in enumerate(q14):
        y = yn_row(p, ref, q, y, alt=i % 2 == 0)

    y += 4
    y = section_title(p, "15. Declaration", y)
    y = wrap_text(
        p,
        "I confirm that the information in this questionnaire is accurate and complete to the best "
        "of my knowledge, and that Aether Rotor Support B.V. will be informed of changes that may "
        "affect the validity of any resulting vendor approval.",
        ML,
        y,
        CONTENT_W,
        size=8,
        leading=11,
    )
    y += 6
    y = field_row(p, "Name of authorised representative", y)
    y = field_row(p, "Position / title", y)
    text(p, "Signature", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 55, y, ML + 280)
    text(p, "Date", ML + 300, y, size=8.5, color=MUTED)
    underline(p, ML + 330, y, PAGE_W - MR)
    y += 22

    y = section_title(p, "16. For ARS Quality use only", y)
    text(p, "Reviewed by", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 70, y, ML + 250)
    text(p, "Date", ML + 270, y, size=8.5, color=MUTED)
    underline(p, ML + 300, y, PAGE_W - MR)
    y += 16
    text(p, "Decision:", ML, y, size=8.5, color=MUTED)
    checkbox(p, ML + 55, y, 8)
    text(p, "Approved", ML + 68, y, size=8)
    checkbox(p, ML + 130, y, 8)
    text(p, "Conditional", ML + 143, y, size=8)
    checkbox(p, ML + 215, y, 8)
    text(p, "Not approved", ML + 228, y, size=8)
    checkbox(p, ML + 310, y, 8)
    text(p, "On-site audit required", ML + 323, y, size=8)
    y += 18
    text(p, "Vendor code assigned", ML, y, size=8.5, color=MUTED)
    underline(p, ML + 115, y, ML + 250)
    text(p, "Next review due", ML + 270, y, size=8.5, color=MUTED)
    underline(p, ML + 355, y, PAGE_W - MR)
    y += 20
    text(p, "Remarks:", ML, y, size=8.5, color=MUTED)
    y += 12
    for _ in range(3):
        underline(p, ML, y, PAGE_W - MR)
        y += 14

    y += 8
    p.draw_rect(pymupdf.Rect(ML, y, PAGE_W - MR, y + 42), color=SAND, fill=None, width=1.2)
    text(p, "Return to", ML + 8, y + 14, size=8, color=TEAL, bold=True)
    text(
        p,
        "Aether Rotor Support B.V. — Quality & Compliance  |  Hangar 4, Luchthavenweg 12, 5657 EA Eindhoven, NL",
        ML + 8,
        y + 26,
        size=7.5,
        color=INK,
    )
    text(
        p,
        "quality@aether-rotor.nl  |  +31 40 000 0000  |  Form ARS-SQA-012 Rev.03",
        ML + 8,
        y + 38,
        size=7.5,
        color=MUTED,
    )

    doc.save(OUT, garbage=4, deflate=True)
    doc.close()
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
