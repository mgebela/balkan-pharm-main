#!/usr/bin/env python3
"""Convert internal markdown specs to print HTML and PDF.

  python3 docs/generate_feature_pdf.py              # all jobs
  python3 docs/generate_feature_pdf.py product
  python3 docs/generate_feature_pdf.py feature
  python3 docs/generate_feature_pdf.py futard
  python3 docs/generate_feature_pdf.py costs
"""
from __future__ import annotations

import html
import re
import subprocess
from pathlib import Path

DOCS = Path(__file__).resolve().parent
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

JOBS = {
    "feature": {
        "md": DOCS / "FEATURE.md",
        "html": DOCS / "feature" / "index.html",
        "pdf": DOCS / "feature" / "growtoo-feature-spec.pdf",
        "title": "growtoo feature specification",
        "page_title": "growtoo · feature specification · 4 Sep 2026",
        "meta": "Product behaviour for a future team · 4 September 2026 · internal, not a marketing page",
        "banner": (
            "This is <strong>what the product does</strong> on "
            '<a href="https://growto.live">https://growto.live</a>. '
            "Stack, Firestore, Functions, and Solana live in the rebuild packet "
            "(<code>docs/rebuild/</code>). Root <code>README.md</code> is stale. "
            "Do not treat pitch-deck numbers as product facts."
        ),
        "footer": (
            "Generated from <code>docs/FEATURE.md</code> on 4 Sep 2026. "
            "If a claim is not in this spec, the rebuild packet, or <code>product-facts.md</code>, treat it as unverified."
        ),
    },
    "product": {
        "md": DOCS / "PRODUCT.md",
        "html": DOCS / "product" / "index.html",
        "pdf": DOCS / "product" / "growtoo-product-spec.pdf",
        "title": "growtoo product specification",
        "page_title": "growtoo · product specification · 4 Sep 2026",
        "meta": "Why, who, jobs, journeys, requirements · 4 September 2026 · internal, not a marketing page",
        "banner": (
            "This is <strong>why the product exists and what it must be</strong>. "
            "It is not a screen inventory — that is <code>docs/FEATURE.md</code>. "
            'Live site: <a href="https://growto.live">https://growto.live</a>. '
            "Do not treat pitch-deck numbers as product facts."
        ),
        "footer": (
            "Generated from <code>docs/PRODUCT.md</code> on 4 Sep 2026. "
            "If a claim is not in this spec, the feature spec, or <code>product-facts.md</code>, treat it as unverified."
        ),
    },
    "futard": {
        "md": DOCS / "FUTARD.md",
        "html": DOCS / "futard" / "index.html",
        "pdf": DOCS / "futard" / "growtoo-futard-raise.pdf",
        "title": "Futard.io vs growtoo — $200–250k raise",
        "page_title": "growtoo · Futard raise scan · 3 Sep 2026",
        "meta": "Internal board scan · 3 September 2026 · not a marketing page, not investment advice",
        "banner": (
            "Public <a href=\"https://www.futard.io/\">futard.io</a> scrape from 3 Sep 2026 "
            "(86 launches, $43.7M committed). Commitments are not cash kept — miss the minimum and "
            "everything refunds. Chance bands are judgment, not a model. "
            "Do not treat this as a Futard application or a public pitch."
        ),
        "footer": (
            "Generated from <code>docs/FUTARD.md</code> (canvas <code>futard-raise-vs-growtoo</code>, 3 Sep 2026). "
            "Not investment advice. Futard tokens are not equity. Follow counsel on cannabis."
        ),
    },
    "costs": {
        "md": DOCS / "COSTS.md",
        "html": DOCS / "costs" / "index.html",
        "pdf": DOCS / "costs" / "growtoo-use-of-funds.pdf",
        "title": "growtoo use of funds — cost catalog",
        "page_title": "growtoo · use of funds · 4 Sep 2026",
        "meta": "Where Raise I cash goes · 4 September 2026 · internal, not a priced round",
        "banner": (
            "Planning numbers in USD. Canonical fill is the Labs paper: "
            "<strong>50% runway ($8k/mo)</strong>, 15% legal, 35% Mainnet + growers. "
            "Not a Futard form, not a founder employment contract, not investment advice."
        ),
        "footer": (
            "Generated from <code>docs/COSTS.md</code> on 4 Sep 2026. "
            "Legal and harvest lines need counsel. Domain ask is a snapshot, not a bid."
        ),
    },
}

CSS = """
:root {
  --ink: #1c241c;
  --muted: #5a665a;
  --line: #d5ddd4;
  --paper: #f7f4ee;
  --card: #fff;
  --accent: #3d5c3a;
  --warn: #8a4b2a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 15px/1.5 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  color: var(--ink);
  background: var(--paper);
}
.wrap { max-width: 880px; margin: 0 auto; padding: 2.25rem 1.25rem 4rem; }
header h1 { font-size: 1.65rem; font-weight: 650; margin: 0 0 0.35rem; letter-spacing: -0.02em; }
header p.meta { margin: 0; color: var(--muted); font-size: 0.92rem; }
.banner {
  margin: 1.25rem 0 1.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--line);
  background: var(--card);
  font-size: 0.92rem;
}
nav.toc { margin: 0 0 2rem; padding: 1rem 1.1rem; background: var(--card); border: 1px solid var(--line); }
nav.toc strong { display: block; margin-bottom: 0.4rem; }
nav.toc ol { margin: 0; padding-left: 1.2rem; columns: 2; gap: 1.5rem; }
nav.toc a { color: var(--accent); text-decoration: none; }
nav.toc a:hover { text-decoration: underline; }
h2 { font-size: 1.2rem; margin: 2.1rem 0 0.6rem; padding-top: 0.4rem; border-top: 1px solid var(--line); }
h3 { font-size: 1.02rem; margin: 1.3rem 0 0.4rem; }
h4 { font-size: 0.95rem; margin: 1rem 0 0.35rem; }
p, li { color: var(--ink); }
.muted { color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin: 0.5rem 0 1rem; background: var(--card); }
th, td { text-align: left; vertical-align: top; padding: 0.42rem 0.55rem; border-bottom: 1px solid var(--line); }
th { font-weight: 650; background: #eef2ee; }
code, kbd { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 0.84em; }
ul, ol { margin: 0.35rem 0 0.85rem; padding-left: 1.25rem; }
ul ul, ol ul, ol ol, ul ol { margin: 0.15rem 0 0.25rem; }
.status { font-weight: 650; color: var(--accent); }
.warn { color: var(--warn); }
footer { margin-top: 2.5rem; color: var(--muted); font-size: 0.85rem; }
@media print {
  body { background: #fff; }
  .wrap { max-width: none; padding: 0; }
  nav.toc, .banner { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
  h2, h3 { break-after: avoid; }
  table { break-inside: avoid; }
}
"""


def inline(text: str) -> str:
    parts: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("`", i):
            j = text.find("`", i + 1)
            if j == -1:
                parts.append(html.escape(text[i:]))
                break
            parts.append(f"<code>{html.escape(text[i + 1:j])}</code>")
            i = j + 1
            continue
        if text.startswith("[", i):
            m = re.match(r"\[([^\]]+)\]\(([^)]+)\)", text[i:])
            if m:
                label, href = m.group(1), m.group(2)
                parts.append(
                    f'<a href="{html.escape(href, quote=True)}">{inline(label)}</a>'
                )
                i += m.end()
                continue
        if text.startswith("**", i):
            j = text.find("**", i + 2)
            if j != -1:
                parts.append(f"<strong>{inline(text[i + 2:j])}</strong>")
                i = j + 2
                continue
        if text[i] == "*" and (i + 1 < n and text[i + 1] != " "):
            j = text.find("*", i + 1)
            if j != -1 and not text.startswith("**", j):
                parts.append(f"<em>{inline(text[i + 1:j])}</em>")
                i = j + 1
                continue
        j = i + 1
        while j < n and text[j] not in "`*[":
            j += 1
        parts.append(html.escape(text[i:j]))
        i = j
    return "".join(parts)


def slug(title: str) -> str:
    s = re.sub(r"<[^>]+>", "", title)
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "section"


def is_table_sep(line: str) -> bool:
    return bool(re.match(r"^\|?\s*:?-{3,}", line))


def parse_row(line: str) -> list[str]:
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells


def render_md(src: str) -> tuple[str, list[tuple[str, str]]]:
    lines = src.splitlines()
    out: list[str] = []
    toc: list[tuple[str, str]] = []
    i = 0
    list_stack: list[str] = []

    def close_lists(to_indent: int = -1) -> None:
        while list_stack and (to_indent < 0 or len(list_stack) > to_indent):
            out.append(f"</{list_stack.pop()}>")

    while i < len(lines) and not re.match(r"^##\s+", lines[i].strip()):
        i += 1

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "---":
            close_lists()
            i += 1
            continue

        m = re.match(r"^(#{2,4})\s+(.*)$", stripped)
        if m:
            close_lists()
            level = len(m.group(1))
            title = inline(m.group(2))
            sid = slug(m.group(2))
            if level == 2:
                toc.append((sid, re.sub(r"<[^>]+>", "", title)))
            out.append(f'<h{level} id="{html.escape(sid, quote=True)}">{title}</h{level}>')
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and is_table_sep(lines[i + 1].strip()):
            close_lists()
            headers = parse_row(stripped)
            i += 2
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(parse_row(lines[i].strip()))
                i += 1
            out.append("<table>")
            out.append("<thead><tr>" + "".join(f"<th>{inline(h)}</th>" for h in headers) + "</tr></thead>")
            out.append("<tbody>")
            for row in rows:
                while len(row) < len(headers):
                    row.append("")
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row[: len(headers)]) + "</tr>")
            out.append("</tbody></table>")
            continue

        lm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if lm:
            indent = len(lm.group(1).replace("\t", "  "))
            ordered = lm.group(2).endswith(".")
            depth = indent // 2
            tag = "ol" if ordered else "ul"
            while len(list_stack) > depth + 1:
                out.append(f"</{list_stack.pop()}>")
            if len(list_stack) == depth:
                out.append(f"<{tag}>")
                list_stack.append(tag)
            elif list_stack and list_stack[-1] != tag and len(list_stack) == depth + 1:
                out.append(f"</{list_stack.pop()}>")
                out.append(f"<{tag}>")
                list_stack.append(tag)
            out.append(f"<li>{inline(lm.group(3))}</li>")
            i += 1
            continue

        if not stripped:
            close_lists()
            i += 1
            continue

        close_lists()
        para = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i]
            ns = nxt.strip()
            if (
                not ns
                or ns == "---"
                or ns.startswith("#")
                or ns.startswith("|")
                or re.match(r"^(\s*)([-*]|\d+\.)\s+", nxt)
            ):
                break
            para.append(ns)
            i += 1
        text = inline(" ".join(para))
        if text.startswith("<strong>Status:"):
            out.append(f'<p class="status">{text}</p>')
        elif text.startswith("Do not treat") or text.startswith("Not live"):
            out.append(f'<p class="banner">{text}</p>')
        else:
            out.append(f"<p>{text}</p>")

    close_lists()
    return "\n".join(out), toc


def build_html(job: dict, body: str, toc: list[tuple[str, str]]) -> str:
    toc_html = "".join(f'<li><a href="#{html.escape(sid, quote=True)}">{html.escape(title)}</a></li>' for sid, title in toc)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>{html.escape(job["page_title"])}</title>
  <style>{CSS}</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>{html.escape(job["title"])}</h1>
      <p class="meta">{job["meta"]}</p>
    </header>
    <p class="banner">
      {job["banner"]}
    </p>
    <nav class="toc">
      <strong>Contents</strong>
      <ol>{toc_html}</ol>
    </nav>
    {body}
    <footer>
      {job["footer"]}
    </footer>
  </div>
</body>
</html>
"""


def print_job(name: str) -> None:
    job = JOBS[name]
    md = job["md"]
    html_out: Path = job["html"]
    pdf_out: Path = job["pdf"]
    if not md.is_file():
        raise SystemExit(f"Missing {md}")
    if not CHROME.is_file():
        raise SystemExit("Google Chrome not found — needed for headless print-to-pdf")
    body, toc = render_md(md.read_text(encoding="utf-8"))
    html_out.parent.mkdir(parents=True, exist_ok=True)
    html_out.write_text(build_html(job, body, toc), encoding="utf-8")
    subprocess.run(
        [
            str(CHROME),
            "--headless",
            "--disable-gpu",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_out}",
            html_out.resolve().as_uri(),
        ],
        check=True,
    )
    print(f"Wrote {html_out}")
    print(f"Wrote {pdf_out} ({pdf_out.stat().st_size} bytes)")


def main() -> None:
    import sys

    names = sys.argv[1:] or list(JOBS)
    unknown = [n for n in names if n not in JOBS]
    if unknown:
        raise SystemExit(f"Unknown job(s) {unknown}. Use: {' '.join(JOBS)}")
    for name in names:
        print_job(name)


if __name__ == "__main__":
    main()
