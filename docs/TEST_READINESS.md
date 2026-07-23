# growtoo / dnevnik — Devnet test readiness

**As of:** 2026-07-23  
**Overall:** **9 / 10** — ready for grower + adopter desk testing on [dnevnik.live](https://dnevnik.live)

Hard-refresh the app (`Cmd+Shift+R`) before testing so the latest `chain-config` / scripts load.

---

## Scores

| Area | Score | Notes |
|------|------:|-------|
| **Overall readiness** | **9** | End-to-end Devnet path is usable |
| **Stability** | **9** | Escrow program live; CF health + settle OK |
| **Market buy/settle** | **9.5** | New listings: atomic on-chain; legacy: CF queue |
| **Browser RPC** | **9** | `solanaRpc` proxy → QuickNode (secret server-side) |
| **Scalability** | **8** | No hot-wallet settle bottleneck; proxy rate-limited |

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
| Hot-wallet escrow (legacy / adopt_stake NFT + locked $GROWTOO) | `EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD` |
| Care escrow | same as hot-wallet escrow (Devnet MVP) |
| Mint authority | `F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3` |
| Fee payer | `Et1uJZn2GAWFdnKaVTubZYohKNJNB7gEpoQ7EHHKq975` |
| Browser RPC | `https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc` |
| Reconcile CF | `…/reconcileMarketEscrow` |
| Settle CF | `…/settleMarketQueue` |
| Adopt-stake queue | `npm run adopt:queue` (GH Actions every 5m) |
| Platform bonus queue | `npm run platform:queue` |

### Ops wallet balances (snapshot 2026-07-23)

| Role | Balance | Purpose |
|------|--------:|---------|
| Mint authority | ~1.95 SOL | Seed / growth mint queue |
| Fee payer | ~1.47 SOL | Legacy market settle fees |
| Escrow vault | 0 SOL | OK — holds NFTs only |

Top up when low:

```bash
cd chain
npm run pow:fund:mint   # authority → ~2 SOL
npm run pow:fund:fee    # fee-payer → ~1.5 SOL
```

---

## Test plan

### 1. Wallet + auth
1. Open https://dnevnik.live/app/ (or local app) on **Solana Devnet**.
2. Sign in (Firebase).
3. Connect wallet → link pubkey to user profile.

### 2. Mint path
1. Grower: import / mint a **Seed RWA** (cloud queue).
2. Optionally advance growth stages and confirm `$GROWTOO` rewards mint.
3. Confirm NFT appears in **My garden** / wallet.

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
- If a wallet call fails with `RPC method not allowed`, check Cloud Function logs (`solanaRpc denied method …`) and extend the proxy allow/deny rules in `functions/solana-rpc-proxy.js`

---

## Pass criteria (desk session)

- [ ] Wallet connect + Firebase link works on Devnet  
- [ ] Seed mint lands in wallet via queue  
- [ ] New listing goes `active` with `settlement: program`  
- [ ] Buy completes atomically (NFT + `$GROWTOO`, status `sold`)  
- [ ] Cancel returns NFT  
- [ ] Browser confirmations do not flake on public RPC (proxy preferred)  
- [ ] Authority / fee-payer stay funded for queue + legacy settle  
- [ ] **Adopt stake:** post offer as “Adopt stake”, adopter pays full price to care escrow; settle releases 50% to grower, locks 50%  
- [ ] **Monthly care:** ≥12 distinct care days / calendar month on linked plant (unlock rule)  
- [ ] **Weekly progress:** grower-only on Tokenise; adopters see monthly unlock status only  
- [ ] **Ranks:** grower rank on Tokenise wallet; plant rank on token cards (both profiles)  
- [ ] **Harvest claim:** all months qualify → locked half to grower; fail → refund to adopter  
- [ ] **Notifications:** header bell shows unread; journal log creates toast + inbox item  
- [ ] **Stake notify:** adopter invest → grower gets `stake_received` in inbox  
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
