# Languages

growtoo is served from one set of HTML files in every language. The English
copy stays in the markup as the readable source of truth; a dictionary swaps
it at runtime. A missing translation therefore shows English — never a blank
element or a key name.

Live languages are whatever `locales.json` lists. Today: English, Hrvatski,
Deutsch.

## Layout

```
locales/
  locales.json          the register — which languages exist, and how each
                        one formats numbers and dates
  en/                   source of truth, one file per namespace
    common.json         chrome shared by every page: nav, footer, age gate
    landing.json        index.html
    app.json            app/index.html
    signin.json         dnevnik/
    …
  hr/  de/              same key tree, translated
```

A namespace maps to a page. Pages declare what they need on the script tag:

```html
<script src="/js/i18n.js" data-i18n-ns="common,landing"></script>
```

## How a page gets translated

1. **Extract** the English copy out of the markup into a draft namespace:
   ```
   node scripts/i18n-extract-html.mjs --html pitch/grower/index.html --ns pitch-grower
   ```
   Values come out of the file itself, so they match it exactly. Curate the
   suggested key names, delete rows that are not really copy.

2. **Wire** the page to the runtime (script tag, stylesheet, switcher slot):
   ```
   node scripts/i18n-wire-page.mjs --html pitch/grower/index.html --ns pitch-grower
   ```

3. **Key** the markup — stamps `data-i18n` on the element holding each string:
   ```
   node scripts/i18n-key-html.mjs --html pitch/grower/index.html --ns pitch-grower,common
   ```
   Anything it could not place is listed at the end. Copy that lives in an
   attribute (`aria-label`, `placeholder`, `content`) is keyed by hand with
   `data-i18n-attr="placeholder:signin.field.emailPlaceholder"`.

4. **Translate** `locales/hr/<ns>.json` and `locales/de/<ns>.json`, then:
   ```
   npm run i18n:check
   ```

Re-running any of these after a copy edit is safe: already-keyed elements are
skipped and existing translations are left alone.

## Copy rendered from JavaScript

`app/js/*` renders most of the product, so its copy goes through `T()`:

```js
toast(T('app.plant.saved', 'Plant saved.'));
status(T('app.upload.progress', 'Uploading {pct}%', { pct: 40 }));
```

The English stays at the call site and is the fallback — a key with no
translation, or a dictionary that never loaded, still reads correctly.
`T` is defined by `js/i18n.js`, with a stub in `app/index.html` that runs
first so it exists even if i18n.js fails.

**Never call `T()` at module scope.** Tables built while the page parses run
before the dictionary has loaded and would freeze in English. Store the pair
and resolve it on read:

```js
var STAGES = { klijanje: ['app.stage.germination', 'Germination'] };
function label(k) { var row = STAGES[k]; return row ? T(row[0], row[1]) : ''; }
```

**Never branch on displayed text.** `if (label === 'Refunded')` breaks the
moment the label is translated — test the state that produced it.
(`app/js/status-rail.js` had exactly this and now branches on a flag.)

**Some English is protocol, not copy.** The wallet-link message in
`app/js/wallet-link.js` is signed by the wallet and verified byte-for-byte by
`functions/link-wallet.js`; translating it would fail every signature. Sample
data that stands in for Firestore documents is the same — a translated sample
stops looking like a real row. Both carry `// i18n-ignore` and a comment
saying why.

The workflow per file:

```
node scripts/i18n-scan-js.mjs app/js/market.js   # what is still hardcoded
# …wrap those in T('key', 'English')…
node scripts/i18n-sync-js.mjs                    # keys → locales/en/
# …translate the new keys in hr/ and de/…
npm run i18n:check
```

`i18n-sync-js` treats the call site as the source of truth for English, so
the JSON never drifts from the code. A string that is deliberately English —
a console diagnostic, an internal invariant — gets `// i18n-ignore` on its
line and drops out of the scan.

Markup built in JS can instead carry `data-i18n` attributes, which lets a
language switch re-translate it in place without rebuilding the node and
losing its handlers; `js/site-trust.js` is the worked example. The app does
not need this — it reloads on switch (`data-i18n-reload`) because half its
copy lives in views that are not mounted.

Plurals go through `Intl.PluralRules`, so Croatian's one/few/other and
German's one/other both work — give the key `_one` / `_few` / `_other`
variants and pass `{ count }`:

```json
"journalLogs_one":   "1 zapis u dnevniku od zadnjeg posjeta",
"journalLogs_few":   "{count} zapisa u dnevniku od zadnjeg posjeta",
"journalLogs_other": "{count} zapisa u dnevniku od zadnjeg posjeta"
```

English only needs `_one` plus the bare key. `i18n-check` judges each
language by its own categories, so hr having three forms and en two is
complete on both sides, not a gap.

## Adding a language

```
node scripts/i18n-add-locale.mjs --code it --native Italiano --name Italian --intl it-IT
```

That registers it and seeds `locales/it/*.json` from English. Two things it
cannot do for you:

- add the `/it/*` rewrite pair to `netlify.toml`, next to `/hr/*` and `/de/*`
- translate the files

Everything else — the switcher, `<html lang>`, hreflang tags, the sitemap
(`node scripts/i18n-sitemap.mjs`), number and date formatting — reads the
manifest and picks the language up on its own.

## URLs

Marketing pages have a real URL per language: `/hr/`, `/de/pitch/investor/`.
Netlify rewrites those onto the English file (`netlify.toml`), and the
runtime reads the prefix off the path. That is what makes the Croatian and
German versions indexable and shareable.

The app (`/app/`) is behind auth and never indexed, so it switches in place
and records the choice in `?lang=` plus `localStorage['growtoo:lang']`. Local
dev has no rewrites either, so it behaves the same way there.

## Debugging

`?i18n=debug` outlines every element that fell back to English, and
`I18N.missing` lists the keys that were asked for and not found.
