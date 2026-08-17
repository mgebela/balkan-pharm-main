#!/usr/bin/env node
/**
 * Pull the English out of the JavaScript and into the dictionary.
 *
 *   node scripts/i18n-sync-js.mjs            # every app script
 *   node scripts/i18n-sync-js.mjs --check    # fail if anything is out of sync
 *
 * Every T('app.plant.saved', 'Plant saved.') call — and every lazy
 * ['app.x', 'English'] pair — becomes a key in locales/en/<namespace>.json.
 * The call site stays the source of truth for English, so nobody has to
 * keep a JS literal and a JSON value in step by hand.
 *
 * Translations are never touched. When the English behind a key changes,
 * the key is reported as drifted: the hr/de values are now stale and want
 * a look, but they keep working until then.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = resolve(REPO, 'locales');
const checkOnly = process.argv.includes('--check');

const files = [
  ...readdirSync(resolve(REPO, 'app/js')).map((f) => resolve(REPO, 'app/js', f)),
  ...readdirSync(resolve(REPO, 'js')).map((f) => resolve(REPO, 'js', f)),
].filter((f) => f.endsWith('.js'));

/**
 * Blank out comments, keeping offsets and newlines intact.
 *
 * The doc comments in these files show example calls — T('app.plant.saved',
 * 'Plant saved.') — and a plain regex happily lifts those into the
 * dictionary as real keys. They are prose, not copy.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let prev = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    /* A regex literal can hold quote characters — /[&<>"']/g is common in
       the esc() helpers here. Without this branch that quote opens a
       "string" and swallows the rest of the file, so every key after it
       goes missing. Whether "/" starts a regex depends on the previous
       significant token. */
    if (c === '/' && !/[\w)\]]$/.test(prev)) {
      out += c;
      i++;
      while (i < src.length && src[i] !== '/' && src[i] !== '\n') {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === '[') {
          while (i < src.length && src[i] !== ']') {
            if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
            out += src[i++];
          }
        }
        out += src[i++];
      }
      out += src[i] || '';
      i++;
      prev = '/';
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i++];
      }
      out += src[i] || '';
      i++;
      prev = 'x';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/* T('key', 'English')  and  ['key', 'English'] */
const CALL = /\bT\(\s*(['"])([\w-]+(?:\.[\w-]+)+)\1\s*,\s*(['"`])((?:(?!\3)[^\\]|\\.)*)\3/g;
const PAIR = /\[\s*(['"])([\w-]+(?:\.[\w-]+)+)\1\s*,\s*(['"`])((?:(?!\3)[^\\]|\\.)*)\3/g;

const found = new Map();      // key → { value, file }
const conflicts = [];

for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const re of [CALL, PAIR]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const key = m[2];
      /* Unescape the literal so the JSON holds the real sentence. */
      const value = m[4].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
      const prev = found.get(key);
      if (prev && prev.value !== value) {
        conflicts.push(`${key}\n      ${relative(REPO, prev.file)}: ${JSON.stringify(prev.value)}\n      ${relative(REPO, file)}: ${JSON.stringify(value)}`);
        continue;
      }
      found.set(key, { value, file });
    }
  }
}

/* Group by namespace: app.statusRail.sold → app.json, path statusRail.sold */
const byNamespace = new Map();
for (const [key, { value }] of found) {
  const [ns, ...rest] = key.split('.');
  if (!rest.length) continue;
  if (!byNamespace.has(ns)) byNamespace.set(ns, []);
  byNamespace.get(ns).push([rest, value]);
}

function setPath(obj, path, value) {
  let cursor = obj;
  for (const part of path.slice(0, -1)) {
    if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {};
    cursor = cursor[part];
  }
  const last = path[path.length - 1];
  const before = cursor[last];
  cursor[last] = value;
  return before;
}

/* Keys sort into place so a namespace file stays readable as it grows. */
function sortDeep(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    out[key] = val && typeof val === 'object' && !Array.isArray(val) ? sortDeep(val) : val;
  }
  return out;
}

let added = 0;
let drifted = [];

for (const [ns, rows] of byNamespace) {
  const path = resolve(LOCALES, 'en', `${ns}.json`);
  const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};

  for (const [keyPath, value] of rows) {
    const before = setPath(data, keyPath, value);
    if (before === undefined) added++;
    else if (before !== value) drifted.push(`${ns}.${keyPath.join('.')}`);
  }

  if (!checkOnly) {
    writeFileSync(path, JSON.stringify(sortDeep(data), null, 2) + '\n');
  }
}

if (conflicts.length) {
  console.log(`\n  one key, two different sentences — pick one:`);
  for (const c of conflicts) console.log(`    ${c}`);
}
if (drifted.length) {
  console.log(`\n  English changed since the translations were written:`);
  for (const d of drifted) console.log(`    ${d}`);
}

console.log(
  `${found.size} key(s) in JavaScript · ${added} new` +
  (checkOnly ? ' (check only, nothing written)' : ' written into locales/en/')
);

/* Dictionaries just changed, so the ?v= that busts them in a reader's browser
   has to change with them. Doing it here means nobody has to remember. */
if (!checkOnly) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [resolve(REPO, 'scripts/i18n-bump.mjs')], {
    stdio: 'inherit',
  });
}

if (conflicts.length || (checkOnly && (added || drifted.length))) process.exitCode = 1;
