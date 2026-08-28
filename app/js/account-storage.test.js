'use strict';

function mockLocalStorage() {
  const store = Object.create(null);
  global.localStorage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem: function (key, val) {
      store[key] = String(val);
    },
    removeItem: function (key) {
      delete store[key];
    },
    clear: function () {
      Object.keys(store).forEach(function (k) {
        delete store[k];
      });
    },
  };
  return store;
}

mockLocalStorage();
const Signup = require('./signup.js');

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

function plant(id, name) {
  return JSON.stringify([{ id: id, name: name }]);
}

const OWNER = Signup.ACCOUNT_OWNER_KEY;
const PLANTS = 'dnevnik-live-plants';
const ENTRIES = 'dnevnik-live-entries';
const NAME = 'dnevnik-live-display-name';

function plantsOf() {
  try {
    return JSON.parse(localStorage.getItem(PLANTS) || '[]');
  } catch (err) {
    return [];
  }
}

function namesOf(list) {
  return (list || []).map(function (p) {
    return p && p.name;
  });
}

function bindEstablished(uid, plantName, displayName) {
  localStorage.setItem(PLANTS, plant('p-' + uid, plantName));
  localStorage.setItem(NAME, displayName);
  localStorage.setItem(OWNER, uid);
  Signup.persistAccountLocalData(uid);
}

// Unscoped leftover after an old logout: do not give it to the next uid.
localStorage.clear();
localStorage.setItem(PLANTS, plant('p-a', 'Superadmin plant'));
localStorage.setItem(ENTRIES, JSON.stringify([{ id: 'e-a', plantId: 'p-a' }]));
localStorage.setItem(NAME, 'Superadmin');
Signup.isolateAccountLocalData('uid-b');
check(
  'unowned leftover journal is not assigned to the next account',
  plantsOf().length === 0,
  namesOf(plantsOf())
);
check(
  'unowned leftover profile is not assigned to the next account',
  localStorage.getItem(NAME) == null
);
check('owner is bound to B', localStorage.getItem(OWNER) === 'uid-b');

// Established A -> B -> A on the same browser.
localStorage.clear();
bindEstablished('uid-a', 'Account A plant', 'Grower A');
Signup.isolateAccountLocalData('uid-a');
check('established A keeps journal', plantsOf()[0] && plantsOf()[0].name === 'Account A plant');

Signup.isolateAccountLocalData('uid-b');
check('switch to B does not show A journal', plantsOf().length === 0, namesOf(plantsOf()));
check('switch to B does not show A name', localStorage.getItem(NAME) == null);
check(
  'A snapshot is parked',
  localStorage.getItem(PLANTS + ':uid-a') &&
    localStorage.getItem(PLANTS + ':uid-a').indexOf('Account A plant') !== -1
);

localStorage.setItem(PLANTS, plant('p-b', 'Account B plant'));
localStorage.setItem(NAME, 'Grower B');
Signup.persistAccountLocalData('uid-b');
Signup.isolateAccountLocalData('uid-a');
check('switch back to A restores A journal', plantsOf()[0] && plantsOf()[0].name === 'Account A plant');
check('switch back to A restores A name', localStorage.getItem(NAME) === 'Grower A');
check('B snapshot is not in unscoped keys', !JSON.stringify(plantsOf()).includes('Account B plant'));

// Logout snapshots A, clears the desk, B cannot see A, A can restore.
localStorage.clear();
bindEstablished('uid-a', 'Account A plant', 'Grower A');
Signup.releaseAccountLocalData('uid-a');
check('logout clears unscoped plants', plantsOf().length === 0);
check('logout clears owner', localStorage.getItem(OWNER) == null);

Signup.isolateAccountLocalData('uid-b');
check('B after A logout has empty journal', plantsOf().length === 0);

Signup.isolateAccountLocalData('uid-a');
check('A after re-login restores snapshot', plantsOf()[0] && plantsOf()[0].name === 'Account A plant');

// Same uid isolate is a no-op.
localStorage.setItem(PLANTS, plant('p-a2', 'New A plant'));
Signup.isolateAccountLocalData('uid-a');
check('same-uid isolate keeps in-session writes', plantsOf()[0] && plantsOf()[0].name === 'New A plant');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
