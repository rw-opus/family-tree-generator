#!/usr/bin/env python3
"""Download Malta Government Gazette issues and split out notarial notices.

The gazette publishes notices about notaries under the Notarial Profession and
Notarial Archives Act (Cap. 55) -- partial incapacitation ("inabilitazzjoni
parzjali") and its reverse ("waqfien tal-inabilitazzjoni").  For every event in
events.json this produces two PDFs:

    <slug>_p1_cover.pdf              page 1 of the issue (the SOMMARJU cover)
    <slug>_p<printed>_notice.pdf     the page(s) carrying the notice

The printed page number in the filename is the one shown in the gazette's own
running title ("9810  Gazzetta tal-Gvern ta' Malta  20,706"), which is not the
PDF's internal page index -- each issue starts its internal page 1 at a printed
page well into the year's continuous numbering.

Usage:
    python3 gazette_extract.py run                 # fetch + extract (default)
    python3 gazette_extract.py fetch               # download issues into cache/
    python3 gazette_extract.py extract             # split cached issues
    python3 gazette_extract.py extract --png       # also render page images
    python3 gazette_extract.py extract --zip       # zip the output folder
    python3 gazette_extract.py index --years 2020 2023   # sweep yearly indexes
    python3 gazette_extract.py selftest            # verify locators on fixtures

Requires: pypdf.  Optional: poppler-utils (pdftotext, pdftoppm) for better text
extraction and for --png.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_EVENTS = HERE / "events.json"

# gov.mt rejects the stock urllib user agent.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
RETRY_DELAYS = (2, 4, 8, 16)

# The running title carries the printed page number on every page but the cover.
RUNNING_TITLE = re.compile(
    r"(gazzetta\s+tal-?gvern\s+ta'?\s*malta|malta\s+government\s+gazette)", re.I
)
# "10,376" before "9810" so a thousands separator is not split in two.
NUMBER = re.compile(r"\b\d{1,2},\d{3}\b|\b\d{3,6}\b")
# Notice headings: "Nru. 1282" (Maltese column) / "No. 1282" (English column).
NOTICE_HEADING = re.compile(r"\b(?:nru|no)\.?\s*(\d{1,4})\b", re.I)

# The contents page names itself, and any index page lists many notice numbers.
SUMMARY_MARKER = re.compile(r"\bsommarju\b|\bsummary\b", re.I)
INDEX_LIKE_NOTICES = 5

# A following page is treated as a continuation only if it carries this much
# text before its first notice heading (i.e. more than a bare running title).
CONTINUATION_MIN_CHARS = 200
MIN_PAGE_TEXT = 50  # below this a page is treated as text-less (scanned)


# --------------------------------------------------------------------------
# text helpers
# --------------------------------------------------------------------------


def normalise(text: str) -> str:
    """Fold apostrophes, dashes and whitespace so phrase matching is stable."""
    text = unicodedata.normalize("NFKC", text)
    for ch in "‘’ʼ´`":
        text = text.replace(ch, "'")
    for ch in "‐‑‒–—":
        text = text.replace(ch, "-")
    return re.sub(r"\s+", " ", text)


# Maltese letters that Unicode does not decompose into base + combining mark.
UNDECOMPOSED = str.maketrans({"\u0127": "h", "\u0126": "H", "\u0111": "d", "\u0110": "D"})


def fold(text: str) -> str:
    """Strip diacritics and casefold, so \u010bekk/\u0121ie/\u017cmien match plain ASCII spellings.

    Maltese uses \u010b \u0121 \u017c \u0127; the first three decompose, \u0127 does not, so it is mapped by hand.
    Only widens what matches -- the surnames searched for are plain Latin anyway.
    """
    text = unicodedata.normalize("NFKD", text.translate(UNDECOMPOSED))
    return "".join(c for c in text if not unicodedata.combining(c)).casefold()


def digits(token: str) -> str:
    return re.sub(r"[,\s]", "", token)


def contains(haystack: str, needle: str) -> bool:
    """Case/accent-insensitive substring test against a page's folded text."""
    return fold(normalise(needle)) in haystack


# --------------------------------------------------------------------------
# page model
# --------------------------------------------------------------------------


@dataclass
class Page:
    index: int  # 0-based internal PDF page index
    text: str  # raw extracted text
    flat: str = ""  # normalised + casefolded, for matching
    printed: int | None = None  # printed page number from the running title
    printed_inferred: bool = False
    notices: list[int] = field(default_factory=list)
    is_summary: bool = False

    @property
    def label(self) -> str:
        """Printed page number if known, else the internal index as 'i<N>'."""
        return str(self.printed) if self.printed is not None else f"i{self.index + 1}"


def extract_text_pypdf(pdf: Path) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf))
    return [(page.extract_text() or "") for page in reader.pages]


def extract_text_pdftotext(pdf: Path) -> list[str] | None:
    """Poppler keeps the two-column layout in reading order better than pypdf."""
    if not shutil.which("pdftotext"):
        return None
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"],
            capture_output=True,
            check=True,
            timeout=300,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    pages = out.stdout.decode("utf-8", "replace").split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def parse_printed_page(text: str, issue_digits: str) -> int | None:
    """Pull the printed page number out of a page's running title."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not RUNNING_TITLE.search(normalise(line)):
            continue
        # The number can sit either side of the title, and the title sometimes
        # wraps, so look at the neighbouring lines too.
        window = normalise(" ".join(lines[max(0, i - 1) : i + 2]))
        for token in NUMBER.findall(window):
            value = digits(token)
            if value != issue_digits and 3 <= len(value) <= 6:
                return int(value)
    return None


def build_pages(pdf: Path, gazette_no: str, backend: str = "auto") -> list[Page]:
    """Extract per-page text and derive printed page numbers and notice numbers."""
    issue_digits = digits(gazette_no)

    texts = None
    if backend in ("auto", "pdftotext"):
        texts = extract_text_pdftotext(pdf)
    if texts is None:
        texts = extract_text_pypdf(pdf)
    elif backend == "auto":
        # Fall back per page where poppler produced nothing but pypdf might.
        if sum(len(t.strip()) for t in texts) < MIN_PAGE_TEXT * len(texts):
            pypdf_texts = extract_text_pypdf(pdf)
            texts = [
                p if len(t.strip()) < MIN_PAGE_TEXT else t
                for t, p in zip(texts, pypdf_texts)
            ]

    pages = []
    for i, text in enumerate(texts):
        page = Page(index=i, text=text, flat=fold(normalise(text)))
        page.printed = parse_printed_page(text, issue_digits)
        page.notices = [int(m.group(1)) for m in NOTICE_HEADING.finditer(text)]
        page.is_summary = bool(SUMMARY_MARKER.search(page.flat)) or (
            len(set(page.notices)) >= INDEX_LIKE_NOTICES
        )
        pages.append(page)

    # Trust the running title where it parsed; fall back to structure when it
    # barely did, which is what an unfamiliar layout looks like.
    parsed = sum(1 for p in pages if p.printed is not None)
    if parsed < max(3, len(pages) // 4) and infer_printed_structurally(pages):
        return pages
    infer_missing_printed(pages)
    return pages


def candidate_numbers(text: str) -> set[int]:
    """Numbers sitting in a page's top or bottom margin."""
    lines = [line for line in text.splitlines() if line.strip()]
    found: set[int] = set()
    for line in lines[:2] + lines[-2:]:
        for token in NUMBER.findall(normalise(line)):
            value = digits(token)
            if 3 <= len(value) <= 6:
                found.add(int(value))
    return found


def infer_printed_structurally(pages: list[Page]) -> bool:
    """Recover printed numbering without relying on the running title's wording.

    Every margin number votes for an offset of (number - page index).  Page
    numbering is the offset nearly every page agrees on, because it is the only
    number on the page that climbs in step with the page index -- the issue
    number, printed on every page too, yields a different offset each time and
    so can never out-vote it.  This is the safety net for an issue whose running
    title is laid out differently from the ones this was built against.
    """
    votes: dict[int, int] = {}
    for page in pages:
        for candidate in candidate_numbers(page.text):
            offset = candidate - page.index
            votes[offset] = votes.get(offset, 0) + 1
    if not votes:
        return False
    offset, support = max(votes.items(), key=lambda kv: (kv[1], -abs(kv[0])))
    if support < max(3, len(pages) // 4):
        return False
    for page in pages:
        page.printed = page.index + offset
        page.printed_inferred = True
    return True


def infer_missing_printed(pages: list[Page]) -> None:
    """Fill gaps in printed numbering using the dominant printed-minus-index offset.

    Pages whose running title did not parse (the cover, full-page tables) still
    get a printed number, flagged as inferred.
    """
    offsets: dict[int, int] = {}
    for page in pages:
        if page.printed is not None:
            offsets[page.printed - page.index] = offsets.get(page.printed - page.index, 0) + 1
    if not offsets:
        return
    offset = max(offsets, key=lambda k: offsets[k])
    for page in pages:
        if page.printed is None:
            page.printed = page.index + offset
            page.printed_inferred = True


# --------------------------------------------------------------------------
# locating a notice
# --------------------------------------------------------------------------


@dataclass
class Hit:
    page: Page
    score: int
    evidence: list[str]


def notice_position(page: Page, number: int) -> int | None:
    """Character offset of a given notice heading on a page, if present."""
    for m in NOTICE_HEADING.finditer(page.text):
        if int(m.group(1)) == number:
            return m.start()
    return None


def score_page(page: Page, event: dict) -> Hit | None:
    """Score one page against one event's locator hints.

    Each hint class contributes independently so the manifest can record *why* a
    page was picked -- provenance matters for legal-notice extraction.
    """
    score = 0
    evidence: list[str] = []

    for number in event.get("printed_pages") or []:
        if page.printed == number:
            weight = 60 if event.get("printed_pages_approximate") else 100
            score += weight
            evidence.append(
                f"printed page {number}"
                + (" (inferred)" if page.printed_inferred else "")
                + (" (approximate hint)" if event.get("printed_pages_approximate") else "")
            )
            break

    for number in event.get("notice_numbers") or []:
        if number in page.notices:
            score += 60
            evidence.append(f"notice heading Nru./No. {number}")

    phrases = event.get("phrases") or []
    if phrases and all(contains(page.flat, p) for p in phrases):
        score += 40
        evidence.append("phrases " + ", ".join(repr(p) for p in phrases))

    any_phrases = event.get("any_phrases") or []
    matched_any = [p for p in any_phrases if contains(page.flat, p)]
    if matched_any:
        score += 25 * len(matched_any)
        evidence.append("phrases " + " or ".join(repr(p) for p in matched_any))

    # The statute citation next to a surname is the strongest corroboration that
    # this is the notarial notice and not a passing mention elsewhere.
    surnames = phrases + any_phrases
    if any(contains(page.flat, s) for s in surnames) and re.search(
        r"\b(kap|cap)\.?\s*55\b", page.flat
    ):
        score += 30
        evidence.append("surname next to Kap./Cap. 55")

    # The SOMMARJU contents page lists every notice number and usually the
    # notaries' names as well, so it matches most hints without being the
    # notice.  Without this it ties with the real page and, being earlier, wins.
    if score and page.is_summary:
        score -= 50
        evidence.append("summary/index page, demoted")

    score = max(score, 0)
    if score == 0:
        return None
    return Hit(page=page, score=score, evidence=evidence)


def detect_span(pages: list[Page], start: int, notice_numbers: list[int]) -> list[int]:
    """Return the page indices a notice covers, following it over a page break.

    A notice runs onto the next page when no *other* notice heading follows it on
    its own page and the next page carries real text before its first heading.
    """
    page = pages[start]

    position = None
    target = None
    for number in notice_numbers:
        position = notice_position(page, number)
        if position is not None:
            target = number
            break

    if position is not None:
        for m in NOTICE_HEADING.finditer(page.text):
            if m.start() > position and int(m.group(1)) != target:
                return [start]  # the next notice begins on this same page

    if start + 1 >= len(pages):
        return [start]

    nxt = pages[start + 1]
    first = NOTICE_HEADING.search(nxt.text)
    lead = nxt.text[: first.start()] if first else nxt.text
    lead = RUNNING_TITLE.sub("", normalise(lead))
    lead = NUMBER.sub("", lead).strip()
    if len(lead) > CONTINUATION_MIN_CHARS:
        return [start, start + 1]
    return [start]


def locate(event: dict, pages: list[Page]) -> dict:
    """Find the page(s) for one event and explain the choice."""
    hits = [h for h in (score_page(p, event) for p in pages) if h]
    hits.sort(key=lambda h: (-h.score, h.page.index))

    result: dict = {
        "id": event["id"],
        "notary": event["notary"],
        "event": event.get("event"),
        "decree_date": event.get("decree_date"),
    }

    if not hits:
        result["status"] = "not-found"
        result["warning"] = "no page matched any locator hint"
        return result

    best = hits[0]
    rivals = [h for h in hits[1:] if h.score == best.score]

    indices = detect_span(pages, best.page.index, event.get("notice_numbers") or [])

    # An explicit multi-page hint in the data wins over detection, but a
    # disagreement is worth surfacing.
    hinted = event.get("printed_pages") or []
    if len(hinted) > 1 and not event.get("printed_pages_approximate"):
        by_printed = {p.printed: p.index for p in pages}
        explicit = [by_printed[n] for n in hinted if n in by_printed]
        if explicit and explicit != indices:
            result["span_note"] = (
                f"data hints printed pages {hinted}; text detection gave "
                f"{[pages[i].label for i in indices]} -- used the data hint"
            )
            indices = sorted(explicit)

    result.update(
        {
            "status": "ok",
            "score": best.score,
            "evidence": best.evidence,
            "pdf_pages": [i + 1 for i in indices],  # 1-based internal
            "printed_pages": [pages[i].label for i in indices],
            "printed_inferred": any(pages[i].printed_inferred for i in indices),
        }
    )
    if len(indices) > 1:
        result["spans_pages"] = True
    if rivals:
        result["ambiguous"] = [
            {"printed": h.page.label, "evidence": h.evidence} for h in rivals
        ]
        result["warning"] = (
            f"{len(rivals) + 1} pages tied at score {best.score}; used the first"
        )
    if best.score < 60:
        result.setdefault("warning", "weak match -- verify this page by hand")
    return result


# --------------------------------------------------------------------------
# download
# --------------------------------------------------------------------------


def looks_like_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            return fh.read(5) == b"%PDF-"
    except OSError:
        return False


def download(url: str, dest: Path, force: bool = False) -> tuple[bool, str]:
    """Fetch one URL with retry/backoff. Returns (ok, message)."""
    if dest.exists() and looks_like_pdf(dest) and not force:
        return True, f"cached ({dest.stat().st_size:,} bytes)"

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last = ""
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read()
            if not body.startswith(b"%PDF-"):
                # gov.mt serves an HTML error page rather than a 404 sometimes.
                return False, f"not a PDF ({len(body):,} bytes, likely an error page)"
            dest.write_bytes(body)
            return True, f"downloaded ({len(body):,} bytes)"
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if exc.code in (403, 404, 407):
                return False, last  # not transient; try a fallback URL instead
        except Exception as exc:  # noqa: BLE001 - report whatever the network did
            last = f"{type(exc).__name__}: {exc}"
        if attempt < len(RETRY_DELAYS):
            time.sleep(RETRY_DELAYS[attempt])
    return False, last or "failed"


def fetch_issue(issue: dict, cache: Path, force: bool = False) -> tuple[Path | None, str]:
    dest = cache / f"{issue['slug']}.pdf"
    urls = [issue["url"], *issue.get("url_fallbacks", [])]
    messages = []
    for url in urls:
        ok, message = download(url, dest, force=force)
        messages.append(message)
        if ok:
            return dest, message
    return None, "; ".join(messages)


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------


def write_subset(src: Path, indices: list[int], dest: Path) -> None:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(src))
    writer = PdfWriter()
    for i in indices:
        writer.add_page(reader.pages[i])
    with dest.open("wb") as fh:
        writer.write(fh)


def render_png(src: Path, indices: list[int], base: Path, dpi: int = 200) -> list[str]:
    """Render the given pages to PNG next to the PDFs, with predictable names.

    pdftoppm appends its own page-index suffix, zero-padded to the width of the
    document's page count ("-1" in a 5-page file, "-08" in a 12-page one), so
    each page is rendered to a scratch stem and then renamed.
    """
    if not shutil.which("pdftoppm"):
        return []
    made = []
    for n, i in enumerate(indices, start=1):
        scratch = base.parent / f".{base.name}.tmp"
        subprocess.run(
            ["pdftoppm", "-png", "-r", str(dpi), "-f", str(i + 1), "-l", str(i + 1),
             str(src), str(scratch)],
            check=True,
        )
        produced = sorted(scratch.parent.glob(f"{scratch.name}-*.png"))
        if not produced:
            continue
        suffix = "" if len(indices) == 1 else f"_{n}"
        dest = base.with_name(f"{base.name}{suffix}.png")
        produced[0].replace(dest)
        for leftover in produced[1:]:
            leftover.unlink()
        made.append(dest.name)
    return made


def zip_output(output: Path) -> Path:
    archive = output.parent / f"{output.name}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(output.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(output))
    return archive


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------


def load_events(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def cmd_fetch(args) -> int:
    data = load_events(args.events)
    args.cache.mkdir(parents=True, exist_ok=True)
    failures = 0
    for issue in data["issues"]:
        if args.only and issue["slug"] not in args.only:
            continue
        path, message = fetch_issue(issue, args.cache, force=args.force)
        status = "ok " if path else "FAIL"
        print(f"[{status}] {issue['gazette_no']} ({issue['date']}): {message}")
        if not path:
            failures += 1
            print(f"         url: {issue['url']}")
    if failures:
        print(f"\n{failures} issue(s) could not be downloaded.", file=sys.stderr)
    return 1 if failures else 0


def cmd_extract(args) -> int:
    data = load_events(args.events)
    args.output.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    problems = 0

    for issue in data["issues"]:
        if args.only and issue["slug"] not in args.only:
            continue
        src = args.cache / f"{issue['slug']}.pdf"
        entry: dict = {
            "gazette_no": issue["gazette_no"],
            "date": issue["date"],
            "url": issue["url"],
        }
        if not src.exists() or not looks_like_pdf(src):
            entry["status"] = "missing-pdf"
            entry["events"] = [
                {"id": e["id"], "notary": e["notary"], "status": "missing-pdf"}
                for e in issue["events"]
            ]
            manifest.append(entry)
            problems += 1
            print(f"[FAIL] {issue['gazette_no']}: not cached -- run `fetch` first")
            continue

        pages = build_pages(src, issue["gazette_no"], backend=args.text_backend)
        textless = sum(1 for p in pages if len(p.text.strip()) < MIN_PAGE_TEXT)
        entry["pdf_page_count"] = len(pages)
        if textless:
            entry["textless_pages"] = textless
            if textless == len(pages):
                entry["warning"] = "no extractable text -- scanned issue, needs OCR"

        print(f"\n=== {issue['gazette_no']}  {issue['date']}  ({len(pages)} pages) ===")

        # Cover: internal page 1 of the issue.
        cover = args.output / f"{issue['slug']}_p1_cover.pdf"
        write_subset(src, [0], cover)
        entry["cover_file"] = cover.name
        entry["cover_printed_page"] = pages[0].label
        expected = issue.get("cover_printed_page")
        if expected is not None and pages[0].printed != expected:
            entry["cover_warning"] = (
                f"expected printed page {expected}, PDF page 1 reads {pages[0].label}"
            )
            print(f"  ! cover: {entry['cover_warning']}")
        print(f"  cover -> {cover.name} (printed page {pages[0].label})")
        if args.png:
            entry["cover_images"] = render_png(
                src, [0], args.output / f"{issue['slug']}_p1_cover", args.dpi
            )

        events_out = []
        for event in issue["events"]:
            found = locate(event, pages)
            if found["status"] != "ok":
                problems += 1
                print(f"  ! {event['notary']}: {found['warning']}")
                events_out.append(found)
                continue

            indices = [n - 1 for n in found["pdf_pages"]]
            labels = found["printed_pages"]
            tag = labels[0] if len(labels) == 1 else f"{labels[0]}-{labels[-1]}"
            dest = args.output / f"{issue['slug']}_p{tag}_notice.pdf"
            write_subset(src, indices, dest)
            found["file"] = dest.name
            if args.png:
                found["images"] = render_png(
                    src, indices, args.output / f"{issue['slug']}_p{tag}_notice", args.dpi
                )

            note = f"  {event['notary']} -> {dest.name}"
            note += f"  [printed {', '.join(labels)}; pdf page {', '.join(str(n) for n in found['pdf_pages'])}]"
            print(note)
            print(f"      why: {'; '.join(found['evidence'])}")
            for key in ("warning", "span_note"):
                if found.get(key):
                    problems += 1 if key == "warning" else 0
                    print(f"      ! {found[key]}")
            events_out.append(found)

        entry["status"] = "ok"
        entry["events"] = events_out
        manifest.append(entry)

    manifest_path = args.output / "manifest.json"
    manifest_path.write_text(
        json.dumps({"issues": manifest}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"\nmanifest -> {manifest_path}")

    if args.zip:
        archive = zip_output(args.output)
        print(f"archive  -> {archive}")

    total = sum(len(i["events"]) for i in manifest)
    ok = sum(
        1 for i in manifest for e in i["events"] if e.get("status") == "ok" and not e.get("warning")
    )
    print(f"\n{ok}/{total} events extracted cleanly; {problems} need review.")
    return 0


INDEX_URLS = {
    "default": "https://www.gov.mt/en/Government/DOI/Government%20Gazette/Documents/Gov%20Gaz%20Index%20{year}.pdf",
    2025: "https://www.gov.mt/en/Government/DOI/Government%20Gazette/Documents/Index%202025.pdf",
}
INDEX_TERMS = (
    "nutar",
    "notarial",
    "inabilitazzjoni",
    "interdizzjoni",
    "professjoni nutarili",
)


def cmd_index(args) -> int:
    """Sweep the authoritative yearly indexes for notary-related notices.

    Use this to close the gaps the hand-built table has (2020 beyond October,
    2023, and criminal-code "interdizzjoni" notices, which are a different
    animal from the Court of Revision's civil "inabilitazzjoni").
    """
    args.cache.mkdir(parents=True, exist_ok=True)
    failures = 0
    for year in args.years:
        url = INDEX_URLS.get(year, INDEX_URLS["default"]).format(year=year)
        dest = args.cache / f"index-{year}.pdf"
        ok, message = download(url, dest, force=args.force)
        print(f"\n=== index {year}: {message} ===")
        if not ok:
            print(f"    url: {url}")
            failures += 1
            continue

        texts = extract_text_pdftotext(dest) or extract_text_pypdf(dest)
        for i, text in enumerate(texts):
            flat = normalise(text).casefold()
            if not any(term in flat for term in INDEX_TERMS):
                continue
            for line in text.splitlines():
                low = normalise(line).casefold()
                if any(term in low for term in INDEX_TERMS):
                    print(f"  p{i + 1}: {line.strip()}")
    return 1 if failures else 0


def cmd_selftest(args) -> int:
    from fixtures import build_fixture, FIXTURE_CASES  # noqa: PLC0415

    tmp = args.cache / "selftest"
    tmp.mkdir(parents=True, exist_ok=True)
    failures = 0

    for case in FIXTURE_CASES:
        pdf = tmp / f"{case['slug']}.pdf"
        build_fixture(pdf, case)
        pages = build_pages(pdf, case["gazette_no"], backend=args.text_backend)

        print(f"\n=== {case['name']} ===")
        for check in case["checks"]:
            found = locate(check["event"], pages)
            got_printed = found.get("printed_pages")
            got_pdf = found.get("pdf_pages")
            ok = got_printed == check["expect_printed"] and got_pdf == check["expect_pdf"]
            print(
                f"  [{'PASS' if ok else 'FAIL'}] {check['event']['id']}: "
                f"printed={got_printed} pdf={got_pdf} "
                f"(want printed={check['expect_printed']} pdf={check['expect_pdf']})"
            )
            if not ok:
                failures += 1
                print(f"         evidence: {found.get('evidence')} {found.get('warning', '')}")

    print(f"\nselftest: {'all passed' if not failures else f'{failures} failure(s)'}")
    return 1 if failures else 0


def cmd_doctor(args) -> int:
    """Print what was parsed from a cached issue, to diagnose a real run.

    Run this first if an extraction looks wrong: it shows whether printed page
    numbers came from the running title or had to be inferred, whether the
    numbering is consistent, and which pages carry no text at all.
    """
    data = load_events(args.events)
    for issue in data["issues"]:
        if args.only and issue["slug"] not in args.only:
            continue
        src = args.cache / f"{issue['slug']}.pdf"
        if not src.exists() or not looks_like_pdf(src):
            print(f"{issue['gazette_no']}: not cached -- run `fetch` first")
            continue

        pages = build_pages(src, issue["gazette_no"], backend=args.text_backend)
        titled = sum(1 for p in pages if p.printed is not None and not p.printed_inferred)
        inferred = sum(1 for p in pages if p.printed_inferred)
        textless = sum(1 for p in pages if len(p.text.strip()) < MIN_PAGE_TEXT)
        offsets = sorted({p.printed - p.index for p in pages if p.printed is not None})

        print(f"\n=== {issue['gazette_no']}  {issue['date']}  ({len(pages)} pages) ===")
        print(f"  printed number read from running title : {titled}/{len(pages)}")
        print(f"  printed number inferred                : {inferred}")
        print(f"  pages with no extractable text         : {textless}"
              + ("  <- scanned issue, needs OCR" if textless == len(pages) else ""))
        print(f"  printed-minus-index offset(s)          : {offsets}"
              + ("  <- should be a single value" if len(offsets) > 1 else ""))
        print(f"  summary/index pages                    : "
              f"{[p.label for p in pages if p.is_summary] or '-'}")
        if args.verbose:
            for page in pages:
                flags = "".join(
                    f" [{name}]"
                    for name, on in (
                        ("no text", len(page.text.strip()) < MIN_PAGE_TEXT),
                        ("inferred", page.printed_inferred),
                        ("summary", page.is_summary),
                    )
                    if on
                )
                seen = ", ".join(str(n) for n in sorted(set(page.notices))[:8]) or "-"
                print(f"   pdf {page.index + 1:>4}  printed {page.label:>7}  notices: {seen}{flags}")
    return 0


def cmd_run(args) -> int:
    rc = cmd_fetch(args)
    if rc:
        print("\nContinuing with whatever was cached.\n", file=sys.stderr)
    return cmd_extract(args)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS)
    parser.add_argument("--cache", type=Path, default=Path("cache"))
    parser.add_argument("--output", type=Path, default=Path("output"))
    parser.add_argument("--only", nargs="*", default=None, metavar="SLUG",
                        help="limit to these issue slugs, e.g. --only 20497 21481")
    parser.add_argument("--force", action="store_true", help="re-download cached PDFs")
    parser.add_argument("--png", action="store_true", help="also render page images")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--zip", action="store_true", help="zip the output folder")
    parser.add_argument("--text-backend", choices=("auto", "pypdf", "pdftotext"),
                        default="auto")
    parser.add_argument("--years", nargs="*", type=int,
                        default=[2020, 2021, 2022, 2023, 2024, 2025],
                        help="years for the `index` sweep")
    parser.add_argument("--verbose", action="store_true",
                        help="per-page detail in `doctor`")
    parser.add_argument("command", nargs="?", default="run",
                        choices=("run", "fetch", "extract", "doctor", "index", "selftest"))

    args = parser.parse_args(argv)
    handlers = {
        "run": cmd_run,
        "fetch": cmd_fetch,
        "extract": cmd_extract,
        "doctor": cmd_doctor,
        "index": cmd_index,
        "selftest": cmd_selftest,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    raise SystemExit(main())
