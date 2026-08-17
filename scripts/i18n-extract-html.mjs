#!/usr/bin/env node
/**
 * Draft an English namespace file from a page's markup.
 *
 *   node scripts/i18n-extract-html.mjs --html pitch/investor/index.html --ns pitch-investor
 *
 * Walks the page for elements that hold copy and no block-level children,
 * and writes locales/en/<ns>.json with a suggested key per string. Keys are
 * derived from the nearest section id, so they read like
 * "problem.h2", "problem.p1" rather than "k17".
 *
 * The output is a draft: rename keys that deserve better names, delete rows
 * that are not really copy, then run i18n-key-html.mjs to stamp the markup.
 * Because the values come out of the file itself, they match the markup
 * exactly — the keying pass will not miss on a mistyped character.
 *
 * Existing locales/en/<ns>.json is never overwritten: new keys are appended
 * and unchanged ones left alone, so a second run after a copy edit shows up
 * as a small diff.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let parse5;
try {
  parse5 = require('parse5');
} catch {
  console.error('This script needs parse5:  npm i -D parse5');
  process.exit(1);
}

const argv = process.argv;
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

const htmlArg = arg('html');
const ns = arg('ns');
if (!htmlArg || !ns) {
  console.error('usage: i18n-extract-html.mjs --html <file> --ns <namespace> [--min-words 1]');
  process.exit(1);
}
const minWords = Number(arg('min-words') || 1);

/* Copy never lives in these, and walking into them produces noise. */
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head', 'link', 'meta', 'br', 'hr', 'img', 'path', 'defs', 'g']);
/* Elements that can sit inside a sentence — their presence does not split
   the copy into two strings. */
const INLINE_TAGS = new Set(['a', 'em', 'strong', 'span', 'code', 'b', 'i', 'small', 'sup', 'sub', 'abbr', 'mark', 'u', 's', 'time', 'br', 'wbr', 'kbd', 'var', 'q', 'cite']);

const html = readFileSync(resolve(REPO, htmlArg), 'utf8');
const doc = parse5.parse(html, { sourceCodeLocationInfo: true });

const attrOf = (node, name) =>
  (node.attrs || []).find((a) => a.name === name)?.value || null;

const rows = [];
const usedKeys = new Set();

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 3)
    .join('-');
}

function uniqueKey(base) {
  let key = base;
  let n = 2;
  while (usedKeys.has(key)) key = `${base}${n++}`;
  usedKeys.add(key);
  return key;
}

/** innerHTML of an element, straight out of the original source. */
function innerSource(node) {
  const loc = node.sourceCodeLocation;
  if (!loc || !loc.startTag || !loc.endTag) return null;
  return html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
}

function hasCopy(node) {
  let text = '';
  const visit = (n) => {
    if (n.nodeName === '#text') text += n.value;
    else if (n.childNodes && !SKIP_TAGS.has(n.nodeName)) n.childNodes.forEach(visit);
  };
  (node.childNodes || []).forEach(visit);
  return text.trim().split(/\s+/).filter(Boolean).length >= minWords && /[a-zA-Z]/.test(text);
}

/**
 * A copy unit is an element whose children are all text or inline markup —
 * and whose inline children are inline all the way down. A card built as
 * <a><h2>…</h2><p>…</p></a> is a link by tag but a section by content, and
 * swallowing it whole would put a page's worth of markup in one string.
 */
function isLeafCopy(node) {
  /* An icon inside the element means its markup is mostly path data. Keying
     the parent would hand a translator a wall of SVG around three words, so
     we walk past it and key the label element inside instead. */
  if (containsIcon(node)) return false;
  return (node.childNodes || []).every(function inlineOnly(c) {
    if (c.nodeName === '#text' || c.nodeName === '#comment') return true;
    if (!INLINE_TAGS.has(c.nodeName)) return false;
    return (c.childNodes || []).every(inlineOnly);
  });
}

function containsIcon(node) {
  return (node.childNodes || []).some(
    (c) => c.nodeName === 'svg' || c.nodeName === 'img' || containsIcon(c)
  );
}

function walk(node, scope) {
  for (const child of node.childNodes || []) {
    if (child.nodeName.startsWith('#')) continue;
    if (SKIP_TAGS.has(child.nodeName)) continue;
    if (attrOf(child, 'data-i18n') || attrOf(child, 'data-i18n-html')) continue;

    /* A section id is the most stable name a page gives its own parts. */
    const id = attrOf(child, 'id');
    const nextScope = id ? slug(id) : scope;

    if (isLeafCopy(child) && hasCopy(child)) {
      const value = (innerSource(child) || '').trim().replace(/\s+/g, ' ');
      if (value) {
        rows.push({
          key: uniqueKey(`${nextScope ? nextScope + '.' : ''}${child.nodeName}`),
          value,
        });
      }
      continue;
    }

    walk(child, nextScope);

    /* Copy that lives in an attribute has no text node to find, so it is
       reported rather than keyed — aria-label and placeholder need
       data-i18n-attr, which is a judgement call per element. */
    for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
      const val = attrOf(child, attr);
      if (val && /[a-zA-Z]{3}/.test(val)) {
        rows.push({
          key: uniqueKey(`${nextScope ? nextScope + '.' : ''}${attr.replace(/-/g, '')}`),
          value: val,
          attr,
          tag: child.nodeName,
        });
      }
    }
  }
}

const body = doc.childNodes.find((n) => n.nodeName === 'html')
  ?.childNodes.find((n) => n.nodeName === 'body');
walk(body, '');

/* Merge with whatever is already translated so a re-run is additive. */
const outPath = resolve(REPO, 'locales', 'en', `${ns}.json`);
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const existingValues = new Set();
(function collect(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') collect(v);
    else existingValues.add(String(v));
  }
})(existing);

const fresh = {};
const attrRows = [];
for (const row of rows) {
  if (existingValues.has(row.value)) continue;
  if (row.attr) { attrRows.push(row); continue; }
  const path = row.key.split('.');
  let cursor = fresh;
  while (path.length > 1) cursor = (cursor[path.shift()] ||= {});
  cursor[path[0]] = row.value;
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ ...existing, ...fresh }, null, 2) + '\n');

const count = JSON.stringify(fresh).match(/":/g)?.length || 0;
console.log(`locales/en/${ns}.json — ${count} new string(s) drafted from ${htmlArg}`);
if (attrRows.length) {
  console.log(`\n  copy sitting in attributes (add data-i18n-attr by hand if it matters):`);
  for (const r of attrRows.slice(0, 30)) {
    console.log(`    <${r.tag} ${r.attr}="${r.value.slice(0, 60)}">`);
  }
}
console.log(`\n  next: curate the keys, then\n    node scripts/i18n-key-html.mjs --html ${htmlArg} --ns ${ns},common`);
