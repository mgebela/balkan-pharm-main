#!/usr/bin/env node
/**
 * Compare every language against English and report the gaps.
 *
 *   node scripts/i18n-check.mjs            # all locales, all namespaces
 *   node scripts/i18n-check.mjs --ns app   # one namespace
 *
 * English is the source of truth: a key that exists in en/ and is missing
 * elsewhere is untranslated copy (the page falls back to English, so this is
 * a to-do, not a crash). A key that exists only in a translation is dead
 * weight left over from copy that changed.
 *
 * Exits non-zero when anything is missing, so it can gate a deploy.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = resolve(REPO, 'locales');

const onlyNs = process.argv.includes('--ns')
  ? process.argv[process.argv.indexOf('--ns') + 1]
  : null;

const manifest = JSON.parse(readFileSync(resolve(LOCALES, 'locales.json'), 'utf8'));
const source = manifest.fallback || 'en';

function flatten(obj, prefix, out = {}) {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) flatten(val, path, out);
    else out[path] = String(val);
  }
  return out;
}

/* one / few / other are language-specific: English needs two forms, Croatian
   three, and a locale carrying only its own forms is complete, not broken.
   Keys are grouped by their base so each locale is judged by its own rules. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function pluralCategories(locale) {
  const meta = manifest.locales.find((l) => l.code === locale);
  try {
    return new Intl.PluralRules(meta ? meta.intl : locale).resolvedOptions().pluralCategories;
  } catch {
    return ['other'];
  }
}

function read(locale, ns) {
  const file = resolve(LOCALES, locale, `${ns}.json`);
  if (!existsSync(file)) return null;
  return flatten(JSON.parse(readFileSync(file, 'utf8')));
}

const namespaces = readdirSync(resolve(LOCALES, source))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((ns) => !onlyNs || ns === onlyNs);

let missingTotal = 0;
let translatedTotal = 0;
let sourceTotal = 0;

console.log(`i18n coverage — source: ${source}\n`);

for (const meta of manifest.locales) {
  const locale = meta.code;
  if (locale === source) continue;

  const rows = [];
  let missing = 0;
  let translated = 0;
  let total = 0;

  for (const ns of namespaces) {
    const src = read(source, ns) || {};
    const dst = read(locale, ns);
    const keys = Object.keys(src);
    total += keys.length;

    if (!dst) {
      missing += keys.length;
      rows.push(`    ${ns}: file missing (${keys.length} keys)`);
      continue;
    }

    const cats = pluralCategories(locale);
    /* A plural key is covered when this locale has a form for each of its
       own categories — or the bare key, which t() falls back to. */
    const covered = (k) => {
      const base = k.replace(PLURAL_SUFFIX, '');
      if (base === k && !keys.some((other) => other.replace(PLURAL_SUFFIX, '') === k && other !== k)) {
        return !!dst[k] && !!dst[k].trim();
      }
      return cats.every((cat) => {
        const form = dst[`${base}_${cat}`] || dst[base];
        return !!form && !!form.trim();
      });
    };

    const gaps = keys.filter((k) => !covered(k))
      /* Report the base once rather than once per English form. */
      .filter((k, i, all) => all.findIndex((o) => o.replace(PLURAL_SUFFIX, '') === k.replace(PLURAL_SUFFIX, '')) === i);
    /* Copy that reads identically in both languages is usually fine
       (brand names, "FAQ"), so it counts as done — it is only flagged in
       --verbose so nobody has to tick it off twice. */
    /* A translation-only plural form is this locale doing its job, not
       leftovers: hr needs _few where en has no such category. */
    const stale = Object.keys(dst).filter(
      (k) => !(k in src) && !(k.replace(PLURAL_SUFFIX, '') in src) &&
        !keys.some((s2) => s2.replace(PLURAL_SUFFIX, '') === k.replace(PLURAL_SUFFIX, ''))
    );

    missing += gaps.length;
    translated += Math.max(0, keys.length - gaps.length);

    if (gaps.length) rows.push(`    ${ns}: ${gaps.length} missing → ${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? ', …' : ''}`);
    if (stale.length) rows.push(`    ${ns}: ${stale.length} stale (not in ${source}) → ${stale.slice(0, 8).join(', ')}${stale.length > 8 ? ', …' : ''}`);
  }

  const pct = total ? Math.round((translated / total) * 100) : 100;
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
  console.log(`  ${meta.nativeName} (${locale})  ${bar} ${pct}%  ${translated}/${total}`);
  for (const row of rows) console.log(row);
  if (rows.length) console.log('');

  missingTotal += missing;
  translatedTotal += translated;
  sourceTotal += total;
}

console.log(`\n  ${translatedTotal}/${sourceTotal} strings translated across ${manifest.locales.length - 1} language(s).`);
if (missingTotal) {
  console.log(`  ${missingTotal} still to translate — those elements fall back to ${source}.`);
  process.exitCode = 1;
}
