#!/usr/bin/env python3
"""Generate growtoo Labs $200k Raise I proposal PDF (Jurassic-style Labs paper)."""
from __future__ import annotations

import os
from pathlib import Path

from fpdf import FPDF

DOCS = Path(__file__).resolve().parent
OUT = DOCS / "growtoo-labs-200k-proposal.pdf"

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def pick_font() -> str:
    for path in FONT_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError("No Unicode TTF font found for PDF generation")


class LabsPDF(FPDF):
    def __init__(self) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=True, margin=18)
        font_path = pick_font()
        self.add_font("Body", "", font_path)
        self.add_font("Body", "B", font_path)
        self._brand = (45, 106, 56)

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Body", "B", 9)
        self.set_text_color(*self._brand)
        self.cell(0, 8, "growtoo Labs — Raise I proposal", align="L")
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"{self.page_no()}", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(197, 217, 190)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(4)

    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Body", "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(
            0,
            8,
            "Confidential · September 2026 · not an offer of securities · growto.live",
            align="C",
        )

    def cover(self) -> None:
        self.set_fill_color(*self._brand)
        self.rect(0, 0, 210, 78, style="F")
        self.set_y(22)
        self.set_font("Body", "", 11)
        self.set_text_color(255, 255, 255)
        self.cell(0, 7, "growtoo Labs  ·  Raise I  ·  September 2026", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(4)
        self.set_font("Body", "B", 22)
        self.multi_cell(0, 10, "Everyone tokenises a promise.\nWe build the paper trail first.", align="C")
        self.ln(28)
        self.set_text_color(40, 40, 40)
        self.set_font("Body", "B", 14)
        self.cell(0, 8, "$200,000 operating raise  ·  $800,000 designed post-money", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Body", "", 11)
        self.set_text_color(80, 80, 80)
        self.cell(0, 7, "Journal-first plant RWA platform on Solana  ·  not a token sale", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(6)
        self.set_font("Body", "", 10)
        self.multi_cell(
            180,
            6,
            "Same two-raise architecture as Jurassic Finance Labs: Raise I funds the "
            "operating company; Raise II (first harvest SPV) is a separate vehicle after "
            "the legal path exists. This paper is Raise I only.",
        )

    def section(self, title: str) -> None:
        self.ln(3)
        self.set_font("Body", "B", 12)
        self.set_text_color(*self._brand)
        self.multi_cell(180, 7, title)
        self.set_draw_color(*self._brand)
        self.set_line_width(0.35)
        y = self.get_y()
        self.line(15, y, 72, y)
        self.ln(4)
        self.set_text_color(40, 40, 40)

    def p(self, text: str) -> None:
        self.set_font("Body", "", 10)
        self.multi_cell(180, 5.5, text)
        self.ln(1.5)

    def bullets(self, items: list[str]) -> None:
        self.set_font("Body", "", 10)
        for it in items:
            self.multi_cell(180, 5.5, f"  •  {it}")
        self.ln(1.5)

    def table(self, headers: list[str], rows: list[list[str]], widths: list[int]) -> None:
        self.set_font("Body", "B", 8)
        self.set_fill_color(234, 246, 230)
        self.set_text_color(40, 40, 40)
        for i, h in enumerate(headers):
            self.cell(widths[i], 7, h, border=1, fill=True)
        self.ln()
        self.set_font("Body", "", 8)
        fill = False
        for row in rows:
            if fill:
                self.set_fill_color(250, 250, 250)
            else:
                self.set_fill_color(255, 255, 255)
            # Wrap by splitting long cells across extra lines
            lines = [self._split(cell, widths[i]) for i, cell in enumerate(row)]
            n = max(len(x) for x in lines)
            line_h = 5
            for r in range(n):
                for i, parts in enumerate(lines):
                    txt = parts[r] if r < len(parts) else ""
                    self.cell(widths[i], line_h, txt, border=1, fill=True)
                self.ln()
            fill = not fill
        self.ln(3)

    def _split(self, text: str, width_mm: int) -> list[str]:
        # rough char budget for 8pt
        budget = max(12, int(width_mm / 1.7))
        words = text.split()
        lines: list[str] = []
        cur = ""
        for w in words:
            trial = (cur + " " + w).strip()
            if len(trial) <= budget:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines or [""]


def build() -> None:
    pdf = LabsPDF()
    pdf.set_margins(15, 16, 15)
    pdf.add_page()
    pdf.cover()

    pdf.section("1. Two raises")
    pdf.p(
        "Jurassic Finance split the work correctly: Labs first (infrastructure, team, legal), "
        "specimen SPV second. growtoo uses that split. The asset is a living plant with a care "
        "trail, not a static fossil. The journal is already live. The first harvest SPV is not."
    )
    pdf.table(
        ["Raise", "Amount", "What it buys"],
        [
            ["I · Labs (this paper)", "$200,000", "12 months, legal entity, Mainnet rails, 30–50 growers"],
            ["II · First harvest SPV", "Later, separate", "Economic rights to a documented batch — after counsel"],
        ],
        [48, 42, 90],
    )
    pdf.p(
        "Instrument this round: operating company (SAFE or equity, set by counsel). "
        "Not a token sale. Not $GROWTOO. Not harvest title. Designed post-money $800,000 (25% of Labs). "
        "Jurassic priced Labs at $400k with no product; growtoo prices higher because the desk and Devnet escrow already run."
    )

    pdf.section("2. What we are building")
    pdf.bullets(
        [
            "Log it (live): free journal — watering, feeding, stages, photos, illness check, AI coach, weather, stories. No wallet.",
            "Seal it (Solana Devnet): optional stage-linked plant tokens, test $GROWTOO, on-chain escrow, instant sale or adopt-stake. Listing needs 14 days of care, half those days logged.",
            "Hold it (Raise II): each documented harvest batch as an SPV. Physical redemption is specified, mocked on Devnet, not a live pipeline.",
        ]
    )
    pdf.p(
        "Why this is not an ICO: a cannabis-adjacent harvest right cannot be sold permissionlessly "
        "until an entity and regulatory path exist. $GROWTOO has no monetary value by design. "
        "This $200k is cash into Labs so Raise II is even possible."
    )

    pdf.section("3. Use of funds — $200,000")
    pdf.table(
        ["Share", "USD", "Bucket"],
        [
            ["50%", "$100,000", "12 months runway. Monthly allowance $8,000 (product, ops, hosting, coach, chain fees)."],
            ["15%", "$30,000", "Legal: entity, IP, RWA/harvest counsel, future SPV terms."],
            ["35%", "$70,000", "Mainnet rails, stronger attestations, 30–50 growers, 30-day retention, Raise II term sheet (not the acquisition)."],
        ],
        [22, 28, 130],
    )
    pdf.p("Spend above $8k/month from runway, or any draw from legal/Mainnet outside the decision log, needs written approval.")

    pdf.add_page()
    pdf.section("4. Why plants")
    pdf.bullets(
        [
            "Evidence is the product. The journal is the funnel; the token is optional.",
            "Living, not static. A plant accrues a trail every watering. Adopt-stake already pays the grower to keep logging.",
            "Recurring origination. Cycles repeat — Labs does not need a nine-figure specimen every year.",
            "Rules are opening, tooling is not. Week nine still lives in a notebook and a camera roll.",
            "Universally legible. Crypto stays behind a Profile unlock.",
        ]
    )

    pdf.section("5. Map to Jurassic Finance Raise I")
    pdf.table(
        ["", "Jurassic Labs", "growtoo Labs"],
        [
            ["Raise I", "$200k operating company", "$200k operating company"],
            ["Raise II", "First fossil SPV", "First harvest SPV after legal"],
            ["Underlying", "Specimen, museum custody", "Plant, grower custody, journal trail"],
            ["On-chain now", "Labs ICO; contracts after", "Devnet NFTs, escrow — test value only"],
            ["This round sells", "Labs treasury / token", "Labs equity or SAFE — not harvest title"],
        ],
        [32, 74, 74],
    )

    pdf.section("6. Upside case")
    pdf.p(
        "Not a 100x pitch. A real operating company with a free top-of-funnel (journal) and a later "
        "origination business (harvest SPVs). Growers keep the majority share under the designed model; "
        "adopters enter stage-weighted; Labs takes the market/escrow layer. Five to ten documented batches "
        "over two seasons only works if growers actually journal — hence 30-day retention as a Raise I milestone. "
        "A lending market against SPV tokens is out of scope until harvest rights are real. We will not copy yield onto a test token."
    )

    pdf.section("7. What is already built")
    pdf.table(
        ["Capability", "Status"],
        [
            ["PWA journal, camera, illness check, AI coach, stories", "Live"],
            ["Firebase Auth, public journal, Terms / Privacy / Risks", "Live"],
            ["Phantom / Solflare / watch-only link", "Live"],
            ["Stage mint, seed NFTs, adopt-stake, on-chain escrow", "Solana Devnet"],
            ["$GROWTOO", "Test asset — no monetary value"],
            ["Physical harvest redemption", "Specified, mocked"],
            ["Legal entity, Mainnet money, trustless attestation", "This raise"],
        ],
        [120, 60],
    )
    pdf.p(
        "Check: growto.live · growto.live/rwa-docs · growto.live/risks · chain/deployed.devnet.json. "
        "SuperteamBLKN collaboration is underway. This paper does not claim a Foundation grant or unpublished waitlist numbers."
    )

    pdf.section("8. 12-month roadmap")
    pdf.table(
        ["When", "What ships"],
        [
            ["Now", "Journal, coach, Devnet seal / market."],
            ["Q4 2026", "Legal entity. Regulatory memo. Stronger attestations."],
            ["H1 2027", "Scoped Mainnet pilot. 30–50 growers. 30-day retention. Raise II term sheet."],
            ["Later", "Raise II first harvest SPV — not funded here."],
        ],
        [32, 148],
    )
    pdf.p(
        "The 14-day / 50% care listing rule already runs on Devnet. It is process evidence, not proof a physical plant exists."
    )

    pdf.add_page()
    pdf.section("9. Team")
    pdf.p(
        "Bela Ikotic — product and engineering. Journal-first product, evidence model, AI coach. "
        "Testing with early growers. bela.ikotic@gmail.com · admin@growto.live. "
        "Single-operator Labs today. Raise I pays that operator and counsel, not a 12-person team. "
        "A second hire comes from the $8k monthly allowance or a written overage."
    )

    pdf.section("10. Operating rules")
    pdf.bullets(
        [
            "Monthly allowance $8,000 from the runway bucket.",
            "Harvest lockup: no proposal to sell physical harvest rights until Raise II and counsel exist.",
            "Emergency: freeze or delist if legal or safety risk, ratify after. Not a change to raise purpose.",
            "Brand and product IP assign into the Labs entity formed with this capital. Domain growto.live.",
        ]
    )

    pdf.section("11. Designed Labs economics (not live)")
    pdf.table(
        ["Line", "Figure"],
        [
            ["Cash this round", "$200,000"],
            ["Post-money (Labs)", "$800,000"],
            ["Investor share of Labs", "25%"],
            ["Founder / operator", "75% at close, subject to counsel"],
            ["$GROWTOO", "Devnet test asset, no value"],
            ["First harvest token", "Raise II only"],
        ],
        [70, 110],
    )
    pdf.p(
        "There is no live ICO and no implied FDV on a ticker. A MetaDAO-style supply table will be published "
        "only if that mechanism is actually used — not before an entity exists."
    )

    pdf.section("12. Risks")
    pdf.bullets(
        [
            "Single operator and a single Devnet collection authority today.",
            "Journal entries can still be fabricated until attestations harden.",
            "CBD / cannabis rules vary by country. growtoo is documentation, not a licensed cultivator or broker.",
            "Mainnet and physical redemption may slip or never ship if counsel says no.",
            "No third-party audit claimed. Planned before Mainnet money.",
            "Early-grower counts are small. Retention is a goal of this raise.",
        ]
    )

    pdf.section("13. Close")
    pdf.p(
        "Jurassic Finance proved that a $200k Labs raise can be told as: build the desk, then buy the specimen. "
        "growtoo is the same sentence with the specimen still in the ground: build the trail, then sell the harvest — "
        "and only if the law allows. The journal is live. The chain is optional and already testable. "
        "The $200k is to make the second raise honest."
    )
    pdf.ln(4)
    pdf.set_fill_color(234, 246, 230)
    pdf.set_font("Body", "B", 10)
    pdf.set_text_color(*pdf._brand)
    pdf.multi_cell(
        180,
        7,
        "  Live  growto.live    Deck  growto.live/pitch/investor/    Contact  bela.ikotic@gmail.com",
        fill=True,
    )

    pdf.output(OUT)
    print(f"Generated: {OUT}")


if __name__ == "__main__":
    build()
