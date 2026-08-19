# growtoo / dnevnik — Devnet test readiness

**As of:** 2026-08-13  
**Overall:** **9 / 10** — ready for grower + adopter desk testing on [growto.live](https://growto.live)

Hard-refresh the app (`Cmd+Shift+R`) before testing so the latest scripts / CSS / `Permissions-Policy` load.

---

## Scores

| Area | Score | Notes |
|------|------:|-------|
| **Overall readiness** | **9** | End-to-end Devnet path + grower coach / camera usable |
| **Stability** | **9** | Escrow program live; CF health + settle OK; GH queues green |
| **Market buy/settle** | **9.5** | New listings: atomic on-chain; legacy: CF queue |
| **Browser RPC** | **9** | `solanaRpc` proxy → QuickNode (secret server-side) |
| **Grower coach / camera** | **8.5** | Live multimodal coach + in-app camera; needs verified email |
| **Auth / admin gate** | **9** | Google domain allowlist; Admin only for two emails |
| **UX** | **8** | Honest failure paths throughout; nav collapsed 2026-08-13 and not yet desk-tested |
| **UI** | **8.5** | Strong token discipline; trust gates are the one unthemed surface |
| **Scalability** | **8** | No hot-wallet settle bottleneck; proxy rate-limited per instance |

### What the UX and UI scores are counting

These two were scored for the first time on 2026-08-13, against the code rather
than against impressions, so the evidence is written down here and can be
re-measured next pass.

**UI — 8.5.** In favour: `app/styles/app.css` resolves **1926** `var(--…)`
references against only **8** raw hex literals, so the whole app repaints from
the **229** tokens in `styles/tokens.css`; light theme is one
`:root[data-theme='light']` block, not a second stylesheet. Accessibility
hygiene is real and not decorative — 47 `aria-label`, 33 `role`, 5 `aria-modal`,
23 `:focus-visible` rules, 45 `min-height` tap-target rules, 9
`prefers-reduced-motion` blocks, and 2/2 `<img>` tags carry `alt` (icons are
inline SVG marked `aria-hidden`). Against: **`styles/trust-gates.css` never got
the light theme** — 144 lines, 21 hardcoded colours, zero tokens, zero
`data-theme` rules, and zero `prefers-reduced-motion`. It is loaded on all three
entry points, so in light mode the age gate and cookie banner stay dark over a
light page. That is the first screen a new visitor sees, which is why it costs a
full point and a half on its own.

**UX — 8.** In favour: the app consistently tells the truth when something
fails. Chain-locked growers get the **Unlock Tokenise & Market?** dialog instead
of a dead click; mint toasts distinguish *queued* from *failed* and never claim
success the queue refused; the coach separates `email_unverified`,
expired-token, and `quota_exceeded` into distinct copy and labels replies
**Live coach** vs **Local helper**; the camera separates
`NotAllowedError`/`PermissionDeniedError` from `NotFoundError`; destructive
actions use an in-app confirm sheet rather than `window.confirm`; in-flight
transactions get a persistent status rail. Against: the primary nav collapsed to
Journal / Log / Coach / Tokenise (grower) · Market (adopter) and **no desk
pass has run against it**. Growers now land on Tokenise from the 4th tab;
Market is the other segment on that same screen. Whether a first-time grower
then finds listing unaided is still a human question — that unknown is the
whole deduction. `view-dashboard` and `view-danas` also remain in the DOM but
are unreachable (`showView` redirects both to `plants`).

---

## What shipped since last readiness pass (Aug 2026)

Product / trust work on the live site and app — desk testers should exercise these paths.

| Area | Change | Why it matters for testing |
|------|--------|----------------------------|
| **Admin** | Panel + Firestore privileges only for `supadmin@dnevnik.live` and `admin@dnevnik.live` | Growers must **not** see Admin nav even if Firestore `role` was wrong |
| **Google sign-in** | `growto.live` / `www.growto.live` authorized in Firebase Auth | Google popup no longer flashes closed as unauthorized domain |
| **Email verify** | Live AI (coach / vision) requires verified email; Account + Coach **Resend** / **I already verified** | Unverified accounts fall back to Local helper — verify before coach photo tests |
| **Adopter intro** | **START HERE**, **How to adopt**, **Adopting on this board** (+ faucet block) hide after first adoption | Onboarded adopters see garden/market board, not explainer chrome |
| **One intro layer (2026-08-19)** | Welcome / **While you were away** OR **START HERE** per session — never stacked with Tokenise / garden explainers | After ≥30m away: sheet only. Under 30m and not onboarded: START HERE only |
| **Coach** | Richer journal snapshot (stage timing, weather, toolbox readings); photo attach; clearer live-failure errors | Diagnose should cite visible symptoms + logged numbers when live |
| **Plant camera** | Full in-app camera (preview, shutter, Flip, Gallery); **Log to journal** / **Ask coach** / Retake | Coach control uses a **camera** icon (not `+`); Netlify allows `camera=(self)` |
| **App Check** | Site key live (`20260819c`); **monitor mode** — tokens are sent, nothing is rejected | Watch App Check → Metrics for a few days. Do **not** set `APP_CHECK_ENFORCE` yet — see [app-check-rollout.md](app-check-rollout.md) |
| **Nav (2026-08-13, labels 2026-08-19)** | Primary nav is **Journal · Log · Coach · Tokenise** for growers (4th tab opens the Tokenise pane; Market is the other segment). Adopters see **Market** on that same slot | Any older step that says "tap Market, then Tokenise" or "the Today tab" is stale — see [Nav map](#nav-map-2026-08-13) below |
| **Market privacy (2026-08-19)** | In-app board reads `marketPublicTape` (on-chain pubkeys only). Full `marketListings` docs are owner/buyer (list) or active (get). Header chip shows **Watch-only** when the session cannot sign | **Ship JS first, then Firestore rules.** Watch-only Invest is disabled. Confirm a second signed-in user cannot list other people's sold history |
| **Appearance (2026-08-13, default 2026-08-19)** | Light / dark / auto via Profile → Appearance, stored at `growtoo:appearance`. **Light is the product default** (same sage paper as landing). Dark stays an explicit choice | **Untested.** Existing `dark` in localStorage is preserved |
| **Stories + public journal** | Grower blogs in-app; public grower journal served on `journal.growto.live` | **Untested.** Public surface — check what it exposes for a signed-out visitor |
| **Journal month view** | Month is the Journal landing (List stays if they picked it). Empty trail: one Coach-style next step — **Add a plant** or **Log first watering** | **Untested.** First-run grower should not see a mute calendar |

---

## Nav map (2026-08-13)

Commit `7443748` collapsed the app so the bar can be worked with a thumb. Steps
written before that date may name tabs that no longer exist.

| Was | Is now |
|-----|--------|
| Journal tab (`dashboard`) | **Journal** — merged with Plants; `dashboard` and `danas` both redirect to `plants` |
| Plants tab | folded into **Journal** |
| Today tab | gone from the bar; its Today card lives on Journal |
| Tokenise tab | **4th tab for growers** (label Tokenise / Tokeniziraj / Tokenisieren). First tap opens the Tokenise pane (`adopt`). Market is the other segment on that screen |
| Market tab | **4th tab for adopters**; growers switch to it with the Tokenise / Market control |
| Tools | renamed **Measurements**, moved into the More menu |
| Log · Coach | unchanged in place |

Deep links still work: `?view=dashboard` and `?view=danas` resolve to Journal.
The chain-unlock dialog still fires from any Tokenise/Market entry point, so
test A below is unaffected apart from how you reach it.

---

## Automated smoke (baseline 2026-07-31 · product layer 2026-08-06)

| Check | Result |
|-------|--------|
| `healthCheck` CF | OK (re-check before a desk day) |
| `solanaRpc` `getHealth` | OK |
| `settleMarketQueue` / `reconcileMarketEscrow` | OK (idle queues) |
| `coachChat` CF | Deployed (multimodal image + context); needs Bearer + verified email |
| GH Actions (`chain-queues`, `chain-health`, reconcile) | Expect **success** on main |
| Landing / app / dnevnik / docs / 404 / emails / pitch | HTTP 200 |
| Botanical PNGs + brass `$GROWTOO` icon on growto.live | HTTP 200 |
| App JS syntax (`app.js`, `ai-coach`, `grow-camera`, `plant-token`, `market`, …) | OK |
| Firebase authorized domains include `growto.live` | Set 2026-08-04 |

**Not automated (needs human wallets / verified accounts):** sign-in + link, seed mint in Phantom, list/buy/cancel, adopt-stake, harvest claim, coach photo diagnosis, in-app camera permissions.

### Adopt-stake desk (2026-07-31 evening)

Ops audit of the two live sold stakes + queue (no new Phantom list/invest this pass).

| Check | Result |
|-------|--------|
| Live `adopt_stake` listings | **2** · both `sold` / `careStatus: active` |
| Locked `$GROWTOO` (legacy shared vault) | **15** on NFT escrow `EmQ4…` (= 5 Gold Bloom + 10 The BUD) until those stakes harvest |
| Dedicated care escrow (new listings) | `C69K4V4921m1jYxjBoBoMYJR2fxYQpnx1w45gNGsL4ZU` · GH secret `SOLANA_CARE_ESCROW_KEY_JSON` set |
| NFT with adopter wallet | **yes** (both mints) |
| Care progress sync (GH `adopt:queue`) | **OK** — writes `careMonthKeys`, `currentMonthDaysHit`, `careProgressUpdatedAt` |
| Live stage sync on sold stakes | **OK** — writes `liveStage` / `liveStageKey` / `harvestReady` / `journalStage` from grower journal |
| Local `npm run adopt:queue` | **OK** — both stakes “up to date” |
| Monthly proof (live data) | Gold Bloom **0/12** days (external plant missing in journal) · The BUD **1/12** |
| Harvest claim docs | **0** pending (none filed yet) |
| Unpaid `pending-*` reservations | **none** (TTL dry-run: 5m keep / 20m reopen) |
| Grower inbox for these listings | **2 notify docs each** (`stake_received` path) |

**Still needs human wallets:** post a fresh Adopt stake offer → invest → watch settle; abandon a pay to confirm 15m reopen; advance journal to harvest + 12 care days → Claim harvest stake on Market.

---

## Live stack (Devnet)

| Piece | Value |
|-------|--------|
| Cluster | `devnet` |
| Site | `https://growto.live` |
| `$GROWTOO` mint | `3nReF8GGLdbPc4bmrgWyproVwt9taHb1yGvL5Cekrcqp` |
| Seed collection | `79yYy4aSRzJQq9xonvcaTw7DgndoqwPMYDd2MpT8iVZa` |
| Escrow program | `GspPo6doBKoYmD6aCFHgo2q3CEXmWEoZXPpXAJnkjdyb` |
| Marketplace PDA | `2a887xGdhztkvfHn1BdR5xSkXjunzTG1StdTdtrRddAm` |
| Settlement mode | `program` (instant) · `adopt_stake` (50/50 care escrow) |
| Hot-wallet escrow (listed NFTs) | `EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD` |
| Care escrow (adopt-stake locked `$GROWTOO`) | `C69K4V4921m1jYxjBoBoMYJR2fxYQpnx1w45gNGsL4ZU` |
| Legacy locked stakes (pre-split) | still on NFT escrow until harvest; per-listing `careEscrowAddress` |
| Mint authority | `F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3` |
| Fee payer | `Et1uJZn2GAWFdnKaVTubZYohKNJNB7gEpoQ7EHHKq975` |
| Browser RPC | `https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc` |
| Coach chat | `https://coachchat-zwul5y4amq-ew.a.run.app` |
| Reconcile CF | `…/reconcileMarketEscrow` |
| Settle CF | `…/settleMarketQueue` |
| Adopt-stake queue | `npm run adopt:queue` (GH Actions every 5m) |
| Platform bonus queue | `npm run platform:queue` |
| Admin allowlist | `supadmin@dnevnik.live`, `admin@dnevnik.live` only |

### Ops wallet balances (snapshot 2026-07-31 — re-check before desk)

| Role | Balance | Purpose |
|------|--------:|---------|
| Mint authority | ~1.73 SOL | Seed / growth mint queue |
| Fee payer | ~1.46 SOL | Legacy market settle fees |
| Escrow vault | holds NFTs | OK — not a SOL hotspot |

Top up when low:

```bash
cd chain
npm run pow:fund:mint   # authority → ~2 SOL
npm run pow:fund:fee    # fee-payer → ~1.5 SOL
```

---

## Test plan

### 1. Wallet + auth
1. Open https://growto.live/app/ (or `/dnevnik/`) on **Solana Devnet**.
2. Sign in (Firebase) — email/password **or** Google (popup must stay open on `growto.live`).
3. Email/password: verify inbox (and Spam) for **Verify your email · growtoo** before live coach tests; use Account / Coach **Resend** if needed.
4. Confirm grower accounts do **not** show Admin (unless allowlisted admin email).
5. Connect wallet → link pubkey to user profile.

### 2. Mint path
1. Grower: import / mint a **Seed RWA** (cloud queue).
2. Optionally advance growth stages and confirm `$GROWTOO` rewards mint.
3. Confirm NFT appears in **My garden** / wallet (botanical thumbnail from `growto.live/token-metadata/images/`).

### 3. Market — program path (default for Instant sale)
1. **List** an owned Seed/Flower RWA at a `$GROWTOO` price (Instant sale radio).
   - Expect Firestore `status: active`, `settlement: program` immediately (no `escrow_pending`).
   - Gate: program whenever `escrowProgramId` is set, unless `settlementMode: 'legacy'` or Adopt stake.
2. **Invest** from a second (adopter) wallet with enough `$GROWTOO`.
   - Expect NFT + payment in **one** tx; listing `sold` (no `sale_pending`).
3. **Cancel** an open program listing as seller.
   - Expect NFT returned; listing `cancelled`.

### 4. Market — legacy path (regression)
1. Any remaining hot-wallet listings (`settlement` unset / `legacy`, or `escrow_pending` / `sale_pending`) should still move via CF reconcile + settle.
2. Confirm `settleMarketQueue` / schedule still processes them.

### 5. Adopter onboarding chrome
1. Fresh adopter (no adopted plants): expect **START HERE** strip + My garden **How to adopt** + Market **Adopting on this board** (with faucet).
2. After wallet connect **and** at least one adopted plant: those intro blocks **hidden**; garden/summary + market grid remain.
3. Faucet: one claim per UTC day (cap enforced).

### 6. Coach + plant camera
1. Verified grower → **Coach** tab → camera icon opens full in-app camera (allow camera permission).
2. Capture → **Ask coach** → expect **Live coach** (not Local helper) with photo-based advice.
3. Capture → **Log to journal** → general photo entry on focus / selected plant.
4. Journal entry modal → **Take photo** fills the entry preview.
5. If live coach fails: bubble shows a **specific** reason (verify email / network / model) — not only “I can create plants…”.

### 7. RPC / smoke checks

```bash
curl -sS https://europe-west1-balpha-9dab9.cloudfunctions.net/healthCheck
curl -sS -X POST https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":[]}'
```

On-chain smoke (ops machine with keys):

```bash
cd chain
node smoke-escrow-program.js --mode cancel --mint <NFT_MINT> --price 1
# buy path needs a funded buyer keypair with $GROWTOO
```

---

## Known gaps / out of scope

- Mainnet, marketplace fees > 0, royalties, offers/bidding
- Migrating old hot-wallet listings into PDAs (cancel + relist instead)
- Removing CF settle entirely (still required for legacy)
- Physical harvest redemption — **coming later** (Devnet UX states this clearly; practice path ends at care unlock + Claim locked stake `$GROWTOO`)
- Native App Store / Play wrappers (Capacitor) — web is mobile-ready; not packaged as store apps yet
- App Check — **monitor mode.** Site key is live; clients send tokens. Do not
  set `APP_CHECK_ENFORCE=true` until App Check → Metrics shows almost no
  `appcheck_missing` / `appcheck_invalid` (a few days of real traffic)
- `solanaRpc` has **no user auth** — until App Check is *enforced* it is still
  an open relay to a
  paid RPC provider, throttled only by a per-instance in-memory Map (~180/min/IP
  *per instance*, so the real ceiling scales with instance count)
- `solanaRpc` upstream `fetch` has **no `AbortSignal`** — a hung provider pins the
  instance until the platform timeout
- `solanaRpc` falls back to `api.devnet.solana.com` silently when `SOLANA_RPC_URL`
  is unset — the exact public-RPC flakiness the proxy exists to avoid, with no
  alarm. Confirm the env var is set before trusting "→ QuickNode"
- Light theme misses `styles/trust-gates.css` (age gate + cookie banner) — 21
  hardcoded colours, no tokens; loaded on landing, sign-in, and app
- `view-dashboard` and `view-danas` are dead markup — no nav reaches them and
  `showView` redirects both to `plants`
- Live coach needs **verified email**; Local helper cannot analyze photos
- Coach photos are not auto-saved into journal unless the user taps **Log to journal** (or saves from the entry modal)
- Market / Tokenise use an in-app confirm sheet (invest, claim, cancel, burn) instead of `window.confirm`; empty boards point to one next-step CTA
- In-flight txs show a persistent status rail (Queued → confirmed): invest settle, listing escrow/cancel, mint queue, harvest claim queue
- After sign-in: role **Start here** strip + idle-game **Daily status** popup for grower **and** adopter (hidden for adopters who already adopted)
- Adopter **spotlight tour** (faucet → market → garden) after daily status / first role visit; **Replay tour** in Profile
- Adopter Market / garden cards keep mint · PDA · batch behind **Chain details** (collapsed unless Advanced view)
- Early broken metadata reminted (2026-07-31): CBD Auto #1–#3 + Charlotte's Web #1 → new mints with healthy metadata + growto.live botanical images. Old mints kept as `replacedMint` in `mints.devnet.json`. Re-run: `cd chain && npm run repair:seed-metadata -- --execute`
- Tokenise shows a **Replaces stub mint** / **Broken metadata stub** hint on reminted cards so desk wallets don’t confuse Phantom’s leftover empty Collectibles
- All `mints.devnet.json` seeds now use growto.live botanical images (Irys image hosts cleared). Gold Bloom #1 → `plant-flowering.png`. Refresh: `npm run update:seed-art`
- If a wallet call fails with `RPC method not allowed`, check Cloud Function logs (`solanaRpc denied method …`) and extend the proxy allow/deny rules in `functions/solana-rpc-proxy.js`
- Soil moisture sync: sensor `http://164.92.208.95/latest.json` often times out; workflow soft-warns and keeps the previous `latest.json` (schedule every 15m)

---

## Post-reliability desk script (2026-08-02)

Hard-refresh (`Cmd+Shift+R`) so `app.js` / `plant-token.js` / CSS cache-bust loads. Confirm Advanced/Simple is one global (`localStorage` key `growtoo-crypto-mode`) — toggling on Market, Tokenise, or Profile updates all three.

### A. Chain unlock (no silent CTA)
1. Grower account **without** `chainOptIn` (clear `dnevnik-live-chain-opt-in` or use a fresh grower).
2. From **START HERE**, tap **Tokenise** (4th tab, or the START HERE Tokenise chip — see [Nav map](#nav-map-2026-08-13)).
3. Expect the **Unlock Tokenise & Market?** dialog — not a dead click / silent stay on Plants.
4. Confirm **Unlock** → lands on Tokenise; **Not now** → stays put.

### B. Seal / mint (honest outcome)
1. Unlock → connect Phantom or Solflare on **Devnet** → link wallet.
2. Plant with care logs that unlock the next seal → **Seal stage**.
3. Expect toast that matches reality:
   - **queued** → “Mint queued on Devnet…”
   - **failed** → warn that garden saved but mint did not queue + use **Retry mint**
   - never an unqualified success when the queue rejected
4. Card reaches **Minted on devnet** (or Retry succeeds).

### C. Market Instant sale (two wallets)
1. Grower: Market → Instant sale → list sealed NFT.
2. Adopter: enough test `$GROWTOO` → **Invest** → listing `sold`.
3. NFT + payment settle (program path).

### D. Journal photo round-trip
1. Journal / plant → **New entry** → attach a **JPG** (not HEIC) **or** **Take photo**.
2. Preview appears → save → entry shows in **Recent notes** / Journal list / plant timeline.
3. Unsupported video MIME shows a visible **media-error** (no silent clear).

### E. Auth + Admin (2026-08)
1. Sign in with Google on `https://growto.live/dnevnik/` — complete account picker (no instant close).
2. Ordinary grower: no Admin item in nav / more menu.
3. Only allowlisted admin emails reach `/app/admin-*.html`.

### F. Coach camera (2026-08)
1. Verified email → Coach → camera icon → shutter → **Ask coach**.
2. Expect **Live coach** reply that references the photo (and journal context when present).
3. Same capture → **Log to journal** → plant timeline shows photo entry.

### G. Nav collapse (2026-08-13) + Tokenise-first grower tab (2026-08-19) — first desk pass

The bar changed on 13 Aug; the 4th-tab label/fallback flipped on 19 Aug. Nothing
below has been exercised by a human yet. Test on a phone, not a desktop window
— the point of the change was thumb reach.

1. Grower signs in → lands on **Journal** (not Today, not Plants).
2. Bar shows exactly **Journal · Log · Coach · Tokenise**. Tools is not in the bar.
3. First tap on the 4th tab opens **Tokenise** (not the Market board). The
   Tokenise / Market segment switches panes without a full view reload; the
   4th tab stays highlighted for both panes.
4. Switch to Market, go to Journal, tap **Tokenise** again → returns to Market
   (last pane), not always Tokenise.
5. Adopter bar shows **Market** on that same slot; first tap opens the board.
6. More menu → **Measurements** opens the old Tools view.
7. Old deep links `?view=dashboard` and `?view=danas` land on Journal.
8. **Discoverability check (the real question):** hand the phone to someone who
   has not seen the app and ask them to list a plant for sale. Note whether they
   open Tokenise, seal, then find Market on the same screen — and how long it takes.

### H. Appearance / light theme (2026-08-13, default 2026-08-19)

1. First visit with no `growtoo:appearance` key: sage paper, same as landing.
   Profile → Appearance shows **Light** selected. Dark remains an explicit choice.
2. If `localStorage` already has `dark`, the app stays dark (do not overwrite).
3. Hard-refresh. Theme survives before Firebase resolves (painted pre-paint from `<head>`).
4. Set **Auto** → theme tracks the OS. Light and Dark ignore the OS by design.
5. Age gate and cookie banner use paper tokens (`7e3f21b`). Confirm they follow
   light / dark with the rest of the app.

### I. Stories + public journal (2026-08-13)

`journal.growto.live` is a **public** surface — treat this as a privacy check,
not just a rendering one.

1. Grower → Journal → Stories write CTA → publish a post.
2. Open `https://journal.growto.live/` **signed out, in a private window**.
3. Confirm the published post renders and the grower profile resolves.
4. Confirm nothing unpublished leaks: private journal entries, plant counts,
   wallet addresses, email, or any other grower not opted in.
5. Unpublish → confirm the public page stops serving it.

### J. Journal month view (2026-08-13, empty trail 2026-08-19)

Month is the Journal landing (List only if they already picked it).

1. New grower, no `dnevnik-live-journal-view` key: Journal opens on **Month**.
2. Empty trail, no plants: strip under the month title — **Add a plant**.
3. Empty trail, plant with no watering: same strip, Coach headline
   (“…waiting for a first watering”) + **Log first watering**. Opens the log
   sheet for today (confirm, do not auto-write).
4. Once any log exists, the strip goes away; day panel **Log this day** returns.
5. Days with care logs are marked; Coach due dates appear on their days.
6. Add a log via **Log** → the month view reflects it without a manual refresh.

### K. Market privacy + watch-only (2026-08-19)

**Ship `market.js` / `plant-token.js` to Netlify before deploying the new
`marketListings` Firestore rules.** Old clients still scan the full listing
collection; the new `allow list` will break that query.

1. Signed-in adopter on Market: board still shows active offers (from the
   public tape). Cards do not show another grower's Firebase uid, journal
   notes, or photos.
2. After invest, the buyer still sees their own sold/pending rows (buyer
   query). A *different* signed-in account must not see that sold history.
3. Paste-address (watch-only) session: header compact chip shows **Watch-only**.
   Invest is a disabled ghost button, not a signing prompt.
4. Phantom / Solflare session: Invest still works; hydrate of an active
   listing at click time still reaches `sellerPubkey`.
5. Grower's own asks (including cancelled) still appear — they come from
   `where uid == me`, not the public tape.

---

## Pass criteria (desk session)

### Automated / ops (2026-07-31)
- [x] Browser RPC proxy healthy (`getHealth` ok)
- [x] Authority / fee-payer funded for queue + legacy settle (~1.73 / ~1.46 SOL)
- [x] Mint / grow / market queues idle and GH Actions succeeding
- [x] Botanical + brass token images served from growto.live
- [x] **Adopt-stake settle (existing):** 2 sold stakes · NFTs with buyer · 15 `$GROWTOO` locked in escrow
- [x] **Care progress sync:** GH + local adopt queue writing month / day counters
- [x] **Monthly unlock rule (proof):** rejects &lt;12 care days; BUD 1/12 · Gold Bloom 1/12 (journal plant linked 2026-07-31)
- [x] **Stake notify (store):** grower notification docs present for both listing IDs
- [x] **Reservation TTL logic:** dry-run reopen after 15m (no live unpaid reservation to expire)
- [x] **Auth domains:** `growto.live` authorized for Google sign-in (2026-08-04)
- [x] **Admin allowlist** + Firestore rules deployed (2026-08)
- [x] **coachChat** multimodal deploy (2026-08)

### Manual (human wallets / accounts)
- [ ] Wallet connect + Firebase link works on Devnet  
- [ ] Google sign-in completes on growto.live  
- [ ] Email verify unlocks live coach (Resend works)  
- [ ] Grower does not see Admin  
- [ ] Seed mint lands in wallet via queue  
- [ ] New listing goes `active` with `settlement: program`  
- [ ] Buy completes atomically (NFT + `$GROWTOO`, status `sold`)  
- [ ] Cancel returns NFT  
- [ ] Browser confirmations do not flake on public RPC (proxy preferred)  
- [ ] **Adopt stake (fresh):** post “Adopt stake” → adopter pays full price → settle 50/50 (existing stakes already prove settle path)  
- [ ] **Adopt reservation TTL (live):** abandon unpaid `pending-*` and confirm reopen ~15m  
- [ ] **Monthly care (UI):** log ≥12 distinct care days; Market / adopter garden show live counters  
- [ ] **Weekly progress:** grower-only on the Tokenise pane (4th tab → Tokenise); adopters see **Care unlock** panel with month timeline (Jul qualify · Aug 4/12 · …) + path meters + sync-lag state  
- [ ] **Ranks:** grower rank on the Tokenise pane wallet; plant rank on token cards (both profiles)  
- [ ] **Harvest claim:** journal at harvest + months qualify → Claim on Market; fail path refunds adopter  
- [ ] **Notifications:** header bell shows unread; journal log creates toast + inbox item  
- [ ] **Mark all read** clears badge; click item navigates to related view  
- [ ] **Adopter intro hide:** START HERE / how-to / market guide gone after first adoption  
- [ ] **Coach photo:** Live coach diagnoses a leaf photo (camera icon → Ask coach)  
- [ ] **Camera → journal:** Log to journal creates a photo entry  

### Manual — new since 2026-08-06 (never desk-tested)

- [ ] **Nav collapse:** grower bar is Journal · Log · Coach · Tokenise on a phone; Market is the other segment on that screen  
- [ ] **Nav memory:** returning to the 4th tab restores the last pane (Tokenise vs Market)  
- [ ] **Nav deep links:** `?view=dashboard` / `?view=danas` land on Journal  
- [ ] **Nav discoverability:** a first-time grower finds Tokenise from the bar, then Market on the same screen, unaided  
- [ ] **Appearance:** light / dark / auto persists across refresh and across devices  
- [ ] **Appearance gap:** age gate + cookie banner follow the light theme *(painted in `7e3f21b` — confirm on a phone)*  
- [ ] **Stories:** publish → post renders on `journal.growto.live` signed out  
- [ ] **Public journal privacy:** no private entries, wallets, emails, or opted-out growers exposed  
- [ ] **Market tape:** board loads from public tape; no other user's uid / journal / photo on cards  
- [ ] **Market list rules:** another signed-in account cannot see sold/cancelled history they are not party to  
- [ ] **Watch-only chip:** paste-address session shows Watch-only on the header chip; Invest is disabled  
- [ ] **Journal month view:** logs and Coach due dates land on the right days; empty months degrade cleanly  
- [ ] **Journal month view:** a new log appears without a manual refresh    

---

## Notifications (quick reference)

| Event | Who sees it |
|-------|-------------|
| Journal / care log | Grower (toast + inbox) |
| Weekly / monthly care qualifies | Grower (deduped per period) |
| Someone invests / adopt-stakes | Grower inbox (`stake_received`) |
| Seed / growth mint settled | Grower |
| Harvest / platform bonus | Grower (+ adopter on stake settle) |

| Piece | Rule |
|-------|------|
| Adopter payment | Full `priceGrow` to care escrow up front |
| Immediate | 50% `$GROWTOO` → grower on settle |
| Locked | 50% held until harvest claim |
| Month qualify | ≥12 distinct days with plant-linked journal/toolbox logs |
| Harvest | All-or-nothing across every calendar month from adopt → claim |
| Visibility | Weekly progress = grower only · Monthly unlock = grower + adopter |
| Plant rank | Stage + qualifying care months + care intensity (Sprout→Legendary) |
| Grower rank | XP + care months + mints (New→Elite cultivator) |
| Platform bonus | Separate mint: base 5 + 2/plant + 5/seed + 3/week + 10 flower (cap 50) |
| Live coach | Verified email + daily quota; photos via in-app camera / attach |

---

## Synthetic traffic agents (UX load)

Admin-SDK harness under [`chain/traffic/`](../chain/traffic/) seeds **3 growers** + **15 adopters** so you can exercise dense adopter gardens and a populated market board **without** minting thousands of Devnet NFTs.

| Persona | Scale (display) | Journal model | Market |
|---------|-----------------|---------------|--------|
| `traffic+grower-s@growto.live` | **Luka · Zagreb** — 5 named closet plants | Honest short English logs (radiator dry air, under-watering) | ~40% listed |
| `traffic+grower-m@growto.live` | **Ivan · Zadar County** — tent near Poličnik (~600) | English logs; humidity / Adriatic air / blunt delays | ~40% listed |
| `traffic+grower-l@growto.live` | **Marko · Osijek / Baranja** — ~10k / 5 ha | English field daybook; weather, irrigation, soil | ~40% listed |
| 15 adopters (`…-c*`, `…-a*`, `…-s*`) | 1 → ~25 plants | Garden hydrates from sold listings | Casual → serious |

Listings are **sim** (`settlement: adopt_stake`, `mintAddress` prefixed `TrafficMint_`, `trafficBatch: ux-2026-08`). Care progress and live stage update from grower journal entries; they are **not** real on-chain escrows.

**Journal skill growth:** each grower’s care notes start simple and gain measurements / next-step plans over the 21-day history (`journalSkill` 1→up to start+2). `traffic:day` keeps adding XP toward that cap.

**Coach adaptation:** live `coachChat` reads `journalSkill`, `coachAdaptation`, and adopter portfolio needs from the client snapshot (deploy `functions` for `coach-system.js`). Grower coach teaches journaling at their level; adopter coach is read-only advice on care unlock / log quality.

### Commands

From repo root (needs [`chain/keys/firebase-service-account.json`](../chain/keys/) via `npm run firebase:setup --prefix chain`):

```bash
npm run traffic:seed   # create/overwrite batch + write chain/keys/traffic-agents.json
npm run traffic:day    # append today's care + bump sold listing care counters
npm run traffic:wipe   # delete only trafficAgent / trafficBatch docs + Auth users
```

Password for all agents is in the gitignored creds file after seed.

### Desk checks

1. Sign in as `traffic+adopter-s1@growto.live` (email/password) → open **Garden** / **Market**.
2. Expect many adopted cards; care month counters / live stage present on sold stakes.
3. Board still shows **active** traffic listings from micro / tent / field growers.
4. Re-run `traffic:day` → `currentMonthDaysHit` and latest journal dates move forward.
5. `traffic:wipe` removes the batch without touching real desk accounts.
