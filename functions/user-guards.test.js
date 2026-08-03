/* Exercises user-guards.js against a fake Firestore + Auth. */
const Module = require('module');
const path = require('path');

const FN = __dirname;

// ---- fakes ----
const store = new Map();
const FieldValue = {
  increment: (n) => ({__inc: n}),
  serverTimestamp: () => ({__ts: true}),
};
function applyWrite(existing, data) {
  const out = Object.assign({}, existing);
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__inc !== undefined) out[k] = (out[k] || 0) + v.__inc;
    else if (v && v.__ts) out[k] = 'TS';
    else out[k] = v;
  }
  return out;
}
const fakeDb = {
  collection: (c) => ({
    doc: (id) => {
      const key = c + '/' + id;
      return {
        key,
        get exists() {return store.has(key);},
      };
    },
  }),
  runTransaction: async (fn) => {
    const tx = {
      get: async (ref) => ({
        exists: store.has(ref.key),
        get: (f) => (store.get(ref.key) || {})[f],
      }),
      update: (ref, data) => store.set(ref.key, applyWrite(store.get(ref.key), data)),
      set: (ref, data) => store.set(ref.key, applyWrite({}, data)),
    };
    return fn(tx);
  },
};

let fakeToken = {uid: 'u1', email_verified: true};
let throwCode = null;

const realResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...rest) {
  if (request === 'firebase-admin/firestore') return 'FAKE_FS';
  if (request === 'firebase-admin/auth') return 'FAKE_AUTH';
  return realResolve.call(this, request, ...rest);
};
require.cache['FAKE_FS'] = {id: 'FAKE_FS', filename: 'FAKE_FS', loaded: true,
  exports: {getFirestore: () => fakeDb, FieldValue}};
require.cache['FAKE_AUTH'] = {id: 'FAKE_AUTH', filename: 'FAKE_AUTH', loaded: true,
  exports: {getAuth: () => ({verifyIdToken: async () => {
    if (throwCode) {const e = new Error('x'); e.code = throwCode; throw e;}
    return fakeToken;
  }})}};

const g = require(path.join(FN, 'user-guards.js'));

// ---- tests ----
let pass = 0; let fail = 0;
function check(name, cond, extra) {
  if (cond) {pass++; console.log('  PASS', name);}
  else {fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra));}
}

(async () => {
  console.log('\n[quota] cap is enforced exactly at max');
  const MAX = 3;
  const results = [];
  for (let i = 0; i < 6; i++) {
    try {
      const r = await g.consumeDailyQuota('u1', 'coachChat', MAX);
      results.push('ok:' + r.used);
    } catch (e) {results.push(e.code + ':' + e.status);}
  }
  check('first 3 allowed, rest blocked with 429',
      JSON.stringify(results) === JSON.stringify(
          ['ok:1', 'ok:2', 'ok:3', 'quota_exceeded:429', 'quota_exceeded:429', 'quota_exceeded:429']),
      results);
  const day = new Date().toISOString().slice(0, 10);
  check('counter stopped incrementing at max',
      store.get('aiUsage/u1_' + day).coachChat === 3,
      store.get('aiUsage/u1_' + day));

  console.log('\n[quota] buckets are independent');
  const other = await g.consumeDailyQuota('u1', 'analyzeGrowFrames', MAX);
  check('separate kind has its own count', other.used === 1, other);

  console.log('\n[quota] users are independent');
  const u2 = await g.consumeDailyQuota('u2', 'coachChat', MAX);
  check('second uid starts at 1', u2.used === 1, u2);

  console.log('\n[auth] email verification');
  try {
    await g.requireVerifiedUser({headers: {authorization: 'Bearer t'}});
    check('verified user passes', true);
  } catch (e) {check('verified user passes', false, e.message);}

  fakeToken = {uid: 'u3', email_verified: false};
  try {
    await g.requireVerifiedUser({headers: {authorization: 'Bearer t'}});
    check('unverified rejected', false, 'no throw');
  } catch (e) {
    check('unverified rejected 403/email_unverified', e.status === 403 && e.code === 'email_unverified', e);
  }

  console.log('\n[auth] token problems');
  try {
    await g.requireVerifiedUser({headers: {}});
    check('missing token rejected', false);
  } catch (e) {check('missing token -> 401/no_token', e.status === 401 && e.code === 'no_token', e);}

  throwCode = 'auth/id-token-expired';
  try {
    await g.requireVerifiedUser({headers: {authorization: 'Bearer t'}});
    check('expired rejected', false);
  } catch (e) {check('expired -> 401/token_expired', e.status === 401 && e.code === 'token_expired', e);}

  console.log('\n[errors] internal details are not leaked');
  let body = null; let status = null;
  g.sendGuardError('t', new Error('secret db connection string'), {
    status: (s) => {status = s; return {json: (b) => {body = b;}};},
  });
  check('generic 500 without internals',
      status === 500 && body.error === 'Internal error' && !JSON.stringify(body).includes('secret'), {status, body});

  g.sendGuardError('t', new g.GuardError(429, 'Daily AI limit reached (60 per day).', 'quota_exceeded'), {
    status: (s) => {status = s; return {json: (b) => {body = b;}};},
  });
  check('guard message passes through with code',
      status === 429 && body.code === 'quota_exceeded', {status, body});

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
