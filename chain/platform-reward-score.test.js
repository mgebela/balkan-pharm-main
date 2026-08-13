import {
  collectCareActivity,
  collectMonthlyActivity,
  scorePlatformReward,
  breakdownLines,
  PLATFORM_REWARD_CAP,
  CARE_DAY_CAP,
} from './platform-reward-score.js';

function check(name, ok, detail) {
  if (!ok) {
    console.error('FAIL', name, detail || '');
    process.exitCode = 1;
  } else {
    console.log('ok', name);
  }
}

const monthKey = '2026-08';
const start = '2026-08-01T00:00:00.000Z';

function entry(plantId, type, day) {
  return {
    id: plantId + type + day,
    plantId,
    type,
    date: day,
    createdAt: day + 'T10:00:00.000Z',
  };
}

const empty = collectMonthlyActivity({ plants: [], entries: [] }, monthKey);
check('empty month is zero', scorePlatformReward(empty) === 0, scorePlatformReward(empty));

const dailyWater = {
  plants: [{ id: 'p1', name: 'A', createdAt: '2026-07-01T00:00:00.000Z' }],
  entries: Array.from({ length: 20 }, (_, i) =>
    entry('p1', 'zalijevanje', '2026-08-' + String(i + 1).padStart(2, '0'))
  ),
};
const daily = collectMonthlyActivity(dailyWater, monthKey);
check('20 water days → 20 care days', daily.careDays === 20, daily.careDays);
check(
  '20 water days + two 5-day weeks = 26',
  scorePlatformReward(daily) === 26,
  scorePlatformReward(daily) + ' weeks=' + daily.qualifyingWeeks
);

const spamSameDay = {
  plants: [{ id: 'p1', createdAt: start }, { id: 'p2', createdAt: start }],
  entries: [
    entry('p1', 'zalijevanje', '2026-08-03'),
    entry('p1', 'zalijevanje', '2026-08-03'),
    entry('p2', 'zalijevanje', '2026-08-03'),
    entry('p1', 'gnojidba', '2026-08-03'),
  ],
};
const spam = collectCareActivity(spamSameDay, Date.parse(start), Date.parse('2026-09-01T00:00:00.000Z'));
check('same UTC day is one care day', spam.careDays === 1, spam.careDays);
check('feeding that day still counts as one feeding day', spam.feedingDays === 1, spam.feedingDays);
check('same-day score is 2 (care + feed)', scorePlatformReward(spam) === 2, scorePlatformReward(spam));

const notesOnly = {
  plants: [{ id: 'p1', createdAt: start }],
  entries: [entry('p1', 'opcenito', '2026-08-04')],
};
check(
  'general notes do not earn care days',
  collectMonthlyActivity(notesOnly, monthKey).careDays === 0
);

const stories = scorePlatformReward({
  careDays: 10,
  feedingDays: 0,
  publishedStories: 4,
  qualifyingWeeks: 0,
  newPlants: 0,
  seedMints: 0,
});
check('stories cap at 2×5', stories === 10 + 10, stories);

const capped = scorePlatformReward({
  careDays: 30,
  feedingDays: 20,
  publishedStories: 9,
  qualifyingWeeks: 8,
  newPlants: 20,
  seedMints: 10,
  flowerBonus: true,
});
check('hard cap 50', capped === PLATFORM_REWARD_CAP, capped);
check('care day cap used in breakdown', breakdownLines({ careDays: 25 }).lines[0].capped === CARE_DAY_CAP);

const weekState = {
  plants: [{ id: 'p1', createdAt: start }],
  entries: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'].map((d) =>
    entry('p1', 'zalijevanje', d)
  ),
};
const weeked = collectMonthlyActivity(weekState, monthKey);
check('five days in one ISO week qualifies once', weeked.qualifyingWeeks >= 1, weeked.qualifyingWeeks);

if (process.exitCode) {
  console.error('platform-reward-score tests failed');
  process.exit(1);
}
console.log('platform-reward-score tests passed');
