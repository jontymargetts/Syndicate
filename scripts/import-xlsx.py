#!/usr/bin/env python3
"""
Convert the syndicate spreadsheet into JSON files for the web app.

Usage:
    python3 scripts/import-xlsx.py path/to/Syndicate.xlsx

Writes:
    data/index.json          list of sheets, row counts, import timestamp, omitted fields
    data/<sheet-slug>.json   one file per sheet: { name, columns, rows }

Re-run whenever the spreadsheet changes, then commit the regenerated data/ files.

Privacy: columns whose headers look like personal or banking data (bank details,
phone numbers, e-mail, addresses, dates of birth, etc.) are dropped from the JSON
and listed in data/index.json under "omittedColumns". Extend SENSITIVE_HEADER
below if you need to exclude more.

Note: password-protected or rights-managed .xlsx files (e.g. Microsoft IRM /
AIP-protected) cannot be read. Save an unprotected copy first.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
import zipfile
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is required: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

SENSITIVE_HEADER = re.compile(
    r"bank|sort\s*code|account\s*(no|num|number)|iban|\bbic\b|phone|mobile|tel\b|"
    r"e-?mail|address|postcode|post\s*code|\bdob\b|birth|passport|national\s*insurance|"
    r"password|\bpin\b|card\s*(no|number)|\bcvv\b",
    re.I,
)


def is_plain_xlsx(path: Path) -> bool:
    """True only for a normal (unencrypted) OOXML zip package."""
    if not zipfile.is_zipfile(path):
        return False
    with zipfile.ZipFile(path) as z:
        return "xl/workbook.xml" in z.namelist()


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "sheet"


def to_json_value(v):
    if v is None:
        return None
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, dt.time):
        return v.isoformat()
    if isinstance(v, float):
        # Avoid 0.1+0.2 style noise from Excel floats.
        return round(v, 10)
    if isinstance(v, (int, bool, str)):
        return v
    return str(v)


def read_sheet(ws):
    rows_iter = ws.iter_rows(values_only=True)
    header_row = None
    for row in rows_iter:  # first non-empty row is the header
        if any(c not in (None, "") for c in row):
            header_row = row
            break
    if header_row is None:
        return [], [], []

    headers = []
    for i, h in enumerate(header_row):
        label = str(h).strip() if h not in (None, "") else f"column_{i + 1}"
        headers.append(label)

    keep_idx, omitted = [], []
    for i, h in enumerate(headers):
        if SENSITIVE_HEADER.search(h):
            omitted.append(h)
        else:
            keep_idx.append(i)

    columns = [headers[i] for i in keep_idx]
    rows = []
    for row in rows_iter:
        if not any(c not in (None, "") for c in row):
            continue
        rows.append({columns[j]: to_json_value(row[i]) if i < len(row) else None
                     for j, i in enumerate(keep_idx)})
    return columns, rows, omitted


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    src = Path(sys.argv[1]).expanduser()
    if not src.exists():
        print(f"File not found: {src}", file=sys.stderr)
        return 1

    if not is_plain_xlsx(src):
        print(
            f"{src} is not a readable .xlsx file. It is probably password-protected or\n"
            "rights-managed (Microsoft IRM/AIP). Open it in Excel, remove the protection\n"
            "(File > Info > Protect Workbook / Restrict Access) and Save As a new .xlsx.",
            file=sys.stderr,
        )
        return 1

    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    DATA_DIR.mkdir(exist_ok=True)

    index = {
        "source": src.name,
        "importedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sheets": [],
        "omittedColumns": {},
    }

    used_slugs: set[str] = set()
    for ws in wb.worksheets:
        columns, rows, omitted = read_sheet(ws)
        slug = slugify(ws.title)
        base, n = slug, 2
        while slug in used_slugs:
            slug = f"{base}-{n}"
            n += 1
        used_slugs.add(slug)

        payload = {"name": ws.title, "columns": columns, "rows": rows}
        (DATA_DIR / f"{slug}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        index["sheets"].append({
            "name": ws.title,
            "slug": slug,
            "rowCount": len(rows),
            "columnCount": len(columns),
        })
        if omitted:
            index["omittedColumns"][ws.title] = omitted
        print(f"{ws.title!r}: {len(rows)} rows, {len(columns)} columns -> data/{slug}.json")

    (DATA_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Wrote data/index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
