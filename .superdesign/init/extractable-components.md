# Extractable components — growtoo app

These are HTML/CSS patterns, not framework components: there are no `.tsx`/`.vue` files to convert.
Each entry below points at the markup in `app/index.html` (or the template string in `app/js/*.js`)
that defines it, plus the CSS contract in `app/styles/app.css`.

Conversion note: every label is wrapped in `data-i18n="<key>"`. Drop the attribute when converting to
a Petite-Vue template and keep the visible English text.

---

## Layout Components (appear on most pages)

### Sidebar
- Source: `app/index.html:127:158` (markup), `app/styles/app.css:655:720` (CSS)
- Category: layout
- Description: 240px desktop rail — brass wordmark + round brass mark, then 6 nav items (Journal, Stories, Log, Coach, Tokenise, Admin)
- Extractable props: `activeItem` (string, default: `"plants"`), `showAdmin` (boolean, default: `false`), `marketLabel` (string, default: `"Tokenise"`), `chainLocked` (boolean, default: `false`)
- Hardcoded: the six inline nav SVGs, `images/growtoo-mark-brass.png`, the wordmark text `growtoo`, all CSS classes, `data-view` values

### BottomNav
- Source: `app/index.html:160:197` (markup), `app/styles/app.css:722:724` + the `max-width: 768px` block (CSS)
- Category: layout
- Description: mobile 4-slot tab bar — Journal, a raised Log FAB, Coach, Tokenise/Market
- Extractable props: `activeItem` (string, default: `"plants"`), `marketLabel` (string, default: `"Tokenise"`)
- Hardcoded: nav SVGs (the FAB icon uses `stroke-width="1.8"`, the rest `1.6`), `.bottom-nav-log-fab` structure, all CSS

### MainHeader
- Source: `app/index.html:296:333` (markup), `app/styles/app.css:1306:1360` (CSS)
- Category: layout
- Description: view title on the left; profile badge, wallet pill, notification bell and avatar button on the right
- Extractable props: `title` (string, default: `"Journal"`), `profileType` (string, default: `"Grower"`), `showProfileBadge` (boolean, default: `false`), `notificationCount` (number, default: `0`), `showNotificationDot` (boolean, default: `false`), `avatarInitial` (string, default: `"G"`)
- Hardcoded: bell SVG, `.header-avatar-mark` shape, all CSS, aria wiring

### AccountSheet
- Source: `app/index.html:199:267`
- Category: layout
- Description: bottom sheet holding the profile block, a 2-column settings grid, and inline appearance/language pickers
- Extractable props: `appearance` (string, default: `"light"`), `showAdminTile` (boolean, default: `false`), `chainLocked` (boolean, default: `false`)
- Hardcoded: tile icons, tile labels, Privacy/Terms hrefs, all CSS

### LogCareSheet
- Source: `app/index.html:270:293`
- Category: layout
- Description: the app's fastest care-logging path — plant multi-select listbox + three action buttons
- Extractable props: `hasPlants` (boolean, default: `true`)
- Hardcoded: heading "Log care", the hint copy, the three button labels, all CSS

### AppBoot
- Source: `app/index.html:69:84`
- Category: layout
- Description: pre-hydration splash — brass mark, wordmark, "Opening your journal…", pulse, and a stalled state with Retry / Back to sign in
- Extractable props: `stalled` (boolean, default: `false`)
- Hardcoded: mark image, all copy, all CSS

---

## Basic Components (used across pages)

### PlantCard
- Source: `app/js/app.js:5809:5881` (`plantCardHtml`), `app/styles/app.css:3544:3648` (CSS)
- Category: basic
- Description: one plant in the Journal grid — cover photo, byline, name, TL;DR line, optional pot/field badges, and a 3-button action row
- Extractable props: `name` (string), `byline` (string), `tldr` (string), `stageKey` (string, default: `"vegetative"`), `avatarInitial` (string), `photoUrl` (string, default: `""`), `subphase` (string, default: `""`), `fieldLocation` (string, default: `""`), `shared` (boolean, default: `false`)
- Hardcoded: the `::before` stage-tint bar, the stage→tint map, button labels, all CSS

### JournalEntryCard
- Source: `app/js/app.js:7082:7135` (`entryCardHtml`), `app/styles/app.css:3816:3899` (CSS)
- Category: basic
- Description: one logged care event — type chip, optional "via Tools" badge, plant · date, the note in the serif face, optional coach note, meta blocks and media
- Extractable props: `typeLabel` (string, default: `"Watering"`), `plantName` (string), `date` (string), `note` (string), `fromTools` (boolean, default: `false`), `coachNote` (string, default: `""`), `deletable` (boolean, default: `true`)
- Hardcoded: `.entry-type` / `.entry-source--tools` chip styling, the Delete button, all CSS

### PlantStack
- Source: `app/js/plant-stacks.js` (`wrapStackHtml`), `app/styles/app.css:3367:3430` (CSS)
- Category: basic
- Description: a `<details>` face that collapses same-strain, same-stage plants into one card; expands full-width to reveal members
- Extractable props: `strain` (string), `count` (number, default: `2`), `stageKey` (string, default: `"vegetative"`), `open` (boolean, default: `false`)
- Hardcoded: the deck-edge pseudo-elements, the tint map, all CSS

### ShellCard
- Source: `app/index.html:435:439` (the Today card is the canonical instance)
- Category: basic
- Description: generic panel with an uppercase brass eyebrow, a lead line, and an action row
- Extractable props: `eyebrow` (string, default: `"Today"`), `lead` (string), `variant` (string, default: `""`)
- Hardcoded: `--shell-card-radius`, eyebrow letter-spacing, all CSS

### SegmentedControl
- Source: `app/index.html:472:482` (Journal List/Month), `app/index.html:510:515` (Tokenise/Market)
- Category: basic
- Description: two-option switch with a sliding thumb; active option set by `data-active` on the wrapper
- Extractable props: `optionOne` (string, default: `"List"`), `optionTwo` (string, default: `"Month"`), `active` (string, default: `"month"`)
- Hardcoded: `.segmented-thumb`, role/aria wiring, all CSS

### ToolboxCard
- Source: `app/index.html:836:839`, `app/styles/app.css:96:110` + `:6107:6130`
- Category: basic
- Description: a Measurements (or Admin) grid tile — `<button>` with an `<h3>` and a one-line `<p>`
- Extractable props: `title` (string, default: `"Watering"`), `description` (string), `tool` (string, default: `"watering"`)
- Hardcoded: the `::before` accent, all CSS

### Button
- Source: `app/styles/app.css:2054:2173`
- Category: basic
- Description: `.btn` with `primary` / `secondary` / `ghost` / `destructive` variants and `sm` / `lg` sizes
- Extractable props: — *skip extraction, inline it*

### SectionHeading
- Source: `app/styles/app.css:6079:6106`
- Category: basic
- Description: `<h2 class="section-heading">` with a `::before` rule mark
- Extractable props: — *skip extraction, inline it*

### Badge / chip family
- Source: `.stage-badge` (`app.css:3612`), `.subphase-badge` (`:3626`), `.entry-type` (`:3837`), `.entry-source--tools` (`:3857`), `.profile-type-badge`, `.grower-rank-chip`
- Category: basic
- Extractable props: — *skip extraction, inline them*

### Modal
- Source: `app/index.html:1053:1207` (`#modal-plant`), `app/index.html:1209:1295` (`#modal-entry`), `app/styles/app.css:4204:4290` + `:4418:4445`
- Category: basic
- Description: centred dialog with `.modal-header` (title + `×`), a form using the label-wraps-control pattern, and a `.modal-actions` footer
- Extractable props: `title` (string, default: `"New entry"`)
- Hardcoded: the close glyph, the form field pattern, all CSS

---

## Recommended extraction order

1. **Sidebar**, **BottomNav**, **MainHeader** — on every screen, highest consistency payoff.
2. **PlantCard**, **JournalEntryCard** — the two objects the Journal view is made of.
3. **ShellCard**, **SegmentedControl** — repeat across Journal, Tokenise and Market.

Skip Button, SectionHeading and the badge family: they are a handful of CSS declarations each and
read better inline in a draft.

## Brand asset for logo positions

`images/growtoo-mark-brass.png` is the only logo. It appears in the sidebar (32×32, circular,
`box-shadow: 0 0 0 1px rgb(var(--brass-rgb) / 0.4)`), on the boot splash (64×64), and as the favicon.
Any component or design with a logo position must render this exact file — never initials, an emoji,
an invented SVG leaf, or the wordmark alone.
