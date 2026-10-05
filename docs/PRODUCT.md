# growtoo product specification

**Audience:** product, design, and engineering taking over growtoo.  
**Date:** 4 September 2026.  
**PDF:** [`docs/product/growtoo-product-spec.pdf`](product/growtoo-product-spec.pdf)  
**Live product:** [https://growto.live](https://growto.live)

This document is **why the product exists and what it must be**. It is not a screen-by-screen inventory.

| Packet | Question it answers |
|--------|---------------------|
| This spec (`docs/PRODUCT.md`) | Why, who, jobs, journeys, requirements, success, non-goals |
| Feature spec (`docs/FEATURE.md`) | What ships today, field by field |
| Rebuild packet (`docs/rebuild/`) | How it is built (stack, data, chain) |
| `product-facts.md` | What marketing is allowed to say |

Do not treat pitch-deck numbers, mint counts, fundraising asks, or root `README.md` as product facts.

---

## 1. One-line product

growtoo is a **free grow journal** so a cannabis / CBD grower can run the next cycle from this one’s trail — not from memory — with an optional checkable proof layer for people who want to follow that trail.

Promise: **Grow it again. Exactly.**

---

## 2. Problem

A grow lives in four places that do not talk:

1. Notes in a notebook or chat.
2. Photos in the camera roll, unnamed.
3. Weather in another app.
4. A yellow leaf decided from memory.

By week nine, nobody can reconstruct week two. The next cycle starts from zero. Care slips (water, feed) because nothing is due on the plant. If someone later wants to back, buy, or simply believe the grow, there is no trail they can open themselves.

growtoo’s bet: **documentation is the asset**. Tokens only matter if the grow behind them is real.

---

## 3. Who it is for

Two desks. One account cannot be both on the client. Choose at signup; do not flip later without an explicit product decision.

### Grower (primary)

Cannabis / hemp / CBD growers: one plant, a tent, or a room. Indoor, outdoor, or mixed. They may be new or experienced. They do **not** need crypto knowledge to get value.

**Jobs**

- Keep watering, feeding, stages, and photos on the right plant.
- Know what to do next today without opening five apps.
- Compare this cycle to the last one.
- Optionally publish a story or seal a stage others can check.

**When we have succeeded for them:** they open Journal, log in seconds, and next season the trail is still there.

### Adopter (secondary)

People who want to follow a real plant’s story — not a trading terminal. RWA-curious, but the hook is “I can watch this plant grow,” not yield.

**Jobs**

- Pick one listed plant that already has a two-week care trail.
- Follow the same logs, photos, and sealed stages the grower recorded.
- Open the transaction themselves. No hidden side channel.

**When we have succeeded for them:** they can explain the plant’s week without asking us to attest it.

### Not for (today)

- Minors (18+).
- Anyone seeking medical, legal, or investment advice.
- Day traders / yield seekers.
- Licensed fulfillment / physical harvest buyers (redemption is mocked).
- Growers who need growtoo to prove a plant exists in the physical world. It does not.

---

## 4. Product principles

These beat feature requests when they conflict.

1. **Journal first.** The journal, Log, camera, reminders, and Coach are a complete product with no wallet. Tokenise and Market are optional layers.
2. **One trail.** Measurements, camera, Coach drafts, and stage changes write the same journal — not a second ledger.
3. **Seconds to log.** The daily habit is the Log sheet (water / feed). Full entry and Measurements are for when they have more to say.
4. **Ask before acting.** Coach proposes; the grower confirms. No silent mutations. No deletes from the model.
5. **Honest about the chain.** Devnet, no monetary value, process evidence not physical proof, harvest redemption not live. Say it on the surface that needs it — not only in `/risks/`.
6. **Watch beats yield.** Adopter copy is plant story + checkable trail. Never APY, never “guaranteed harvest.”
7. **Two desks are a trust boundary.** Faucet and Invest are adopter-only. Mint-from-journal is grower-only. Adopter Coach cannot edit the grower’s log.
8. **Documentation tool, not oracle.** Coverage gates (14 days, 50% care days, `createdAt` not backdated `date`) reduce mint-and-list farms. They do not prove a plant exists.
9. **Local law stays with the user.** Follow the law where you grow. growtoo is not legal advice.
10. **Light paper default.** Sage journal look. Dark is opt-in. EN source + HR + DE.

---

## 5. What “good” feels like

### Grower, ordinary day

Open app → Today card or Log → tap watering on the right plant(s) → photo optional → reminder clears. If a leaf looks wrong: camera → Check for illness → at most two hypotheses, then a suggested log. Coach may draft feeding; nothing saves until confirm. Next month, the calendar still shows that day.

### Grower, optional proof

Same journal work. Unlock chain when they want it. Seal a stage linked to a real `plantId`. Listing waits until a two-week care trail exists. Toasts tell queued vs failed. Never “success” the queue refused.

### Adopter, first session

Sign up, accept Devnet has no value. START HERE once. Browse tape (no Firebase uids). Watch-only until a wallet can sign. After adopt: garden shows that plant’s stage and care — same trail, not a curated recap.

If any of those three stories needs a wallet, a yield number, or a second notebook, the product has failed the principle.

---

## 6. Core loop

```
Log care  →  trail exists  →  Coach / reminders use it  →  next cycle starts from the trail
                              ↘ optional: seal stage  →  list only after 14-day care  →  adopter follows
```

North-star behaviour (qualitative, no fake KPIs): **care days logged on real plants, week after week.** Mint count is not the north star. Wallet links are not the north star.

Leading signals a team may instrument later (do not invent current numbers):

- Growers who log watering or feeding in week 2 after signup.
- Plants with a photo on the trail.
- Coach confirms (not just opens).
- Stories published (public journal).
- Listings that pass coverage vs listings attempted too early (trust health).

---

## 7. Experience requirements

Must-hold UX, independent of stack.

| ID | Requirement |
|----|-------------|
| UX-1 | A grower can complete add-plant → log water with no wallet and no verified email. |
| UX-2 | Primary nav stays thumbable: Journal · Log · Coach · Tokenise (Market on adopter). |
| UX-3 | Log is a sheet, not a page. Water and feed are one tap; full entry is the escape hatch. |
| UX-4 | Empty garden offers one next step (add plant or first watering), not a mute calendar. |
| UX-5 | Live Coach vs Local helper is labelled. Unverified / quota / expired token have distinct copy. |
| UX-6 | Camera permission failures name the cause (blocked / missing / generic) and offer Gallery. |
| UX-7 | Destructive actions and Coach writes use in-app confirm, not `window.confirm`. |
| UX-8 | Chain-locked Tokenise/Market opens Unlock, never a dead click. |
| UX-9 | Public Stories and market tape never expose emails or Firebase uids. |
| UX-10 | One intro layer per session (welcome / while away / START HERE) — never stacked with Tokenise explainers. |
| UX-11 | Simple vs Advanced detail: Simple hides mint addresses; Advanced shows explorer links. |
| UX-12 | Missing translations show English, never a key name. |

---

## 8. Product requirements (by job)

Status of today’s implementation lives in the feature spec. This section is the **contract**: a rewrite still has to satisfy these jobs.

### P0 — Journal product (no chain)

| ID | Job | Acceptance |
|----|-----|------------|
| P0-1 | Create / edit plants | Name + stage required. Indoor/outdoor/mixed. Stable plant ids forever. |
| P0-2 | Stage model | Keys `klijanje → sadnica → vegetativna → cvjetanje → susenje`. Labels translated; keys not. |
| P0-3 | Care log | Water, feed, environment, transplant, stressors, stage, general. `date` for humans; `createdAt` for coverage. |
| P0-4 | Photos on the plant | Camera or file → Storage. Not base64 in the journal blob. |
| P0-5 | Calendar + list | Month is default landing. Filter by plant. |
| P0-6 | Auth | Email/password + Google. 18+ + Terms + Privacy at signup. Desk chosen once. |
| P0-7 | Sync | Signed-in journal survives a new browser. Local cache may exist; cloud is source after login. |
| P0-8 | i18n | English source, Croatian, German. |
| P0-9 | Age and law | 18+ gate; FAQ/terms: documentation tool, follow local law. |

### P1 — Coach, reminders, weather, stories

| ID | Job | Acceptance |
|----|-----|------------|
| P1-1 | Reminders | Derived from journal + weather. Dismissable. Confirm drafts a log; does not auto-write. |
| P1-2 | Weather | 3-day city forecast for planning. No GPS unless product reopens it. Key must not live in the client on a rewrite. |
| P1-3 | Grower Coach | Reads journal snapshot. Max 5 proposed actions. Confirm required. No deletes. Advisory only. |
| P1-4 | Photo / illness | Visible facts first, ≤2 hypotheses, no pathogen name without matching signs, never treat from photo alone. |
| P1-5 | Live model gate | Gemini requires verified email. Unverified → local helper. Quotas: chat 60/day, vision 25/day UTC. |
| P1-6 | Adopter Coach | Explains care / stage / unlock. `actions` always empty. |
| P1-7 | Stories | Draft/publish/delete. Public feed and `/g/{slug}` without sign-in. Private journal stays private. |
| P1-8 | Inbox | Care due, mint/sale/faucet outcomes, wallet reconnect explained as session end not theft. |

### P2 — Optional chain (Devnet)

| ID | Job | Acceptance |
|----|-----|------------|
| P2-1 | Opt-in | `chainOptIn` unlocks Tokenise/Market. Journal works without it. |
| P2-2 | Wallet | Phantom/Solflare Devnet. Pubkey set only after server-verified signature. Client may unlink. |
| P2-3 | Seed seal | Requires real `plantId`. Not gated on 14-day coverage. Queue → worker; UI distinguishes queued/fail/success. |
| P2-4 | Growth seal | Journal proof: linked plant, stage log, watering; feeding optional only at germination. |
| P2-5 | List gate | 14 elapsed days + ≥50% care days on watering/feeding `createdAt`. Backdates do not count. Failed coverage hidden from tape. |
| P2-6 | Offers | Instant sale vs adopt-stake (50/50 locked). |
| P2-7 | Public board | Reads scrubbed tape only. |
| P2-8 | Faucet | Adopter-only, test $GROWTOO, no value. |
| P2-9 | Harvest claim | May exist as a pending record. Must not claim physical fulfillment. |
| P2-10 | Copy | No monetary value; on-chain ≠ physical plant; no mainnet date. |

### P3 — Admin (narrow)

| ID | Job | Acceptance |
|----|-----|------------|
| P3-1 | Allowlist | Only `supadmin@dnevnik.live` and `admin@dnevnik.live`. Role field is not enough. |
| P3-2 | Growers | Never see Admin nav. |

---

## 9. Trust, legal, and voice

**Trust model today (say this internally and on `/risks/`):** operator-reviewed journal progress plus coverage math. Not an independent oracle, not IoT, not photo attestation as legal proof. Fabricated logs remain a residual risk.

**Legal posture**

- Documentation tool, not legal / tax / investment / medical advice.
- CBD/cannabis rules vary by jurisdiction. Future physical redemption would need licensing, custody, shipping, KYC/AML where required. That pipeline does not exist.
- Devnet assets are not securities offers and not title to plant material.
- Users 18+ and legally allowed to use grow-related information services where they live.

**Voice**

- Warm, specific, grower-plain. Not a corporate social account. Not a yield pitch.
- Early: small tester group, Devnet, test tokens have no value.
- Coach: practical CBD/hemp peer. Does not replace looking at the plant.

Approved public phrases live in `community-agent/config/product-facts.md`. If a claim is not there, in this spec, or in the feature spec, treat it as unverified.

---

## 10. Scope boundaries

### In scope for the current product

- Web journal (responsive). Free.
- Coach on Gemini with local fallback.
- Optional Solana Devnet proof + market desk for learning the trust flow.
- Public Stories.
- EN / HR / DE.

### Out of scope unless product reopens

- Native App Store / Play builds.
- Installable PWA / service worker.
- Mainnet, real $GROWTOO value, published mainnet date.
- Physical harvest shipping or licensed fulfillment.
- Trustless proof a physical plant exists.
- GPS weather.
- Client-mutable desk (`profileType`).
- Subscription paywall on the journal.
- Using Cursor or any third-party chat as the grower-facing Coach.

### Planned (do not date)

- Stronger attestations so a single operator is not the forever trust point.
- Mainnet pilot after harvest-redemption design is real — milestone in `/rwa-docs/`, not “soon.”
- German live-coach locale (UI is already DE; Gemini today is en/hr).

---

## 11. Open product decisions

A new team should not silently pick these.

1. **May a user ever change Grower ↔ Adopter?** Today: no on the client. Changing it mixes faucet, Invest, and Tokenise.
2. **When does harvest redemption become a real pipeline?** Legal + ops, not a UI toggle.
3. **Does Market stay Devnet-only until attestations harden?** Recommended yes.
4. **Is Stories the public face, or a subset of the private journal?** Today: explicit publish only.
5. **Rank / XP / activity $GROWTOO** — retention game on test assets, or drop on rewrite? Product call.
6. **Admin model** — keep two-email allowlist or replace with a designed role system.

---

## 12. How to use this with the other packets

- Changing **why / who / copy / gates / honesty** → update this spec first, then feature spec, then code.
- Changing **fields, nav, quotas, collection names** → feature spec.
- Changing **stack, Firestore shape, programs** → rebuild packet.
- Shipping **marketing** → `product-facts.md` only.

A rewrite that preserves plant ids, `createdAt` coverage, desk immutability, server-verified wallets, tape-not-listings, and journal-without-wallet has kept the product even if every screen is new.
