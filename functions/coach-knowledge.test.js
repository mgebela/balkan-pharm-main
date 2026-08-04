/* Tests for coach knowledge retrieval. Run: npm test */
'use strict';

const fs = require('fs');
const path = require('path');
const {getRelevantKnowledge} = require('./coach-knowledge');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const CAP = 1200; // MAX_CHARS_PER_SECTION in coach-knowledge.js

let pass = 0; let fail = 0;
function check(name, cond, extra) {
  if (cond) {pass++; console.log('  PASS', name);} else {
    fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}
const headings = (block) =>
  (block.match(/From "[^"]+" — ([^:\n]+):/g) || []).join(' ').toLowerCase();

console.log('\n[corpus is well formed]');
const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
check('knowledge files present', files.length >= 3, files);
let sectionCount = 0; const oversized = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf8');
  check(`${f} has a # title`, /^#\s+.+/m.test(raw));
  const secs = raw.split(/\n(?=##\s)/g).filter((p) => /^##\s/m.test(p));
  check(`${f} splits into sections`, secs.length > 0, secs.length);
  sectionCount += secs.length;
  for (const s of secs) {
    // Over the cap the body is sliced mid-sentence before the model ever sees it.
    if (s.trim().length > CAP) oversized.push([f, (s.match(/^##\s+(.+)$/m) || [])[1], s.trim().length]);
  }
}
check('no section exceeds the ' + CAP + '-char cap', oversized.length === 0, oversized.slice(0, 5));
console.log('        (' + sectionCount + ' sections across ' + files.length + ' files)');

console.log('\n[Croatian queries reach the English corpus]');
// Regression guard for the HR->EN bridge: without it these all scored zero.
const hrCases = [
  ['zašto su mi žuti donji listovi?', 'nitrogen'],
  ['plijesan na cvjetovima, vlaga je visoka', 'botrytis'],
  ['koliko često zalijevati biljku?', 'water'],
  ['grinje na listovima, što sada?', 'mites'],
  ['koje gnojivo za dušik?', 'nitrogen'],
  ['kada je berba?', null],
  ['presađivanje u veći lonac', null],
];
for (const [q, expect] of hrCases) {
  const r = getRelevantKnowledge(q, null);
  check(`"${q}" grounds`, !!r, r);
  if (expect && r) {
    check(`  ...and surfaces ${expect}`, headings(r).includes(expect), headings(r));
  }
}

console.log('\n[English queries still work]');
for (const q of [
  'why are my lower leaves yellow?',
  'when do outdoor plants start flowering at 45 degrees north?',
  'what is the THC limit for hemp?',
  'my top leaves are bleached under the light',
  'how long should I dry and cure?',
]) {
  check(`"${q}" grounds`, !!getRelevantKnowledge(q, null));
}

console.log('\n[the new material is reachable]');
const reach = [
  ['bud rot in a humid autumn outdoors', 'botrytis|bud rot|humid'],
  ['is my hemp going to go over the legal thc limit', 'thc|compliance|threshold'],
  ['what ppfd for flowering', 'light'],
  ['runoff ec is climbing', 'ec|runoff|salt'],
  ['when should I stop defoliating', 'topping|pruning|defoliat|canopy'],
];
for (const [q, pattern] of reach) {
  const r = getRelevantKnowledge(q, null);
  check(`"${q}" → ${pattern}`, !!r && new RegExp(pattern).test(headings(r)), headings(r));
}

console.log('\n[limits and degenerate input]');
const many = getRelevantKnowledge('water light nitrogen humidity mites harvest cure ph', null);
check('never returns more than 3 sections',
    (many.match(/From "/g) || []).length <= 3, (many.match(/From "/g) || []).length);
for (const q of ['', null, undefined, '   ', 'zzzzqqqq xxxxyyyy']) {
  const r = getRelevantKnowledge(q, null);
  check(`${JSON.stringify(q)} → empty string, no throw`, r === '', r);
}
check('unknown stage key does not throw', typeof getRelevantKnowledge('yellow leaves', 'nonsense') === 'string');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
