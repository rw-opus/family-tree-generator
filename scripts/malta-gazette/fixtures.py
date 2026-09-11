"""Synthetic gazette PDFs that reproduce the real issues' structure.

The live gazettes are only reachable from a network that allows www.gov.mt, so
the locator logic is exercised here against fixtures that copy the things it
actually depends on:

  * a running title carrying the printed page number ("9810  Gazzetta tal-Gvern
    ta' Malta  20,706"), offset from the PDF's internal page index;
  * a cover page with no running title, so the offset has to be inferred;
  * printed page and issue numbers that both use a thousands separator and are
    both five digits (10,376 in issue 21,481);
  * numbered notice headings, two to a page, so a span must stop at the next one;
  * a notice that genuinely runs over a page break;
  * a decoy page mentioning a notary's surname outside any Cap. 55 notice.

Used by `gazette_extract.py selftest`.  Needs reportlab; the main tool does not.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
)
BODY_FONT = "Helvetica"
for _candidate in FONT_CANDIDATES:
    if Path(_candidate).exists():
        pdfmetrics.registerFont(TTFont("GazetteBody", _candidate))
        BODY_FONT = "GazetteBody"
        break

WIDTH, HEIGHT = A4
MARGIN = 50
LINE = 14

NOTICE_MT = (
    "QORTI TAL-REVIŻJONI TAL-ATTI NOTARILI",
    "Inabilitazzjoni Parzjali ta' Nutar",
    "",
    "Bis-saħħa ta' digriet mogħti mill-Qorti tal-Reviżjoni tal-Atti",
    "Notarili fid-data msemmija hawn fuq, in-Nutar Dottor {name}",
    "ġie inabilitat/a parzjalment mill-eżerċizzju tal-professjoni",
    "notarili skont id-disposizzjonijiet tal-Att dwar il-Professjoni",
    "Notarili u l-Arkivji Notarili (Kap. 55).",
)
NOTICE_EN = (
    "COURT OF REVISION OF NOTARIAL ACTS",
    "Partial Incapacitation of a Notary",
    "",
    "By virtue of a decree given by the Court of Revision of Notarial",
    "Acts on the date stated above, Notary Doctor {name} has been",
    "partially incapacitated from exercising the notarial profession",
    "in terms of the provisions of the Notarial Profession and",
    "Notarial Archives Act (Cap. 55).",
)
FILLER = (
    "Il-partijiet interessati huma mgħarrfa li dan l-avviż jiġi ppubblikat",
    "skont il-liġi u li kull talba għandha ssir bil-miktub lir-Reġistratur.",
)


def _text_block(c, x, y, lines, name="", leading=LINE):
    for line in lines:
        c.drawString(x, y, line.format(name=name))
        y -= leading
    return y


def _running_title(c, printed_page, gazette_no, page_index):
    """Bottom running title, page number alternating sides as in the real issues."""
    label = f"{printed_page:,}" if printed_page >= 10000 else str(printed_page)
    title = "Gazzetta tal-Gvern ta' Malta"
    y = 40
    if page_index % 2 == 0:
        c.drawString(MARGIN, y, f"{label}    {title} {gazette_no}")
    else:
        c.drawRightString(WIDTH - MARGIN, y, f"{title} {gazette_no}    {label}")


def build_fixture(dest: Path, case: dict) -> Path:
    """Render one synthetic issue to dest."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(dest), pagesize=A4)
    c.setFont(BODY_FONT, 9)

    pages = case["pages"]
    for i, page in enumerate(pages):
        y = HEIGHT - MARGIN
        if page.get("cover"):
            c.drawString(MARGIN, y, "SOMMARJU — SUMMARY")
            y -= LINE * 2
            c.drawString(MARGIN, y, f"Gazzetta tal-Gvern ta' Malta {case['gazette_no']}")
            y -= LINE * 2
            for entry in page.get("summary", []):
                c.drawString(MARGIN, y, entry)
                y -= LINE
        else:
            for notice in page.get("notices", []):
                c.drawString(MARGIN, y, f"Nru. {notice['number']}")
                c.drawRightString(WIDTH - MARGIN, y, f"No. {notice['number']}")
                y -= LINE * 1.5
                if notice.get("date_line"):
                    c.drawString(MARGIN, y, notice["date_line"])
                    y -= LINE * 1.5
                top = y
                _text_block(c, MARGIN, top, NOTICE_MT, notice["name"])
                y = _text_block(c, WIDTH / 2 + 10, top, NOTICE_EN, notice["name"])
                for extra in notice.get("extra_lines", []):
                    y -= LINE
                    c.drawString(MARGIN, y, extra)
                y -= LINE * 2
            for line in page.get("lines", []):
                c.drawString(MARGIN, y, line)
                y -= LINE
            if page.get("continuation"):
                # A notice running over the break: real text, no new heading.
                for line in page["continuation"]:
                    c.drawString(MARGIN, y, line)
                    y -= LINE
                for line in FILLER * 3:
                    c.drawString(MARGIN, y, line)
                    y -= LINE

        if not page.get("cover"):
            _running_title(c, page["printed"], case["gazette_no"], i)
        c.showPage()
        c.setFont(BODY_FONT, 9)

    c.save()
    return dest


def _plain_pages(start_printed, count, first_index=0):
    return [
        {"printed": start_printed + i, "lines": [f"Avviżi tal-Gvern — paġna {start_printed + i}"]}
        for i in range(count)
    ]


# --------------------------------------------------------------------------
# cases
# --------------------------------------------------------------------------

_case_20497 = {
    "name": "20,497 — single-page notice, cover number inferred (Maria Briffa)",
    "slug": "fixture-20497",
    "gazette_no": "20,497",
    "pages": (
        [{"cover": True, "printed": 9069, "summary": ["Nru. 1167  Inabilitazzjoni Parzjali"]}]
        + _plain_pages(9070, 11)
        + [
            {
                "printed": 9081,
                "notices": [
                    {
                        "number": 1167,
                        "name": "Maria Briffa",
                        "date_line": "Is-7 ta' Ottubru, 2020",
                    }
                ],
            }
        ]
        + _plain_pages(9082, 3)
    ),
    "checks": [
        {
            "event": {
                "id": "20497-briffa",
                "notary": "Dr Maria Briffa",
                "printed_pages": [9081],
                "notice_numbers": [1167],
                "phrases": ["Briffa"],
            },
            "expect_printed": ["9081"],
            "expect_pdf": [13],
        }
    ],
}

_case_21481 = {
    "name": "21,481 — notice spanning a page break, comma-separated page numbers (Mark Zaffarese)",
    "slug": "fixture-21481",
    "gazette_no": "21,481",
    "pages": (
        [{"cover": True, "printed": 10369, "summary": ["Nru. 1222  Inabilitazzjoni Parzjali"]}]
        + _plain_pages(10370, 6)
        + [
            {
                "printed": 10376,
                "notices": [
                    {
                        "number": 1222,
                        "name": "Mark Zaffarese",
                        "date_line": "Il-31 ta' Lulju, 2025",
                    }
                ],
            },
            {
                "printed": 10377,
                "continuation": [
                    "instatat mill-eżerċizzju tal-professjoni notarili sakemm",
                    "tingħata deċiżjoni oħra mill-istess Qorti, u dan skont",
                    "l-Att dwar il-Professjoni Notarili u l-Arkivji Notarili.",
                ],
            },
            {"printed": 10378, "notices": [{"number": 1223, "name": "Xi Ħadd Ieħor"}]},
        ]
        + _plain_pages(10379, 2)
    ),
    "checks": [
        {
            "event": {
                "id": "21481-zaffarese",
                "notary": "Dr Mark Zaffarese",
                "printed_pages": [10376, 10377],
                "notice_numbers": [1222],
                "phrases": ["Zaffarese"],
            },
            "expect_printed": ["10376", "10377"],
            "expect_pdf": [8, 9],
        }
    ],
}

_case_20855 = {
    "name": "20,855 — two notices on one page, plus a surname decoy (Cassar x2)",
    "slug": "fixture-20855",
    "gazette_no": "20,855",
    "pages": (
        [{"cover": True, "printed": 4401, "summary": ["Nru. 504  Inabilitazzjoni Parzjali"]}]
        + [
            {
                "printed": 4402,
                "lines": [
                    "AVVIŻ TA' SEJĦA GĦALL-OFFERTI",
                    "Offerti mingħand Herbert Cassar Ltd għal xogħlijiet ta' tiswija.",
                    "Dan l-avviż m'għandu x'jaqsam xejn mal-professjoni notarili.",
                ],
            }
        ]
        + [
            {
                "printed": 4403,
                "notices": [
                    {
                        "number": 504,
                        "name": "Herbert Cassar",
                        "date_line": "Is-6 ta' Mejju, 2022",
                    },
                    {
                        "number": 506,
                        "name": "Joanne Cassar",
                        "date_line": "Is-6 ta' Mejju, 2022",
                    },
                ],
            }
        ]
        + _plain_pages(4404, 2)
    ),
    "checks": [
        {
            "event": {
                "id": "20855-herbert-cassar",
                "notary": "Dr Herbert Cassar",
                "notice_numbers": [504],
                "phrases": ["Herbert Cassar"],
            },
            "expect_printed": ["4403"],
            "expect_pdf": [3],
        },
        {
            "event": {
                "id": "20855-joanne-cassar",
                "notary": "Dr Joanne Cassar",
                "notice_numbers": [506],
                "phrases": ["Joanne Cassar"],
            },
            "expect_printed": ["4403"],
            "expect_pdf": [3],
        },
    ],
}

_case_21362 = {
    "name": "21,362 — phrase-only locator, no page or notice hint (Galea Mamo)",
    "slug": "fixture-21362",
    "gazette_no": "21,362",
    "pages": (
        [{"cover": True, "printed": 12001, "summary": ["Nru. 1767  Waqfien tal-Inabilitazzjoni"]}]
        + _plain_pages(12002, 3)
        + [
            {
                "printed": 12005,
                "notices": [
                    {
                        "number": 1771,
                        "name": "Maria Roberta Galea Mamo",
                        "date_line": "Rikors numru 1123/2024",
                        "extra_lines": [
                            "Il-waqfien tal-inabilitazzjoni ġie rreġistrat skont il-liġi.",
                        ],
                    }
                ],
            }
        ]
        + _plain_pages(12006, 2)
    ),
    "checks": [
        {
            "event": {
                "id": "21362-galea-mamo",
                "notary": "Dr Maria Roberta Galea Mamo",
                "phrases": ["Maria Roberta", "1123/2024"],
            },
            "expect_printed": ["12005"],
            "expect_pdf": [5],
        }
    ],
}

FIXTURE_CASES = [_case_20497, _case_21481, _case_20855, _case_21362]
