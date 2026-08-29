import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { approveDraft, publishIfApproved, runDaily } from './orchestrator.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'growtoo-community-'));

before(() => {
  process.env.COMMUNITY_AGENT_DATA = path.join(tmp, 'data');
  process.env.COMMUNITY_AGENT_QUEUE = path.join(tmp, 'queue');
  process.env.COMMUNITY_AGENT_WEEKLY = path.join(tmp, 'weekly');
  process.env.COMMUNITY_AGENT_LOG = path.join(tmp, 'log.md');
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test('daily run creates one pending multi-platform draft', async () => {
  const result = await runDaily({
    skipDiscover: true,
    conversations: [
      {
        platform: 'reddit',
        url: 'https://www.reddit.com/r/microgrowery/comments/example/how_do_you_keep_a_grow_journal/',
        title: 'How do you keep a grow journal without losing notes?',
        excerpt: 'Looking for a simple journal and reminders so I stay consistent.',
      },
    ],
  });

  assert.equal(result.draft.approvalStatus, 'pending');
  assert.ok(result.draft.xVersion && result.draft.xVersion.length <= 280);
  assert.ok(result.draft.instagramVersion);
  assert.ok(result.draft.facebookVersion);
  assert.ok(result.draft.masterIdea.includes('growtoo') || result.draft.masterIdea.includes('journal'));
  assert.match(result.card.source, /reddit.com/);
});

test('publish refuses a pending draft', async () => {
  const result = await runDaily({ skipDiscover: true });
  assert.throws(() => publishIfApproved(result.draft.id), /Publish only after approval/);
  const approved = approveDraft(result.draft.id);
  assert.equal(approved.approvalStatus, 'approved');
  const published = publishIfApproved(result.draft.id);
  assert.equal(published.id, result.draft.id);
});
