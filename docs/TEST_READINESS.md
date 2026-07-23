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
| Settlement mode | `program` (new listings) |
| Hot-wallet escrow (legacy) | `EmQ4nNB1YVWNKVEiPNYhLgJR2gY1deJoV2L743z945yD` |
| Mint authority | `F6ZEFk81ht6yWKvc5pLYQ5eM6DEKqdN69kbi2hFaMTv3` |
| Fee payer | `Et1uJZn2GAWFdnKaVTubZYohKNJNB7gEpoQ7EHHKq975` |
| Browser RPC | `https://europe-west1-balpha-9dab9.cloudfunctions.net/solanaRpc` |
| Reconcile CF | `…/reconcileMarketEscrow` |
| Settle CF | `…/settleMarketQueue` |

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
