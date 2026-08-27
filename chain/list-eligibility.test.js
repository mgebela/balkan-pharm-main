import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  evaluateListEligibility,
  LIST_ELIGIBILITY,
  requiredCareDays,
} = require('../functions/list-eligibility.js');

function check(name, ok, detail) {
  if (!ok) {
    console.error('FAIL', name, detail || '');
    process.exitCode = 1;
  } else {
    console.log('ok', name);
  }
}

const DAY = 86400000;
const now = Date.parse('2026-08-28T12:00:00.000Z');

function isoDaysAgo(days, hour) {
  const h = hour == null ? '10:00:00.000Z' : hour;
  const ms = now - days * DAY;
  return new Date(ms).toISOString().slice(0, 10) + 'T' + h;
}

function water(plantId, createdAt, date) {
  return {
    id: 'e-' + createdAt,
    plantId,
    type: 'zalijevanje',
    date: date || createdAt.slice(0, 10),
    createdAt,
  };
}

const plant = { id: 'p1', name: 'Trail', createdAt: isoDaysAgo(20) };

check('no plantId', evaluateListEligibility({ plants: [plant], entries: [] }, '').code === 'no_plant');
check(
  'missing plant',
  evaluateListEligibility({ plants: [plant], entries: [] }, 'nope').code === 'no_plant'
);

const dump = {
  plants: [{ id: 'p1', name: 'Dump', createdAt: '2026-08-28T12:00:00.000Z' }],
  entries: Array.from({ length: 90 }, (_, i) =>
    water(
      'p1',
      '2026-08-28T12:00:00.000Z',
      '2026-01-' + String((i % 27) + 1).padStart(2, '0')
    )
  ),
};
const dumped = evaluateListEligibility(dump, 'p1', now);
check('same-session dump is one care day', dumped.careDays === 1, dumped);
check('same-session dump is too soon', dumped.code === 'too_soon', dumped.code);

const startDateTrap = {
  plants: [{ id: 'p1', name: 'Trap', startDate: '2026-01-01', createdAt: isoDaysAgo(1) }],
  entries: [water('p1', isoDaysAgo(1))],
};
const trapped = evaluateListEligibility(startDateTrap, 'p1', now);
check('startDate does not unlock listing', trapped.ok === false, trapped);
check('startDate ignored for elapsed', trapped.elapsedDays <= 2, trapped.elapsedDays);

const readyEntries = [];
for (let d = 0; d < 14; d++) {
  if (d % 2 === 0) readyEntries.push(water('p1', isoDaysAgo(13 - d)));
}
const ready = evaluateListEligibility(
  { plants: [{ id: 'p1', name: 'Ok', createdAt: isoDaysAgo(13) }], entries: readyEntries },
  'p1',
  now
);
check('14 elapsed days + 7 care days is ok', ready.ok === true, ready);
check('ready careDays is 7', ready.careDays === 7, ready.careDays);

const shortCare = evaluateListEligibility(
  {
    plants: [{ id: 'p1', name: 'Sparse', createdAt: isoDaysAgo(13) }],
    entries: [water('p1', isoDaysAgo(13)), water('p1', isoDaysAgo(1))],
  },
  'p1',
  now
);
check('14 days with 2 care days is low coverage', shortCare.code === 'low_coverage', shortCare);

check('required at 14 days is 7', requiredCareDays(14) === 7);
check('required at 180 days is 90', requiredCareDays(180) === 90);
check('required at 200 days still 90 (cycle cap)', requiredCareDays(200) === 90);

const longTrail = [];
for (let d = 0; d < 90; d++) {
  longTrail.push(water('p1', isoDaysAgo(199 - d)));
}
const capped = evaluateListEligibility(
  { plants: [{ id: 'p1', name: 'Long', createdAt: isoDaysAgo(199) }], entries: longTrail },
  'p1',
  now
);
check('long trail with 90 days passes cycle cap', capped.ok === true, capped);
check('capped requiredCareDays is 90', capped.requiredCareDays === 90, capped.requiredCareDays);

const datedOnly = evaluateListEligibility(
  {
    plants: [{ id: 'p1', name: 'Old' }],
    entries: [
      { id: 'x', plantId: 'p1', type: 'zalijevanje', date: '2026-01-01' },
    ],
  },
  'p1',
  now
);
check('entry.date without createdAt does not count', datedOnly.code === 'no_logs', datedOnly);

check('minElapsedDays is 14', LIST_ELIGIBILITY.minElapsedDays === 14);
check('coverageRatio is 0.5', LIST_ELIGIBILITY.coverageRatio === 0.5);

if (process.exitCode) {
  console.error('list-eligibility tests failed');
} else {
  console.log('list-eligibility tests passed');
}
