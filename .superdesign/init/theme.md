# Theme — growtoo design tokens

Source of truth: `styles/tokens.css`, loaded before `app/styles/app.css` on every page that renders
growtoo chrome. No Tailwind, no PostCSS, no theme provider — plain CSS custom properties.

Three palettes exist:

1. `:root` — **dark** (warm forest + brass). This is the unthemed default state.
2. `:root[data-theme='light']` — **light** ("the catalog printed on paper"): brass splits into an
   ink-weight `--brass` (#7d6024, 5.8:1 on cream) and a fill-weight `--brass-fill` (#c9a55e).
3. `body.journal-paper` — **sage paper**, the palette the app and sign-in actually ship with. It
   overrides both of the above, and turns the accent green instead of brass.

An inline script in `app/index.html` writes `data-theme="light"` before first paint, reading
`localStorage['growtoo:appearance']` (`light` | `dark` | `system`, default `light`).

**The app body is always `class="app-loading journal-paper"`, so the sage-paper values below are the
ones that actually render.**

---

# Part 1 — Compact token summary

## Sage paper (what the app renders — `body.journal-paper`)

| Token | Value |
| --- | --- |
| `--bg` | `#f5faf3` (page canvas) |
| `--bg-alt` | `#ffffff` |
| `--surface` | `#eaf6e6` |
| `--surface-raised` | `#ffffff` |
| `--card-bg` | `#ffffff` |
| `--card-hover` | `#eaf6e6` |
| `--desk-panel` | `#ffffff` |
| `--text` | `#1a2c1e` |
| `--text-muted` | `#3d5648` |
| `--text-strong` | `#1a2c1e` |
| `--border` | `#c5d9be` |
| `--border-muted` | `#c5d9be` |
| `--desk-line` | `#c5d9be` |
| `--green` | `#3d6a38` |
| `--green-light` | `#4d7d46` |
| `--brass` (ink accent) | `#6b5420` |
| `--brass-fill` (button fill) | `#3d6a38` ← **green, not gold, on paper** |
| `--brass-hover` | `#2f542c` |
| `--brass-active` | `#2a4a28` |
| `--brass-ink` (text on fill) | `#ffffff` |
| `--accent` | `#3d6a38` |
| `--accent-warm` | `#6b5420` |
| `--field-bg` | `#ffffff` |
| `--canvas-top` / `--canvas-bottom` | `#f5faf3` / `#eaf6e6` |
| `--canvas-glow` | `#cfe0c6` |

So the app reads as **white cards on a pale sage canvas, deep-green ink, forest-green primary
buttons, olive-brass for eyebrow labels and accents, and a hairline `#c5d9be` border everywhere.**

## Dark (`:root`, the unthemed default)

| Token | Value |
| --- | --- |
| `--bg` | `#0f1a12` |
| `--bg-alt` | `#142018` |
| `--surface` | `rgba(180, 200, 180, 0.05)` |
| `--card-bg` | `#132016` |
| `--card-hover` | `#18261c` |
| `--text` | `#f3efe6` |
| `--text-muted` | `rgb(184 196 176 / 0.78)` |
| `--border` | `rgb(201 165 94 / 0.18)` |
| `--brass` / `--brass-fill` | `#c9a55e` |
| `--brass-hover` / `--brass-active` | `#d8b872` / `#b08f45` |
| `--brass-ink` | `#1a1408` |
| `--green` / `--green-light` | `#b8d4b0` / `#cfe0c6` |
| `--rust` | `#a86b4f` |

## Light paper (`:root[data-theme='light']`)

`--bg #f5faf3`, `--bg-alt #ffffff`, `--surface #eaf6e6`, `--text #1a2c1e`, `--text-muted #3d5648`,
`--border #c5d9be`, `--brass #7d6024` (ink), `--brass-fill #c9a55e` (gold fill), `--card-bg #fffefa`.

## Stage tints (drive `.plant-card` / `.plant-stack` accents)

| Stage (`data-stage-key`) | `--tint` | dark value | sage-paper value |
| --- | --- | --- | --- |
| `seed` | `--brass` | `#c9a55e` | `#6b5420` |
| `germination` | `--leaf` | `#9ab97f` | `#5b7a45` |
| `seedling` | `--leaf-mid` | `#86ad72` | `#517037` |
| `vegetative` | `--leaf-deep` | `#6f9457` | `#45632f` |
| `flowering` | `--brass-earth` | `#c98a4f` | `#9a6530` |
| `harvest` | `--brass-active` | `#b08f45` | `#2a4a28` |

## Status colours

| Token | dark | light/paper |
| --- | --- | --- |
| `--ok` | `#34d399` | `#2f7d52` |
| `--warn` | `#f59e0b` | `#9a6408` |
| `--danger` | `#f87171` | `#b3402c` |
| `--info` | `#5fb6ff` | `#1f6fb0` |

## Typography

| Token | Value |
| --- | --- |
| `--font` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` |
| `--font-serif` | `-apple-system, BlinkMacSystemFont, 'SF Pro Display', …` (used for `.entry-note`) |
| `--font-display` | `-apple-system, BlinkMacSystemFont, 'SF Pro Display', …` (used for `.view-title`, card titles) |
| `--font-mono` | `'JetBrains Mono', monospace` — the **only** webfont loaded in the app (Google Fonts, weights 400/500) |

There is no embedded display face: the system stack resolves to real San Francisco on macOS/iOS,
which is deliberate (SF Pro's licence only covers Apple-platform software).

Observed type scale:

| Role | Size / weight |
| --- | --- |
| `.view-title` | `1.55rem` / 350, `letter-spacing: -0.02em`, `--font-display` |
| `.section-heading` | ~`1.15rem`, carries a `::before` rule mark |
| `.plant-card h3` | `1.1rem` / 600 |
| body / `.entry-note` | `0.95rem`, `line-height: 1.6` |
| `.btn` | `0.95rem` / 650 |
| `.btn-sm` | `0.82rem` |
| `.plant-card .strain`, `.entry-meta-block` | `0.85–0.9rem` |
| `.entry-meta`, `.notif-bell-btn` | `0.78–0.8rem` |
| `.subphase-badge`, `.entry-type`, `.stage-badge` | `0.72–0.75rem` |
| eyebrow labels (`.shell-card-eyebrow`, `.today-card-eyebrow`) | `0.72rem` / 650, `letter-spacing: 0.1em`, uppercase, brass |

## Radius

| Token | Value | Used by |
| --- | --- | --- |
| `--radius-pill` | `999px` | chips |
| `--radius-control` | `14px` | `.btn` |
| `--radius-row` | `14px` | list rows |
| `--radius-card` | `20px` | large cards |
| `--radius-sheet` | `22px` | bottom sheets |
| `--shell-card-radius` | `12px` | `.shell-card` |
| literal `16px` | | `.plant-card`, `.plant-stack` |
| literal `12px` | | `.journal-entry`, `.plant-card-photo` |
| literal `8px` | | selects, `.notif-bell-btn` |
| literal `4–6px` | | badges (`.entry-type` 4px, `.stage-badge` 6px) |

## Spacing

rem-based, no numeric scale. The values in use: `0.25 / 0.35 / 0.5 / 0.65 / 0.75 / 1 / 1.25 / 1.5 / 2rem`.
`.main` padding is `1.5rem 2rem`; cards pad `1–1.25rem`; grid gaps are `0.75–1rem`.

## Shadows & fills

| Token | dark | paper |
| --- | --- | --- |
| `--shadow` | `0 8px 24px rgb(0 0 0 / 0.35)` | `0 6px 20px rgb(61 106 56 / 0.1)` |
| `--shadow-md` | `0 16px 48px rgb(0 0 0 / 0.45)` | `0 14px 40px rgb(61 106 56 / 0.14)` |
| `--fill-sheen` | `inset 0 1px 0 rgb(255 255 255 / 0.34), inset 0 -1px 0 rgb(0 0 0 / 0.14)` | inverted per theme |
| `--fill-lift` | `0 1px 2px rgb(0 0 0 / 0.22)` | `0 1px 2px rgb(60 50 20 / 0.12)` |
| `--focus-ring` | `0 0 0 2px var(--bg), 0 0 0 4px var(--brass)` | same formula |

## Motion

| Token | Value |
| --- | --- |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| `--ease-control` | `cubic-bezier(0.25, 0.1, 0.25, 1)` |

Durations are `0.15s` for controls, `0.2s` for cards, `0.22s` for sheets. `.btn:active` scales to
`0.96`. Views rise in with `@keyframes catalog-view-rise` (10px translate + fade).

## Canvas texture

`body::before` lays a fixed 48px graph-paper grid at `opacity: 0.28` in
`rgb(var(--sage-rgb) / 0.035)`, masked out toward the bottom. `body` itself carries two radial
gradients (a brass glow top-right, a green glow mid-left) over a vertical
`--canvas-top → --bg → --canvas-bottom` gradient. This paper-under-ink feel is the app's signature
and should survive any redesign.

## Breakpoints

| Query | Effect |
| --- | --- |
| `max-width: 768px` | sidebar hidden, `.bottom-nav` shown, single-column grids, swipe-to-delete on entries |
| `min-width: 769px` | inline Delete buttons, `.journal-swipe-actions` hidden |

---

# Part 2 — Raw source

## `styles/tokens.css` (full)

```css
/* ============================================================
   growtoo design tokens — single source of truth.

   Linked by every page that renders growtoo chrome: the app
   (app/index.html + admin/tools pages) and the sign-in page
   (dnevnik/index.html), which used to carry its own copy.

   Load this BEFORE app.css. A second theme restates the values
   here and nowhere else.
   ============================================================ */
:root {
  /* Channel triplets for the colours that get reused at many opacities.
     Written bare (`201 165 94`) so they can be composed as
     `rgb(var(--brass-rgb) / 0.28)` instead of repeating the literal. */
  --brass-rgb: 201 165 94;      /* --brass  #c9a55e */
  --brass-hi-rgb: 232 196 106;  /* brass highlight #e8c46a */
  --rust-rgb: 168 107 79;       /* --rust   #a86b4f */
  --alert-rgb: 180 71 43;       /* alert / danger glow */
  --forest-rgb: 31 46 34;       /* deep forest surface tint */
  --ink-rgb: 184 196 176;       /* muted green ink */
  --white-rgb: 255 255 255;
  --shadow-rgb: 0 0 0;
  --scrim-rgb: 0 0 0;      /* modal/overlay backdrops — black in both themes */
  --paper-rgb: 247 238 225;  /* warm off-white ink */

  /* Catalog system — warm forest + brass (matches landing). */
  --bg: #0f1a12;
  --bg-alt: #142018;
  --surface: rgba(180, 200, 180, 0.05);
  --green: #b8d4b0;
  --green-light: #cfe0c6;
  /* --brass is the ink-weight accent (text, icons, borders — 90 uses).
     --brass-fill is brass as a filled surface (buttons — 15 uses), with
     --brass-ink as the text on top of it. */
  --brass: #c9a55e;
  --brass-fill: #c9a55e;
  --brass-hover: #d8b872;
  --brass-active: #b08f45;
  --brass-ink: #1a1408;
  --brass-disabled-bg: #2a3530;
  --brass-disabled-ink: #6a7568;
  --rust: #a86b4f;
  --rust-hover-fill: rgb(var(--rust-rgb) / 0.14);
  --accent: var(--brass-active);
  --accent-hover: var(--brass);
  --accent-bright: var(--brass);
  --accent-warm: var(--brass);
  --text: #f3efe6;
  --text-muted: rgb(var(--ink-rgb) / 0.78);
  --border: rgb(var(--brass-rgb) / 0.18);
  --shadow: 0 8px 24px rgb(var(--shadow-rgb) / 0.35);
  --shadow-md: 0 16px 48px rgb(var(--shadow-rgb) / 0.45);
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-serif: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --desk-panel: linear-gradient(180deg, rgba(18, 28, 20, 0.94) 0%, rgba(12, 20, 14, 0.97) 100%);
  --desk-line: rgb(var(--brass-rgb) / 0.14);
  --card-bg: #132016;
  --card-hover: #18261c;
  --shell-card-radius: 12px;
  --radius-pill: 999px;
  --radius-control: 14px;
  --radius-card: 20px;
  --radius-row: 14px;
  --radius-sheet: 22px;
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-control: cubic-bezier(0.25, 0.1, 0.25, 1);
  --fill-sheen: inset 0 1px 0 rgb(var(--white-rgb) / 0.34), inset 0 -1px 0 rgb(var(--shadow-rgb) / 0.14);
  --fill-lift: 0 1px 2px rgb(var(--shadow-rgb) / 0.22);
  --pill-track: inset 0 1px 2px rgb(var(--shadow-rgb) / 0.38), inset 0 0 0 0.5px rgb(var(--white-rgb) / 0.08);
  --chip-hairline: inset 0 0 0 0.5px rgb(var(--white-rgb) / 0.16), inset 0 1px 0 rgb(var(--white-rgb) / 0.08);
  --metric-panel-bg: rgba(12, 22, 16, 0.9);
  --metric-panel-border: rgb(var(--brass-rgb) / 0.2);
  --metric-card-bg: rgba(10, 18, 14, 0.96);
  --metric-card-border: rgb(var(--white-rgb) / 0.07);
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--brass);

  /* Semantic colours. */
  --accent-forest: #3d5c44;
  --accent-moss: #2f4a36;
  --brass-earth: #c98a4f;
  --brass-hi: #e8c46a;
  --brass-lo: #8a7340;
  --brass-pale: #f0d58a;
  --brass-pale-2: #f0d090;
  --canvas-bottom: #101c14;
  --canvas-top: #0c1610;
  --danger: #f87171;
  --danger-ink: #ffb4a8;
  --danger-ink-soft: #ffd9c8;
  --danger-solid: #b4472b;
  --danger-tint: #fecaca;
  --info: #5fb6ff;
  --info-tint: #9ecfff;
  --ink-bright: #f4fff4;
  --ink-on-brass: #06201a;
  --ink-panel: #f2f6f0;
  --ink-panel-2: #f2f4ef;
  --ink-soft: #9aab9c;
  --ink-warm: #faf4ea;
  --leaf: #9ab97f;
  --leaf-deep: #6f9457;
  --leaf-mid: #86ad72;
  --ok: #34d399;
  --ok-soft: #6fbf78;
  --ok-solid: #2f8f4e;
  --ok-tint: #c8ffd4;
  --ok-tint-2: #b6f4c4;
  --ok-tint-3: #b8e0c2;
  --rust-soft: #b87658;
  --surface-panel: #121c16;
  --warn: #f59e0b;
  --warn-tint: #ffd9a8;

  /* Used by the sign-in page (dnevnik/). */
  --canvas-glow: rgba(40, 80, 50, 0.18);
  --ink-faint: rgba(150, 180, 150, 0.28);
  --text-strong: rgb(243 239 230 / 0.9);
  --field-bg: rgba(6, 14, 10, 0.55);
  --field-bg-strong: rgba(6, 14, 10, 0.65);
  --border-muted: rgba(106, 117, 104, 0.45);

  /* ---- Surface & accent scale ----
     Three surface depths preserve the elevation order (deep < base < raised). */
  --surface-deep-rgb: 6 14 10;
  --surface-rgb: 12 24 16;
  --surface-raised-rgb: 30 48 35;

  --text-rgb: 243 239 230;
  --sage-rgb: 160 195 160;
  --sage-light-rgb: 190 215 188;
  --olive-rgb: 120 145 110;

  --mint-rgb: 152 242 172;
  --mint-mid-rgb: 120 221 141;
  --green-glow-rgb: 40 110 58;
  --leaf-glow-rgb: 90 140 80;

  --brass-mid-rgb: 185 134 46;
  --rust-deep-rgb: 142 53 32;
  --orange-rgb: 212 90 56;
  --peach-rgb: 255 160 120;
  --warn-rgb: 245 158 11;
  --danger-rgb: 248 113 113;
  --ok-rgb: 52 211 153;

  /* Decorative accents — chart series, badges, tool cards. */
  --violet-rgb: 199 155 255;
  --sky-rgb: 95 182 255;
  --gold-rgb: 230 190 80;
  --clay-rgb: 224 180 152;
  --ember-rgb: 180 83 9;

  /* Marketing site (styles/landing.css) shares these. */
  --cream-rgb: 255 231 168;
  --mint-bright-rgb: 200 255 212;
  --umber-rgb: 80 55 10;
  --teal-rgb: 94 200 216;
}

/* ============================================================
   Light theme — the catalog printed on paper.

   Dark is the DEFAULT and the unthemed state: this block only ever
   applies when data-theme="light" is set on <html>.

   This is not the dark scheme inverted:
   - brass splits. #c9a55e as text on cream measures 2.31:1, so the
     ink-weight accent drops to #7d6024 (5.8:1) while --brass-fill
     keeps the gold for buttons.
   - status colours re-derive.
   - cards gain a hairline shadow.
   ============================================================ */
:root[data-theme='light'] {
  --brass-rgb: 114 87 31;
  --brass-hi-rgb: 150 116 44;
  --rust-rgb: 141 82 51;
  --alert-rgb: 150 52 28;
  --forest-rgb: 120 140 122;
  --ink-rgb: 37 58 42;
  --white-rgb: 24 34 26;   /* "white" overlays become dark scrims on paper */
  --paper-rgb: 26 38 29;
  --shadow-rgb: 60 50 20;
  --scrim-rgb: 0 0 0;

  --surface: #eaf6e6;
  --green: #3d6a38;
  --green-light: #4d7d46;
  --brass: #7d6024;
  --brass-fill: #c9a55e;
  --brass-hover: #b8923f;
  --brass-active: #8f7030;
  --brass-ink: #241a05;
  --brass-disabled-bg: #e2ddce;
  --brass-disabled-ink: #9a9482;
  --rust: #8d5233;
  --text: #1a2c1e;
  --text-muted: #3d5648;
  --text-strong: #1a2c1e;
  --bg: #f5faf3;
  --bg-alt: #ffffff;
  --border: #c5d9be;
  --fill-sheen: inset 0 1px 0 rgb(var(--white-rgb) / 0.55), inset 0 -1px 0 rgb(var(--shadow-rgb) / 0.08);
  --fill-lift: 0 1px 2px rgb(var(--shadow-rgb) / 0.12);
  --pill-track: inset 0 1px 2px rgb(var(--shadow-rgb) / 0.1), inset 0 0 0 0.5px rgb(var(--brass-rgb) / 0.16);
  --chip-hairline: inset 0 0 0 0.5px rgb(var(--brass-rgb) / 0.22), inset 0 1px 0 rgb(var(--white-rgb) / 0.7);
  --shadow: 0 6px 20px rgb(var(--shadow-rgb) / 0.1);
  --shadow-md: 0 14px 40px rgb(var(--shadow-rgb) / 0.14);
  --desk-panel: linear-gradient(180deg, rgba(255, 254, 250, 0.96) 0%, rgba(247, 243, 232, 0.98) 100%);
  --desk-line: rgb(var(--brass-rgb) / 0.16);
  --card-bg: #fffefa;
  --card-hover: #f7f3e8;
  --metric-panel-bg: rgba(250, 247, 238, 0.9);
  --metric-card-bg: #fffefa;
  --metric-card-border: rgb(var(--brass-rgb) / 0.14);

  /* Semantic layer */
  --accent-forest: #4a6b50;
  --accent-moss: #3f5a45;
  --brass-earth: #9a6530;
  --brass-hi: #96742c;
  --brass-lo: #6b5220;
  --brass-pale: #8a6c2a;
  --brass-pale-2: #8a6828;
  --canvas-bottom: #eaf6e6;
  --canvas-top: #f5faf3;
  --danger: #b3402c;
  --danger-ink: #8d3f1a;
  --danger-ink-soft: #a05a3c;
  --danger-solid: #b4472b;
  --danger-tint: #8f4436;
  --info: #1f6fb0;
  --info-tint: #2b6d9e;
  --ink-bright: #16241a;
  --ink-on-brass: #241a05;
  --ink-panel: #1b2a1f;
  --ink-panel-2: #1e2c22;
  --ink-soft: #566356;
  --ink-warm: #3a3327;
  --leaf: #5b7a45;
  --leaf-deep: #45632f;
  --leaf-mid: #517037;
  --ok: #2f7d52;
  --ok-soft: #3c7a44;
  --ok-solid: #2f8f4e;
  --ok-tint: #2c6b3c;
  --ok-tint-2: #327040;
  --ok-tint-3: #3a6b46;
  --rust-soft: #8a5540;
  --surface-panel: #f0ece0;
  --warn: #9a6408;
  --warn-tint: #8a5c12;

  /* Surfaces keep their elevation ORDER but reverse direction. */
  --surface-deep-rgb: 226 220 205;
  --surface-rgb: 244 240 230;
  --surface-raised-rgb: 255 254 250;

  --text-rgb: 23 37 27;
  --sage-rgb: 74 96 76;
  --sage-light-rgb: 52 72 54;
  --olive-rgb: 92 108 82;

  --mint-rgb: 36 100 66;
  --mint-mid-rgb: 33 96 62;
  --green-glow-rgb: 62 130 84;
  --leaf-glow-rgb: 88 125 78;

  --brass-mid-rgb: 140 100 30;
  --rust-deep-rgb: 150 62 38;
  --orange-rgb: 180 74 44;
  --peach-rgb: 175 85 50;
  --warn-rgb: 154 100 8;
  --danger-rgb: 179 64 44;
  --ok-rgb: 47 125 82;

  --violet-rgb: 118 74 176;
  --sky-rgb: 26 108 168;
  --gold-rgb: 148 108 20;
  --clay-rgb: 150 96 66;
  --ember-rgb: 154 72 8;

  --cream-rgb: 112 80 16;
  --mint-bright-rgb: 32 94 60;
  --umber-rgb: 108 88 44;
  --teal-rgb: 24 108 120;

  --canvas-glow: #cfe0c6;
  --ink-faint: #3d5648;
  --text-strong: #1a2c1e;
  --field-bg: rgba(233, 228, 214, 0.75);
  --field-bg-strong: rgba(226, 220, 203, 0.85);
  --border-muted: rgb(var(--brass-rgb) / 0.3);
}

/* Sage paper — same growtoo journal as landing / app. Sign-in and any
   page with body.journal-paper inherit this from tokens, without waiting
   for appearance settings. THIS IS WHAT THE APP RENDERS. */
body.journal-paper {
  --bg: #f5faf3;
  --bg-alt: #ffffff;
  --surface: #eaf6e6;
  --surface-raised: #ffffff;
  --text: #1a2c1e;
  --text-muted: #3d5648;
  --text-faint: #3d5648;
  --text-strong: #1a2c1e;
  --text-rgb: 26 44 30;
  --white-rgb: 26 44 30;
  --ink-rgb: 61 86 72;
  --ink-bright: #1a2c1e;
  --ink-soft: #3d5648;
  --ink-faint: #c5d9be;
  --paper-rgb: 26 44 30;
  --sage-rgb: 61 106 56;
  --sage-light-rgb: 61 86 72;
  --olive-rgb: 61 86 72;
  --surface-deep-rgb: 234 246 230;
  --surface-rgb: 245 250 243;
  --surface-raised-rgb: 255 255 255;
  --shadow-rgb: 61 106 56;
  --green: #3d6a38;
  --green-light: #4d7d46;
  --brass: #6b5420;
  --brass-rgb: 107 84 32;
  --brass-fill: #3d6a38;
  --brass-hover: #2f542c;
  --brass-active: #2a4a28;
  --brass-ink: #ffffff;
  --accent: #3d6a38;
  --accent-hover: #2f542c;
  --accent-bright: #3d6a38;
  --accent-warm: #6b5420;
  --border: #c5d9be;
  --border-muted: #c5d9be;
  --desk-panel: #ffffff;
  --desk-line: #c5d9be;
  --card-bg: #ffffff;
  --card-hover: #eaf6e6;
  --surface-panel: #ffffff;
  --canvas-top: #f5faf3;
  --canvas-bottom: #eaf6e6;
  --canvas-glow: #cfe0c6;
  --field-bg: #ffffff;
  --field-bg-strong: #ffffff;
  --mint-rgb: 36 100 66;
  --mint-mid-rgb: 33 96 62;
  --mint-bright-rgb: 45 92 58;
  background: #f5faf3;
  color: #1a2c1e;
}

html:has(body.journal-paper) {
  background-color: #f5faf3;
}
```

## Webfont link (`app/index.html:13–15`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

## Stylesheet load order (`app/index.html:61–64`)

```html
<link rel="stylesheet" href="../styles/tokens.css?v=20260817v" />
<link rel="stylesheet" href="styles/app.css?v=20260819j" />
<link rel="stylesheet" href="../styles/trust-gates.css?v=20260820a" />
<link rel="stylesheet" href="../styles/i18n.css?v=20260817p" />
```

No `tailwind.config.*` and no `globals.css` exist in this repo — `styles/tokens.css` is the
equivalent, and `app/styles/app.css` (13,912 lines) is the component layer. When passing CSS as
design context, pass this file's Part 1 summary plus targeted line ranges of `app/styles/app.css`;
never pass `app/styles/app.css` whole.
