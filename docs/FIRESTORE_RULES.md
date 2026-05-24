# Firestore sigurnosna pravila — dnevnik.live

Firebase Test Mode ističe nakon 30 dana. Bez produkcijskih pravila **cijela aplikacija prestaje raditi** (uključujući učitavanje uloge superadmina).

## Brzi deploy (Firebase Console)

1. Otvori [Firebase Console](https://console.firebase.google.com/) → projekt **balpha-9dab9**
2. **Build** → **Firestore Database** → kartica **Rules**
3. Kopiraj cijeli sadržaj datoteke [`firestore.rules`](../firestore.rules) u editor
4. Klikni **Publish**

## Deploy preko Firebase CLI

```bash
# 1. Jednokratno — prijava (otvara browser)
npm install
npm run firebase:login

# 2. Deploy pravila
npm run deploy:firestore-rules
```

Ili bez npm install:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project balpha-9dab9
```

**Napomena:** `firebase login` moraš pokrenuti **u svom terminalu** (interaktivni browser login). Cursor agent ne može autentificirati umjesto tebe.

## Što pravila dopuštaju

| Kolekcija | Tko može čitati | Tko može pisati |
|-----------|-----------------|-----------------|
| `users/{uid}` | vlasnik, admin, superadmin, javni profili admin/superadmin uloga | vlasnik (create/update), superadmin (update/delete) |
| `users/{uid}/app/state` | vlasnik, admin, superadmin, korisnik s `sharedGrants` | samo vlasnik |
| `users/{uid}/sharedGrants/{viewer}` | vlasnik, viewer, superadmin | vlasnik, superadmin |
| `loginEvents` | superadmin | bilo koji prijavljeni korisnik (svoj `uid`) |
| `plants`, `entries` | admin, superadmin | admin, superadmin |
| `tenants` | superadmin | superadmin |

## Uloga superadmina

U Firestore dokumentu `users/{tvoj-uid}` polje **`role`** mora biti:

- `superadmin` (preporučeno), ili
- `supadmin` (app normalizira u superadmin)

Korisnik **ne smije** sam sebi promijeniti ulogu u superadmin — to može samo postojeći superadmin (ručno u konzoli ili admin panelu).

## Indeks za loginEvents

Kad superadmin prvi put otvori izvještaj prijava, Firebase može tražiti **composite index** na `loginEvents` (`loggedAt`). Klikni link u konzoli preglednika (F12) i kreiraj indeks.

## Provjera nakon deploya

1. Odjavi se i prijavi kao superadmin
2. Otvori **Admin** panel — ne smije biti „Access denied”
3. Provjeri **Biljke i dnevnik** — podaci se učitavaju i spremaju
4. Hybrid korisnik (Marko/Filip) — vidi dijeljene biljke superadmina

## Ako nešto ne radi

- **Permission denied** u konzoli → provjeri `role` u `users/{uid}`
- **Missing index** → kreiraj indeks iz linka u grešci
- Pravila se ažuriraju do 24 h u Firebase upozorenjima
