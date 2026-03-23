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

Pristup aplikaciji na `/app` je zaštićen kroz Netlify Identity s prijavom i registracijom. Nakon uspješne prijave/registracije aplikacija automatski otvara sekciju **Biljke i dnevnik**.

## Prijava i uloge

Aplikacija koristi profile korisnika kroz Netlify Identity:

- `registracija` – korisnik kreira profil (email + lozinka)
- `prijava` – korisnik ulazi u svoj profil i vidi vlastite zapise

## Spremanje dnevnika i napretka (server-side)

Podaci o biljkama, dnevniku, alatima i napretku više nisu samo lokalni:

- `netlify/functions/profile-data.js` služi kao API za čitanje/pisanje profila
- svaki prijavljeni korisnik ima zaseban profil (ključan po Identity korisniku)
- podaci se trajno spremaju u **Netlify Blobs** store `diary-profiles`
- klijent i dalje drži lokalni cache kao fallback kada API nije dostupan

Datoteka `netlify/functions/identity-signup.js` i dalje automatski dodaje ulogu `admin_user` novim korisnicima pri registraciji.

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

1. U repozitoriju [mgebela/balkan-pharm-main](https://github.com/mgebela/balkan-pharm-main) otvori **Settings** → **Pages**.
2. Kod **Build and deployment** odaberi **Source**: **GitHub Actions**.
3. Nakon pusha na granicu `main`, workflow automatski deploya stranicu.

**Live URL** (nakon prvog deploya):  
**https://mgebela.github.io/balkan-pharm-main/**

## Tehnologije

- HTML5, CSS3, JavaScript (vanilla)
- Netlify Identity (`@netlify/identity`)
- Netlify Functions + Netlify Blobs (`@netlify/blobs`)
