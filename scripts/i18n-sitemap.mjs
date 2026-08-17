#!/usr/bin/env node
/**
 * Rewrite sitemap.xml so every indexed page lists its language versions.
 *
 *   node scripts/i18n-sitemap.mjs
 *
 * Each <url> keeps its English <loc> and gains an xhtml:link alternate per
 * locale in the manifest, plus x-default. Search engines need the whole set
 * on every entry — a page that lists only its own language reads as an
 * island rather than one of three versions of the same page.
 *
 * Re-run it after adding a language or a page; it is idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(REPO, 'locales/locales.json'), 'utf8'));
const defaultLocale = manifest.default || 'en';

const path = resolve(REPO, 'sitemap.xml');
const xml = readFileSync(path, 'utf8');

const ORIGIN = 'https://growto.live';

function localised(loc, code) {
  if (code === defaultLocale) return loc;
  /* Only the apex site carries the locale rewrites; the journal subdomain
     serves grower-written posts, which are in whatever language they were
     written in and have no translated twin. */
  if (!loc.startsWith(ORIGIN)) return null;
  return ORIGIN + '/' + code + loc.slice(ORIGIN.length);
}

let count = 0;
let out = xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
  const loc = /<loc>(.*?)<\/loc>/.exec(block)?.[1];
  if (!loc) return block;

  const stripped = block.replace(/\n\s*<xhtml:link[^>]*\/>/g, '');
  const links = [];
  for (const meta of manifest.locales) {
    const href = localised(loc, meta.code);
    if (href) links.push(`    <xhtml:link rel="alternate" hreflang="${meta.code}" href="${href}" />`);
  }
  if (!links.length) return stripped;
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}" />`);
  count++;

  return stripped.replace(/(\n\s*)<\/url>/, `\n${links.join('\n')}$1</url>`);
});

/* The alternates need the xhtml namespace on the root element. */
if (!out.includes('xmlns:xhtml')) {
  out = out.replace(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">'
  );
}

writeFileSync(path, out);
console.log(`sitemap.xml — ${count} page(s) now list ${manifest.locales.length} language versions.`);
