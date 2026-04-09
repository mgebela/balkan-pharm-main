# balpha.shop – CBD dnevnik uzgoja

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

## Deploy na GitHub Pages

Aplikacija se može objaviti besplatno na GitHub Pages.

1. U repozitoriju [mgebela/balpha.shop](https://github.com/mgebela/balpha.shop) otvori **Settings** → **Pages**.
2. Kod **Build and deployment** odaberi **Source**: **GitHub Actions**.
3. Nakon pusha na granicu `main`, workflow automatski deploya stranicu.

**Live URL** (nakon prvog deploya):  
**https://mgebela.github.io/balpha.shop/**

## Tehnologije

- HTML5, CSS3, JavaScript (vanilla)
- Bez backenda – sve radi u pregledniku

## Netlify Identity email obavijesti

Za automatsko slanje emaila nakon registracije novog korisnika dodana je Netlify Identity event funkcija:

- `netlify/functions/identity-signup.js`

Funkcija šalje:

- potvrdu registracije korisniku
- obavijest administratoru na `admin@dnevnik.live`

Potrebne varijable okruženja:

- `RESEND_API_KEY` – API ključ za Resend
- `SIGNUP_EMAIL_FROM` (opcionalno) – adresa pošiljatelja; ako nije postavljena koristi se `EMAIL_FROM` ili `no-reply@dnevnik.live`
