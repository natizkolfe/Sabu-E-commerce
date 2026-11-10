"""Extract and clean schema.sql from the architecture PDF Appendix C."""
from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

PDF = Path(
    r"c:\Users\natna\.cursor\projects\c-Users-natna-Desktop-Sabu-E-commerce-Sabu-E-commerce"
    r"\attachments\7c50515e-6d65-4a3e-849e-b1c86632a03f"
    r"\Ethiopian_Ecommerce_ERP_Architecture_ERD_Data_Structure.pdf"
)
ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "packages" / "db"


def extract_appendix_c(reader: PdfReader) -> str:
    start = None
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if "Appendix C" in text and "schema.sql" in text:
            start = i
            break
    if start is None:
        raise SystemExit("Appendix C not found")

    out: list[str] = []
    header_re = re.compile(r"^Ethiopian E-Commerce & ERP")
    page_re = re.compile(r"^\d+\s*/\s*\d+$")

    for i in range(start, len(reader.pages)):
        text = reader.pages[i].extract_text() or ""
        for line in text.splitlines():
            s = line.rstrip()
            if "Appendix C" in s or "Executable DDL" in s or "Run with psql" in s:
                continue
            if header_re.match(s.strip()) or page_re.match(s.strip()):
                continue
            out.append(s)

    joined = "\n".join(out)
    idx = joined.find("-- =====================================================================")
    if idx < 0:
        idx = joined.find("CREATE EXTENSION")
    content = joined[idx:] if idx >= 0 else joined
    for a, b in (
        ("\u2010", "-"),
        ("\u2011", "-"),
        ("\u2013", "-"),
        ("\u2014", "-"),
        ("\ue005", ""),
        ("\ue006", ""),
    ):
        content = content.replace(a, b)
    return content


def join_broken_comments(content: str) -> str:
    """Rejoin COMMENT ON ... IS '...' lines split across PDF page breaks."""
    lines = content.splitlines()
    fixed: list[str] = []
    buf = ""
    for line in lines:
        if not buf:
            buf = line
        else:
            buf = f"{buf} {line.strip()}"

        if "COMMENT ON" in buf and " IS " in buf:
            after = buf.split(" IS ", 1)[1]
            if after.count("'") % 2 == 1:
                continue
            fixed.append(buf)
            buf = ""
            continue

        fixed.append(buf)
        buf = ""
    if buf:
        fixed.append(buf)
    return "\n".join(fixed)


def split_migrations(content: str) -> None:
    migrations_dir = DB / "migrations"
    migrations_dir.mkdir(parents=True, exist_ok=True)
    blocks = re.split(r"(?=-- MIGRATION \d+)", content)
    header = blocks[0]
    names: list[str] = []

    for block in blocks[1:]:
        first = block.splitlines()[0]
        m = re.match(r"-- MIGRATION (\d+)\s*-\s*(.+?)[\s-]*$", first)
        if not m:
            print("WARN no match:", first[:80])
            continue
        num, title = m.group(1), m.group(2).strip(" -")
        slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")[:40]
        fname = f"{num}_{slug}.sql"
        body = (header.rstrip() + "\n" + block) if num == "000" else block
        (migrations_dir / fname).write_text(body.rstrip() + "\n", encoding="utf-8")
        names.append(fname)

    (DB / "schema.sql").write_text(content.rstrip() + "\n", encoding="utf-8")
    print(f"Wrote schema.sql ({(DB / 'schema.sql').stat().st_size} bytes)")
    print(f"Migrations: {len(names)}")
    for n in names:
        print(" ", n)


def main() -> None:
    reader = PdfReader(str(PDF))
    content = join_broken_comments(extract_appendix_c(reader))
    bad = sum(
        1
        for line in content.splitlines()
        if line.strip().startswith("COMMENT ON") and line.count("'") % 2 == 1
    )
    print("CREATE TABLE", content.count("CREATE TABLE"))
    print("unbalanced COMMENT lines", bad)
    split_migrations(content)


if __name__ == "__main__":
    main()
