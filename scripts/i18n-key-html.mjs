#!/usr/bin/env node
/**
 * Key an HTML file against the English dictionary.
 *
 * For every entry in locales/en/<ns>.json it finds the element whose inner
 * content is that exact copy (whitespace-insensitive) and stamps it with
 * data-i18n / data-i18n-html. That keeps the English in the markup as the
 * readable source of truth while making the element translatable.
 *
 * Run it again after editing copy: already-keyed elements are skipped, so
 * it only ever fills in what is new.
 *
 *   node scripts/i18n-key-html.mjs --html index.html --ns landing [--dry]
 *
 * Anything it cannot place is listed at the end — usually a value that
 * drifted from the markup, or copy that lives in an attribute and has to be
 * keyed by hand with data-i18n-attr.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { dry: false, ns: [], locale: 'en' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--html') args.html = argv[++i];
    else if (a === '--ns') args.ns.push(...argv[++i].split(','));
    else if (a === '--locale') args.locale = argv[++i];
  }
  if (!args.html || !args.ns.length) {
    console.error('usage: i18n-key-html.mjs --html <file> --ns <namespace>[,<ns>] [--dry]');
    process.exit(1);
  }
  return args;
}

function flatten(obj, prefix, out = {}) {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) flatten(val, path, out);
    else out[path] = String(val);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whitespace in the dictionary is one space; in the markup it is indentation. */
const looseRe = (value) =>
  value.trim().split(/\s+/).map(escapeRe).join('\\s+');

/** Markup or entities in the value mean it has to be set as innerHTML. */
const isRich = (value) => /<[a-zA-Z/][\s\S]*?>|&[a-zA-Z]+;|&#\d+;/.test(value);

const args = parseArgs(process.argv);
const htmlPath = resolve(REPO, args.html);
let html = readFileSync(htmlPath, 'utf8');

const dict = {};
for (const ns of args.ns) {
  const file = resolve(REPO, 'locales', args.locale, `${ns}.json`);
  Object.assign(dict, flatten(JSON.parse(readFileSync(file, 'utf8')), ns));
}

/* Longest copy first: a short value ("Sign in") can appear inside a long one,
   and the long element is the one that should own the key. Between two keys
   holding the same sentence, the shared common.* one wins. */
const entries = Object.entries(dict).sort((a, b) =>
  b[1].length - a[1].length ||
  Number(b[0].startsWith('common.')) - Number(a[0].startsWith('common.')));

/* The same sentence under two keys ("FAQ" as nav.faq and footer.faq) is one
   element's worth of markup, so the first key owns every occurrence and the
   rest are aliases. Translators only ever have to fill in the owner. */
const owner = new Map();
const aliases = [];
const keyable = entries.filter(([key, value]) => {
  const held = owner.get(value);
  if (held) { aliases.push(`${key} → ${held}`); return false; }
  owner.set(value, key);
  return true;
});

const placed = [];
const missed = [];
const repeated = [];
/* Regions already owned by a key. A short value often sits inside a longer
   one ("Sign in" inside "Already have an account? Sign in"); the outer key
   replaces the whole innerHTML, so keying the child too would be dead
   markup. Longest-first means the outer element always claims first. */
const claimed = [];
const edits = [];

const overlaps = (start, end) =>
  claimed.some(([s, e]) => start < e && end > s);

for (const [key, value] of keyable) {
  if (html.includes(`data-i18n="${key}"`) || html.includes(`data-i18n-html="${key}"`)) {
    placed.push(key);
    continue;
  }

  const attr = isRich(value) ? 'data-i18n-html' : 'data-i18n';
  /* (open tag)(content)(matching close tag) — the backreference keeps us from
     closing on an inner element's tag. */
  const re = new RegExp(
    `(<([a-zA-Z][\\w-]*)\\b(?![^>]*\\bdata-i18n)[^>]*>)(\\s*${looseRe(value)}\\s*)(</\\2>)`,
    'g'
  );

  let hits = 0;
  for (const hit of html.matchAll(re)) {
    const start = hit.index;
    const end = start + hit[0].length;
    if (overlaps(start, end)) continue;
    claimed.push([start, end]);
    /* Identical copy in several places is the same sentence in every
       language, so every occurrence gets the same key. */
    edits.push({ at: start + hit[1].length, open: hit[1], attr, key });
    hits++;
  }

  if (!hits) { missed.push(key); continue; }
  if (hits > 1) repeated.push(`${key} (${hits}×)`);
  placed.push(key);
}

/* Apply back to front so earlier offsets stay valid. The attribute goes in
   right after the tag name rather than before the ">", so tags written
   across several lines keep their formatting. */
edits.sort((a, b) => b.at - a.at);
for (const edit of edits) {
  const keyed = edit.open.replace(/^<([a-zA-Z][\w-]*)/, `<$1 ${edit.attr}="${edit.key}"`);
  const start = edit.at - edit.open.length;
  html = html.slice(0, start) + keyed + html.slice(edit.at);
}

if (!args.dry) writeFileSync(htmlPath, html);

console.log(`${args.html}: keyed ${placed.length}/${keyable.length}${args.dry ? ' (dry run)' : ''}`);
if (aliases.length) {
  console.log(`\n  same copy as another key — the owner carries it:`);
  for (const a of aliases) console.log(`    ${a}`);
}
if (repeated.length) {
  console.log(`\n  repeated copy — keyed every occurrence:`);
  for (const a of repeated) console.log(`    ${a}`);
}
if (missed.length) {
  console.log(`\n  not found in markup (key by hand, or the copy drifted):`);
  for (const m of missed) console.log(`    ${m}`);
  process.exitCode = 1;
}
