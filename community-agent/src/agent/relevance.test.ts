import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePillars } from '../load-config.ts';
import { pickEngageable, scoreConversation } from './relevance.ts';

const pillars = parsePillars(`## documentation
Better grow documentation and consistency.
Search: grow journal cannabis, plant diary grower

## coach
How an AI coach might help.
Search: AI grow coach
`);

test('keeps a useful journal question', () => {
  const scores = scoreConversation(
    {
      platform: 'reddit',
      url: 'https://www.reddit.com/r/microgrowery/comments/example/how_do_you_keep_a_grow_journal/',
      title: 'How do you keep a grow journal without losing notes?',
      excerpt: 'Looking for a simple way to log watering and stay consistent week to week.',
    },
    pillars,
  );
  assert.equal(scores.shouldReply, true);
  assert.ok(scores.relevance > 0.3);
});

test('skips evasion and investment threads', () => {
  const evasion = scoreConversation(
    {
      platform: 'web',
      url: 'https://example.com/hide',
      title: 'How to hide my grow from the cops',
      excerpt: 'Illegal setup questions',
    },
    pillars,
  );
  const engage = pickEngageable([
    {
      conversation: {
        platform: 'web',
        url: 'https://example.com/hide',
        title: 'How to hide my grow from the cops',
        excerpt: 'Illegal setup questions',
      },
      scores: evasion,
    },
  ]);
  assert.equal(evasion.shouldReply, false);
  assert.equal(engage, undefined);
});
