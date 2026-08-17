#!/usr/bin/env node
/**
 * Stamp the dictionary version onto every i18n.js script tag.
 *
 *   node scripts/i18n-bump.mjs          # write the stamp
 *   node scripts/i18n-bump.mjs --check  # fail if any page is out of date
 *
 * The runtime fetches locales/<code>/<ns>.json with the same ?v= its own
 * script tag carries, so that version is what busts a stale dictionary in a
 * reader's browser. Tying it to a hash of the locale files means it changes
 * exactly when a translation changes — no manual bump to forget, and no
 * pointless cache miss when nothing moved.
 *
 * Run it after editing anything under locales/. i18n-sync-js.mjs calls it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = resolve(REPO, 'locales');
const checkOnly = process.argv.includes('--check');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/* Content hash, not a timestamp: identical dictionaries keep the same URL, so
   a rebuild that changes nothing does not throw away warm caches. */
const files = walk(LOCALES).filter((f) => f.endsWith('.json')).sort();
const hash = createHash('sha256');
for (const file of files) {
  hash.update(relative(LOCALES, file));
  hash.update(readFileSync(file));
}
/* The runtime also ships the reading of these files, so its own source
   belongs in the stamp — a fix there must reach browsers too. */
hash.update(readFileSync(resolve(REPO, 'js/i18n.js')));
const version = hash.digest('hex').slice(0, 10);

const pages = walk(REPO)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => !/node_modules|\/target\/|\.claude|test-ledger/.test(f));

const stale = [];
let written = 0;

for (const page of pages) {
  const src = readFileSync(page, 'utf8');
  if (!/js\/i18n\.js\?v=/.test(src)) continue;
  const next = src.replace(/(js\/i18n\.js\?v=)[^"']*/g, `$1${version}`);
  if (next === src) continue;
  stale.push(relative(REPO, page));
  if (!checkOnly) {
    writeFileSync(page, next);
    written++;
  }
}

console.log(
  `dictionary version ${version} — ${files.length} locale file(s), ` +
    (checkOnly
      ? `${stale.length} page(s) out of date`
      : `${written} page(s) stamped`)
);
if (stale.length) {
  for (const p of stale) console.log(`    ${p}`);
}
if (checkOnly && stale.length) process.exitCode = 1;
