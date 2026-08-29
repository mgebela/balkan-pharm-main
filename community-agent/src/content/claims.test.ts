import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProductFacts } from '../load-config.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClaims } from './claims.ts';

const factsFile = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../config/product-facts.md'),
  'utf8',
);
const { facts, phrases } = parseProductFacts(factsFile);

test('flags invented traction', () => {
  const flags = checkClaims(
    { masterIdea: '10,000 growers already use growtoo.', factualClaims: [] },
    facts,
    phrases,
  );
  assert.ok(flags.includes('unapproved-count'));
});

test('allows approved no-value wording', () => {
  const flags = checkClaims(
    {
      masterIdea: 'The journal works without a wallet. Devnet tokens have no monetary value.',
      factualClaims: ['The journal, coach, and reminders work with no wallet.'],
    },
    facts,
    phrases,
  );
  assert.equal(flags.includes('token-value'), false);
  assert.equal(flags.some((flag) => flag.startsWith('unapproved-claim:')), false);
});
