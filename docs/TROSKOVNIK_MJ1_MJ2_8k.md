# growto.live — Troškovnik razvoja: mjesec 1 + 2
**Ukupno:** 8.000 EUR (fiksno, bez PDV-a ako nije drugačije dogovoreno)  
**Razdoblje:** mjesec 1 (stabilizacija, produkcija) + mjesec 2 (komercijalni UX, pravni okvir)  
**Satnica implicitna:** ~55 EUR/h (programiranje i vođenje); infrastruktura = stvarni trošak + setup

---

## Pregled po kategorijama

| Kategorija | EUR | % | Važnost |
|------------|-----|---|---------|
| Programiranje | 3.050 | 38,1 % | Kritično |
| Arhitektura sustava + priprema skaliranja | 1.350 | 16,9 % | Kritično |
| Vođenje projekta | 900 | 11,3 % | Visoka |
| Rad na lokaciji (uzgoj / senzori / demo) | 700 | 8,8 % | Visoka |
| Firebase (produkcija + sigurnost — razvoj) | 550 | 6,9 % | Kritično |
| Servisi i pretplate (2 mj.: Blaze, Workspace) | 400 | 5,0 % | Visoka |
| Otvaranje računa i pristupa (setup) | 450 | 5,6 % | Visoka |
| Domena i DNS | 250 | 3,1 % | Srednja |
| Mail (poslovni + transakcijski setup) | 200 | 2,5 % | Srednja |
| Monitoring, backup, QA alati | 150 | 1,9 % | Srednja |
| **UKUPNO** | **8.000** | **100 %** | |

---

## Stavka po stavka (8.000 EUR)

### A — Otvaranje računa i pristupa (450 EUR · 5,6 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| A1 | Firebase projekt — produkcijski setup, IAM, backup pristup tvrtki | 150 | 70 | **220** | Projekt `balpha-9dab9`, uloge vlasnika |
| A2 | GitHub organizacija / repo pristup, branch zaštita, Actions | 70 | 30 | **100** | Deploy na Pages, secrets |
| A3 | Sentry (ili slično) — projekt, alerti, integracija u app | 50 | 20 | **70** | Error tracking |
| A4 | Dokumentacija pristupa (1 doc: tko ima što, rotacija lozinki) | 30 | 30 | **60** | Predaja tvrtki |
| | **Podzbroj A** | **300** | **150** | **450** | |

---

### B — Produkcijski računi i servisi (vanjski troškovi uključeni u ponudu)

*Ovo pokriva **prva 2 mjeseca** pretplate/registracija gdje je moguće; nakon toga na teret tvrtke.*

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| B1 | Firebase Blaze plan — rezerva korištenja (Auth, Firestore, Storage) | 110 | 90 | **200** | Procjena ~100 EUR/mj pri malom prometu |
| B2 | Google Workspace / poslovni mail (1 korisnik × 2 mj.) | 65 | 75 | **140** | npr. `info@growto.live` |
| B3 | Firebase Auth — e-mail predlošci, verifikacija, domena za mail | 25 | 35 | **60** | Custom domain za Auth mailove |
| | **Podzbroj B (servisi)** | **200** | **200** | **400** | Pretplate/registracije 2 mj. |

---

### C — Domena i DNS (250 EUR · 3,1 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| C1 | Registracija / obnova `growto.live` (godina) | 140 | 10 | **150** | Ovisno o registraru |
| C2 | DNS: A/CNAME, GitHub Pages, Firebase Hosting (ako se koristi) | 60 | 20 | **80** | SSL automatski |
| C3 | Subdomena `app.` / redirect `dnevnik/` → app | 15 | 5 | **20** | Već djelomično postoji |
| | **Podzbroj C** | **215** | **35** | **250** | |

---

### D — Mail (transakcijski i operativni) (200 EUR · 2,5 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| D1 | Postavljanje SPF/DKIM/DMARC za Auth i Workspace | 70 | 30 | **100** | Deliverability |
| D2 | Predlošci: dobrodošlica, reset lozinke (HR), kontakt forma | 40 | 60 | **100** | Firebase + statičke stranice |
| | **Podzbroj D** | **110** | **90** | **200** | |

*Workspace trošak je u B2; D = tehnički setup.*

---

### E — Firebase (razvoj i sigurnost, ne samo pretplata) (550 EUR · 6,9 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| E1 | Deploy i test `firestore.rules` (sve uloge, hybrid, sharedGrants) | 210 | 20 | **230** | Kritično za produkciju |
| E2 | Firestore indeksi, struktura `users`, `loginEvents`, `plants` | 70 | 50 | **120** | Composite indexi |
| E3 | Backup strategija (export, raspored, dokumentacija) | 60 | 40 | **100** | Ručni/automatski export |
| E4 | Auth: reset lozinke, e-mail verifikacija, onboarding flow | 20 | 80 | **100** | Pretežno mj. 2 |
| | **Podzbroj E** | **360** | **190** | **550** | |

---

### F — Arhitektura cijelog sustava (900 EUR · 11,3 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| F1 | Dokument arhitekture v1: slojevi (UI, sync, Firestore, IoT, Web3) | 280 | 120 | **400** | Dijagrami + data model |
| F2 | Model uloga i multi-tenant priprema (farme, admin, hybrid) | 110 | 90 | **200** | Za skaliranje B2B |
| F3 | Integracija senzora (API, cache, GitHub Action) — dokumentacija | 70 | 30 | **100** | Već djelomično live |
| F4 | Roadmap Web3 / Plant Passport — tehnički okvir (bez implementacije) | 30 | 70 | **100** | Za fazu 4–5 |
| F5 | CPVO, pitch deck, vanjski embed — mapiranje u arhitekturi | 40 | 60 | **100** | |
| | **Podzbroj F** | **530** | **370** | **900** | |

---

### G — Priprema skaliranja (450 EUR · 5,6 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| G1 | CI/CD: GitHub Actions (deploy, sync senzora, lint) | 90 | 40 | **130** | |
| G2 | Performanse: lazy load, cache localStorage vs Firestore conflict | 70 | 50 | **120** | |
| G3 | Plan kapaciteta Firestore (čitanja/pisanja po korisniku) | 60 | 40 | **100** | |
| G4 | Priprema exporta i migracije podataka (CSV schema) | 20 | 80 | **100** | Implementacija mj. 2 |
| | **Podzbroj G** | **240** | **210** | **450** | |

*F + G zajedno = **1.350 EUR (16,9 %)** — arhitektura + skaliranje.*

---

### H — Sati na lokaciji (700 EUR · 8,8 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| H1 | Obilazak uzgoja: mapiranje procesa → polja u aplikaciji | 360 | 40 | **400** | ~1 dan (7–8 h efektivno) |
| H2 | Senzor vlažnosti tla: provjera API-ja, CORS, prikaz u Alatima | 115 | 85 | **200** | Usklađivanje s Markom |
| H3 | Demo s timom tvrtke (superadmin, hybrid, admin) | 45 | 55 | **100** | |
| | **Podzbroj H** | **520** | **180** | **700** | |

*Ekvivalent ~12–13 h @ ~55 EUR/h + putni trošak uključen u fiksnu cijenu.*

---

### I — Programiranje (3.050 EUR · 38,1 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| I1 | Stabilizacija: auth, uloge, hybrid, loading, sync bugovi | 430 | 190 | **620** | Nastavak postojećeg koda |
| I2 | QA i ispravci: biljke, dnevnik, growlog, alati, admin | 310 | 230 | **540** | |
| I3 | Firestore rules integracija u app (error handling kad rules padnu) | 155 | 65 | **220** | |
| I4 | Onboarding (prvi login, tutorial, prazna baza) | 25 | 325 | **360** | |
| I5 | Pravne stranice + cookie banner (HR) | 10 | 260 | **270** | |
| I6 | Reset lozinke + e-mail verifikacija UI | 8 | 172 | **180** | |
| I7 | Export CSV (biljke, dnevnik) | 7 | 213 | **220** | |
| I8 | UI/UX mobilni + pristupačnost (osnovno) | 40 | 220 | **360** | |
| I9 | Admin panel: dorada korisnika, dijeljenja, login izvještaj | 90 | 170 | **260** | |
| I10 | Monitoring u app (Sentry hook, user-friendly errors) | 75 | 45 | **120** | |
| | **Podzbroj I** | **1.150** | **1.900** | **3.050** | ~55 h ukupno |

---

### J — Vođenje projekta (900 EUR · 11,3 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| J1 | Kick-off, scope, prioriteti P0/P1, sprint plan | 140 | 140 | **280** | |
| J2 | Tjedni sync (8× 30 min) + bilješke | 140 | 100 | **240** | |
| J3 | Mjesečni demo + izvještaj za tvrtku (PDF/MD) | 140 | 160 | **300** | |
| J4 | Koordinacija s vanjskim (registrar, senzor server, CPVO) | 25 | 55 | **80** | |
| | **Podzbroj J** | **445** | **455** | **900** | ~16 h @ ~55 EUR/h |

---

### K — Monitoring, backup, QA alati (150 EUR · 1,9 %)

| # | Stavka | Mj. 1 | Mj. 2 | Ukupno | Napomena |
|---|--------|-------|-------|--------|----------|
| K1 | Test checklist produkcija (auth, sync, admin, offline) | 85 | 35 | **120** | |
| K2 | Release notes + verzioniranje tagova | 20 | 10 | **30** | |
| | **Podzbroj K** | **105** | **45** | **150** | |

---

## Raspodjela po mjesecima

| Mjesec | EUR | % | Fokus isporuke |
|--------|-----|---|----------------|
| **Mjesec 1** | **4.200** | 52,5 % | Produkcija stabilna, arhitektura v1, rules, lokacija, QA |
| **Mjesec 2** | **3.800** | 47,5 % | Komercijalni paket v0.9: onboarding, GDPR, export, UX |
| **Ukupno** | **8.000** | 100 % | |

### Mjesec 1 — sažetak stavki (4.200 EUR)

| Kategorija | EUR |
|------------|-----|
| Programiranje (I) | 1.150 |
| Arhitektura (F) | 530 |
| Skaliranje (G) | 240 |
| Vođenje (J) | 445 |
| Lokacija (H) | 520 |
| Firebase razvoj (E) | 360 |
| Otvaranje računa (A) | 300 |
| Servisi Blaze/Workspace (B) | 200 |
| Domena (C) | 215 |
| Mail setup (D) | 110 |
| Monitoring/QA (K) | 105 |
| **Ukupno mj. 1** | **4.200** |

### Mjesec 2 — sažetak stavki (3.800 EUR)

| Kategorija | EUR |
|------------|-----|
| Programiranje (I) | 1.900 |
| Vođenje (J) | 455 |
| Arhitektura (F) | 370 |
| Skaliranje (G) | 210 |
| Firebase + Auth (E) | 190 |
| Lokacija (H) | 180 |
| Otvaranje računa (A) | 150 |
| Servisi (B) | 200 |
| Domena (C) | 35 |
| Mail setup (D) | 90 |
| Monitoring/QA (K) | 45 |
| **Ukupno mj. 2** | **3.800** |

---

## Provjera zbrojeva (mora = 8.000)

| Stavka | EUR |
|--------|-----|
| A Otvaranje računa | 450 |
| B Servisi (Firebase Blaze, Workspace) | 400 |
| C Domena | 250 |
| D Mail setup | 200 |
| E Firebase razvoj | 550 |
| F Arhitektura | 900 |
| G Skaliranje | 450 |
| H Lokacija | 700 |
| I Programiranje | 3.050 |
| J Vođenje | 900 |
| K QA alati | 150 |
| **UKUPNO** | **8.000** |

---

## Što tvrtka dobiva za 8.000 EUR (isporuke)

**Kraj mjeseca 1**
- Produkcijski Firebase s aktivnim security rules
- Dokument „Arhitektura sustava v1” + plan skaliranja
- Sentry + backup procedura
- Stabilna aplikacija na growto.live (QA prolaz)
- Obilazak lokacije i usklađen senzor

**Kraj mjeseca 2**
- Onboarding + reset lozinke + verifikacija e-maila
- Uvjeti korištenja, privatnost, cookie banner (HR)
- Export CSV
- Mobilni UX poboljšan
- **Komercijalni paket v0.9** — spreman za prve registrirane korisnike

---

## Što NIJE u ovih 8.000 EUR

- AI Coach, Web3 implementacija (mj. 4–5)
- Smart contract, RWA
- Marketing, fotografija, copy osim pravnih stranica
- Troškovi nakon 2. mjeseca (Firebase, Workspace) — prelaze na tvrtku
- Više od planiranih sati na lokaciji (dodatni dani = satnica + dogovor)

---

## Predloženo plaćanje (8.000 EUR)

| Milestone | EUR | % |
|-----------|-----|---|
| Potpis / start mjesec 1 | 3.200 | 40 % |
| Prihvat isporuke mjesec 1 (arhitektura + rules + stabilna prod) | 2.000 | 25 % |
| Prihvat isporuke mjesec 2 (v0.9 komercijalni paket) | 2.800 | 35 % |

---

*Povezano s:* [`PONUDA_ROADMAP_6M_18k.md`](PONUDA_ROADMAP_6M_18k.md) (ukupni projekt 18.000 EUR; mj. 1–2 = 8.000 EUR od ukupno planiranih ~6.000 u starom docu — ovaj dokument **ažurira** prva dva mjeseca na 8k prema zahtjevu korisnika).*
