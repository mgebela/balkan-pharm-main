# growtoo — design system

## Product context

growtoo is a grow journal for cannabis growers, plus a market where adopters can back a grower's
plant. The core promise is **the trail**: a grower logs care day after day, and that record is what
makes a plant worth backing. Everything in the product exists to make logging fast and the record
legible.

**Audiences share one app.** A `body.profile-grower` / `body.profile-adopter` class flips which
sections render and swaps nav labels ("Tokenise" for growers, "Market" for adopters). There is no
separate adopter build.

### Key screens

| Screen | Job |
| --- | --- |
| **Journal** (`#view-plants`) | the home screen. Plant grid + the care trail (list or month calendar) |
| **Measurements** (`#view-toolbox`) | structured logging — watering, feeding, environment, transplant, stressors, charts. Every entry also writes to the Journal trail |
| **Plant page** (`#view-growlog`) | one plant: photos, strain, stages, environment, seed-to-harvest timeline |
| **Tokenise** (`#view-adopt`) | seal a stage → mint a plant NFT (Devnet) |
| **Market** (`#view-market`) | list a sealed plant, browse open asks, invest |
| **Stories** (`#view-blog`) | public write-ups linked to a plant |

### Jobs to be done

1. *Log today's care in under ten seconds* — the Log sheet is reachable from the sidebar, a mobile
   FAB, and every plant card.
2. *See at a glance what needs attention today* — the Today card and the Start-here strip.
3. *Prove the trail* — a legible, continuous record: 14 days elapsed with care on at least half of
   them is what unlocks a market listing.
4. *Learn while growing* — an AI Coach reads the journal and annotates entries.

### Constraints that shape design

- **No build step.** Vanilla HTML + CSS + `window`-scoped JS. Designs must be expressible as plain
  HTML and CSS — no framework-only patterns.
- **Three locales** (en, hr, de). German runs ~30% longer than English; labels must not be pinned to
  a fixed width.
- **Mobile-first reality.** Growers log from a tent or a field on a phone. Touch targets are 48px
  minimum (`.btn` enforces `min-height: 48px`).
- **Offline-ish tolerance.** The boot splash has a 12-second stall state because connections drop.

---

## Branding & styling

### Palette — sage paper (what the app renders)

The app body always carries `class="journal-paper"`, so this is the live palette:

| Role | Value |
| --- | --- |
| Page canvas | `#f5faf3` |
| Raised surface / card | `#ffffff` |
| Sunken surface | `#eaf6e6` |
| Border hairline | `#c5d9be` |
| Primary text | `#1a2c1e` |
| Muted text | `#3d5648` |
| Primary button fill | `#3d6a38` (forest green), text `#ffffff` |
| Button hover / active | `#2f542c` / `#2a4a28` |
| Ink accent (eyebrows, icons, links) | `#6b5420` (olive brass) |

**White cards on pale sage, deep-green ink, forest-green buttons, olive-brass accents.** A dark
theme (`:root`, warm forest `#0f1a12` + gold brass `#c9a55e`) exists and must keep working, but
design against sage paper.

### Stage tints

Plant cards carry a 3px gradient bar tinted by growth stage — the fastest scan cue in the product:

germination `#5b7a45` · seedling `#517037` · vegetative `#45632f` · flowering `#9a6530` · harvest `#2a4a28`

### Typography

- `--font` — system stack (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto…`).
  Real San Francisco on Apple hardware, zero embedding cost.
- `--font-serif` / `--font-display` — the same system stack at display weights. Used for `.view-title`
  and `.entry-note`.
- `--font-mono` — `'JetBrains Mono'`, the only webfont the app loads (Google Fonts, 400/500).

Scale: `.view-title` 1.55rem/350 with `-0.02em` tracking; `.plant-card h3` 1.1rem/600; body 0.95rem
at 1.6 line-height; `.btn` 0.95rem/650; eyebrow labels 0.72rem/650 uppercase with `0.1em` tracking.

### Spacing, radius, elevation

- Spacing is rem-based and informal: `0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2rem`. `.main` pads
  `1.5rem 2rem`; cards pad `1–1.25rem`; grid gaps `0.75–1rem`.
- Radius: buttons and rows `14px`, shell cards `12px`, plant cards and stacks `16px`, large cards
  `20px`, bottom sheets `22px` (top corners only), chips `999px`, small badges `4–6px`.
- Elevation is soft and green-tinted on paper: `0 6px 20px rgb(61 106 56 / 0.1)`, lifting to
  `0 14px 40px rgb(61 106 56 / 0.14)` on hover.
- Focus is always `0 0 0 2px var(--bg), 0 0 0 4px var(--brass)` — never a browser outline.

### Layout structure

- Desktop: 240px sidebar + fluid `.main`. Mobile (≤768px): sidebar hidden, fixed 4-slot bottom tab
  bar with a raised centre FAB for Log.
- Plant grid: `repeat(auto-fill, minmax(280px, 1fr))`, 1rem gap. Journal trail: a vertical flex
  column with 0.75rem gaps.
- Sections are stacked `.plants-journal-section` blocks, each opening with a `.section-heading`.

### Signature texture

`body::before` lays a fixed 48px graph-paper grid at 0.28 opacity, masked out toward the bottom, over
two soft radial glows (brass top-right, green mid-left). This *paper-under-ink* quality is the brand
and should survive any redesign.

### Iconography

Inline SVG only — 24×24 viewBox, `fill="none" stroke="currentColor" stroke-width="1.6"`, round caps
and joins, class `nav-svg`. No icon font, no icon library. Icons are line-drawn and slightly
botanical (a sprout for Coach, a bookmarked book for Stories, a market stall for Tokenise).

### Logo

`images/growtoo-mark-brass.png` — a round brass mark. 32×32 in the sidebar beside the lowercase
wordmark `growtoo` (weight 700, `0.02em` tracking, brass), 64×64 on the boot splash. Every logo
position must render this exact file; never initials, an emoji, or an invented mark.

---

## Motion

| Token | Value | Used for |
| --- | --- | --- |
| `--ease-control` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | buttons, nav, inputs — 0.15s |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | sheets and the segmented thumb |

Cards transition border and shadow over 0.2s. `.btn:active` scales to `0.96`. Views enter with
`catalog-view-rise` (10px rise + fade). Bottom sheets slide up over 0.22s and are drag-dismissible
(`app/js/sheet-drag.js`). Nothing bounces gratuitously — the product's tone is calm and clerical.

---

## Voice

Plain, lowercase-friendly, no exclamation marks. Labels are verbs ("Log care", "Seal a stage",
"Post to market"). Hints explain the rule rather than cheerleading: *"Offers need a journal trail: 14
days since the first watering or feeding log, with care on at least half of those days."* The brand
name is always lowercase `growtoo`.

---

## Project requirements for design work

1. Every design must work at ≤768px — the phone is the primary logging device.
2. Keep the three-part reading order on the Journal: what needs doing today → my plants → the trail.
3. Copy must tolerate 30% expansion for German.
4. Touch targets stay at 48px.
5. Designs must be plain HTML/CSS — no framework primitives.
6. The dark theme must remain expressible: colour choices should route through the token names, not
   raw hex.
