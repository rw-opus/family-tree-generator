# Malta Government Gazette — notarial notice extractor

Downloads Malta Government Gazette issues and splits out the notices concerning
notaries published under the Notarial Profession and Notarial Archives Act
(Cap. 55) by the Court of Revision of Notarial Acts, 2020–2026.

Two notice types recur: **inabilitazzjoni parzjali** (partial incapacitation) and
its reverse, **waqfien tal-inabilitazzjoni** (cessation / reinstatement).

For each of the 20 events in `events.json` it produces:

| File                           | Contents                                      |
| ------------------------------ | --------------------------------------------- |
| `<slug>_p1_cover.pdf`          | page 1 of the issue (the SOMMARJU cover page) |
| `<slug>_p<printed>_notice.pdf` | the page(s) carrying the notice               |

The `<printed>` in the filename is the page number printed in the gazette's own
running title (`9081  Gazzetta tal-Gvern ta' Malta  20,497`), **not** the PDF's
internal page index — each issue's internal page 1 starts at a printed page well
into the year's continuous numbering, so the two never coincide.

## Network requirement

`www.gov.mt` must be reachable. It is **not** reachable from the Claude Code
remote sandbox this was written in — that environment's egress policy is an
allowlist and denies the host at the proxy (`Tunnel connection failed: 403
Forbidden`), so the PDFs themselves could not be produced there. Run this from a
machine with ordinary internet access.

## Requirements

```sh
pip install pypdf                 # required
apt-get install -y poppler-utils  # optional: better text extraction, and --png
```

Poppler's `pdftotext -layout` keeps the gazette's two-column Maltese/English
layout in reading order better than pypdf, so it is preferred when present and
pypdf is the automatic fallback.

## Usage

```sh
cd scripts/malta-gazette

python3 gazette_extract.py run                    # fetch + extract (default)
python3 gazette_extract.py fetch                  # download issues into cache/
python3 gazette_extract.py extract                # split cached issues
python3 gazette_extract.py extract --png --zip    # also render images, then zip
python3 gazette_extract.py extract --only 20497   # one issue
python3 gazette_extract.py doctor --only 20497 --verbose  # what did it parse?
python3 gazette_extract.py index --years 2020 2023  # sweep the yearly indexes
python3 gazette_extract.py selftest               # verify locators on fixtures
```

Downloads are cached in `cache/` and each issue is fetched once no matter how
many events it carries; `--force` re-downloads. Both directories are ignored by
git.

## How a notice page is found

Page numbers in the source table are hints, not trusted values — every one is
re-derived from the PDF's own text:

1. **Printed page number.** Every page's running title is parsed for the printed
   number, excluding the issue number so that `10,376` is not confused with
   `21,481` when both are five digits with a thousands separator. Pages whose
   title does not parse (the cover, full-page tables) get a number inferred from
   the dominant printed-minus-index offset, flagged as `inferred`.
   If the running title parses on almost no pages — which is what an unfamiliar
   layout looks like — the numbering is instead recovered structurally: every
   margin number votes for an offset of (number − page index), and page
   numbering is the offset nearly all pages agree on. The issue number, printed
   on every page too, yields a different offset each time and so cannot win.

2. **Notice heading.** `Nru. 1167` / `No. 1167` — the numbered heading each
   notice carries.
3. **Phrases.** The notary's name, a report or application number such as
   `224/2022`.
4. **Corroboration.** A surname sitting next to `Kap. 55` / `Cap. 55`, which
   separates the real notice from a passing mention of the same name elsewhere
   in the issue (a tender notice, say).

The SOMMARJU contents page is demoted, because it lists every notice number and
usually the notaries' names as well — it therefore matches most hints without
being the notice, and being the earlier page it would otherwise win the tie.

Each class scores independently and the reasons are written to the manifest, so
every extracted page can be traced back to why it was chosen. A weak or tied
match is reported as a warning rather than silently accepted.

**Multi-page notices** are detected rather than assumed: a notice continues onto
the next page when no other notice heading follows it on its own page and the
next page carries real text before its first heading. Where `events.json` gives
an explicit (non-approximate) page range, that wins, and any disagreement with
detection is recorded in the manifest as a `span_note`.

If an extraction looks wrong, `doctor` is the first thing to run: it reports
whether printed numbers came from the running title or had to be inferred,
whether the page numbering is consistent (the offset should be a single value),
which pages the scorer treats as contents pages, and which carry no text at all.

## Output

`output/manifest.json` records, per event: the resolved printed and internal page
numbers, the files written, the evidence behind the match, and any warnings
(`ambiguous`, weak score, `printed_inferred`, cover page mismatch, `textless_pages`
for a scanned issue that would need OCR). The run prints a
`N/M events extracted cleanly` summary and exits non-zero if an issue could not
be downloaded.

## Adding events

Append to `events.json`. Only `id`, `notary` and one locator are required:

```json
{
  "id": "21616-martinelli",
  "notary": "Dr Carmel Martinelli",
  "event": "partial incapacitation",
  "decree_date": "2026-03-10",
  "printed_pages": [10376, 10377],
  "printed_pages_approximate": false,
  "notice_numbers": [1222],
  "phrases": ["Carmel Martinelli"],
  "any_phrases": ["Rapport Numru: 224/2022"]
}
```

`phrases` must all be present on the page; `any_phrases` scores per match.
`notice_numbers` may list alternatives when the right one is uncertain.
Matching folds case and Maltese diacritics (ċ ġ ż ħ), so `Gafa` finds `Gafà`.

## Known gaps in `events.json`

The table was built from web searches, so it is not exhaustive:

- **2020** — only the October event; the rest of the year was never swept.
- **2023** — no events found; may genuinely have none, or may have been missed.
- **Mid-2026 (May–Sep)** — not checked beyond 2 April 2026.
- **Criminal `interdizzjoni`** — Art. 190 of the Criminal Code (Cap. 9) is a
  harsher, conviction-based penalty, distinct from the Court of Revision's civil
  `inabilitazzjoni`, and was not searched for at all.

The authoritative way to close these is the yearly index, which lists every
notice under its subject heading:

```sh
python3 gazette_extract.py index --years 2020 2021 2022 2023 2024 2025
```

It downloads each year's index and prints the lines under the `NUTARA` /
`PROFESSJONI NUTARILI` headings with their GN and page numbers, which can then be
cross-referenced against that month's issue. There is no 2026 index until the
year closes, so 2026 needs the search-based approach (`site:gov.mt
"inabilitazzjoni parzjali" nutar`).

If a guessed issue URL 404s, check the naming against the
[Government Gazette Repository](https://www.gov.mt/en/Government/DOI/Government%20Gazette/Pages/Government-Gazzette-Repository.aspx) —
most issues are `Government Gazette - {Dth} {Month}.pdf` but some 2025+ ones are
`Gaz {D}.{M}.{YYYY}.pdf`. Add alternates to an issue's `url_fallbacks`.

As a cross-check on who is incapacitated _right now_, the Notarial Council's
[incapacitated notaries page](https://www.notariesofmalta.org/viewincapacitations.php)
lists current entries only — it carries no history, so it is not a substitute for
the Gazette sweep.

## Tests

`selftest` builds synthetic issues with reportlab (`pip install reportlab`) that
reproduce what the locator depends on, then asserts the located pages:

- a running title offset from the internal index;
- a cover page with no title, so the offset must be inferred;
- five-digit page and issue numbers sharing one line (`10,376` in issue `21,481`);
- two notices sharing a page, so a span must stop at the second;
- a notice genuinely running over a page break;
- a decoy page naming a notary outside any Cap. 55 notice;
- an issue with **no running title at all**, so numbering must be recovered
  structurally;
- a contents page naming the notary, against a notice page that omits `Kap. 55`,
  so the two match equally and only the demotion separates them.

The last two are regression tests with teeth: without their fixes the first
yields filenames like `21999_pi6_notice.pdf`, and the second extracts the
contents page instead of the notice. See `fixtures.py`.
