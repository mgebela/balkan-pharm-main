# Routes — growtoo

No router library. Two layers:

1. **Static file routing** (Firebase Hosting / Netlify) — one directory per page, `index.html` inside.
2. **In-app view switching** — `app/index.html` is a single document holding every screen as a
   `<div id="view-*" class="view">`. `app/js/app.js` toggles `.active` on exactly one of them and
   rewrites `.view-title`. Nav is `<a href="#" data-view="plants">`; there is no URL change and no
   history entry, so every app screen lives at `/app/`.

---

## Static routes

| URL | File | Layout |
| --- | --- | --- |
| `/` | `index.html` | marketing landing (`styles/landing.css`) |
| `/app/` | `app/index.html` | **the app shell** — sidebar + bottom nav + `.view` stack |
| `/dnevnik/` | `dnevnik/index.html` | sign-in / sign-up (shares `styles/tokens.css`) |
| `/journal/` | `journal/index.html` | public journal index |
| `/journal/g/` | `journal/g/index.html` | public grower profile |
| `/journal/p/` | `journal/p/index.html` | public plant / story page |
| `/app/dev-preview.html` | `app/dev-preview.html` | component preview harness |
| `/app/admin-users.html` | `app/admin-users.html` | admin subpage |
| `/app/admin-plants.html` | `app/admin-plants.html` | admin subpage |
| `/app/admin-entries.html` | `app/admin-entries.html` | admin subpage |
| `/app/admin-tenants.html` | `app/admin-tenants.html` | admin subpage (super-admin) |
| `/app/admin-system.html` | `app/admin-system.html` | admin subpage (super-admin) |
| `/app/tools/soil-moisture/` | `app/tools/soil-moisture/index.html` | sensor tool, also iframed into Measurements |
| `/app/pitch-deck/` | `app/pitch-deck/index.html` | deck |
| `/pitch/…` | `pitch/*/index.html` | audience-specific pitch pages |
| `/privacy/`, `/terms/`, `/risks/`, `/rwa-docs/` | `*/index.html` | legal |
| `/404.html` | `404.html` | not found |

---

## In-app views (all at `/app/`)

| `data-view` | Container | Title | What renders |
| --- | --- | --- | --- |
| `plants` | `#view-plants` | **Journal** | **default active view.** Hero, weather widget, Today card, activity-reward card, `My plants` grid, and the `Journal` trail (list or month calendar) |
| `blog` | `#view-blog` | Stories | story composer + your published stories |
| `market` | `#view-market` | Tokenise / Market | list a sealed plant, my offers, open market board |
| `adopt` | `#view-adopt` | Tokenise / Garden | seal a stage, trail-ahead card, activity bonus, sealed/adopted plants |
| `growlog` | `#view-growlog` | *(plant name)* | single-plant deep view: photo grid, strain, stages, environment sidebar + seed-to-harvest timeline |
| `toolbox` | `#view-toolbox` | Measurements | 7 tool tiles + per-tool form, list and chart |
| `dashboard` | `#view-dashboard` | Dashboard | plant seals, metrics, quick actions, charts, recent notes |
| `danas` | `#view-danas` | Today | simple checklist (legacy) |
| `admin` | `#view-admin` | Admin Panel | wallet panel, admin tiles, super-admin hub |

`#view-adopt` and `#view-market` are two panes of one destination: both render a
`.chain-pane-bar` segmented control that switches between them, and the nav item is a single
`Tokenise`/`Market` entry.

---

## Journal view structure — `app/index.html:394–495`

This is the app's landing screen and the primary design target.

```html
<div id="view-plants" class="view active">
  <section class="journal-hero">
    <h2 class="journal-hero-title">Your plants, in one garden</h2>
    <p class="journal-hero-sub">A light journal of what you grew, watered, and learned.</p>
  </section>

  <div class="view-tour-bar grower-only">
    <button type="button" class="view-tour-help" data-tour-script="plants" aria-label="Journal tutorial" title="Journal tutorial">?</button>
  </div>

  <section class="plants-weather-widget" id="plants-weather-widget" aria-label="Weather forecast">
    <div class="plants-weather-widget-inner">
      <div class="plants-weather-widget-head">
        <div class="plants-weather-widget-brand">
          <span class="plants-weather-widget-icon" aria-hidden="true">☀</span>
          <div>
            <h3 class="plants-weather-widget-title">Weather forecast</h3>
            <p class="plants-weather-widget-sub" id="plants-weather-widget-sub">3 days · for grow planning</p>
          </div>
        </div>
      </div>
      <form class="plants-weather-city-form" id="plants-weather-city-form">
        <input type="search" id="plants-weather-city" placeholder="City (optional)" autocomplete="off" aria-label="City for forecast" />
        <button type="submit" class="plants-weather-refresh-btn" id="plants-weather-refresh">Refresh</button>
      </form>
      <div id="plants-weather" class="plants-weather-body" role="status">Loading forecast…</div>
    </div>
  </section>

  <section class="dashboard-today-section grower-only" id="dashboard-today-section" hidden>
    <article class="shell-card today-card" id="dashboard-today-card">
      <p class="today-card-eyebrow">Today</p>
      <p class="today-card-line" id="dashboard-today-line"></p>
      <div class="today-card-actions" id="dashboard-today-actions"></div>
    </article>
  </section>

  <section class="grower-only" id="activity-reward-section" hidden>
    <article class="shell-card activity-reward-card" id="activity-reward-card">
      <p class="today-card-eyebrow">This month’s $GROWTOO</p>
      <p class="activity-reward-line" id="activity-reward-line"></p>
      <ul class="activity-reward-meter" id="activity-reward-meter"></ul>
      <p class="activity-reward-hint" id="activity-reward-hint"></p>
      <div class="today-card-actions" id="activity-reward-actions"></div>
    </article>
  </section>

  <section class="plants-journal-section">
    <div class="plants-section-head">
      <h2 class="section-heading">My plants</h2>
      <button type="button" class="grower-rank-chip grower-only" id="grower-rank-chip" hidden title="Open profile for full rank & XP"></button>
    </div>
    <div class="journal-stage-filters" id="journal-stage-filters" role="tablist" aria-label="Filter by stage"></div>
    <div class="toolbar">
      <button type="button" class="btn btn-secondary grower-only" id="plants-open-stories">Write a story</button>
      <button type="button" class="btn btn-ghost" id="btn-add-plant">+ New plant</button>
    </div>
    <p class="coach-plants-strip grower-only" id="coach-plants-strip" hidden></p>
    <div id="plants-list" class="plants-list"></div>
  </section>

  <section class="plants-journal-section plants-journal-diary">
    <div class="plants-section-head">
      <h2 class="section-heading">Journal</h2>
      <div class="segmented-control journal-view-toggle" id="journal-view-toggle" data-active="month" role="radiogroup" aria-label="Journal view">
        <span class="segmented-thumb" aria-hidden="true"></span>
        <button type="button" class="segmented-option" data-journal-view="list" role="radio" aria-checked="false">List</button>
        <button type="button" class="segmented-option" data-journal-view="month" role="radio" aria-checked="true">Month</button>
      </div>
    </div>
    <div class="journal-filters">
      <select id="journal-plant-filter"><option value="">All plants</option></select>
    </div>
    <div id="journal-calendar" class="journal-calendar" hidden></div>
    <div class="toolbar">
      <button type="button" class="btn btn-secondary" id="btn-add-entry">+ New entry</button>
    </div>
    <div id="journal-entries" class="journal-entries"></div>
  </section>
</div>
```

`#plants-list` is filled by `renderPlants()` (`app/js/app.js:5786`) with `.plant-card`s, grouped into
`.plant-stack` `<details>` when several plants share a strain and stage.
`#journal-entries` is filled by `renderJournal()` (`app/js/app.js:6872`) with `.journal-entry` cards;
in Month mode `app/js/journal-calendar.js` paints `#journal-calendar` and the entry list is narrowed
to the selected day.

---

## Measurements view structure — `app/index.html:831–948`

7 tiles in `.toolbox-grid`, each opening a matching `.toolbox-panel` below with a form, a list and a
chart. A bridge note at the top explains that each Add also writes a journal entry.

```html
<div id="view-toolbox" class="view">
  <p class="toolbox-journal-bridge" id="toolbox-journal-bridge">
    Measurements stay here for charts. Each Add also writes a matching note to that plant’s <strong>Journal</strong> trail — one care story.
  </p>
  <div class="toolbox-grid">
    <button type="button" class="toolbox-card toolbox-card-btn" data-tool="watering">
      <h3>Watering</h3><p>Log when you watered your plant.</p>
    </button>
    <!-- feeding, environment, transplant, stressors, soil-moisture (admin), graphs -->
  </div>
  <div class="toolbox-panels">
    <div id="toolbox-panel-watering" class="toolbox-panel" data-tool="watering" aria-hidden="true">
      <h3 class="toolbox-panel-title">Watering</h3>
      <form class="toolbox-form" id="toolbox-form-watering">
        <label>Date <input type="date" lang="en-GB" id="tool-watering-date" required /></label>
        <label>Amount (mL) <input type="number" id="tool-watering-value1" min="0" placeholder="e.g. 500" required /></label>
        <label>Plant <select id="tool-watering-value2" required><option value="">-- Select a plant --</option></select></label>
        <button type="submit" class="btn btn-primary">Add</button>
      </form>
      <div class="toolbox-list" id="toolbox-list-watering"></div>
      <div class="toolbox-chart-wrap"><h4>Chart: Amount by date</h4><div class="toolbox-chart" id="toolbox-chart-watering"></div></div>
    </div>
    <!-- … one panel per tool … -->
  </div>
</div>
```

---

## Script load order — `app/index.html:1364–1421`

Order matters; `app.js` is last and depends on everything above it.

```
js/appcheck-config.js
firebase-app-compat / auth / firestore / storage / app-check  (CDN 12.16.0)
inline firebase.initializeApp(...)
js/chain-config.js → solana-rpc → solana-wallet → wallet-link → seed-chain → spl-transfer → escrow-program
js/status-rail.js, plain-lang.js, list-eligibility.js, sheet-drag.js, app-confirm.js
js/plant-stacks.js, journal-calendar.js, market.js, metric-ui.js
js/token-botanical-art.js, plant-botanical-sprites.js
js/grower-quests.js, notifications.js, signup.js, plant-token.js
js/daily-status.js, product-tour.js, coach-core.js
js/journal-photos.js  ← must precede grow-camera and app.js
js/grow-camera.js, ai-coach.js, grower-blog.js
js/theme.js (defer)
js/app.js               ← view switching + all journal rendering
../js/site-trust.js
```
