#!/usr/bin/env node
/**
 * Append today's care logs for traffic growers' listed / sold plants,
 * bump care counters on sold sim listings, grow journal skill, trim entries.
 *
 * Usage (from chain/): npm run traffic:day
 */
import { initTraffic, commitBatches } from './helpers.js';
import { GROWERS, TRAFFIC_BATCH, ENTRY_WINDOW_DAYS, STAGE_LADDER } from './personas.js';
import { ymdUTC, buildTodayCareEntry, trimEntries } from './synth.js';
import { skillTitle, xpForLevel, levelFromJournalXp } from './journal-skill.js';

function bumpJournalSkill(prev, persona) {
  const start = Math.max(1, Number(persona?.journalSkillStart || prev?.startedAtSkill || 1));
  const cap = Math.min(5, start + 2);
  const prevLevel = Math.max(1, Math.min(5, Number(prev?.level) || start));
  const prevXp = Number(prev?.xp) || xpForLevel(prevLevel);
  const dayStreak = Number(prev?.dayStreak || 0) + 1;
  // +12 XP per care day; level up when crossing thresholds (cap at start+2).
  let xp = prevXp + 12;
  let level = Math.min(cap, levelFromJournalXp(xp));
  if (level < prevLevel) level = prevLevel;
  return {
    level,
    title: skillTitle(level),
    xp,
    dayStreak,
    startedAtSkill: start,
    city: persona?.city || prev?.city || null,
    region: persona?.region || prev?.region || null,
    personality: persona?.personality || prev?.personality || null,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const { db } = initTraffic();
  const today = ymdUTC(new Date());
  console.log(`Traffic day · ${today} · batch ${TRAFFIC_BATCH}`);

  const growerSnaps = await db
    .collection('users')
    .where('trafficBatch', '==', TRAFFIC_BATCH)
    .get();

  const growerDocs = growerSnaps.docs.filter(
    (d) => (d.data() || {}).profileType === 'grower' && (d.data() || {}).trafficAgent === true
  );

  if (!growerDocs.length) {
    console.error('No traffic growers found. Run npm run traffic:seed first.');
    process.exit(1);
  }

  const writes = [];
  let entryAdds = 0;
  let listingBumps = 0;

  for (const userDoc of growerDocs) {
    const uid = userDoc.id;
    const profile = userDoc.data() || {};
    const persona = GROWERS.find((g) => g.key === profile.trafficKey) || null;
    const stateRef = db.collection('users').doc(uid).collection('app').doc('state');
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      console.warn(`… skip ${profile.trafficKey || uid}: no app/state`);
      continue;
    }
    const state = stateSnap.data() || {};
    const plants = Array.isArray(state.plants) ? state.plants : [];
    const prevSkill = state.journalSkill || profile.journalSkill || null;
    const nextSkill = bumpJournalSkill(prevSkill, persona || profile);

    const listingsSnap = await db.collection('marketListings').where('uid', '==', uid).get();

    const listedPlantIds = new Set();
    const soldByPlant = new Map();
    listingsSnap.docs.forEach((d) => {
      const L = d.data() || {};
      if (L.trafficBatch !== TRAFFIC_BATCH) return;
      if (L.plantId) listedPlantIds.add(String(L.plantId));
      if (L.status === 'sold' && L.careStatus === 'active' && L.plantId) {
        soldByPlant.set(String(L.plantId), { ref: d.ref, data: L });
      }
    });

    let targets = plants.filter((p) => p && listedPlantIds.has(String(p.id)));
    if (!targets.length) {
      targets = plants.slice(0, Math.min(80, plants.length));
    }

    let entries = Array.isArray(state.entries) ? state.entries.slice() : [];
    const existingIds = new Set(entries.map((e) => e && e.id).filter(Boolean));
    const growerForNotes = Object.assign({}, persona || profile, {
      journalSkill: nextSkill,
      journalSkillLevel: nextSkill.level,
      waterNotes: persona?.waterNotes,
      feedNotes: persona?.feedNotes,
    });

    for (const plant of targets) {
      const entry = buildTodayCareEntry(plant, today, growerForNotes);
      if (!existingIds.has(entry.id)) {
        entries.push(entry);
        existingIds.add(entry.id);
        entryAdds += 1;
      }

      const dayNum = Number(today.slice(-2));
      if (dayNum % 7 === 0 && persona) {
        const cur = STAGE_LADDER.findIndex((s) => s.journal === plant.stage);
        if (cur >= 0 && cur < STAGE_LADDER.length - 1) {
          const next = STAGE_LADDER[cur + 1];
          plant.stage = next.journal;
          plant.updatedAt = new Date().toISOString();
          plant.stageHistory = Array.isArray(plant.stageHistory) ? plant.stageHistory : [];
          plant.stageHistory.push({
            from: STAGE_LADDER[cur].journal,
            to: next.journal,
            date: today,
          });
          plant.stageDates = Object.assign({}, plant.stageDates || {}, {
            [next.journal]: today,
          });
        }
      }

      const sold = soldByPlant.get(String(plant.id));
      if (sold) {
        const stage =
          STAGE_LADDER.find((s) => s.journal === plant.stage) || STAGE_LADDER[2];
        const prevHit = Number(sold.data.currentMonthDaysHit || 0);
        const bumpedToday = sold.data._trafficDayBump === today;
        const hit = bumpedToday ? prevHit : Math.min(12, prevHit + 1);
        writes.push({
          ref: sold.ref,
          data: {
            currentMonthKey: today.slice(0, 7),
            currentMonthDaysHit: hit,
            currentMonthMinDays: 12,
            liveStage: stage.label,
            liveStageKey: stage.tokenKey,
            journalStage: plant.stage,
            harvestReady: stage.tokenKey === 'harvest',
            careProgressUpdatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            _trafficDayBump: today,
          },
          merge: true,
        });
        sold.data.currentMonthDaysHit = hit;
        sold.data._trafficDayBump = today;
        if (!bumpedToday) listingBumps += 1;
      }
    }

    entries = trimEntries(entries, ENTRY_WINDOW_DAYS);
    writes.push({
      ref: stateRef,
      data: {
        plants,
        entries,
        toolbox: state.toolbox || {},
        journalSkill: nextSkill,
        coachProfile: {
          role: 'grower',
          journalSkill: nextSkill,
          personality: persona?.personality || profile.personality || null,
          city: persona?.city || profile.city || null,
          needs: {
            teach:
              nextSkill.level <= 2
                ? ['richer daily notes', 'one measurement per log']
                : ['stage-aware diagnosis', 'photo confirmation habits'],
            careConsistency: true,
          },
        },
        trafficAgent: true,
        trafficBatch: TRAFFIC_BATCH,
        updatedAt: new Date().toISOString(),
        lastTrafficDay: today,
      },
      merge: false,
    });
    writes.push({
      ref: userDoc.ref,
      data: { journalSkill: nextSkill, updatedAt: new Date().toISOString() },
      merge: true,
    });

    console.log(
      `✔ ${profile.trafficKey || uid}: skill ${nextSkill.level} (${nextSkill.title}) · +care ${targets.length} · entries ${entries.length}`
    );
  }

  await commitBatches(db, writes);
  console.log(`Done · ${entryAdds} new entries · ${listingBumps} listing care bumps`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
