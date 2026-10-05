#!/usr/bin/env python3
"""Print docs/rebuild/index.html to PDF via Chrome headless."""
from __future__ import annotations

import subprocess
from pathlib import Path

DOCS = Path(__file__).resolve().parent
HTML = DOCS / "rebuild" / "index.html"
OUT = DOCS / "rebuild" / "growtoo-rebuild-tech-data-room.pdf"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def main() -> None:
    if not HTML.is_file():
        raise SystemExit(f"Missing {HTML}")
    if not CHROME.is_file():
        raise SystemExit("Google Chrome not found — needed for headless print-to-pdf")
    subprocess.run(
        [
            str(CHROME),
            "--headless",
            "--disable-gpu",
            "--no-pdf-header-footer",
            f"--print-to-pdf={OUT}",
            HTML.resolve().as_uri(),
        ],
        check=True,
    )
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
