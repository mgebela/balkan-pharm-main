/* Tests for the coach journal-snapshot budgeter. Run: npm test */
'use strict';

const {buildContextJson, PRIORITY_FIELDS} = require('./coach-context');

let pass = 0; let fail = 0;
function check(name, cond, extra) {
  if (cond) {pass++; console.log('  PASS', name);} else {
    fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}

// Mirrors buildContext() in app/js/ai-coach.js.
const plant = (i) => ({
  id: 'id-1770000000000-abc' + i, name: 'Northern Lights ' + i,
  strain: 'Northern Lights Auto', stage: 'vegetativna', stageLabel: 'Vegetative',
  environmentType: 'indoor', startDate: '2026-05-14',
});
const entry = (i) => ({
  type: 'zalijevanje', plantId: 'id-1770000000000-abc' + (i % 12),
  date: '2026-08-0' + (i % 9 + 1),
  note: 'Watered 1.2L, runoff clear, medium dry two knuckles down',
});
const token = (i) => ({
  id: 'tok-1770000000000-x' + i, name: 'Seed No 004' + i,
  plantId: 'id-1770000000000-abc' + i, stageIndex: 3,
});
const toolboxRecent = {
  watering: {date: '2026-08-03', amountMl: 1200},
  feeding: {date: '2026-08-01', product: 'BioBizz Grow', doseMl: 4},
  environment: {date: '2026-08-03', tempC: 27, humidity: 62, vpd: 1.3},
};
const ctx = (n) => ({
  focusPlant: plant(0),
  plants: Array.from({length: n}, (_, i) => plant(i)),
  tokens: Array.from({length: n}, (_, i) => token(i)),
  recentEntries: Array.from({length: n}, (_, i) => entry(i)),
  toolboxCounts: {watering: 40, feeding: 12, environment: 30},
  toolboxRecent,
  reminders: ['Feed tomorrow'],
  mintQuest: 'Log a watering and a feeding this week for the care bonus.',
  growSetup: 'Indoor tent 80x80, 240W LED',
  growStyleNote: 'Organic soil, no defoliation',
});

console.log('\n[output is always valid JSON]');
for (const n of [0, 1, 12, 60, 400]) {
  const r = buildContextJson(ctx(n), 6000);
  let ok = true; try {JSON.parse(r.json);} catch (e) {ok = false;}
  check(`n=${n} parses (len ${r.json.length}, trimmed=${r.trimmed})`, ok, r.json.slice(-60));
}

console.log('\n[the fields the prompt depends on survive]');
const tight = buildContextJson(ctx(200), 6000);
const parsedTight = JSON.parse(tight.json);
check('toolboxRecent survives a heavy trim',
    JSON.stringify(parsedTight.toolboxRecent) === JSON.stringify(toolboxRecent), parsedTight.toolboxRecent);
check('mintQuest survives', !!parsedTight.mintQuest, parsedTight.mintQuest);
check('reminders survive', !!parsedTight.reminders, parsedTight.reminders);
check('focusPlant survives', !!parsedTight.focusPlant);
check('did trim, and said so', tight.trimmed === true && Object.keys(tight.dropped).length > 0, tight.dropped);

console.log('\n[budget is respected]');
for (const budget of [500, 2000, 6000, 20000]) {
  const r = buildContextJson(ctx(200), budget);
  check(`n=200 within ${budget} (got ${r.json.length})`, r.json.length <= budget);
}

console.log('\n[trimming degrades evenly, and says what was dropped]');
const t = JSON.parse(buildContextJson(ctx(40), 4000).json);
const counts = {plants: (t.plants || []).length, tokens: (t.tokens || []).length,
  recentEntries: (t.recentEntries || []).length};
check('no array is wiped out while another stays long',
    Math.min(...Object.values(counts)) > 0, counts);
check('spread stays tight (evenly trimmed)',
    Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 2, counts);
check('every trimmed array reports how many were omitted',
    ['plants', 'tokens', 'recentEntries'].every((k) =>
      counts[k] === 40 || typeof t[k + 'Truncated'] === 'number'),
    {counts, truncated: {p: t.plantsTruncated, tk: t.tokensTruncated, re: t.recentEntriesTruncated}});

console.log('\n[an emptied array is still declared, never silently absent]');
const tiny = JSON.parse(buildContextJson(ctx(40), 900).json);
check('arrays present even when empty',
    Array.isArray(tiny.plants) && Array.isArray(tiny.tokens) && Array.isArray(tiny.recentEntries),
    Object.keys(tiny));
check('counts still tell the model what is missing',
    (tiny.plantsTruncated || 0) + (tiny.tokensTruncated || 0) + (tiny.recentEntriesTruncated || 0) > 0,
    tiny);

console.log('\n[small contexts are left alone]');
const small = buildContextJson(ctx(3), 20000);
check('not trimmed', small.trimmed === false && Object.keys(small.dropped).length === 0);
check('all three arrays intact',
    JSON.parse(small.json).plants.length === 3 && JSON.parse(small.json).tokens.length === 3 &&
    JSON.parse(small.json).recentEntries.length === 3);

console.log('\n[priority fields lead the payload]');
const keys = Object.keys(JSON.parse(buildContextJson(ctx(12), 20000).json));
const firstTrimmable = keys.findIndex((k) => ['plants', 'tokens', 'recentEntries'].includes(k));
const lastPriority = Math.max(...PRIORITY_FIELDS.map((f) => keys.indexOf(f)).filter((i) => i >= 0));
check('every priority field precedes the long arrays', lastPriority < firstTrimmable, {keys});

console.log('\n[degenerate input]');
for (const bad of [null, undefined, 'string', 42, []]) {
  const r = buildContextJson(bad, 6000);
  let ok = true; try {JSON.parse(r.json);} catch (e) {ok = false;}
  check(`${JSON.stringify(bad)} → valid JSON`, ok && r.json === '{}', r.json);
}
const huge = buildContextJson({focusPlant: plant(0), toolboxRecent, blob: 'x'.repeat(50000)}, 6000);
let hugeOk = true; try {JSON.parse(huge.json);} catch (e) {hugeOk = false;}
check('unknown oversized field → still valid JSON within budget',
    hugeOk && huge.json.length <= 6000, huge.json.slice(0, 80));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
