/* Tests for solana-rpc-proxy helpers. Run: npm test */
'use strict';

const {isUpstreamTimeout, isMethodAllowed, UPSTREAM_TIMEOUT_MS} = require('./solana-rpc-proxy');

let pass = 0; let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS', name);
  } else {
    fail++;
    console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra));
  }
}

console.log('\n[solana-rpc-proxy]');
check('timeout budget under CF 30s', UPSTREAM_TIMEOUT_MS > 0 && UPSTREAM_TIMEOUT_MS < 30000);
check('TimeoutError is a timeout', isUpstreamTimeout({name: 'TimeoutError'}));
check('AbortError is a timeout', isUpstreamTimeout({name: 'AbortError'}));
check('generic Error is not a timeout', !isUpstreamTimeout(new Error('ECONNRESET')));
check('getHealth allowed', isMethodAllowed('getHealth'));
check('requestAirdrop denied', !isMethodAllowed('requestAirdrop'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
