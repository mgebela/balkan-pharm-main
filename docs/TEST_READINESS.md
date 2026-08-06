# growtoo / dnevnik — Devnet test readiness

**As of:** 2026-08-06  
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
| **Scalability** | **8** | No hot-wallet settle bottleneck; proxy rate-limited |

---

## What shipped since last readiness pass (Aug 2026)

Product / trust work on the live site and app — desk testers should exercise these paths.

| Area | Change | Why it matters for testing |
|------|--------|----------------------------|
| **Admin** | Panel + Firestore privileges only for `supadmin@dnevnik.live` and `admin@dnevnik.live` | Growers must **not** see Admin nav even if Firestore `role` was wrong |
| **Google sign-in** | `growto.live` / `www.growto.live` authorized in Firebase Auth | Google popup no longer flashes closed as unauthorized domain |
| **Email verify** | Live AI (coach / vision) requires verified email; Account + Coach **Resend** / **I already verified** | Unverified accounts fall back to Local helper — verify before coach photo tests |
| **Adopter intro** | **START HERE**, **How to adopt**, **Adopting on this board** (+ faucet block) hide after first adoption | Onboarded adopters see garden/market board, not explainer chrome |
| **Coach** | Richer journal snapshot (stage timing, weather, toolbox readings); photo attach; clearer live-failure errors | Diagnose should cite visible symptoms + logged numbers when live |
| **Plant camera** | Full in-app camera (preview, shutter, Flip, Gallery); **Log to journal** / **Ask coach** / Retake | Coach control uses a **camera** icon (not `+`); Netlify allows `camera=(self)` |
| **App Check** | Wired in **monitor** mode (not enforcing) | Should not block desk sign-in / coach; watch metrics before enforce |

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
- App Check **enforce** mode — still monitor-only
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
2. From **START HERE**, tap **Tokenise** (and once **Market**).
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
- [ ] **Weekly progress:** grower-only on Tokenise; adopters see **Care unlock** panel with month timeline (Jul qualify · Aug 4/12 · …) + path meters + sync-lag state  
- [ ] **Ranks:** grower rank on Tokenise wallet; plant rank on token cards (both profiles)  
- [ ] **Harvest claim:** journal at harvest + months qualify → Claim on Market; fail path refunds adopter  
- [ ] **Notifications:** header bell shows unread; journal log creates toast + inbox item  
- [ ] **Mark all read** clears badge; click item navigates to related view  
- [ ] **Adopter intro hide:** START HERE / how-to / market guide gone after first adoption  
- [ ] **Coach photo:** Live coach diagnoses a leaf photo (camera icon → Ask coach)  
- [ ] **Camera → journal:** Log to journal creates a photo entry  

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
