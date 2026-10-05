# Page dependency trees — growtoo app

There is no module system: every file below is a `<script src>` in `app/index.html` that hangs its API
off `window`. "Dependencies" therefore means *which scripts paint this view*, and the markup for every
view lives in `app/index.html` itself.

`app/js/app.js` is 8,895 lines and `app/styles/app.css` is 13,912 lines — **never pass either whole**.
The line ranges below are the ones that actually render each view.

---

## `/app/` → `#view-plants` (Journal) — the primary design target

Entry: `app/index.html:394:495` (the `#view-plants` markup)

```
app/index.html:126:333            — app shell: sidebar, bottom nav, main header
app/index.html:394:495            — #view-plants markup (hero, weather, today, my plants, journal)
app/index.html:270:293            — #log-sheet-overlay (Log care sheet, reached from this view)
app/index.html:1053:1295          — #modal-plant + #modal-entry (opened from this view)
Dependencies:
- app/js/app.js
  - :3383:3460                    — showView(): toggles .view.active + rewrites .view-title
  - :5786:5924                    — renderPlants(): builds every .plant-card in #plants-list
  - :6872:7217                    — renderJournal() + entryCardHtml(): builds #journal-entries
  - :7218:7376                    — bindJournalRowActions(): swipe-to-delete wiring
- app/js/plant-stacks.js          — GrowtooStacks.groupItems / wrapStackHtml: collapses same-strain plants
- app/js/journal-calendar.js      — paints #journal-calendar in Month mode
- app/js/daily-status.js          — #daily-start-strip and #daily-status-overlay
- app/js/grower-quests.js         — #activity-reward-card meter, #grower-rank-chip
- app/js/status-rail.js           — care-trail status chips
- app/js/ai-coach.js              — .coach-plants-strip, .entry-coach-note, coach FAB/panel
- app/js/coach-core.js            — coach state + quota
- app/js/journal-photos.js        — Storage-backed photo URLs for .plant-card-photo / .entry-media
- app/js/grow-camera.js           — "Take photo" in #modal-entry
- app/js/notifications.js         — #notif-panel inbox
- app/js/sheet-drag.js            — drag-to-dismiss for every bottom sheet
- app/js/app-confirm.js           — #app-confirm-overlay
- app/js/theme.js                 — appearance picker in the account sheet
- app/js/plain-lang.js            — .plain-tip tooltips
Styles:
- styles/tokens.css               — all tokens (pass whole, 385 lines)
- app/styles/app.css:616:724      — body canvas + grid texture, .app, .sidebar, .nav-item, .bottom-nav
- app/styles/app.css:1292:1360    — .main, .main-header, .notif-bell-btn
- app/styles/app.css:2026:2177    — .view-title, .view, .btn and every variant, .toolbar
- app/styles/app.css:3361:3430    — .plants-list, .plant-stack, .plant-stack-face
- app/styles/app.css:3544:3676    — .plant-card and all children, .journal-filters, .journal-entries
- app/styles/app.css:3810:3900    — .journal-entry and all children, .entry-source
```

## `/app/` → `#view-growlog` (single plant)

Entry: `app/index.html:724:770`

```
Dependencies:
- app/js/app.js
  - :4168:4234                    — openGrowlog()
  - :4235:4560                    — renderGrowlog(): hero, timeline, phases, environment
- app/js/journal-photos.js        — #growlog-photo-grid / #growlog-photo-strip
- app/js/ai-coach.js              — "Coach" button in the growlog toolbar
- app/js/grower-quests.js         — #growlog-reward-goal
- app/js/plant-token.js           — seal/stage state shown on the hero
Styles:
- app/styles/app.css               — .growlog-* block (search `.growlog-layout`)
```

## `/app/` → `#view-toolbox` (Measurements)

Entry: `app/index.html:831:948`

```
Dependencies:
- app/js/app.js
  - :8163:8170                    — renderToolbox()
  - :8171:8325                    — renderToolboxList()
  - :8326:8520                    — renderToolboxChart() (hand-rolled SVG/div charts, no chart lib)
- app/js/metric-ui.js             — unit formatting
- app/tools/soil-moisture/        — iframed live sensor tool
Styles:
- app/styles/app.css:96:110       — .toolbox-card base
- app/styles/app.css:3982:4010    — .toolbox-card restated
- app/styles/app.css:6107:6130    — .toolbox-card ::before accent
```

## `/app/` → `#view-market` (Market)

Entry: `app/index.html:603:722`

```
Dependencies:
- app/js/market.js                — 3,093 lines: the whole market board, offer cards, invest flow
- app/js/list-eligibility.js      — the 14-day / 50%-care-days list gate
- app/js/escrow-program.js        — on-chain vault calls
- app/js/spl-transfer.js          — $GROWTOO transfers
- app/js/solana-wallet.js         — wallet connect (Phantom / Solflare, Devnet)
- app/js/solana-rpc.js, chain-config.js
- app/js/plant-stacks.js          — stacks same-seller, same-strain market cards
- app/js/product-tour.js          — the `?` tutorial button
Styles:
- app/styles/app.css               — .market-* block (search `.market-grid`)
```

## `/app/` → `#view-adopt` (Tokenise / Garden)

Entry: `app/index.html:497:601`

```
Dependencies:
- app/js/plant-token.js           — 4,861 lines: seal seed, mint queue, token cards, botanical art
- app/js/seed-chain.js            — seed-seal chain writes
- app/js/token-botanical-art.js   — generated per-token artwork
- app/js/plant-botanical-sprites.js
- app/js/grower-quests.js         — #platform-bonus-panel activity bonus
- app/js/wallet-link.js           — links a Devnet wallet to the account
Styles:
- app/styles/app.css               — .adopt-*, .seal-stage-*, .adopt-token-* blocks
```

## `/app/` → `#view-blog` (Stories)

Entry: `app/index.html:772:829`

```
Dependencies:
- app/js/grower-blog.js           — composer, slug, cover upload, publish/unpublish, list
- app/js/journal-photos.js        — cover image upload
Styles:
- app/styles/app.css               — .blog-* block
```

## `/app/` → `#view-dashboard`

Entry: `app/index.html:371:392`

```
Dependencies:
- app/js/app.js                   — #dashboard-metrics, #recent-notes, #dashboard-charts
- app/js/daily-status.js          — #dashboard-today-card
- app/js/plant-token.js           — #dashboard-plant-seals
Styles:
- app/styles/app.css:2180:2220    — .dashboard-cards, .dashboard-metrics, .dashboard-first-run
```

## `/app/` → `#view-admin`

Entry: `app/index.html:979:1048`

```
Dependencies:
- app/js/admin.js                 — user report, sharing panel, tenant tools
- app/js/solana-wallet.js         — #admin-wallet-panel
- app/admin-users.html, admin-plants.html, admin-entries.html, admin-tenants.html, admin-system.html
Styles:
- app/styles/app.css               — .admin-hub-*, .admin-segment blocks
```

## `/` (marketing landing)

Entry: `index.html` (1,400+ lines, self-contained)

```
Dependencies:
- styles/landing.css              — 130,307 bytes, own token layer and hero system
- js/i18n.js, js/site-trust.js
- images/landing/*                — hero poster and section art
```

Separate visual system from the app (Archivo / Fraunces / JetBrains Mono, brass on forest). Do not
mix landing styles into app designs.

## `/dnevnik/` (sign in)

```
Entry: dnevnik/index.html
Dependencies:
- styles/tokens.css               — shares the app's token layer; body.journal-paper
- app/js/signup.js                — auth + profile-type selection
```

---

## Context-selection guidance

For a **Journal view** design, the faithful, budget-safe bundle is:

```
--context-file .superdesign/design-system.md
--context-file app/index.html:126:495
--context-file app/js/app.js:5786:5924
--context-file app/js/app.js:6872:7130
--context-file app/styles/app.css:616:724
--context-file app/styles/app.css:1292:1360
--context-file app/styles/app.css:2026:2177
--context-file app/styles/app.css:3361:3430
--context-file app/styles/app.css:3544:3676
--context-file app/styles/app.css:3810:3900
--context-file styles/tokens.css
```

`app/index.html` is 1,423 lines, so it must be line-ranged too; `:126:495` covers the shell plus the
whole Journal view, which is everything a Journal design needs.
