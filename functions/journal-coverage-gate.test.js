'use strict';

const g = require('./journal-coverage-gate');

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

check('exports applyJournalCoverageOnCreate', typeof g.applyJournalCoverageOnCreate === 'function');
check('exports loadAppState', typeof g.loadAppState === 'function');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
