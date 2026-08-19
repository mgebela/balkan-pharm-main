/* Tests for scrubPublicListing. Run: npm test */
'use strict';

const {scrubPublicListing} = require('./market-public-tape');

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

const SELLER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const MINT = 'So11111111111111111111111111111111111111112';
const LISTING_PDA = '11111111111111111111111111111111';
const ESCROW = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const privateFull = {
  uid: 'firebaseUidSeller',
  buyerUid: 'firebaseUidBuyer',
  photo: 'data:image/jpeg;base64,AAAA',
  journalSnippets: [{text: 'private note'}],
  paymentSignature: '5sig...',
  buySignature: '5buy...',
  escrowSignature: '5esc...',
  name: 'Kush #3',
  status: 'active',
  priceGrow: 40.7,
  createdAt: '2026-08-19T12:00:00.000Z',
  strain: 'Kush',
  batch: 'B1',
  stage: 'cvjetanje',
  assetType: 'flower',
  offerType: 'instant',
  settlement: 'program',
  mintAddress: MINT,
  sellerPubkey: SELLER,
  listingPda: LISTING_PDA,
  careEscrowAddress: ESCROW,
  lockedGrow: 20,
  immediateGrow: 20,
  totalGrow: 40,
  stakeLockedBps: 5000,
  email: 'grower@example.com',
};

console.log('\n[scrubPublicListing copies on-chain public fields]');
const out = scrubPublicListing(privateFull);
check('returns an object', !!out && typeof out === 'object');
check('keeps name', out && out.name === 'Kush #3');
check('rounds priceGrow', out && out.priceGrow === 41);
check('copies sellerPubkey', out && out.sellerPubkey === SELLER);
check('copies mintAddress', out && out.mintAddress === MINT);
check('copies listingPda', out && out.listingPda === LISTING_PDA);
check('copies careEscrowAddress', out && out.careEscrowAddress === ESCROW);
check('copies stake numbers', out && out.lockedGrow === 20 && out.stakeLockedBps === 5000);

console.log('\n[scrubPublicListing never emits private fields]');
const forbidden = [
  'uid',
  'buyerUid',
  'photo',
  'journalSnippets',
  'paymentSignature',
  'buySignature',
  'escrowSignature',
  'email',
];
const leaked = out ? forbidden.filter((k) => Object.prototype.hasOwnProperty.call(out, k)) : forbidden;
check('no uid / buyer / photo / journal / sigs / email', leaked.length === 0, leaked);

console.log('\n[scrubPublicListing rejects unsellable rows]');
check('null input → null', scrubPublicListing(null) === null);
check('cancelled → null', scrubPublicListing(Object.assign({}, privateFull, {status: 'cancelled'})) === null);
check('no name → null', scrubPublicListing(Object.assign({}, privateFull, {name: '  '})) === null);
check('bad price → null', scrubPublicListing(Object.assign({}, privateFull, {priceGrow: 0})) === null);

console.log('\n[scrubPublicListing omits short / missing pubkeys]');
const noPk = scrubPublicListing(Object.assign({}, privateFull, {sellerPubkey: 'short'}));
check('drops invalid sellerPubkey', noPk && !Object.prototype.hasOwnProperty.call(noPk, 'sellerPubkey'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
