# Shared layout — growtoo app

There is exactly one app shell, hand-written in `app/index.html`. It is a flex row: a fixed 240px
sidebar on desktop, a `.main` column, and a `.bottom-nav` that replaces the sidebar on mobile.

```
<body class="app-loading journal-paper">
  #app-boot                  — boot splash + 12s stall watchdog
  .app
    aside.sidebar            — desktop nav (hidden on mobile)
    nav.bottom-nav           — mobile tab bar (hidden on desktop)
    #more-nav-overlay        — account / settings bottom sheet
    #log-sheet-overlay       — "Log care" bottom sheet
    main.main
      header.main-header     — view title + wallet + bell + avatar
      #daily-start-strip     — "Start here" strip
      #notif-overlay         — inbox panel
      #view-dashboard .view
      #view-plants .view active     ← the app's landing view
      #view-adopt .view
      #view-market .view
      #view-growlog .view
      #view-blog .view
      #view-toolbox .view
      #view-danas .view
      #view-admin .view
  #modal-plant, #modal-entry
  #daily-status-overlay, #reward-earn-overlay, #app-confirm-overlay
```

---

## App shell source — `app/index.html:126–333`

```html
<div class="app">
  <aside class="sidebar">
    <a href="../index.html" class="sidebar-logo" aria-label="growtoo">
      <img src="../images/growtoo-mark-brass.png?v=20260731a" alt="" width="32" height="32" class="sidebar-logo-mark" />
      <span>growtoo</span>
    </a>
    <nav class="sidebar-nav">
      <a href="#" class="nav-item active grower-only" data-view="plants">
        <span class="nav-icon"><svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5h16"/><path d="M7 19.5V8.5l5-3 5 3v11"/></svg></span>
        <span data-i18n="app.span2">Journal</span>
      </a>
      <a href="#" class="nav-item grower-only" data-view="blog">
        <span class="nav-icon"><svg class="nav-svg" viewBox="0 0 24 24" …><path d="M5 4h10a2 2 0 012 2v14l-7-3-7 3V6a2 2 0 012-2z"/><path d="M9 8h4M9 12h4"/></svg></span>
        <span data-i18n="app.span3">Stories</span>
      </a>
      <button type="button" class="nav-item nav-item-log grower-only" id="sidebar-log-btn" aria-controls="log-sheet-overlay">
        <span class="nav-icon nav-log-mark" aria-hidden="true"><svg class="nav-svg" viewBox="0 0 24 24" …><path d="M8 4h8a2 2 0 012 2v14l-6-3-6 3V6a2 2 0 012-2z"/><path d="M10 9h4M10 13h4"/></svg></span>
        <span class="nav-log-label">Log</span>
      </button>
      <button type="button" class="nav-item nav-item-coach" id="sidebar-coach-btn" aria-controls="ai-coach-panel" aria-expanded="false" aria-label="Open coach">
        <span class="nav-icon nav-coach-mark" aria-hidden="true"><svg class="nav-svg" viewBox="0 0 24 24" …><path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/><circle cx="12" cy="6" r="2"/></svg></span>
        <span class="nav-coach-label">Coach</span>
      </button>
      <a href="#" class="nav-item" data-view="market" data-chain-nav>
        <span class="nav-icon"><svg class="nav-svg" viewBox="0 0 24 24" …><path d="M4 7l1.5-3h13L20 7"/><path d="M4 7h16v3a2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0V7z"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M9.5 20v-4.5h5V20"/></svg></span>
        <span data-label-grower="Tokenise" data-label-adopter="Market">Tokenise</span>
      </a>
      <a href="#" class="nav-item admin-only" data-view="admin" hidden>
        <span class="nav-icon"><svg class="nav-svg" viewBox="0 0 24 24" …><path d="M15.5 7a3.5 3.5 0 00-4.6 4.2l-5.6 5.6 1.9 1.9 5.6-5.6A3.5 3.5 0 0017 8.5l-2 2-1.5-1.5 2-2z"/></svg></span>
        <span data-i18n="app.span5">Admin</span>
      </a>
    </nav>
  </aside>

  <nav class="bottom-nav" aria-label="Main navigation">
    <a href="#" class="nav-item active grower-only" data-view="plants">
      <span class="nav-icon"><!-- journal icon --></span>
      <span class="bottom-nav-label">Journal</span>
    </a>
    <button type="button" class="nav-item bottom-nav-log grower-only" id="bottom-nav-log"
            aria-label="Log care" aria-expanded="false" aria-controls="log-sheet-overlay">
      <span class="bottom-nav-log-fab" aria-hidden="true">
        <svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 4h8a2 2 0 012 2v14l-6-3-6 3V6a2 2 0 012-2z"/><path d="M10 9h4M10 13h4"/>
        </svg>
      </span>
      <span class="bottom-nav-label">Log</span>
    </button>
    <button type="button" class="nav-item nav-item-coach" id="bottom-nav-coach"
            aria-label="Open coach" aria-expanded="false" aria-controls="ai-coach-panel">
      <span class="nav-icon nav-coach-mark" aria-hidden="true"><!-- coach icon --></span>
      <span class="bottom-nav-label nav-coach-label">Coach</span>
    </button>
    <a href="#" class="nav-item" data-view="market" data-chain-nav>
      <span class="nav-icon"><!-- market icon --></span>
      <span class="bottom-nav-label" data-label-grower="Tokenise" data-label-adopter="Market">Tokenise</span>
    </a>
  </nav>

  <main class="main">
    <header class="main-header">
      <h1 class="view-title">Journal</h1>
      <div class="main-header-actions">
        <span id="profile-type-badge" class="profile-type-badge" hidden>Grower</span>
        <div id="app-wallet-bar" class="app-wallet-bar" aria-live="polite"></div>
        <div class="notif-wrap" id="notif-wrap">
          <button type="button" class="header-icon-btn notif-bell-btn" id="notif-bell-btn"
                  aria-label="Notifications" aria-expanded="false" aria-haspopup="dialog"
                  aria-controls="notif-panel" title="Inbox">
            <svg class="notif-bell-svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span class="notif-dot" id="notif-dot" hidden aria-hidden="true"></span>
            <span class="notif-badge" id="notif-badge" hidden>0</span>
          </button>
        </div>
        <button type="button" class="header-icon-btn header-avatar-btn" id="btn-account"
                aria-label="Account menu" aria-expanded="false" aria-controls="more-nav-overlay" title="Account">
          <span class="header-avatar-mark" aria-hidden="true">G</span>
        </button>
        <button type="button" class="btn btn-ghost" id="btn-logout" hidden>Log out</button>
      </div>
    </header>
    <!-- .view blocks -->
  </main>
</div>
```

---

## Boot splash — `app/index.html:69–84`

`<body>` starts with `.app-loading`, which hides `.app`; `finishAppLoading()` removes it. An inline,
dependency-free watchdog swaps in a stalled message after 12s (or 1.5s after a script `error`).

```html
<div id="app-boot" class="app-boot" role="status" aria-live="polite" aria-busy="true">
  <img src="../images/growtoo-mark-brass.png?v=20260731a" alt="" width="64" height="64" class="app-boot-mark" />
  <p class="app-boot-word">growtoo</p>
  <p class="app-boot-line" id="app-boot-line">Opening your journal…</p>
  <span class="app-boot-pulse" id="app-boot-pulse" aria-hidden="true"></span>
  <div class="app-boot-stalled" id="app-boot-stalled" hidden>
    <p class="app-boot-stalled-text">This is taking longer than it should — your connection may have dropped, or a script failed to load. Your journal entries are safe.</p>
    <div class="app-boot-stalled-actions">
      <button type="button" class="btn btn-primary btn-tap" id="app-boot-retry">Try again</button>
      <a class="btn btn-ghost btn-tap" href="../dnevnik/">Back to sign in</a>
    </div>
  </div>
</div>
```

---

## Account / settings sheet — `app/index.html:199–267`

Opened from the header avatar (`#btn-account`) on every breakpoint. Holds the profile block, a
2-column `.settings-grid` of `.settings-tile`s, and inline expanding `.settings-panel`s for
appearance and language.

```html
<div class="more-nav-overlay" id="more-nav-overlay" hidden>
  <button type="button" class="more-nav-backdrop" id="more-nav-backdrop" aria-label="Close menu"></button>
  <div class="more-nav-sheet" role="dialog" aria-modal="true" aria-labelledby="more-nav-title">
    <div class="more-nav-handle" aria-hidden="true"></div>
    <div class="more-nav-head">
      <strong id="more-nav-title">Profile</strong>
      <button type="button" class="more-nav-close" id="more-nav-close" aria-label="Close">×</button>
    </div>
    <div class="account-profile" id="account-profile" hidden></div>
    <p class="more-nav-label" id="more-nav-settings-title">Settings</p>
    <div class="settings-grid">
      <button type="button" class="settings-tile" id="settings-tile-appearance" data-settings-panel="appearance" aria-expanded="false" aria-controls="settings-panel-appearance">
        <span class="settings-tile-icon" aria-hidden="true"><!-- sun --></span>
        <span class="settings-tile-label">Appearance</span>
      </button>
      <button type="button" class="settings-tile" id="settings-tile-language" data-settings-panel="language" aria-expanded="false" aria-controls="settings-panel-language">
        <span class="settings-tile-icon" aria-hidden="true"><!-- globe --></span>
        <span class="settings-tile-label">Language</span>
      </button>
      <div class="settings-panel" id="settings-panel-appearance" hidden>
        <div class="settings-picker" role="radiogroup" aria-label="Appearance">
          <button type="button" class="settings-picker-opt" data-theme-choice="light" role="radio" aria-checked="true">
            <span class="settings-picker-check" aria-hidden="true"><!-- check --></span>
            <span>Light</span>
          </button>
          <button type="button" class="settings-picker-opt" data-theme-choice="dark" role="radio" aria-checked="false">…Dark</button>
          <button type="button" class="settings-picker-opt" data-theme-choice="system" role="radio" aria-checked="false">…Auto</button>
        </div>
        <p class="settings-picker-hint">Light paper, like the landing. Dark is always available.</p>
      </div>
      <div class="settings-panel" id="settings-panel-language" hidden>
        <div class="settings-picker" id="settings-language-picker" role="listbox" aria-label="Language"></div>
      </div>
      <a href="#" class="settings-tile settings-tile--grower settings-tile--mobile-only" data-view="blog">…Stories</a>
      <a href="#" class="settings-tile settings-tile--grower" data-view="toolbox">…Measurements</a>
      <a href="#" class="settings-tile admin-only settings-tile--mobile-only" data-view="admin" hidden>…Admin</a>
      <button type="button" class="settings-tile settings-tile--wide settings-tile--unlock" id="btn-unlock-chain">…Unlock chain</button>
      <a href="../privacy/" class="settings-tile" target="_blank" rel="noopener noreferrer">…Privacy</a>
      <a href="../terms/" class="settings-tile" target="_blank" rel="noopener noreferrer">…Terms</a>
      <button type="button" class="settings-tile settings-tile--wide settings-tile--logout" id="btn-logout-sheet">…Log out</button>
    </div>
  </div>
</div>
```

---

## Log care sheet — `app/index.html:270–293`

The app's fastest path to a care log — opened from the sidebar `Log` item, the mobile FAB, or `.plant-card`.

```html
<div class="log-sheet-overlay" id="log-sheet-overlay" hidden>
  <button type="button" class="log-sheet-backdrop" id="log-sheet-backdrop" aria-label="Close log"></button>
  <div class="log-sheet" role="dialog" aria-modal="true" aria-labelledby="log-sheet-title">
    <div class="log-sheet-handle" aria-hidden="true"></div>
    <div class="log-sheet-head">
      <strong id="log-sheet-title">Log care</strong>
      <button type="button" class="log-sheet-close" id="log-sheet-close" aria-label="Close">×</button>
    </div>
    <div class="log-sheet-plant-block" id="log-sheet-plant-block">
      <p class="log-sheet-label" id="log-sheet-plant-label">Plants</p>
      <p class="log-sheet-hint" id="log-sheet-hint">Tap rows to select. Same strain stacks can log together.</p>
      <div class="log-sheet-plants" id="log-sheet-plants" role="listbox" aria-multiselectable="true" aria-labelledby="log-sheet-plant-label"></div>
      <p class="log-sheet-empty" id="log-sheet-empty" hidden>
        No plants yet.
        <button type="button" class="btn btn-primary btn-tap" id="log-sheet-add-plant">Add a plant</button>
      </p>
    </div>
    <div class="log-sheet-actions" id="log-sheet-actions">
      <button type="button" class="btn btn-primary btn-tap" id="log-sheet-water">Log watering</button>
      <button type="button" class="btn btn-secondary btn-tap" id="log-sheet-feed">Log feeding</button>
      <button type="button" class="btn btn-ghost btn-tap" id="log-sheet-full">Full journal entry</button>
    </div>
  </div>
</div>
```

---

## Inbox panel — `app/index.html:345–369`

```html
<div class="notif-overlay" id="notif-overlay" hidden>
  <button type="button" class="notif-backdrop" id="notif-backdrop" aria-label="Close inbox"></button>
  <div class="notif-panel" id="notif-panel" role="dialog" aria-modal="true" aria-labelledby="notif-panel-title">
    <div class="notif-sheet-handle" aria-hidden="true"></div>
    <div class="notif-panel-head">
      <div class="notif-panel-heading">
        <strong id="notif-panel-title">Inbox</strong>
        <span class="notif-panel-sub" id="notif-panel-sub"></span>
      </div>
      <div class="notif-panel-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="notif-mark-all">Mark read</button>
        <button type="button" class="notif-close-btn" id="notif-close" aria-label="Close inbox"><span aria-hidden="true">×</span></button>
      </div>
    </div>
    <div class="notif-panel-list" id="notif-panel-list"></div>
  </div>
</div>
```

---

## Layout CSS — `app/styles/app.css`

```css
body {
  font-family: var(--font);
  background:
    radial-gradient(900px 480px at 85% -5%, rgb(var(--brass-rgb) / 0.07) 0%, transparent 55%),
    radial-gradient(700px 420px at 8% 40%, rgb(var(--green-glow-rgb) / 0.16) 0%, transparent 50%),
    linear-gradient(180deg, var(--canvas-top) 0%, var(--bg) 40%, var(--canvas-bottom) 100%);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
}

/* Faint 48px graph-paper grid over the whole canvas, masked out towards the bottom */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.28;
  background-image:
    linear-gradient(rgb(var(--sage-rgb) / 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgb(var(--sage-rgb) / 0.035) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(180deg, rgb(var(--shadow-rgb) / 0.5), transparent 90%);
}

.app {
  display: flex;
  min-height: 100vh;
  position: relative;
  z-index: 1;
}

/* Sidebar */
.sidebar {
  width: 240px;
  min-width: 240px;
  background: rgb(var(--surface-rgb) / 0.94);
  border-right: 1px solid var(--desk-line);
  padding: 1.25rem 0;
  box-shadow: none;
  backdrop-filter: blur(10px);
}

.sidebar-logo {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0 1.25rem;
  font-family: var(--font);
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--brass);
  text-decoration: none;
  margin-bottom: 1.5rem;
  letter-spacing: 0.02em;
}

.sidebar-logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: block;
  flex: 0 0 auto;
  box-shadow: 0 0 0 1px rgb(var(--brass-rgb) / 0.4);
}

.sidebar-nav { display: flex; flex-direction: column; gap: 0.25rem; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1.25rem;
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover { background: rgb(var(--brass-rgb) / 0.08); color: var(--text); }
.nav-item.active {
  background: rgb(var(--brass-rgb) / 0.1);
  color: var(--brass);
  border-left: 3px solid var(--brass);
  padding-left: calc(1.25rem - 3px);
}
.nav-icon { font-size: 1.2rem; }

/* Bottom nav is desktop-hidden and turned on inside the mobile media query */
.bottom-nav { display: none; }

.main {
  flex: 1;
  padding: 1.5rem 2rem;
  /* `clip` not `hidden`: overflow-x:hidden makes this a scroll container, which
     silently breaks position:sticky on the header inside it. */
  overflow-x: clip;
}

/* Grower Coach FAB sits fixed bottom-right — keep last cards clear of it */
body.coach-fab-visible .main {
  padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
  padding-right: max(2rem, 8.75rem);
}

.main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.main-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.view-title {
  font-family: var(--font-display);
  font-size: 1.55rem;
  font-weight: 350;
  letter-spacing: -0.02em;
  color: var(--text);
}

.view { display: none; }
.view.active { display: block; }

@keyframes catalog-view-rise {
  from { opacity: 0; transform: translate3d(0, 10px, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
```

---

## Role / state classes on `<body>`

The shell is one DOM for two audiences. Visibility is driven by body classes, not by routing:

| Class | Effect |
| --- | --- |
| `.journal-paper` | sage-paper palette (always on in the app) |
| `.app-loading` | hides `.app`, shows `#app-boot` |
| `.profile-grower` | reveals `.grower-only`, hides `.adopter-only` |
| `.profile-adopter` | reveals `.adopter-only`, hides `.grower-only`; re-tints the account block |
| `.chain-locked` | hides `[data-chain-nav]` nav items, shows the unlock tile |
| `.admin-readonly` | disables add/edit/delete controls |
| `.more-nav-open`, `.notif-open` | lock scroll behind a sheet |
| `.coach-fab-visible` | pads `.main` clear of the floating coach button |
| `.soil-moisture-tool-visible` | reveals the soil-moisture tool tile |

Nav labels also swap per role via `data-label-grower` / `data-label-adopter` on the label `<span>`
(e.g. "Tokenise" for growers, "Market" for adopters).

## Mobile breakpoint

`@media (max-width: 768px)`: `.sidebar` is hidden, `.bottom-nav` becomes a fixed 4-slot tab bar with a
raised centre FAB (`.bottom-nav-log-fab`), `.main` padding drops, `.plants-list` collapses to one
column, and journal entries gain the swipe-to-delete layer (`.journal-swipe`, desktop keeps the
inline Delete button instead).
