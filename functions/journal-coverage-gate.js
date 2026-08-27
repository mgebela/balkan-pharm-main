/**
 * Re-evaluate journal coverage when a market listing is first created.
 * Client fields are not trusted — this overwrites journalCoverageOk from
 * users/{uid}/app/state using createdAt care days.
 */
'use strict';

const {evaluateListEligibility, snapshot} = require('./list-eligibility');

async function loadAppState(db, uid) {
  if (!uid) return {plants: [], entries: [], toolbox: {}};
  const snap = await db.collection('users').doc(uid).collection('app').doc('state').get();
  if (!snap.exists) return {plants: [], entries: [], toolbox: {}};
  const data = snap.data() || {};
  return {
    plants: Array.isArray(data.plants) ? data.plants : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
    toolbox: data.toolbox && typeof data.toolbox === 'object' ? data.toolbox : {},
  };
}

/**
 * On listing create, stamp journalCoverageOk from the grower's journal.
 * Returns the listing payload that public tape should use (merged).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} listingId
 * @param {object|null} before
 * @param {object|null} after
 * @param {FirebaseFirestore.DocumentReference|null} ref
 * @return {Promise<object|null>}
 */
async function applyJournalCoverageOnCreate(db, listingId, before, after, ref) {
  if (!after || !ref) return after;
  if (before) return after;
  const status = String(after.status || '');
  if (status !== 'active' && status !== 'escrow_pending') return after;

  const state = await loadAppState(db, after.uid);
  const result = evaluateListEligibility(state, after.plantId);
  const cover = snapshot(result);
  const patch = {
    journalCoverageOk: !!result.ok,
    journalCoverage: cover,
    journalCoverageCheckedAt: cover.checkedAt,
  };
  if (!result.ok) patch.journalCoverageError = String(result.error || result.code).slice(0, 240);

  await ref.update(patch);
  return Object.assign({}, after, patch);
}

module.exports = {
  applyJournalCoverageOnCreate,
  loadAppState,
};
