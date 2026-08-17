#!/usr/bin/env node
/**
 * Find copy still hardcoded in JavaScript.
 *
 *   node scripts/i18n-scan-js.mjs                    # every app script
 *   node scripts/i18n-scan-js.mjs app/js/market.js   # one file
 *   node scripts/i18n-scan-js.mjs --json             # machine-readable
 *
 * A string counts as copy when it reads like a sentence a grower would see.
 * Selectors, ids, URLs, event names, Firestore fields and console output are
 * skipped — those are code, and translating them would break the app.
 *
 * It is a heuristic, so treat the output as a worklist rather than a verdict:
 * anything already wrapped in T('key', 'English') is filtered out, so the
 * list shrinks to zero as a file gets migrated.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');
const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const files = targets.length
  ? targets.map((t) => resolve(REPO, t))
  : [
      ...readdirSync(resolve(REPO, 'app/js')).map((f) => resolve(REPO, 'app/js', f)),
      ...readdirSync(resolve(REPO, 'js')).map((f) => resolve(REPO, 'js', f)),
    ].filter((f) => f.endsWith('.js'));

/**
 * Walk the source and yield only real string literals.
 *
 * A regex cannot tell a string from the same characters inside a comment or
 * a regex literal, and this file is full of both — CSS selectors in
 * comments, URLs with // in them. So we scan properly: track what we are
 * inside of, and only emit when a quote actually opens a string.
 */
function* stringLiterals(src) {
  let i = 0;
  const n = src.length;
  /* Whether a "/" starts a regex or is division depends on what came
     before it; this is the usual "last significant token" heuristic. */
  let prev = '';

  while (i < n) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '/' && !/[\w)\]]$/.test(prev)) {
      i++;
      while (i < n && src[i] !== '/' && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        if (src[i] === '[') { while (i < n && src[i] !== ']') { if (src[i] === '\\') i++; i++; } }
        i++;
      }
      i++;
      prev = '/';
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const start = ++i;
      let value = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { value += src[i] + src[i + 1]; i += 2; continue; }
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          /* Template hole: skip the expression, keep scanning the literal. */
          let depth = 1;
          i += 2;
          while (i < n && depth) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          value += '${…}';
          continue;
        }
        if (quote !== '`' && src[i] === '\n') break;
        value += src[i++];
      }
      i++;
      yield { value, index: start };
      prev = 'x';
      continue;
    }

    if (!/\s/.test(c)) prev = c;
    i++;
  }
}

/* Assignments whose value is a class list or a dataset handle, not copy.
   Context is what separates them: "log watering" is a sentence, but the
   same shape assigned to .className is a pair of CSS classes. */
const CODE_ASSIGN = /\.(?:className|id|src|href|type|name|htmlFor|slot|part)\s*(?:\+?=)\s*$/;

/* Calls whose string arguments are addresses, not copy. */
const CODE_CALLS =
  /(?:querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName|closest|matches|addEventListener|removeEventListener|dispatchEvent|classList\.(?:add|remove|toggle|contains)|setAttribute|getAttribute|removeAttribute|hasAttribute|createElement|console\.\w+|localStorage\.(?:getItem|setItem|removeItem)|sessionStorage\.\w+|collection|doc|where|orderBy|\.emit|require|import)\s*\($/;

const looksLikeCode = (s) =>
  /^[#.]/.test(s) ||                       // selectors
  /^https?:|^\/\/|^\/[\w-]|^data:|^mailto:/.test(s) ||
  /^[a-z]+([A-Z][a-z]+)+$/.test(s) ||      // camelCase identifier
  /^[A-Z][a-z]+([A-Z][a-z]*)+$/.test(s) || // PascalCase — DOMException names, classes
  /^[a-z0-9-]+$/i.test(s) && !/\s/.test(s) && s.length < 4 ||
  /^[\w.-]+\.(?:js|css|json|png|jpg|svg|html)$/i.test(s) ||
  /^[a-z]+(?:[-_][a-z0-9]+)+$/i.test(s) && !/\s/.test(s) ||  // kebab / snake ids
  /^\d+(\.\d+)?$/.test(s) ||
  /^[A-Z][A-Z0-9_]{2,}$/.test(s) ||        // CONSTANT_NAMES
  /^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(s); // base58 — Solana keys and signatures

/* Directives, CSS and wire-format values read like prose but are code. */
const NOT_COPY = [
  /^use strict$/,
  /^\((?:prefers-|max-width|min-width|orientation)/,     // media queries
  /cubic-bezier|max-age=|^transform |^opacity |^\d+(?:px|rem|em|%|s|ms)\b/,
  /^[A-Za-z-]+\/[A-Za-z0-9.+-]+$/,                        // MIME types
  /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS)$/,
  /^\$\{…\}/,                                           // starts with a hole
  /^(?:Escape|Enter|Tab|Backspace|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Shift|Control|Alt|Meta)$/,
];

function isCopy(s) {
  if (s.length < 2 || s.length > 400) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (looksLikeCode(s)) return false;
  if (NOT_COPY.some((re) => re.test(s.trim()))) return false;
  /* Two words, or one capitalised/sentence-ish word — "Save", "Done." */
  const words = s.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length >= 2) return true;
  return /^[A-Z]/.test(s.trim()) || /[.!?…]$/.test(s.trim());
}

const results = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(REPO, file);
  const lines = src.split('\n');
  const hits = [];

  /* Strings already routed through the dictionary are done. Two shapes
     count: the direct call T('key', 'English'), and the lazy pair
     ['key', 'English'] used for tables built at parse time, before the
     dictionary has loaded — those resolve through T() at read time. */
  const migrated = new Set();
  for (const m of src.matchAll(/\bT\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*,\s*(['"`])((?:(?!\3)[^\\]|\\.)*)\3/g)) {
    migrated.add(m[4]);
  }
  for (const m of src.matchAll(/\[\s*(['"])([\w-]+(?:\.[\w-]+)+)\1\s*,\s*(['"`])((?:(?!\3)[^\\]|\\.)*)\3/g)) {
    migrated.add(m[2]);
    migrated.add(m[4]);
  }

  for (const { value, index } of stringLiterals(src)) {
    if (!isCopy(value) || migrated.has(value)) continue;

    const before = src.slice(Math.max(0, index - 61), index - 1);
    if (CODE_CALLS.test(before) || CODE_ASSIGN.test(before)) continue;

    const after = src.slice(index + value.length + 1, index + value.length + 3);
    /* 'term': … — an object key is a lookup handle, not copy. */
    if (/^\s*:/.test(after)) continue;
    /* A bare markup fragment ("<div class=\"x\">") carries no words of its
       own; the copy around it is caught on its own line. */
    const trimmed = value.trim();
    if (/^<[^>]*>$/.test(trimmed)) continue;
    if (/^<\/?[a-z]/i.test(trimmed) && !/>[^<>]*[A-Za-z]{2}/.test(value)) continue;
    /* A fragment that only closes or opens tags and attributes — the words
       around it are picked up on their own lines. */
    if (/^["'\s]*(?:[\w-]+=|\/?>|<)/.test(trimmed) && !/[A-Za-z]{2}[^<>="]*[.!?…]/.test(trimmed)) {
      const words = trimmed
        .replace(/<[^>]*>/g, '')
        .replace(/[\w-]+="[^"]*"/g, '')
        .replace(/[\w-]+=["']?/g, '')      // a half-written attribute
        .replace(/["'>/]/g, '')
        .trim();
      if (!/[A-Za-z]{3}/.test(words)) continue;
    }
    /* The English fallback sitting inside a T() call is already migrated. */
    if (/\bT\(\s*['"][\w.-]+['"]\s*,\s*$/.test(before)) continue;

    const line = src.slice(0, index).split('\n').length;
    /* i18n-ignore on the line, or the line above, marks copy that is
       deliberately English — diagnostics that only ever reach the console. */
    const here = lines[line - 1] || '';
    const above = lines[line - 2] || '';
    if (/i18n-ignore/.test(here) || /i18n-ignore/.test(above)) continue;
    /* A pragma in the comment that opens a table covers the whole table:
       look back a few lines for one, stopping at a blank line. */
    let covered = false;
    for (let n = line - 3; n >= 0 && n > line - 12; n--) {
      const prevLine = lines[n] || '';
      if (!prevLine.trim()) break;
      if (/i18n-ignore/.test(prevLine)) { covered = true; break; }
    }
    if (covered) continue;

    hits.push({ line, value, context: here.trim().slice(0, 90) });
  }

  if (hits.length) results.push({ file: rel, hits });
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  let total = 0;
  for (const r of results.sort((a, b) => b.hits.length - a.hits.length)) {
    total += r.hits.length;
    console.log(`\n${r.file} — ${r.hits.length}`);
    for (const h of r.hits.slice(0, 12)) {
      console.log(`  ${String(h.line).padStart(5)}  ${JSON.stringify(h.value).slice(0, 96)}`);
    }
    if (r.hits.length > 12) console.log(`  … ${r.hits.length - 12} more`);
  }
  console.log(`\n${total} string(s) still hardcoded across ${results.length} file(s).`);
}
