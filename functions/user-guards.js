/**
 * Caller guards for the Gemini-backed endpoints.
 *
 * Both `coachChat` and `analyzeGrowFrames` are `invoker: 'public'` and spend
 * money on every call, so "has a valid Firebase token" is not a strong enough
 * gate on its own: signup is open, so anyone can mint an account and hammer
 * them. These helpers add the two missing checks — a verified email address,
 * and a per-user daily cap.
 */

const {getAuth} = require('firebase-admin/auth');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

/** Error carrying the HTTP status the handler should return. */
class GuardError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {string} message Client-safe message.
   * @param {string} [code] Stable machine-readable code.
   */
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'guard_failed';
  }
}

/**
 * Verify the Bearer token and require a verified email address.
 *
 * Google sign-in sets `email_verified` automatically, so in practice this only
 * gates email/password accounts that never clicked the verification link.
 *
 * @param {!Object} req Incoming request.
 * @return {Promise<Object>} The decoded ID token.
 */
async function requireVerifiedUser(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    throw new GuardError(401, 'Missing Authorization Bearer token', 'no_token');
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(match[1]);
  } catch (err) {
    const expired = err && err.code === 'auth/id-token-expired';
    throw new GuardError(
        401,
        expired ? 'Session expired — sign in again.' : 'Invalid session token.',
        expired ? 'token_expired' : 'bad_token',
    );
  }

  if (!decoded.email_verified) {
    throw new GuardError(
        403,
        'Verify your email address to use the AI features. ' +
      'Check your inbox for the growtoo verification link.',
        'email_unverified',
    );
  }

  return decoded;
}

/**
 * Consume one unit of a per-user, per-UTC-day quota.
 *
 * Counters live in `aiUsage/{uid}_{yyyy-mm-dd}` and are written only by the
 * Admin SDK (the collection is denied to clients in firestore.rules). One doc
 * per user per day keeps the transaction contention-free and makes cleanup a
 * simple TTL on `expiresAt`.
 *
 * @param {string} uid Firebase uid.
 * @param {string} kind Quota bucket, e.g. 'coachChat'.
 * @param {number} max Maximum calls allowed per UTC day.
 * @return {Promise<{used: number, max: number}>} Usage after this call.
 */
async function consumeDailyQuota(uid, kind, max) {
  const db = getFirestore();
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection('aiUsage').doc(`${uid}_${day}`);

  // Return an explicit allowed flag rather than comparing counts outside the
  // transaction: at exactly `max` the "blocked" and "last allowed call" cases
  // produce the same count, so a count alone cannot distinguish them.
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.exists && snap.get(kind)) || 0;
    if (current >= max) return {allowed: false, used: current};

    if (snap.exists) {
      tx.update(ref, {
        [kind]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // 48h past the day boundary — enough slack for any clock skew before a
      // TTL policy on `expiresAt` reaps the doc.
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      tx.set(ref, {
        uid,
        day,
        [kind]: 1,
        expiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {allowed: true, used: current + 1};
  });

  if (!result.allowed) {
    throw new GuardError(
        429,
        `Daily AI limit reached (${max} per day). It resets at 00:00 UTC.`,
        'quota_exceeded',
    );
  }

  return {used: result.used, max};
}

/**
 * Translate a thrown error into a response. Guard failures carry a safe
 * message; anything else is logged and reported generically so internal
 * details never reach the client.
 *
 * @param {string} label Log label.
 * @param {Error} err The thrown error.
 * @param {!Object} res Response to write.
 */
function sendGuardError(label, err, res) {
  if (err instanceof GuardError) {
    res.status(err.status).json({error: err.message, code: err.code});
    return;
  }
  console.error(label, err);
  const status = err && err.code === 'auth/id-token-expired' ? 401 : 500;
  res.status(status).json({error: 'Internal error'});
}

module.exports = {
  GuardError,
  requireVerifiedUser,
  consumeDailyQuota,
  sendGuardError,
};
