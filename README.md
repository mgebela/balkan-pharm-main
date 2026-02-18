# Balkan-pharm – CBD dnevnik uzgoja

Web stranica i aplikacija za vođenje dnevnika uzgoja CBD biljaka, na hrvatskom jeziku.

## Sadržaj

- **`index.html`** – Početna stranica koja predstavlja i objašnjava aplikaciju (na hrvatskom).
- **`app/`** – Aplikacija dnevnika:
  - **Nadzorna ploča** – pregled broja biljaka, bilješki i nedavnih unosa
  - **Moje biljke** – dodavanje i uređivanje biljaka (ime, sorta, faza, datum)
  - **Dnevnik** – bilješke po biljkama (zalijevanje, gnojidba, okoliš)
  - **Alati** – pregled alata (zalijevanje, gnojidba, grafovi)

Faze biljke: Klijanje → Sadnica → Vegetativna → Cvjetanje → Sušenje.

Podaci se spremaju lokalno u pregledniku (localStorage); nema potrebe za registracijom.

## Pokretanje

Otvori `index.html` u pregledniku (dupli klik ili File → Open). Za ispravno učitavanje putanja koristi lokalni poslužitelj:

```bash
# Python 3
python3 -m http.server 8000

# ili npx (Node.js)
npx serve .
```

Zatim otvori: http://localhost:8000

## Tehnologije

- HTML5, CSS3, JavaScript (vanilla)
- Bez backenda – sve radi u pregledniku
# balkan-pharm-main
