import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadMemory } from '../agent/memory.ts';
import { isoWeek } from '../db/client.ts';
import { weeklyDir } from '../paths.ts';

export function runWeeklyReport(week = isoWeek()): string {
  const memory = loadMemory();
  const drafts = memory.recentDrafts;
  const conversations = memory.recentConversations;
  const approved = drafts.filter((draft) => draft.approvalStatus === 'approved');
  const pending = drafts.filter((draft) => draft.approvalStatus === 'pending');
  const topics = count(drafts.map((draft) => draft.topic));
  const skippedReasons = conversations
    .filter((item) => !item.scores.shouldReply)
    .flatMap((item) => item.scores.reasons)
    .slice(0, 8);

  const nextThemes = Object.entries(topics)
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic)
    .concat(memory.learnings.map((item) => item.topic))
    .filter((topic, index, all) => all.indexOf(topic) === index)
    .slice(0, 3);

  const report = [
    `# Week ${week}`,
    '',
    '## What we did',
    '',
    `- Conversations reviewed: ${conversations.length}`,
    `- Drafts queued: ${drafts.length} (${pending.length} pending, ${approved.length} approved)`,
    `- Invites used: ${drafts.filter((draft) => draft.callToAction).length}`,
    '',
    '## What created useful discussion',
    '',
    ...Object.entries(topics).map(([topic, n]) => `- ${topic}: ${n} draft(s)`),
    '',
    '## What to stop or tighten',
    '',
    skippedReasons.length ? skippedReasons.map((reason) => `- ${reason}`).join('\n') : '- Not enough scored threads yet.',
    '',
    '## Recurring people',
    '',
    memory.people.length
      ? memory.people.map((person) => `- ${person.handle} (${person.platform}) — ${person.topics.join(', ')}`).join('\n')
      : '- None stored yet.',
    '',
    '## Metrics (human-reported)',
    '',
    '- Replies / meaningful convos / profile visits / product visits / signups: ask the human. Do not invent.',
    '',
    '## Suggested themes next week',
    '',
    ...(nextThemes.length ? nextThemes.map((theme, index) => `${index + 1}. ${theme}`) : ['1. documentation', '2. coach', '3. proof']),
    '',
    '## Open questions / claims still pending',
    '',
    '- Any new product claim still needs a source and date in product-facts.md.',
    '',
  ].join('\n');

  mkdirSync(weeklyDir(), { recursive: true });
  const file = path.join(weeklyDir(), `${week}.md`);
  writeFileSync(file, report, 'utf8');
  return file;
}

function count(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
