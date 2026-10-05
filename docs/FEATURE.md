# growtoo feature specification

**Audience:** a future product / engineering team taking over or rewriting growtoo.  
**Date:** 4 September 2026.  
**PDF:** [`docs/feature/growtoo-feature-spec.pdf`](feature/growtoo-feature-spec.pdf)  
**Live product:** [https://growto.live](https://growto.live) · app [https://growto.live/app/](https://growto.live/app/)

This document is **what the product does**. Product intent lives in [`docs/PRODUCT.md`](PRODUCT.md). Stack lives in [`docs/rebuild/`](rebuild/README.md).

Do not treat pitch-deck numbers, mint counts, fundraising asks, or `README.md` at repo root as product facts. Root README is stale (it still says localStorage-only, no backend).

Public claims a team may repeat are listed in `community-agent/config/product-facts.md`.

---

## 1. What growtoo is

growtoo is a **free cannabis / CBD grow journal**. The journal is the product. Reminders, a 3-day weather widget, in-app camera, an AI coach, photos, growth-stage tracking, public Stories, and an optional Solana **Devnet** proof layer (Tokenise + Market) sit on top of that journal.

It is a **documentation tool**, not legal advice, not a diagnosis service, and not a live-money marketplace. Users must be **18+** and legally allowed to use grow-related information services where they live. Growers must follow the law where they grow.

Two desks after signup:

| Desk | Job | Wallet |
|------|-----|--------|
| **Grower** | Journal plants, log care, coach, Stories. Tokenise / Market only after chain opt-in. | Optional. Needed only to mint or list on Devnet. |
| **Adopter** | Market / garden desk. Follow listed plants, invest test $GROWTOO, daily faucet. Journal plants are empty by default. | Needed to invest / claim faucet. |

`profileType` (`grower` \| `adopter`) is **immutable** after create on the client. Do not let users flip desks without an explicit product decision — faucet, Invest, and Tokenise are a trust boundary.

---

## 2. Status legend

Use this in every feature below.

| Status | Meaning |
|--------|---------|
| **Live** | Ships to signed-in users on growto.live today. |
| **Gated** | Live, but behind a flag, allowlist, verified email, or chain opt-in. |
| **Devnet** | Live on Solana’s public test network. Tokens have **no monetary value**. |
| **Mocked** | UI / data model exist; fulfillment is not a real pipeline. |
| **Planned** | Roadmap only. Do not announce dates. |

**Not live (do not claim):** mainnet; $GROWTOO as money; trustless proof that a physical plant exists; physical harvest redemption / fulfillment.

On-chain records on Devnet are **process evidence from the journal trail**, not proof a plant exists.

---

## 3. Surfaces a user hits

| Surface | URL | Who |
|---------|-----|-----|
| Marketing landing | `/` (`/hr/`, `/de/`) | Public |
| Sign-in / sign-up | `/dnevnik/` | Public → Auth |
| Signed-in app | `/app/` | Grower / Adopter / Admin |
| Public Stories feed | `https://journal.growto.live` (also `/journal/` on apex) | Public, no account |
| Public grower profile | `journal.growto.live/g/{slug}` | Public |
| Public story | `journal.growto.live/p/{slug}` | Public |
| Terms / Privacy / Risks / RWA docs | `/terms/`, `/privacy/`, `/risks/`, `/rwa-docs/` | Public |
| Pitch chooser | `/pitch/` | Public (grower, adopter, investor, skeptic, labs) |

Languages: **English** (source of truth), **Croatian**, **German**. App switches in place (`?lang=` + `localStorage['growtoo:lang']`). Missing copy falls back to English, never a key name.

Internal data keys stay Croatian. Do not branch on displayed labels.

- Stages: `klijanje` → `sadnica` → `vegetativna` → `cvjetanje` → `susenje`
- Care types: `zalijevanje`, `gnojidba`, plus `opcenito`, `okolis`, `presadjivanje`, `stresori`, `ostalo`, `faza`, `podfaza`

---

## 4. Information architecture (app)

Primary bottom / sidebar nav is thumb-sized. Older docs that mention a Today tab or a separate Plants tab are stale.

### Grower bar

**Journal · Log · Coach · Tokenise**

- **Journal** — plants + calendar / list of entries. Dashboard and Today views still exist in the DOM; navigation redirects both here.
- **Log** — FAB / sheet, not a page. Fast watering / feeding; “Full journal entry” opens the entry modal.
- **Coach** — overlay panel (grower + adopter).
- **Tokenise** — 4th tab. First tap opens Tokenise. Market is the other segment on the same screen.

**More / Profile** (header sheet): Appearance, Language, Stories (mobile), Measurements, Unlock chain, Privacy, Terms, Log out. Admin tile only for two allowlisted emails.

### Adopter bar

Same four slots, but the 4th tab is labelled **Market**. Tokenise / Garden is the other segment. Journal plants are empty by default; Log is grower-only.

Deep links: `?view=dashboard` and `?view=danas` resolve to Journal.

---

## 5. Accounts, onboarding, profile

**Status: Live**

### Sign-in

- Firebase Auth: **email/password** and **Google**.
- Password: at least 8 characters (signup hint).
- Sign-in opens Grower or Adopter workspace from stored `profileType`. No second role picker.

### Sign-up

1. Age gate **18+** + Terms + Privacy (required).
2. Choose desk: Grower or Adopter. This is permanent on the client.
3. Grower extras:
   - Grow setup: `indoor` / `outdoor` / `mixed` (seeds plant defaults and coaching).
   - Home city (optional) — weather widget only.
   - Grow style note (optional).
   - Profile photo / logo (optional).
4. Adopter extras:
   - Intent: support growers / collect a garden / learn the flow.
   - Required checkbox: Devnet assets have no monetary value.

### Profile (More sheet)

- Display name, profile photo, email verification status.
- Wallet link status (not linked / linked pubkey). Clients may **unlink**. Only Cloud Function `linkWallet` may **set** `solanaPubkey` after ed25519 verify. Never let the client write the pubkey.
- Rank · XP chip (growers).
- Detail level: Simple (hide mint addresses) vs Advanced (explorer links, PDAs).
- Appearance: Light (product default) / Dark / Auto. Stored as `growtoo:appearance`.
- Language: EN / HR / DE.
- Replay product tour.
- Resend verification / “I already verified”.

### Email verification gate

Live Gemini (Coach + illness-check photos) requires `email_verified` on the ID token. Unverified accounts get the **local helper** (reminders + draft logs, no live model). After an admin verifies an email, the user must **sign out and in**.

### Product tour

First-run scripts per view (Journal, Tokenise/Garden). Replay from Profile. Welcome / “While you were away” / adopter START HERE: **one intro layer per session**, never stacked with Tokenise explainers. After ≥30 minutes away, show the return sheet only.

---

## 6. Feature catalog

### 6.1 Plants (journal garden)

**Status: Live · Grower**

CRUD for plants in the grower’s journal.

**Create wizard**

1. Essentials: name (required), stage.
2. Optional details: strain, start date, environment name, indoor/outdoor, photo, notes.
3. Outdoor extras: field location, planting location, daily exposure hours.
4. Advanced: `count` (plants in a row/cohort), subphase ladder.

**Subphases (pot / field ladder)**

`pot_1_5dcl` → `pot_5l` → `pot_30l` → `na_polju` (in the field). Quick actions: next pot, to field. Stage and subphase changes write history (`stageHistory`, `subphaseHistory`, `stageDates`) and can emit journal notes.

**Optional on create:** “Also seal this on-chain” — queues a seed mint if chain is unlocked and a Devnet wallet is connected. Not required for journaling.

**List**

- Stage filter chips.
- Rank chip in the plants header.
- Empty garden: Coach-style next step — Add a plant or Log first watering. Do not show a mute empty calendar as the first-run state.

**IDs:** plant `id` is a stable string. Seed mints, growth mints, and market listings foreign-key this id. **Never regenerate plant ids on rewrite.**

`startDate` is grower-facing. Market eligibility does **not** use it (see §6.12).

---

### 6.2 Journal entries

**Status: Live · Grower**

A dated note on one plant (or a same-strain stack).

| Field | Notes |
|-------|--------|
| `date` | Journal day `YYYY-MM-DD`. Display and calendar. **Not** used for market coverage. |
| `type` | See table below. |
| `note` | Required on the full entry form. |
| `photo` / `video` | Photo via camera or file. Video optional. Photos go to Storage, not inline in the state blob. |
| `meta` | Type-specific extras (transplant, stressors, stage location). |
| `createdAt` | Clock time when saved. **This** is what market coverage counts. |
| `source` | e.g. log sheet, toolbox, camera, coach action. |

**Entry types (internal keys)**

| Key | Label | Extra fields |
|-----|--------|----------------|
| `opcenito` | General | — |
| `zalijevanje` | Watering | Amount can come from Measurements |
| `gnojidba` | Feeding | Product / dose |
| `okolis` | Environment | Temp / RH / pH |
| `presadjivanje` | Transplanting | Soil, age, condition |
| `stresori` | Stressors | Temp, humidity, VPD, pests |
| `faza` | Stage / milestone | Optional field / planting location |
| `ostalo` | Other | — |
| `podfaza` | Sub-phase (system) | Written on subphase change |

**Calendar vs list**

Month view is the Journal landing. List stays if the user picked it. Filter by plant. Due watering / feeding from the calendar also feeds Coach reminders — there is **no separate event store**.

**Care-day rule (must keep):** dumping 90 logs in one session is **one** care day. Backdating `entry.date` does not create extra coverage. Distinct UTC days of `zalijevanje` / `gnojidba` by `createdAt` count.

---

### 6.3 Log sheet (FAB)

**Status: Live · Grower**

Fast path from the Log tab.

- Multi-select plants. Same-strain stacks can log together.
- **Log watering** / **Log feeding** — one tap each.
- **Full journal entry** — opens the entry modal with those plants preselected.
- Empty garden: CTA to add a plant.

This is the primary daily habit. Coach drafts should land here in spirit (confirm-then-write), not invent a second logger.

---

### 6.4 Grow log (per-plant trail)

**Status: Live · Grower**

Opened from a plant card. Seed-to-harvest documentation page.

- Hero (name, stage, photo).
- Strain, environment, stage timeline.
- Photo grid + recent strip + “view all”.
- Chronological journal trail for that plant.
- Actions: new entry, edit plant, open Coach.
- Optional reward-goal line when chain activity is on.

This is the “plant passport” a grower (and later an adopter) is meant to read. Listing on Market is supposed to point at this kind of trail, not at a mint timestamp.

---

### 6.5 Measurements (toolbox)

**Status: Live · Grower** (soil moisture: **Gated**, two admin emails)

Opened from Profile → Measurements. Charts live here; each Add **also writes a matching journal entry** so there is one care story, not two ledgers.

| Tool | Inputs | Chart |
|------|--------|--------|
| Watering | Date, amount (mL), plant | Amount by date |
| Feeding | Date, product/dose, note, plant | Feeding history |
| Environment | Date, °C, humidity %, pH, plant | Temp / RH / pH |
| Transplanting | Date, soil, age, condition, plant | List |
| Stressors | Date + stress fields, plant | List |
| Charts | Overview of the above | Combined |
| Soil moisture | Live sensor feed | **Admin emails only** |

Coach snapshot includes last watering mL, last feed product, last temp/RH. If a reading is missing, Coach should ask the grower to log it rather than invent numbers.

---

### 6.6 Weather (3-day)

**Status: Live · Grower**

Widget on Journal. City string (not GPS). Prefills from signup `homeCity`. 3-day forecast for grow planning (heat, watering pace). Coach can answer “what does the forecast mean for my grow?”.

**Rewrite note:** WeatherAPI key is currently in client JS. Move server-side. Do not add GPS unless product asks.

---

### 6.7 Plant camera + illness check

**Status: Live · Grower** (live analysis: **Gated** — verified email)

In-app camera: preview, shutter, Flip, Gallery. After capture:

- **Log to journal** — attach photo to a plant entry.
- **Check for illness** — sends 1–2 JPEG frames through the same Coach photo path (`coachChat` / `analyzeGrowFrames`).
- **Retake**.

Rules the model and UI must keep:

- Describe what is visible first, then at most two hypotheses (pest, disease, deficiency, environment).
- Do not name a pathogen unless the photo shows matching signs.
- Never treat from the photo alone. Suggest one journal log that would confirm the top hypothesis.
- Quota: vision **25/day**. Coach chat **60/day** (UTC). Distinct copy for `email_unverified`, expired token, `quota_exceeded`.
- Permission failures: blocked vs no camera vs generic — never a silent fail. Gallery is the fallback.

Photos: Firebase Storage `users/{uid}/journal/…`, max ~5 MB after compression. Do not store new photos as base64 in the 1 MiB Firestore state document.

---

### 6.8 Reminders + Today card

**Status: Live · Grower**

Derived from journal + toolbox + weather. Not a separate calendar product.

Typical reminders:

- Watering due (pace from last logs).
- Feeding due.
- Heat check / heat + watering pace when forecast is hot and last water is stale.

Surfaces: Journal **Today** card, Coach empty state (“one next step”), Coach habit CTAs, Inbox `care_due`. User can dismiss a reminder id. Confirming a reminder drafts a journal action — **nothing is saved until they tap confirm**.

---

### 6.9 AI Coach

**Status: Live** (local helper always; Gemini **Gated** on verified email)

Two personalities from `profileType`:

| | Grower Coach | Adopter Coach |
|--|----------------|---------------|
| Job | Next care step, drafts, photo read, tokenisation tips | Explain care progress, live stage, unlock months |
| May propose actions | Yes, max 5, user must confirm | **Never** (`actions: []`) |
| May mint / edit journal | Only after confirm | No |

**Grower allowed actions** (client confirms, then `executeAction`):

| type | Does |
|------|------|
| `create_plant` | New plant (name required) |
| `add_entry` | Water / feed / general / stage / environment log |
| `set_stage` | Stage key on a known plant |
| `import_seed` | Mint/link seed for a journal plant |
| `mint_growth` | Next growth stage if journal proof exists |
| `link_plant` | Attach token to plant |

No deletes. Never invent `plantId`s that are not in the snapshot unless creating the plant first. Ground in snapshot numbers (days in stage, last water, weather). Do not replace looking at the plant.

**Caps in the UI:** Today, Care, Stage, Diagnose, Weather, Tokenise.

**Local helper** (unverified or quota): still drafts watering/feeding from the journal. Labels replies **Live coach** vs **Local helper**.

**Locales:** Gemini coach copy is **en** or **hr**. German UI falls back to English for live coach. Illness-frame analysis same.

**Voice:** practical CBD/hemp peer, not a doctor, not a lawyer, not a yield salesperson.

---

### 6.10 Stories + public journal

**Status: Live · Grower** (public site is unauthenticated)

In-app **Stories** (sidebar on desktop; Profile on mobile). Grower writes posts that can publish to the public journal.

**Composer:** title (max 120), URL slug, category, body, optional cover photo. Draft / publish / edit / delete (in-app confirm sheet, not `window.confirm`).

**Categories:** Field note · Looking at my plants · Plant problem · Made from my plants · Tips & tricks · Visited other growers.

**Public profile:** `publicProfileEnabled`, `publicSlug`, `publicBio`, profile photo. Public path `journal.growto.live/g/{slug}`.

**Public feed:** anyone can read, no sign-in. CTA to start a grow / sign in. Do not leak Firebase uids, emails, or private journal entries onto this surface — only published Stories and opted-in profile fields.

Mirroring to `publicJournalPosts` / `publicGrowerProfiles` is done by Cloud Functions (Admin SDK), not by a public client write.

---

### 6.11 Inbox

**Status: Live**

Bell in the header. Types include: journal saved, care due, seed/growth mint success or fail, sale settled, stake received, faucet, activity bonus, harvest claim, wallet reconnect.

Empty state explains the inbox. Mark all read. Demo “load examples” exists for empty desks — do not confuse example rows with production events.

Wallet reconnect: signing out ends the **browser** wallet session; the account can stay linked to the pubkey. Copy must say that, not “wallet was stolen.”

---

### 6.12 Tokenise (optional chain)

**Status: Devnet · Gated on `chainOptIn` · Grower**

Journal works with **no wallet**. Tokenise / Market sit behind Unlock chain (Profile or first tap on the 4th tab). Dialog: “Unlock Tokenise & Market?” — do not dead-click.

**Wallets:** Phantom or Solflare, Solana **Devnet**. Link is a signed challenge verified by `linkWallet`. Challenge message is **not** translated (signature is byte-for-byte).

**What Tokenise does**

1. Pick a **real journal plant** (`plantId` required). Seed mint is not gated on 14-day coverage.
2. Seal seed stage → queue `seedMints` → GitHub worker mints NFT.
3. Later growth seals (`growthMints`) need **journal proof** (quests): linked plant, stage log, watering this stage; feeding optional only for germination.
4. List on Market is a **separate** gate (below).

**Grower quests** (checklist, not a game board): link plant, log stage, log watering, log feeding. Copy: “Journal proof complete — ready to mint.”

**Rank / XP:** New → Active → Dedicated → Seasoned → Master → Elite cultivator. Shown on Journal and Profile. Activity bonus can mint test $GROWTOO for documented care (Devnet, no value).

**Honesty in UI:** mint toasts distinguish **queued** vs **failed**. Never claim on-chain success the queue refused. Test $GROWTOO has no monetary value. Stage rewards copy may mention a harvest total — that is Devnet game points, not money.

---

### 6.13 Market

**Status: Devnet · Gated on chain opt-in**

Growers list; adopters browse / invest. Public board reads **`marketPublicTape`** (scrubbed: on-chain pubkeys, no Firebase uids). Full `marketListings` are owner/buyer, not a public collection list.

**List / escrow activate (must stay in sync client + Functions)**

- ≥ **14 elapsed days** since first care `createdAt`.
- Care on ≥ **50%** of `min(elapsed, 180)` distinct UTC days.
- Watering or feeding only.
- Listings with `journalCoverageOk === false` are **hidden** from the public tape.
- Same-day mint-and-list is blocked.

**Offer types**

| Type | Behavior |
|------|----------|
| Instant sale | Plant token moves to buyer now. |
| Adopt stake | 50% $GROWTOO now, 50% locked until harvest-claim path. |

**Adopter garden:** settled plants appear under My adopted plants. Watch live stage and monthly unlock status. First-run: START HERE + How to adopt; hide after first adoption.

**Invest:** disabled in watch-only (no signing session). Header chip shows Watch-only when the session cannot sign.

**Faucet:** **adopter-only** daily test $GROWTOO. Growers do not get this desk.

**Harvest claim:** UI can file `harvestClaims` (`pending`). **Physical redemption is mocked** — not a fulfillment pipeline. Locked 50% release is specified, not a live warehouse / legal redemption flow.

**Copy rules:** no yield promises. “You can watch this plant’s trail” beats APY language. Devnet / sim traffic may appear; Coach and Market must not invent balances.

---

### 6.14 Admin

**Status: Gated — two emails only**

`supadmin@dnevnik.live` and `admin@dnevnik.live`. Firestore `role` is **not** enough. Ordinary growers must never see Admin nav.

Capabilities (read this as “exists today,” not as a multi-tenant SaaS spec):

- User list / login report (today / 7 days).
- Legacy plants / entries / tenants collections (admin library — **not** the grower journal blob).
- Share plants and tools read-only with another user (`sharedGrants`).
- Hybrid viewers: own journal editable; shared superadmin plants view-only.
- Soil-moisture tool.

Do not expand admin to “anyone with `role: admin`” without replacing the email allowlist on purpose.

---

## 7. Cross-cutting product rules

These are product requirements, not implementation trivia.

1. **Journal first.** Coach, reminders, Tokenise, and Market are layers. A grower who never opens a wallet must still have a complete product.
2. **Confirm before mutate.** Coach actions, destructive deletes, listings, and mints use in-app confirm sheets. No silent journal writes from the model.
3. **Two desks are a trust boundary.** Faucet and Invest are adopter-only. Tokenise mint-from-journal is grower-only. Adopter Coach cannot edit the grower’s log.
4. **Coverage is `createdAt`, not `date`.** Changing that silently rewrites who can list.
5. **Plant ids are foreign keys.** Preserve them across a rewrite.
6. **Devnet honesty** in every chain surface: no monetary value, no live harvest redemption, on-chain ≠ physical plant.
7. **Coach is advisory.** No disease diagnosis-as-fact, no legal advice, no medical claims.
8. **i18n:** EN source + HR/DE; internal keys stay Croatian; German live-coach fallback is a known gap.
9. **Light theme is the default.** Dark is opt-in.
10. **Public market board never lists raw `marketListings`.** Tape only.
11. **Wallet pubkey is server-verified.** Client may unlink only.
12. **Age 18+ and local-law compliance** stay in signup, terms, and marketing FAQ.

---

## 8. What is explicitly out of scope today

Do not build these as if they were missing bugs unless product reopens them.

- Native iOS / Android store apps (responsive web only; mockups exist under `mobile/`).
- Service worker / installable PWA (not in repo).
- Mainnet Solana, real $GROWTOO value, or a published mainnet date.
- Physical harvest shipping / licensed fulfillment.
- Trustless attestation that a plant exists in the world.
- GPS weather.
- Client-mutable `profileType`.
- Cursor / third-party chat as the Grower Coach backend (live Coach is Gemini `gemini-2.0-flash` via `coachChat`).
- Subscription billing / SaaS paywall (journal is free).

---

## 9. Suggested test matrix for a new team

Human desk tests (wallets + verified email). Automated HTTP smoke is listed in `docs/TEST_READINESS.md`.

| # | Path | Expect |
|---|------|--------|
| G1 | Sign up grower, skip wallet | Journal, Log, Coach local helper, weather |
| G2 | Verify email | Live Coach + illness photo |
| G3 | Add plant → log water/feed on Log sheet | Entries on calendar; toolbox mirror if using Measurements |
| G4 | Camera → Log to journal | Photo on grow log, Storage URL not giant state doc |
| G5 | Unlock chain, link Phantom Devnet, seal seed | Queue → minted; toast is queued then success/fail truthfully |
| G6 | Try to list before 14/50% | Blocked; tape hidden |
| A1 | Sign up adopter, faucet, browse tape | No grower journal; Invest watch-only until wallet signs |
| A2 | Instant sale vs adopt-stake | Garden updates; harvest claim remains mocked |
| P1 | Public journal signed-out | Stories + profiles only; no emails/uids |
| X1 | Unverified coach photo | Local helper + verify CTA, not a generic 500 |
| X2 | Non-admin user | No Admin nav even if `role` is wrong |

---

## 10. Related documents

| Doc | Use |
|-----|-----|
| [`docs/rebuild/`](rebuild/README.md) | Tech + data room for a rewrite kickoff |
| [`docs/TEST_READINESS.md`](TEST_READINESS.md) | Desk-test nav map and smoke (nav notes from Aug 2026 still apply) |
| [`docs/FIRESTORE_RULES.md`](FIRESTORE_RULES.md) | Rules intent |
| [`docs/app-check-rollout.md`](app-check-rollout.md) | App Check is **monitor mode** — do not flip enforcement casually |
| `community-agent/config/product-facts.md` | What marketing is allowed to say |
| `locales/README.md` | How to add a language |
| Live: `/rwa-docs/`, `/risks/`, `/terms/`, `/privacy/` | Trust model and legal |

If a claim is not in this spec, the rebuild packet, or `product-facts.md`, treat it as unverified.
