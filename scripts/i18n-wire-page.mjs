#!/usr/bin/env node
/**
 * Wire a page into the i18n runtime.
 *
 *   node scripts/i18n-wire-page.mjs --html pitch/investor/index.html --ns pitch-investor
 *
 * Adds three things, each only if it is not already there:
 *   • the i18n.css link and the i18n.js tag, with the namespaces this page
 *     needs and a relative path that matches the page's depth
 *   • a [data-i18n-switcher] slot in the header (or before </body> when the
 *     page has no header to hang it on)
 *   • nothing else — keying the copy is i18n-key-html.mjs's job
 *
 * The script tag is deliberately plain (no defer): the dictionary fetch has
 * to start before the body parses, or the page paints in the wrong language
 * and then flips.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv;
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};

const htmlArg = arg('html');
const ns = arg('ns');
const version = arg('version') || '20260816a';
if (!htmlArg || !ns) {
  console.error('usage: i18n-wire-page.mjs --html <file> --ns <namespace> [--version <cache-bust>]');
  process.exit(1);
}

const path = resolve(REPO, htmlArg);
let html = readFileSync(path, 'utf8');

/* pitch/investor/index.html → ../../ */
const depth = htmlArg.split('/').length - 1;
const up = depth ? '../'.repeat(depth) : '';

const done = [];
const skipped = [];

if (!/js\/i18n\.js/.test(html)) {
  const tag = `  <script src="${up}js/i18n.js?v=${version}" data-i18n-ns="common,${ns}"></script>\n`;
  /* Before the first stylesheet: the fetch should be in flight while the CSS
     is still downloading. */
  const anchor = html.match(/^[ \t]*<link rel="stylesheet"[^>]*>\n/m);
  if (anchor) html = html.replace(anchor[0], tag + anchor[0]);
  else html = html.replace(/<\/head>/, tag + '</head>');
  done.push('script');
} else skipped.push('script');

if (!/styles\/i18n\.css/.test(html)) {
  const link = `  <link rel="stylesheet" href="${up}styles/i18n.css?v=${version}" />\n`;
  const last = [...html.matchAll(/^[ \t]*<link rel="stylesheet"[^>]*>\n/gm)].pop();
  if (last) html = html.replace(last[0], last[0] + link);
  else html = html.replace(/<\/head>/, link + '</head>');
  done.push('css');
} else skipped.push('css');

if (!/data-i18n-switcher/.test(html)) {
  const slot = '<div class="nav-lang" data-i18n-switcher></div>';
  /* Prefer the end of a real nav, so the control lands with the other
     header affordances rather than floating on its own. */
  const nav = html.match(/[ \t]*<\/nav>/);
  if (nav) {
    html = html.replace(nav[0], `        ${slot}\n${nav[0]}`);
  } else {
    const header = html.match(/[ \t]*<\/header>/);
    if (header) html = html.replace(header[0], `      ${slot}\n${header[0]}`);
    else html = html.replace(/<\/body>/, `  <div class="lang-switch-floating">${slot}</div>\n</body>`);
  }
  done.push('switcher');
} else skipped.push('switcher');

writeFileSync(path, html);
console.log(`${htmlArg}: added ${done.join(', ') || 'nothing'}${skipped.length ? ` (already had ${skipped.join(', ')})` : ''}`);
