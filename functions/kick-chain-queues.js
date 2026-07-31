/**
 * Near-instant chain queue pickup: dispatch GitHub Actions `chain-queues.yml`
 * when seed/growth mints land as pending (and on a short Cloud Scheduler backup).
 *
 * Env (functions/.env.<project>, gitignored):
 *   GITHUB_DISPATCH_TOKEN — fine-grained PAT with Actions: Read and write on this repo
 *   GITHUB_REPO — default mgebela/balkan-pharm-main
 *   GITHUB_WORKFLOW — default chain-queues.yml
 *   GITHUB_REF — default main
 */
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

const DEFAULT_REPO = 'mgebela/balkan-pharm-main';
const DEFAULT_WORKFLOW = 'chain-queues.yml';
const DEFAULT_REF = 'main';
const DEBOUNCE_MS = 45 * 1000;
const STATE_DOC = 'ops/chainQueueKick';

function token() {
  return String(process.env.GITHUB_DISPATCH_TOKEN || '').trim();
}

function repo() {
  return String(process.env.GITHUB_REPO || DEFAULT_REPO).trim();
}

function workflow() {
  return String(process.env.GITHUB_WORKFLOW || DEFAULT_WORKFLOW).trim();
}

function gitRef() {
  return String(process.env.GITHUB_REF || DEFAULT_REF).trim();
}

/**
 * @param {{ source?: string, force?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, kicked?: boolean, skipped?: string, status?: number, error?: string }>}
 */
async function kickChainQueues(opts) {
  const o = opts || {};
  const pat = token();
  if (!pat) {
    return {
      ok: false,
      error: 'GITHUB_DISPATCH_TOKEN missing — set in functions/.env.<project>',
    };
  }

  const db = getFirestore();
  const stateRef = db.doc(STATE_DOC);
  if (!o.force) {
    try {
      const snap = await stateRef.get();
      const last = snap.exists ? Date.parse(String((snap.data() || {}).lastKickAt || '')) : 0;
      if (Number.isFinite(last) && Date.now() - last < DEBOUNCE_MS) {
        return {ok: true, kicked: false, skipped: 'debounced'};
      }
    } catch (err) {
      console.warn('kick debounce read failed', err && err.message ? err.message : err);
    }
  }

  const url =
    'https://api.github.com/repos/' +
    encodeURI(repo()) +
    '/actions/workflows/' +
    encodeURIComponent(workflow()) +
    '/dispatches';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + pat,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'growtoo-kick-chain-queues',
    },
    body: JSON.stringify({ref: gitRef()}),
  });

  if (res.status !== 204 && res.status !== 200) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: 'GitHub dispatch failed: ' + (body || res.statusText || res.status).slice(0, 300),
    };
  }

  try {
    await stateRef.set(
        {
          lastKickAt: new Date().toISOString(),
          lastSource: String(o.source || 'unknown').slice(0, 80),
          updatedAt: FieldValue.serverTimestamp(),
        },
        {merge: true},
    );
  } catch (err) {
    console.warn('kick state write failed', err && err.message ? err.message : err);
  }

  return {ok: true, kicked: true, status: res.status};
}

/**
 * True when a mint doc just entered (or re-entered) pending.
 * @param {object|null} before
 * @param {object|null} after
 */
function becamePending(before, after) {
  if (!after || after.status !== 'pending') return false;
  if (!before) return true;
  return before.status !== 'pending';
}

module.exports = {
  kickChainQueues,
  becamePending,
};
