#!/usr/bin/env node
/**
 * Add a language.
 *
 *   node scripts/i18n-add-locale.mjs --code it --native Italiano --name Italian --intl it-IT
 *
 * Registers it in locales/locales.json and writes locales/<code>/*.json with
 * the full English key tree, values left as the English text so the site
 * still reads correctly while the file is being translated. Nothing else in
 * the codebase has to change: the switcher, hreflang tags, Intl formatting
 * and the URL prefix all read the manifest.
 *
 * Remember the one thing outside this repo's control: add the matching
 * /<code>/* rewrite in netlify.toml so the prefixed URLs resolve.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = resolve(REPO, 'locales');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

if (!args.code || !args.native) {
  console.error('usage: i18n-add-locale.mjs --code <xx> --native <Native name> [--name <English name>] [--intl <xx-XX>] [--dir ltr|rtl]');
  process.exit(1);
}

const manifestPath = resolve(LOCALES, 'locales.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const source = manifest.fallback || 'en';

if (manifest.locales.some((l) => l.code === args.code)) {
  console.error(`${args.code} is already registered in locales/locales.json`);
  process.exit(1);
}

manifest.locales.push({
  code: args.code,
  name: args.name || args.native,
  nativeName: args.native,
  intl: args.intl || args.code,
  dir: args.dir || 'ltr',
  flag: args.code.toUpperCase(),
  ogLocale: (args.intl || args.code).replace('-', '_'),
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const dir = resolve(LOCALES, args.code);
mkdirSync(dir, { recursive: true });

const files = readdirSync(resolve(LOCALES, source)).filter((f) => f.endsWith('.json'));
let written = 0;
for (const file of files) {
  const target = resolve(dir, file);
  if (existsSync(target)) continue;
  /* Seeded with the English copy rather than blanks: an untranslated page
     reads fine, and a translator sees the sentence they are replacing. */
  writeFileSync(target, readFileSync(resolve(LOCALES, source, file), 'utf8'));
  written++;
}

console.log(`Added ${args.native} (${args.code}) — ${written} namespace file(s) seeded from ${source}/.`);
console.log(`Next: translate locales/${args.code}/*.json, then add the rewrite pair for /${args.code}/* in netlify.toml.`);
