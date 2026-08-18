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
const {getAppCheck} = require('firebase-admin/app-check');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

// App Check rollout switch. `onRequest` functions are not covered by the
// console's enforcement toggle (that only applies to callable functions), so
// enforcement has to happen here.
//
// Ships OFF on purpose: clients only start sending tokens once a reCAPTCHA
// site key is set in js/appcheck-config.js and deployed. Turning this on
// before that lands would reject every real request. Roll out in order —
// deploy the client, watch the appcheck_missing / appcheck_invalid logs drop
// to ~zero, then set APP_CHECK_ENFORCE=true.
const APP_CHECK_ENFORCE =
  String(process.env.APP_CHECK_ENFORCE || '').toLowerCase() === 'true';

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
 * @param {string} [unverifiedMessage] Override the 403 copy (wallet vs AI).
 * @return {Promise<Object>} The decoded ID token.
 */
async function requireVerifiedUser(req, unverifiedMessage) {
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
        unverifiedMessage ||
          'Verify your email address to use the AI features. ' +
            'Check your inbox for the growtoo verification link.',
        'email_unverified',
    );
  }

  return decoded;
}

/**
 * Verify the Firebase App Check token on an incoming request.
 *
 * In monitor mode (the default) the outcome is logged and the request always
 * proceeds, so this can be deployed ahead of the client rollout. Once
 * APP_CHECK_ENFORCE=true, a missing or invalid token is rejected outright.
 *
 * This attests that the caller is our app — it says nothing about *who* they
 * are, so it complements requireVerifiedUser() rather than replacing it.
 *
 * @param {!Object} req Incoming request.
 * @param {string} label Log label for the calling endpoint.
 * @return {Promise<{ok: boolean, reason: string}>} Verification outcome.
 */
async function verifyAppCheck(req, label) {
  const token =
    req.headers['x-firebase-appcheck'] || req.headers['X-Firebase-AppCheck'];

  let outcome;
  if (!token) {
    outcome = {ok: false, reason: 'appcheck_missing'};
  } else {
    try {
      await getAppCheck().verifyToken(String(token));
      outcome = {ok: true, reason: 'appcheck_ok'};
    } catch (err) {
      outcome = {ok: false, reason: 'appcheck_invalid'};
    }
  }

  if (!outcome.ok) {
    // Structured so the rollout can be measured before enforcing.
    console.warn(
        JSON.stringify({
          event: 'appcheck',
          endpoint: label,
          reason: outcome.reason,
          enforcing: APP_CHECK_ENFORCE,
        }),
    );
    if (APP_CHECK_ENFORCE) {
      throw new GuardError(
          401,
          'This request could not be verified as coming from the growtoo app.',
          outcome.reason,
      );
    }
  }

  return outcome;
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
  verifyAppCheck,
  consumeDailyQuota,
  sendGuardError,
  APP_CHECK_ENFORCE,
};
