import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSafety, hasBlockingSafetyIssue } from './safety.ts';

test('blocks first-person grow stories', () => {
  const findings = checkSafety({ masterIdea: 'I just checked my plants and the tent looks great.' });
  assert.ok(findings.some((item) => item.flag === 'personal-grow'));
  assert.equal(hasBlockingSafetyIssue({ masterIdea: 'I just checked my plants and the tent looks great.' }), true);
});

test('blocks legal-everywhere and token-lead claims', () => {
  const legal = checkSafety({ masterIdea: 'Cannabis is legal everywhere now.' });
  const token = checkSafety({ masterIdea: 'Buy $GROWTOO before it moons.' });
  assert.ok(legal.some((item) => item.flag === 'legal-everywhere'));
  assert.ok(token.some((item) => item.flag === 'financial' || item.flag === 'token-lead'));
});

test('allows honest Devnet wording', () => {
  const findings = checkSafety({
    masterIdea: 'It’s early. We’re on Solana Devnet, testing with a small group of growers.',
  });
  assert.equal(findings.some((item) => item.severity === 'block'), false);
});
