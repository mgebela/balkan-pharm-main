# growtoo / dnevnik — Devnet test readiness

**As of:** 2026-07-31  
**Overall:** **9 / 10** — ready for grower + adopter desk testing on [growto.live](https://growto.live)

Hard-refresh the app (`Cmd+Shift+R`) before testing so the latest `chain-config` / scripts load.

---

## Scores

| Area | Score | Notes |
|------|------:|-------|
| **Overall readiness** | **9** | End-to-end Devnet path is usable |
| **Stability** | **9** | Escrow program live; CF health + settle OK; GH queues green |
| **Market buy/settle** | **9.5** | New listings: atomic on-chain; legacy: CF queue |
| **Browser RPC** | **9** | `solanaRpc` proxy → QuickNode (secret server-side) |
| **Scalability** | **8** | No hot-wallet settle bottleneck; proxy rate-limited |

---

## Automated smoke (2026-07-31)

| Check | Result |
|-------|--------|
| `healthCheck` CF | OK |
| `solanaRpc` `getHealth` | OK |
| `settleMarketQueue` / `reconcileMarketEscrow` | OK (idle queues) |
| `chain health-check.js` | 0 critical / 0 warnings; no pending mints or stuck market |
| GH Actions (`chain-queues`, `chain-health`, reconcile) | Recent runs **success** |
| Landing / app / dnevnik / docs / 404 / emails | HTTP 200 |
| Botanical PNGs + brass `$GROWTOO` icon on growto.live | HTTP 200 (post `aecffb7`) |
| Mint authority SOL | **~1.73** |
| Fee payer SOL | **~1.46** |
| `growMint` / `seedCollection` / `escrowProgramId` / `marketplacePda` | On-chain LIVE; app `chain-config` synced |
| App JS syntax (`app.js`, `plant-token`, `market`, escrow, …) | OK |

**Not automated (needs human wallets):** sign-in + link, seed mint in Phantom, list/buy/cancel, **new** adopt-stake list+invest, harvest claim click, notifications UX.

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
| growto.live scripts | `market.js?v=20260731c` (Market harvest claim) · `plant-token.js?v=20260731e` · forest care pills CSS |

**Still needs human wallets:** post a fresh Adopt stake offer → invest → watch settle; abandon a pay to confirm 15m reopen; advance journal to harvest + 12 care days → Claim harvest stake on Market.

---

## Live stack (Devnet)

| Piece | Value |
|-------|--------|
| Cluster | `devnet` |
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
| Reconcile CF | `…/reconcileMarketEscrow` |
| Settle CF | `…/settleMarketQueue` |
| Adopt-stake queue | `npm run adopt:queue` (GH Actions every 5m) |
| Platform bonus queue | `npm run platform:queue` |

### Ops wallet balances (snapshot 2026-07-31)

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
1. Open https://growto.live/app/ (or local app) on **Solana Devnet**.
2. Sign in (Firebase).
3. Connect wallet → link pubkey to user profile.

### 2. Mint path
1. Grower: import / mint a **Seed RWA** (cloud queue).
2. Optionally advance growth stages and confirm `$GROWTOO` rewards mint.
3. Confirm NFT appears in **My garden** / wallet (botanical thumbnail from `growto.live/token-metadata/images/`).

### 3. Market — program path (default for new listings)
1. **List** an owned Seed/Flower RWA at a `$GROWTOO` price.
   - Expect Firestore `status: active`, `settlement: program` immediately (no `escrow_pending`).
2. **Invest** from a second (adopter) wallet with enough `$GROWTOO`.
   - Expect NFT + payment in **one** tx; listing `sold` (no `sale_pending`).
3. **Cancel** an open program listing as seller.
   - Expect NFT returned; listing `cancelled`.

### 4. Market — legacy path (regression)
1. Any remaining hot-wallet listings (`settlement` unset / `legacy`, or `escrow_pending` / `sale_pending`) should still move via CF reconcile + settle.
2. Confirm `settleMarketQueue` / schedule still processes them.

### 5. RPC / smoke checks

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
- Early broken metadata reminted (2026-07-31): CBD Auto #1–#3 + Charlotte's Web #1 → new mints with healthy metadata + growto.live botanical images. Old mints kept as `replacedMint` in `mints.devnet.json`. Re-run: `cd chain && npm run repair:seed-metadata -- --execute`
- All `mints.devnet.json` seeds now use growto.live botanical images (Irys image hosts cleared). Gold Bloom #1 → `plant-flowering.png`. Refresh: `npm run update:seed-art`
- If a wallet call fails with `RPC method not allowed`, check Cloud Function logs (`solanaRpc denied method …`) and extend the proxy allow/deny rules in `functions/solana-rpc-proxy.js`
- Soil moisture sync: sensor `http://164.92.208.95/latest.json` often times out; workflow soft-warns and keeps the previous `latest.json` (schedule every 15m)

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

### Manual (human wallets)
- [ ] Wallet connect + Firebase link works on Devnet  
- [ ] Seed mint lands in wallet via queue  
- [ ] New listing goes `active` with `settlement: program`  
- [ ] Buy completes atomically (NFT + `$GROWTOO`, status `sold`)  
- [ ] Cancel returns NFT  
- [ ] Browser confirmations do not flake on public RPC (proxy preferred)  
- [ ] **Adopt stake (fresh):** post “Adopt stake” → adopter pays full price → settle 50/50 (existing stakes already prove settle path)  
- [ ] **Adopt reservation TTL (live):** abandon unpaid `pending-*` and confirm reopen ~15m  
- [ ] **Monthly care (UI):** log ≥12 distinct care days; Market / adopter garden show live counters  
- [ ] **Weekly progress:** grower-only on Tokenise; adopters see monthly unlock status only  
- [ ] **Ranks:** grower rank on Tokenise wallet; plant rank on token cards (both profiles)  
- [ ] **Harvest claim:** journal at harvest + months qualify → Claim on Market; fail path refunds adopter  
- [ ] **Notifications:** header bell shows unread; journal log creates toast + inbox item  
- [ ] **Mark all read** clears badge; click item navigates to related view  

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
