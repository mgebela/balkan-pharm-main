# Shared UI primitives — growtoo app

## Stack detection

- **Framework**: none. Vanilla ES5-flavoured JavaScript in IIFEs, no build step, no bundler.
- **Meta-framework**: none. Static HTML served by Firebase Hosting / Netlify.
- **Component library**: none. All UI is hand-written HTML in `app/index.html` plus template strings
  built by `app/js/*.js` and injected with `innerHTML`.
- **CSS approach**: vanilla CSS, three global stylesheets loaded in order:
  1. `styles/tokens.css` — design tokens (`:root`, `:root[data-theme='light']`, `body.journal-paper`)
  2. `app/styles/app.css` — every app component (13,912 lines)
  3. `styles/trust-gates.css`, `styles/i18n.css` — small overlays
- **Theming**: dark is the unthemed default; `data-theme="light"` on `<html>` is the product default,
  written by an inline script before first paint. `body.journal-paper` is a third, sage-paper palette
  that the app body always carries.
- **i18n**: every string is wrapped in `data-i18n="<key>"` (HTML) or `T('key', 'English')` (JS).

There are no component files to extract — "component" here means *a CSS class contract plus the HTML
shape that fills it*. Both are given below.

---

## Button — `.btn`

Variants: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-destructive`, sizes `.btn-sm` / `.btn-lg`,
plus `.btn-tap` for touch targets.

```html
<button type="button" class="btn btn-primary">Log watering</button>
<button type="button" class="btn btn-secondary">Log feeding</button>
<button type="button" class="btn btn-ghost">Full journal entry</button>
<button type="button" class="btn btn-ghost btn-sm">Delete</button>
```

```css
/* Buttons — iOS continuous corners, not stadium pills */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.35rem;
  min-height: 48px;
  min-width: 48px;
  box-sizing: border-box;
  border-radius: var(--radius-control); /* 14px */
  font-family: var(--font);
  font-weight: 650;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  line-height: 1.2;
  border: 1px solid transparent;
  box-shadow: none;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 0.15s var(--ease-control), border-color 0.15s var(--ease-control),
    color 0.15s var(--ease-control), box-shadow 0.15s var(--ease-control), transform 0.15s var(--ease-control);
  -webkit-tap-highlight-color: transparent;
}

.btn:focus { outline: none; }
.btn:active { transform: scale(0.96); }
.btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.btn-primary {
  background: var(--brass-fill);
  color: var(--brass-ink);
  border-color: transparent;
  box-shadow: var(--fill-sheen), var(--fill-lift);
}
.btn-primary:hover {
  background: var(--brass-hover);
  color: var(--brass-ink);
  border-color: transparent;
  transform: none;
  box-shadow: var(--fill-sheen), 0 2px 6px rgb(var(--brass-rgb) / 0.28);
}
.btn-primary:active { background: var(--brass-active); border-color: var(--brass-active); }
.btn-primary:disabled,
.btn-primary[aria-disabled="true"] {
  background: var(--brass-disabled-bg);
  color: var(--brass-disabled-ink);
  border-color: transparent;
  pointer-events: none;
  cursor: not-allowed;
}

.btn-secondary,
.btn-ghost {
  background: transparent;
  color: var(--text);
  border-color: rgb(var(--brass-rgb) / 0.55);
}
.btn-secondary:hover,
.btn-ghost:hover {
  background: rgb(var(--brass-rgb) / 0.12);
  color: var(--text);
  border-color: rgb(var(--brass-rgb) / 0.85);
}
.btn-secondary:active,
.btn-ghost:active { background: rgb(var(--brass-rgb) / 0.18); border-color: var(--brass); }

.btn-destructive {
  background: transparent;
  color: var(--rust);
  border-color: rgb(var(--rust-rgb) / 0.65);
}
.btn-destructive:hover {
  background: var(--rust-hover-fill);
  color: rgb(var(--clay-rgb));
  border-color: rgb(var(--rust-rgb) / 0.9);
}

.btn-sm {
  min-height: 36px;
  min-width: 0;
  padding: 0.4rem 0.85rem;
  font-size: 0.82rem;
  border-radius: var(--radius-control);
}
.btn-lg { padding: 0.9rem 1.55rem; font-size: 1rem; min-height: 52px; }
```

---

## Plant card — `.plant-card`

The primary object in the Journal view. Built by `renderPlants()` in `app/js/app.js:5786`.
Stage drives a `--tint` accent via `data-stage-key`.

```html
<div class="plant-card" data-id="p_123" data-stage="vegetativna" data-stage-key="vegetative">
  <div class="plant-card-photo"><img src="…" alt="" /></div>
  <div class="plant-card-body">
    <div class="plant-card-byline">
      <span class="plant-card-avatar" aria-hidden="true">C</span>
      <span>CBD Auto · 12/08/2026</span>
    </div>
    <h3>CBD Auto #1</h3>
    <p class="plant-card-tldr">TL;DR: Vegetative · Watered 20/09/2026</p>
    <div class="plant-card-subphases">
      <span class="subphase-badge" title="Pot volume">5 L</span>
    </div>
    <div class="plant-card-meta-line">Field A, plot 3</div>
    <div class="plant-card-actions">
      <button type="button" class="btn btn-primary btn-growlog">Log care</button>
      <button type="button" class="btn btn-ghost btn-edit-plant">✎ Edit plant</button>
      <button type="button" class="btn btn-ghost btn-delete-plant">Delete plant</button>
    </div>
  </div>
</div>
```

```css
.plants-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.plant-card {
  --tint: var(--brass);
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.25rem;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* Stage-tint scale — a scan-at-a-glance accent, not a card restructure. */
.plant-card[data-stage-key="germination"] { --tint: var(--leaf); }
.plant-card[data-stage-key="seedling"]    { --tint: var(--leaf-mid); }
.plant-card[data-stage-key="vegetative"]  { --tint: var(--leaf-deep); }
.plant-card[data-stage-key="flowering"]   { --tint: var(--brass-earth); }
.plant-card[data-stage-key="harvest"]     { --tint: var(--brass-active); }

.plant-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--tint), transparent);
  opacity: 0.8;
}

.plant-card:hover {
  border-color: color-mix(in srgb, var(--tint) 50%, var(--border));
  box-shadow: var(--shadow-md);
}

.plant-card-photo {
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  margin: -1.25rem -1.25rem 0.75rem -1.25rem;
  max-height: 180px;
}
.plant-card-photo img { width: 100%; height: 180px; object-fit: cover; display: block; }

.plant-card h3 { font-size: 1.1rem; font-weight: 600; }
.plant-card .strain { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }

.plant-card .stage-badge {
  display: inline-block;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  background: linear-gradient(90deg, var(--accent), var(--accent-bright));
  color: var(--ink-on-brass);
}

.plant-card-subphases { margin: -0.35rem 0 0.5rem; }
.plant-card .subphase-badge {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 600;
  background: rgb(var(--brass-rgb) / 0.1);
  border: 1px solid rgb(var(--brass-rgb) / 0.28);
  color: var(--brass);
}

.plant-card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.plant-card-actions button { padding: 0.4rem 0.75rem; font-size: 0.85rem; }
```

---

## Journal entry — `.journal-entry`

One logged care event. Built by `renderJournal()` / `entryCardHtml()` in `app/js/app.js:6872`.
Entries mirrored from the Measurements toolbox get `.journal-entry--from-tools` and an
`.entry-source--tools` badge. On mobile the card is wrapped in `.journal-swipe` for swipe-to-delete.

```html
<div class="journal-swipe">
  <div class="journal-swipe-actions">
    <button type="button" class="journal-swipe-delete" tabindex="-1" aria-hidden="true">Delete</button>
  </div>
  <div class="journal-entry journal-entry--from-tools" data-entry-id="e_1">
    <div class="entry-meta">
      <span class="entry-type">Watering</span>
      <span class="entry-source entry-source--tools">via Tools</span>
      CBD Auto #1 · 20/09/2026
      <button type="button" class="btn btn-ghost btn-sm btn-delete-entry" aria-label="Delete entry">Delete</button>
    </div>
    <div class="entry-note">500 mL, soil was dry two knuckles down.</div>
    <p class="entry-coach-note"><span class="entry-coach-note-label">Coach</span> Good cadence — hold at 3-day intervals.</p>
    <div class="entry-meta-blocks">
      <div class="entry-meta-block"><strong>Stage transition</strong><ul><li>From: Seedling</li><li>To: Vegetative</li></ul></div>
    </div>
    <div class="entry-media-wrap">
      <div class="entry-media entry-photo"><img src="…" alt="Photo" /></div>
    </div>
  </div>
</div>
```

```css
.journal-entries { display: flex; flex-direction: column; gap: 0.75rem; }

.journal-entry {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  box-shadow: var(--shadow);
}

.journal-entry .entry-meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem; }

.journal-entry .entry-type {
  display: inline-block;
  margin-right: 0.5rem;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: var(--bg-alt);
  font-size: 0.75rem;
}

.entry-source {
  display: inline-block;
  margin-right: 0.45rem;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  vertical-align: baseline;
}
.entry-source--tools {
  color: rgb(var(--text-rgb) / 0.92);
  background: rgb(var(--brass-rgb) / 0.18);
  border: 1px solid rgb(var(--brass-rgb) / 0.32);
}
.journal-entry--from-tools { border-color: rgb(var(--brass-rgb) / 0.22); }

.journal-entry .entry-note { font-size: 0.95rem; font-family: var(--font-serif); }

.journal-entry .entry-meta-blocks { margin-top: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; }
.journal-entry .entry-meta-block { font-size: 0.9rem; color: var(--text-muted); }
.journal-entry .entry-meta-block strong { color: var(--text); display: block; margin-bottom: 0.25rem; }
.journal-entry .entry-meta-block ul { margin: 0; padding-left: 1.25rem; }
```

---

## Plant stack — `.plant-stack`

A `<details>` element that collapses same-strain, same-stage plants behind one face. Used on the
Journal plant grid, the Journal trail, and the market grid. Built by `app/js/plant-stacks.js`
(`GrowtooStacks.groupItems` / `wrapStackHtml`).

```css
.plant-stack {
  --tint: var(--brass);
  position: relative;
  align-self: start;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  overflow: visible;
}
.plant-stack[data-stage-key="seed"]        { --tint: var(--brass); }
.plant-stack[data-stage-key="germination"] { --tint: var(--leaf); }
.plant-stack[data-stage-key="seedling"]    { --tint: var(--leaf-mid); }
.plant-stack[data-stage-key="vegetative"]  { --tint: var(--leaf-deep); }
.plant-stack[data-stage-key="flowering"]   { --tint: var(--brass-earth); }
.plant-stack[data-stage-key="harvest"]     { --tint: var(--brass-active); }

.plant-stack[open] {
  grid-column: 1 / -1;
  box-shadow: var(--shadow-md);
  border-color: color-mix(in srgb, var(--tint) 45%, var(--border));
}

.plant-stack-face {
  position: relative;
  list-style: none;
  cursor: pointer;
  display: flex;
  gap: 0.9rem;
  align-items: center;
  padding: 1.1rem 1.15rem 1.05rem;
  border-radius: 16px;
  overflow: hidden;
  user-select: none;
}
.plant-stack-face::-webkit-details-marker { display: none; }
.plant-stack-face::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--tint), transparent);
  opacity: 0.85;
  pointer-events: none;
}
.plant-stack-face:hover { background: color-mix(in srgb, var(--tint) 8%, transparent); }
```

---

## Shell card — `.shell-card`

The generic panel used for "Today", "Seal a stage", "List a sealed plant", the activity-reward card,
and the market info notes. Radius comes from `--shell-card-radius` (12px). An eyebrow label
(`.shell-card-eyebrow`) sits above the content in uppercase brass.

```html
<article class="shell-card today-card" id="dashboard-today-card">
  <p class="today-card-eyebrow">Today</p>
  <p class="today-card-line">Two plants are due for water.</p>
  <div class="today-card-actions"><!-- .btn set --></div>
</article>
```

---

## Segmented control — `.segmented-control`

Used for the Journal List/Month switch and the Tokenise/Market pane switch. A sliding
`.segmented-thumb` sits behind `.segmented-option` radio buttons; the active option is driven by the
`data-active` attribute on the wrapper.

```html
<div class="segmented-control journal-view-toggle" id="journal-view-toggle" data-active="month"
     role="radiogroup" aria-label="Journal view">
  <span class="segmented-thumb" aria-hidden="true"></span>
  <button type="button" class="segmented-option" data-journal-view="list" role="radio" aria-checked="false">List</button>
  <button type="button" class="segmented-option" data-journal-view="month" role="radio" aria-checked="true">Month</button>
</div>
```

---

## Toolbox card — `.toolbox-card`

The Measurements grid tile (Watering, Feeding, Environment, Transplanting, Stressors, Charts) and the
Admin grid tile. Always a `<button class="toolbox-card toolbox-card-btn">` holding an `<h3>` + `<p>`.

```css
.toolbox-card {
  /* base tile; a later block at app.css:6107 adds the ::before accent bar */
}
.toolbox-card h3 { /* tile title */ }
.toolbox-card p  { /* tile description */ }
```

---

## Section heading — `.section-heading`

Every section title in the app. Carries a `::before` rule mark (app.css:6079–6106).

```html
<h2 class="section-heading">My plants</h2>
```

---

## Modal — `.modal` / `.modal-content`

Two full modals exist in `app/index.html`: `#modal-plant` (new/edit plant, a 2-step wizard) and
`#modal-entry` (new journal entry). Opened by adding `.open`.

```html
<div id="modal-entry" class="modal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>New entry</h2>
      <button type="button" class="modal-close" aria-label="Close">&times;</button>
    </div>
    <form id="form-entry">
      <label>Date * <input type="date" lang="en-GB" id="entry-date" required /></label>
      <label>Note * <textarea id="entry-note" rows="4" required placeholder="What did you do today?"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost modal-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  </div>
</div>
```

```css
.modal { /* fixed overlay, hidden by default */ }
.modal.open { /* shown */ }
.modal form { }
.modal label { }
.modal label > input,
.modal label > select,
.modal label > textarea { }
.modal input, .modal select, .modal textarea { }
.modal input:focus, .modal select:focus, .modal textarea:focus { }
```

Forms in this app always use the *label-wraps-control* pattern — no separate `for`/`id` pairing, no
floating labels:

```html
<label>
  Plant name *
  <input type="text" id="plant-name" required placeholder="e.g. CBD Auto #1" />
</label>
```

---

## Bottom sheets

Three near-identical sheet patterns, all `position: fixed; inset: 0` with a backdrop button, a drag
handle, and a rounded top:

| Sheet | Root id | Purpose |
| --- | --- | --- |
| Log care | `#log-sheet-overlay` | pick plants → Log watering / Log feeding / Full entry |
| Account / settings | `#more-nav-overlay` | profile, appearance, language, links, log out |
| Daily status | `#daily-status-overlay` | "While you were away" digest |
| Reward earned | `#reward-earn-overlay` | care-day counted confirmation |
| Confirm | `#app-confirm-overlay` | generic confirm dialog |

```css
.more-nav-sheet {
  position: relative;
  z-index: 1;
  width: 100%;
  max-height: min(86vh, 36rem);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 18px 18px 0 0;
  border: 1px solid rgb(var(--mint-mid-rgb) / 0.18);
  border-bottom: 0;
  background: rgb(var(--surface-rgb) / 0.98);
  box-shadow: 0 -12px 40px rgb(var(--shadow-rgb) / 0.45);
  padding: 0 0 calc(0.75rem + env(safe-area-inset-bottom, 0));
  transform: translateY(12px);
  transition: transform 0.22s ease;
}
.more-nav-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  margin: 0;
  background: rgb(var(--surface-deep-rgb) / 0.58);
  cursor: pointer;
}
```

---

## Settings tile — `.settings-tile`

The 2-column grid inside the account sheet. Each tile is an icon + label; `--wide` spans both
columns, `--unlock` / `--logout` carry their own tint, `--mobile-only` hides on desktop.

```html
<button type="button" class="settings-tile" data-settings-panel="appearance" aria-expanded="false">
  <span class="settings-tile-icon" aria-hidden="true"><svg class="nav-svg" …/></span>
  <span class="settings-tile-label">Appearance</span>
</button>
```

---

## Header icon button — `.header-icon-btn`

Notification bell and avatar button in the main header.

```css
.notif-bell-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2.25rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid rgb(var(--mint-mid-rgb) / 0.35);
  border-radius: 8px;
  background: rgb(var(--green-glow-rgb) / 0.18);
  color: var(--brass);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 650;
}
.notif-bell-btn:hover {
  border-color: rgb(var(--mint-mid-rgb) / 0.55);
  background: rgb(var(--green-glow-rgb) / 0.28);
}
```

---

## Icons — reproduce 1:1

Every icon in the app is an inline SVG, 24×24 viewBox, `fill="none" stroke="currentColor"
stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`, class `nav-svg`. There is no icon
font and no icon library. The full set used in navigation:

```html
<!-- Journal (house/plant) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5h16"/><path d="M7 19.5V8.5l5-3 5 3v11"/></svg>

<!-- Stories (bookmarked book) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h10a2 2 0 012 2v14l-7-3-7 3V6a2 2 0 012-2z"/><path d="M9 8h4M9 12h4"/></svg>

<!-- Log (journal) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8a2 2 0 012 2v14l-6-3-6 3V6a2 2 0 012-2z"/><path d="M10 9h4M10 13h4"/></svg>

<!-- Coach (sprout) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-8"/><path d="M12 14c-3.2 0-5-2-5-5 3.2 0 5 2 5 5z"/><path d="M12 12c0-3 1.8-5 5-5 0 3-1.8 5-5 5z"/><circle cx="12" cy="6" r="2"/></svg>

<!-- Tokenise / Market (market stall) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l1.5-3h13L20 7"/><path d="M4 7h16v3a2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0V7z"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M9.5 20v-4.5h5V20"/></svg>

<!-- Admin (wrench) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 7a3.5 3.5 0 00-4.6 4.2l-5.6 5.6 1.9 1.9 5.6-5.6A3.5 3.5 0 0017 8.5l-2 2-1.5-1.5 2-2z"/></svg>

<!-- Appearance (sun) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1"/></svg>

<!-- Language (globe) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18 14 14 0 010-18z"/></svg>

<!-- Measurements (toolbox) -->
<svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="8" width="17" height="11.5" rx="2.5"/><path d="M8.5 8V6.5A2.5 2.5 0 0111 4h2a2.5 2.5 0 012.5 2.5V8"/><path d="M3.5 13h17"/></svg>

<!-- Notification bell (18×18, stroke-width 1.8) -->
<svg class="notif-bell-svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>

<!-- Checkmark (settings picker, stroke-width 2.4) -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-10"/></svg>
```

## Brand mark

`images/growtoo-mark-brass.png` — a round brass mark, used at 32×32 in the sidebar logo, 64×64 on the
boot splash, and as the favicon. The wordmark is plain lowercase text `growtoo` in `var(--font)` at
weight 700, brass colour, `letter-spacing: 0.02em`.
