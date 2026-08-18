const Module = require('module');
const path = require('path');

const FN = __dirname;
let decoded = {uid: 'u1'};
let throwCode = null;

const realResolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...rest) {
  if (request === 'firebase-admin/auth') return 'FAKE_AUTH_OPS';
  return realResolve.call(this, request, ...rest);
};
require.cache['FAKE_AUTH_OPS'] = {
  id: 'FAKE_AUTH_OPS',
  filename: 'FAKE_AUTH_OPS',
  loaded: true,
  exports: {
    getAuth: () => ({
      verifyIdToken: async () => {
        if (throwCode) {
          const e = new Error('x');
          e.code = throwCode;
          throw e;
        }
        return decoded;
      },
    }),
  },
};

process.env.GROWTOO_OPS_SECRET = 'test-ops-secret-value';
const g = require(path.join(FN, 'ops-http-guard.js'));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS', name);
  } else {
    fail++;
    console.log('  FAIL', name, extra === undefined ? '' : extra);
  }
}

(async () => {
  console.log('\n[ops-http] secret');
  const ops = await g.requireOpsOrSignedIn({
    headers: {'x-growtoo-ops': 'test-ops-secret-value'},
  });
  check('ops secret accepted', ops.kind === 'ops', ops);
  check('ops may force', g.opsAllowsForce(ops) === true);

  try {
    await g.requireOpsOrSignedIn({headers: {'x-growtoo-ops': 'wrong'}});
    check('wrong secret rejected', false);
  } catch (e) {
    check('wrong secret 401', e.status === 401, e);
  }

  console.log('\n[ops-http] firebase user');
  const user = await g.requireOpsOrSignedIn({
    headers: {authorization: 'Bearer tok'},
  });
  check('bearer accepted', user.kind === 'user' && user.uid === 'u1', user);
  check('user may not force', g.opsAllowsForce(user) === false);

  try {
    await g.requireOpsOrSignedIn({headers: {}});
    check('empty rejected', false);
  } catch (e) {
    check('empty 401', e.status === 401 && e.code === 'ops_unauthorized', e);
  }

  throwCode = 'auth/id-token-expired';
  try {
    await g.requireOpsOrSignedIn({headers: {authorization: 'Bearer tok'}});
    check('expired rejected', false);
  } catch (e) {
    check('expired 401', e.status === 401 && e.code === 'token_expired', e);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
