#!/usr/bin/env node
/**
 * Seed traffic growers + adopters for adopter garden / market UX.
 *
 * Usage (from chain/): npm run traffic:seed
 *
 * Creates Auth users, journal state, ~40% market listings (adopt_stake sim),
 * and assigns sold listings across the 15 adopter ladder.
 * Creds → chain/keys/traffic-agents.json (gitignored).
 */
import {
  initTraffic,
  ensureAuthUser,
  userProfilePayload,
  commitBatches,
  writeCredsFile,
} from './helpers.js';
import { GROWERS, ADOPTERS, TRAFFIC_BATCH, HISTORY_DAYS } from './personas.js';
import {
  buildPlants,
  buildEntries,
  selectListedPlants,
  buildListingDoc,
  buildAdopterToken,
  trafficPubkey,
  buildJournalSkillProfile,
} from './synth.js';
import { coachHintsForAdopter } from './journal-skill.js';
import { buildJournalSeedWrites } from './journal-posts.js';

async function main() {
  const { db } = initTraffic();
  console.log(`Traffic seed · batch ${TRAFFIC_BATCH}`);

  const accounts = [];
  const growerRuntime = [];

  // --- Auth + profile: growers (skill stamped after journals are built) ---
  for (const g of GROWERS) {
    const user = await ensureAuthUser(null, g);
    const skill = buildJournalSkillProfile(g, HISTORY_DAYS);
    const profile = userProfilePayload({ ...g, journalSkill: skill }, user.uid);
    await db.collection('users').doc(user.uid).set(profile, { merge: true });
    const sellerPubkey = trafficPubkey(`seller:${g.key}`);
    growerRuntime.push({
      ...g,
      uid: user.uid,
      sellerPubkey,
      journalSkill: skill,
    });
    accounts.push({
      key: g.key,
      role: 'grower',
      email: g.email,
      uid: user.uid,
      displayName: g.displayName,
      declaredPlants: g.declaredPlants,
      sellerPubkey,
      journalSkill: skill,
    });
    console.log(`✔ grower ${g.key} · skill ${skill.level} (${skill.title}) · ${user.uid}`);
  }

  // --- Auth + profile: adopters ---
  const adopterRuntime = [];
  for (const a of ADOPTERS) {
    const user = await ensureAuthUser(null, a);
    const profile = userProfilePayload(a, user.uid);
    await db.collection('users').doc(user.uid).set(profile, { merge: true });
    const buyerPubkey = trafficPubkey(`buyer:${a.key}`);
    adopterRuntime.push({ ...a, uid: user.uid, buyerPubkey });
    accounts.push({
      key: a.key,
      role: 'adopter',
      tier: a.tier,
      email: a.email,
      uid: user.uid,
      displayName: a.displayName,
      portfolioSize: a.portfolioSize,
      buyerPubkey,
    });
    console.log(`✔ adopter ${a.key} · ${user.uid}`);
  }

  // --- Build plants + listing pool ---
  const allListingDocs = [];
  const growerStates = [];

  for (const g of growerRuntime) {
    const plants = buildPlants(g);
    const listedPlants = selectListedPlants(plants, g.listRatio);
    const listedIds = listedPlants.map((p) => p.id);
    const entries = buildEntries(plants, listedIds, g, HISTORY_DAYS);

    growerStates.push({
      grower: g,
      plants,
      entries,
      listedPlants,
    });

    listedPlants.forEach((plant, index) => {
      allListingDocs.push({ grower: g, plant, index });
    });

    console.log(
      `  ${g.key}: ${plants.length} plant rows (display ~${g.declaredPlants}) · listed ${listedPlants.length} · entries ${entries.length}`
    );
  }

  // Shuffle listing pool deterministically by plant id
  allListingDocs.sort((a, b) => String(a.plant.id).localeCompare(String(b.plant.id)));

  const neededSold = adopterRuntime.reduce((s, a) => s + a.portfolioSize, 0);
  if (allListingDocs.length < neededSold) {
    throw new Error(
      `Not enough listings (${allListingDocs.length}) for adopter portfolios (${neededSold}). Increase plantRows/listRatio.`
    );
  }

  const soldSlots = allListingDocs.slice(0, neededSold);
  const activeSlots = allListingDocs.slice(neededSold);

  // Assign sold to adopters in order
  let cursor = 0;
  const assignments = []; // { slot, buyer }
  for (const buyer of adopterRuntime) {
    for (let i = 0; i < buyer.portfolioSize; i += 1) {
      assignments.push({ slot: soldSlots[cursor], buyer });
      cursor += 1;
    }
  }

  const listingWrites = [];
  const listingsByBuyer = new Map();
  adopterRuntime.forEach((a) => listingsByBuyer.set(a.uid, []));

  for (const { slot, buyer } of assignments) {
    const doc = buildListingDoc({
      grower: slot.grower,
      plant: slot.plant,
      index: slot.index,
      sold: true,
      buyer,
    });
    listingWrites.push(doc);
    listingsByBuyer.get(buyer.uid).push(doc);
  }

  for (const slot of activeSlots) {
    listingWrites.push(
      buildListingDoc({
        grower: slot.grower,
        plant: slot.plant,
        index: slot.index,
        sold: false,
        buyer: null,
      })
    );
  }

  console.log(
    `Listings: ${listingWrites.length} total · ${assignments.length} sold · ${activeSlots.length} active`
  );

  // --- Write grower journals ---
  const writes = [];
  for (const gs of growerStates) {
    const skill = gs.grower.journalSkill || buildJournalSkillProfile(gs.grower, HISTORY_DAYS);
    const stateRef = db.collection('users').doc(gs.grower.uid).collection('app').doc('state');
    writes.push({
      ref: stateRef,
      data: {
        plants: gs.plants,
        entries: gs.entries,
        toolbox: {},
        journalSkill: skill,
        coachProfile: {
          role: 'grower',
          journalSkill: skill,
          personality: gs.grower.personality || null,
          city: gs.grower.city || null,
          needs: {
            teach: skill.level <= 2 ? ['richer daily notes', 'one measurement per log'] : ['stage-aware diagnosis'],
            careConsistency: true,
          },
        },
        trafficAgent: true,
        trafficBatch: TRAFFIC_BATCH,
        updatedAt: new Date().toISOString(),
      },
      merge: false,
    });
  }

  // --- Write adopter empty journal + plantWallet + coach needs ---
  for (const a of adopterRuntime) {
    const sold = listingsByBuyer.get(a.uid) || [];
    const tokens = sold.map(buildAdopterToken);
    const lowCare = sold.filter((l) => Number(l.currentMonthDaysHit || 0) < 6).length;
    const harvestReady = sold.filter((l) => l.harvestReady === true).length;
    const needs = {
      adoptedCount: sold.length,
      lowCareCount: lowCare,
      harvestReadyCount: harvestReady,
      tier: a.tier,
      intent: a.adopterIntent || 'support_growers',
    };
    const hints = coachHintsForAdopter(needs);
    const coachNeeds = { ...needs, ...hints };
    writes.push({
      ref: db.collection('users').doc(a.uid),
      data: { coachNeeds, updatedAt: new Date().toISOString() },
      merge: true,
    });
    const stateRef = db.collection('users').doc(a.uid).collection('app').doc('state');
    writes.push({
      ref: stateRef,
      data: {
        plants: [],
        entries: [],
        toolbox: {},
        plantWallet: {
          connected: false,
          address: a.buyerPubkey,
          growthBalance: 50 + a.portfolioSize * 10,
          tokens,
        },
        coachProfile: {
          role: 'adopter',
          needs: coachNeeds,
        },
        trafficAgent: true,
        trafficBatch: TRAFFIC_BATCH,
        updatedAt: new Date().toISOString(),
      },
      merge: false,
    });
  }

  // --- Listings ---
  for (const listing of listingWrites) {
    const { id, ...data } = listing;
    writes.push({
      ref: db.collection('marketListings').doc(id),
      data: { ...data, id },
      merge: false,
    });
  }

  // --- Public journal stories + grower profiles ---
  for (const g of growerRuntime) {
    writes.push(...buildJournalSeedWrites(db, g));
  }

  await commitBatches(db, writes);
  console.log(`✔ wrote ${writes.length} docs`);

  const credsPath = writeCredsFile(accounts);
  console.log(`✔ creds → ${credsPath}`);
  console.log(`Password (all): ${accounts.length ? '(see creds file)' : 'n/a'}`);
  console.log('Done. Sign in as an adopter (email/password) → open Market / Garden.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
