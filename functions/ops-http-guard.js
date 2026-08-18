/**
 * Gate public HTTP ops endpoints (settle / reconcile / kick / verifyTxHealth).
 *
 * Cloud Scheduler onSchedule handlers do not go through this — they stay
 * internal. Browser pings must send a Firebase ID token. GitHub Actions /
 * curl must send X-Growtoo-Ops: $GROWTOO_OPS_SECRET (same value in Functions
 * env and the GitHub Actions secret).
 *
 * `force` on kickChainQueues is only honoured for the ops secret, never for
 * signed-in users.
 */
'use strict';

const crypto = require('crypto');
const {getAuth} = require('firebase-admin/auth');

function opsSecret() {
  return String(process.env.GROWTOO_OPS_SECRET || '').trim();
}

function providedSecret(req) {
  const headers = (req && req.headers) || {};
  return String(headers['x-growtoo-ops'] || headers['x-growtoo-ops-secret'] || '').trim();
}

function secretsEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * @param {!Object} req
 * @return {Promise<{kind: 'ops'} | {kind: 'user', uid: string}>}
 */
async function requireOpsOrSignedIn(req) {
  if (secretsEqual(opsSecret(), providedSecret(req))) {
    return {kind: 'ops'};
  }

  const authHeader = (req.headers && req.headers.authorization) || '';
  const match = String(authHeader).match(/^Bearer (.+)$/i);
  if (!match) {
    const err = new Error(
        'Unauthorized — sign in, or send X-Growtoo-Ops with GROWTOO_OPS_SECRET.',
    );
    err.status = 401;
    err.code = 'ops_unauthorized';
    throw err;
  }

  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    return {kind: 'user', uid: decoded.uid};
  } catch (err) {
    const expired = err && err.code === 'auth/id-token-expired';
    const out = new Error(expired ? 'Session expired — sign in again.' : 'Invalid session token.');
    out.status = 401;
    out.code = expired ? 'token_expired' : 'bad_token';
    throw out;
  }
}

function opsAllowsForce(auth) {
  return !!(auth && auth.kind === 'ops');
}

module.exports = {
  requireOpsOrSignedIn,
  opsAllowsForce,
  secretsEqual,
  opsSecret,
  providedSecret,
};
