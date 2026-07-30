#!/usr/bin/env python3
"""Generate investor PDF for growto.live."""
from __future__ import annotations

import os
from pathlib import Path

from fpdf import FPDF

DOCS = Path(__file__).resolve().parent
OUT = DOCS / "dnevnik-live-investitor-ponuda.pdf"

# macOS / Linux fallback fonts with Croatian glyphs
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


class InvestorPDF(FPDF):
    def __init__(self) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=True, margin=18)
        font_path = pick_font()
        self.add_font("Body", "", font_path)
        self.add_font("Body", "B", font_path)
        self._brand = (34, 85, 68)

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_font("Body", "B", 9)
        self.set_text_color(*self._brand)
        self.cell(0, 8, "growto.live — investitorski pregled", align="L")
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"Stranica {self.page_no()}", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(220, 220, 220)
        self.line(15, self.get_y(), 195, self.get_y())
        self.ln(4)

    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Body", "", 8)
        self.set_text_color(130, 130, 130)
        self.cell(
            0,
            8,
            "Povjerljivo — predložak ponude · svibanj 2026 · growto.live",
            align="C",
        )

    def cover(self) -> None:
        self.set_fill_color(*self._brand)
        self.rect(0, 0, 210, 90, style="F")
        self.set_y(28)
        self.set_font("Body", "B", 32)
        self.set_text_color(255, 255, 255)
        self.cell(0, 14, "growto.live", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Body", "", 14)
        self.cell(0, 10, "CBD uzgoj — digitalni dnevnik i platforma", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(8)
        self.set_font("Body", "", 11)
        self.cell(0, 8, "Investitorski pregled · ponuda razvoja", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(30)
        self.set_left_margin(15)
        self.set_x(15)
        self.set_text_color(40, 40, 40)
        self.set_font("Body", "B", 16)
        self.cell(0, 10, "6 mjeseci · 18.000 EUR", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Body", "", 11)
        self.set_text_color(80, 80, 80)
        self.cell(0, 8, "Faza 1 (mj. 1–2): 8.000 EUR · komercijalni temelj", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(12)
        self.set_font("Body", "", 10)
        bullets = [
            "Postojeći MVP na https://growto.live (~40–45 % komercijalnog cilja)",
            "Firebase Auth + Firestore, admin, IoT senzor, hibridni pristup",
            "Cilj: komercijalni lansman + Web3 pilot (Plant Passport)",
            "IP, programiranje, vođenje, servisi i održavanje uključeni",
        ]
        for b in bullets:
            self.multi_cell(180, 7, f"  -  {b}")
        self.ln(8)
        self.set_font("Body", "", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, "Dokument za investitore i poslovne partnere — predložak za pregovore.", align="C")

    def section_title(self, title: str) -> None:
        self.ln(4)
        self.set_font("Body", "B", 13)
        self.set_text_color(*self._brand)
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*self._brand)
        self.set_line_width(0.4)
        self.line(15, self.get_y(), 80, self.get_y())
        self.ln(5)
        self.set_text_color(40, 40, 40)

    def body(self, text: str) -> None:
        self.set_font("Body", "", 10)
        self.multi_cell(180, 6, text)
        self.ln(2)

    def table(self, headers: list[str], rows: list[list[str]], col_widths: list[int] | None = None) -> None:
        if col_widths is None:
            w = 180 // len(headers)
            col_widths = [w] * len(headers)
        self.set_font("Body", "B", 9)
        self.set_fill_color(240, 248, 244)
        self.set_text_color(40, 40, 40)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 8, h, border=1, fill=True)
        self.ln()
        self.set_font("Body", "", 9)
        fill = False
        for row in rows:
            if fill:
                self.set_fill_color(250, 250, 250)
            else:
                self.set_fill_color(255, 255, 255)
            max_h = 8
            for i, cell in enumerate(row):
                self.cell(col_widths[i], max_h, cell[:80], border=1, fill=True)
            self.ln()
            fill = not fill
        self.ln(3)


def build() -> None:
    pdf = InvestorPDF()
    pdf.set_margins(15, 15, 15)
    pdf.add_page()
    pdf.cover()

    pdf.add_page()
    pdf.section_title("1. Sažetak")
    pdf.body(
        "growto.live je web platforma za vođenje dnevnika uzgoja CBD biljaka na hrvatskom jeziku. "
        "Projekt polazi od funkcionalnog MVP-a i u 6 mjeseci (18.000 EUR) cilja komercijalno "
        "spreman proizvod s Web3 pilotom (Plant Passport, wallet connect), bez punog RWA marketplacea."
    )
    pdf.table(
        ["Komponenta", "Uključeno"],
        [
            ["Intelektualno vlasništvo", "Prijenos custom koda i dizajna tvrtki"],
            ["Programiranje", "Frontend, Firebase, admin, senzori, Web3 pilot"],
            ["Vođenje projekta", "Sprintovi, demo, mjesečni izvještaji"],
            ["Servisi", "Produkcija, domena, CI, monitoring"],
            ["Održavanje", "3 mjeseca (mj. 4–6), do 8 h/mj"],
        ],
        [55, 125],
    )

    pdf.section_title("2. Tržišna prilika i proizvod")
    pdf.body(
        "Regulirani CBD uzgoj zahtijeva dokumentiranje faza, zalijevanja, okoliša i usklađenost "
        "(CPVO). Groweri i farme trebaju jednostavan alat koji spaja dnevnik, IoT senzore i "
        "kasnije transparentnost lanca (Web3 plant passport) prema investitorima i kupcima."
    )
    pdf.table(
        ["Modul", "Status"],
        [
            ["Biljke, dnevnik, growlog, alati", "Live"],
            ["Firebase Auth + sync", "Live"],
            ["Admin, uloge, hybrid pristup", "Live"],
            ["Senzor vlažnosti tla", "Pilot"],
            ["AI Coach", "Plan (mj. 4)"],
            ["Web3 Plant Passport", "Plan (mj. 5)"],
        ],
        [70, 110],
    )

    pdf.section_title("3. Polazno stanje (~40–45 % komercijalnog MVP-a)")
    items = [
        "Prijava, sync Firestore, CRUD biljaka i dnevnika, fotografije",
        "Faze uzgoja, podfaze (lonci/polje), lokacije, growlog",
        "Alati: zalijevanje, gnojidba, okoliš, grafovi; CPVO embed",
        "Uloge: user, admin, superadmin; dijeljenje baze; login izvještaj",
        "Deploy: growto.live, GitHub Pages; Firestore rules pripremljene",
    ]
    for it in items:
        pdf.set_font("Body", "", 10)
        pdf.cell(5, 6, "")
        pdf.multi_cell(180, 6, f"- {it}")

    pdf.ln(2)
    pdf.set_font("Body", "B", 10)
    pdf.set_text_color(160, 60, 40)
    pdf.multi_cell(180, 6, "Još za komerciju: GDPR, onboarding, rules deploy, AI, Web3 pilot, naplata (opcija).")
    pdf.set_text_color(40, 40, 40)

    pdf.add_page()
    pdf.section_title("4. Roadmap — 6 mjeseci")
    pdf.table(
        ["Mjesec", "Budžet", "Fokus", "Isporuka"],
        [
            ["1", "3.000 €", "Stabilizacija, sigurnost", "Produkcija + arhitektura v1"],
            ["2", "3.000 €", "UX, pravni okvir", "Komercijalni paket v0.9"],
            ["3", "3.000 €", "Admin, IoT", "Operativni admin v1"],
            ["4", "3.000 €", "AI + Web3 prep", "AI Coach beta, wallet POC"],
            ["5", "3.000 €", "Web3 pilot", "Plant Passport"],
            ["6", "3.000 €", "Lansman", "Release v1.0 + predaja IP"],
        ],
        [18, 22, 55, 85],
    )

    pdf.section_title("5. Faza 1 — detaljni troškovnik (mj. 1–2: 8.000 EUR)")
    pdf.body(
        "Prva dva mjeseca pokrivaju produkcijski temelj, arhitekturu, rad na lokaciji i "
        "komercijalni UX. Raspodjela po važnosti:"
    )
    pdf.table(
        ["Kategorija", "EUR", "%"],
        [
            ["Programiranje", "3.050", "38,1 %"],
            ["Arhitektura + skaliranje", "1.350", "16,9 %"],
            ["Vođenje projekta", "900", "11,3 %"],
            ["Rad na lokaciji", "700", "8,8 %"],
            ["Firebase (razvoj)", "550", "6,9 %"],
            ["Servisi (2 mj.)", "400", "5,0 %"],
            ["Otvaranje računa", "450", "5,6 %"],
            ["Domena + mail + QA", "600", "7,5 %"],
            ["UKUPNO", "8.000", "100 %"],
        ],
        [95, 35, 50],
    )
    pdf.table(
        ["Mjesec", "EUR", "Ključno"],
        [
            ["Mjesec 1", "4.200", "Rules, arhitektura, lokacija, Sentry, QA"],
            ["Mjesec 2", "3.800", "Onboarding, GDPR, export, mobilni UX"],
        ],
        [35, 30, 115],
    )

    pdf.section_title("6. Ukupni budžet 18.000 EUR")
    pdf.table(
        ["Stavka", "EUR", "%"],
        [
            ["Programiranje", "8.400", "47 %"],
            ["Vođenje i analiza", "2.400", "13 %"],
            ["Intelektualno vlasništvo", "2.000", "11 %"],
            ["Održavanje (3 mj.)", "1.200", "7 %"],
            ["Servisi i infrastruktura", "1.000", "6 %"],
            ["Web3 pilot", "1.500", "8 %"],
            ["AI integracija", "1.000", "6 %"],
            ["Rezerva", "500", "3 %"],
            ["UKUPNO", "18.000", "100 %"],
        ],
        [85, 40, 55],
    )
    pdf.set_font("Body", "", 9)
    pdf.set_text_color(90, 90, 90)
    pdf.multi_cell(
        180,
        5,
        "Napomena: Firebase, OpenAI API, gas, domena nakon 2. mj. — procj. 50–150 EUR/mj na teret tvrtke.",
    )
    pdf.set_text_color(40, 40, 40)

    pdf.add_page()
    pdf.section_title("7. Web3 — što je uključeno")
    pdf.body("Uključeno u 6 mjeseci (pilot):")
    for w in [
        "Wallet connect (MetaMask / WalletConnect)",
        "Plant Passport — digitalni zapis biljke (off-chain + anchor/NFT)",
        "Javni growlog pregled (link / QR, read-only)",
        "Arhitektura za budući RWA — bez reguliranog trgovanja",
    ]:
        pdf.set_font("Body", "", 10)
        pdf.multi_cell(180, 6, f"  -  {w}")
    pdf.ln(2)
    pdf.body("Nije uključeno (faza 2 / zasebni budžet): RWA marketplace, KYC/AML, smart contract audit (3–8k EUR).")

    pdf.section_title("8. Intelektualno vlasništvo")
    pdf.body(
        "Po završetku i zadnjem milestoneu tvrtka dobiva isključivo pravo na custom kod razvijen "
        "u projektu. Izuzeci: open-source biblioteke, Firebase, postojeći pitch deck sadržaj, vanjski API-ji. "
        "Autor zadržava pravo reference u portfelju (bez poslovne tajne)."
    )

    pdf.section_title("9. Uvjeti plaćanja (prijedlog)")
    pdf.table(
        ["Milestone", "%", "EUR", "Okidač"],
        [
            ["Potpis ugovora", "20 %", "3.600", "Start"],
            ["Kraj mj. 2", "20 %", "3.600", "Paket v0.9"],
            ["Kraj mj. 4", "25 %", "4.500", "AI + Web3 POC"],
            ["Kraj mj. 6", "35 %", "6.300", "v1.0 + IP"],
        ],
        [55, 18, 28, 79],
    )
    pdf.table(
        ["Faza 1 (8k)", "%", "EUR"],
        [
            ["Start", "40 %", "3.200"],
            ["Prihvat mj. 1", "25 %", "2.000"],
            ["Prihvat mj. 2", "35 %", "2.800"],
        ],
        [70, 30, 40],
    )

    pdf.section_title("10. Rizici i mitigacija")
    pdf.table(
        ["Rizik", "Mitigacija"],
        [
            ["Firestore rules nisu deployane", "P0 — mjesec 1"],
            ["Regulativa CBD / CPVO", "Embed + pravni savjet tvrtke"],
            ["Web3 scope creep", "Pilot u mj. 5, audit zasebno"],
            ["API troškovi", "Budžet na tvrtki, monitoring"],
        ],
        [65, 115],
    )

    pdf.ln(6)
    pdf.set_fill_color(240, 248, 244)
    pdf.set_font("Body", "B", 11)
    pdf.set_text_color(*pdf._brand)
    pdf.multi_cell(
        180,
        8,
        "Kontakt i demo: https://growto.live - pitch deck u aplikaciji (superadmin).",
        fill=True,
    )

    pdf.output(OUT)
    print(f"Generated: {OUT}")


if __name__ == "__main__":
    build()
