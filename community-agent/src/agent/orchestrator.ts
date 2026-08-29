import { newId } from '../db/client.ts';
import type { ConversationRecord, DraftRecord } from '../db/schema.ts';
import { loadConfig } from '../load-config.ts';
import { validateFacebook } from '../platforms/facebook.ts';
import { validateInstagram } from '../platforms/instagram.ts';
import type { PublicConversation } from '../platforms/types.ts';
import { validateX } from '../platforms/x.ts';
import { checkClaims, factsForTopic } from '../content/claims.ts';
import { adaptForPlatforms } from '../content/repurposer.ts';
import { chooseStrategy } from '../content/strategist.ts';
import { writeMasterIdea } from '../content/writer.ts';
import type { ReviewCard } from '../types.ts';
import { logPublish, pendingCards, publishApproved, queueForReview } from './approval.ts';
import { discoverConversations } from './discovery.ts';
import { getDraft, loadMemory, rememberConversation, rememberDraft, rememberLearning } from './memory.ts';
import { publishToFacebook } from '../platforms/facebook.ts';
import { pickEngageable, scoreConversation } from './relevance.ts';
import { safetyFlags } from './safety.ts';

export interface DailyRunInput {
  urls?: string[];
  conversations?: PublicConversation[];
  enableReddit?: boolean;
  skipDiscover?: boolean;
}

export interface DailyRunResult {
  reviewed: number;
  selected: number;
  skipped: number;
  card: ReviewCard;
  draft: DraftRecord;
}

export async function runDaily(input: DailyRunInput = {}): Promise<DailyRunResult> {
  const config = loadConfig();
  const memory = loadMemory();

  const discovered = input.skipDiscover
    ? (input.conversations ?? [])
    : await discoverConversations({
        urls: input.urls,
        conversations: input.conversations,
        pillars: config.pillars,
        enableReddit: input.enableReddit,
      });

  const scored = discovered.map((conversation) => ({
    conversation,
    scores: scoreConversation(conversation, config.pillars),
  }));

  const stored = scored.map((item) => {
    const record: ConversationRecord = {
      id: newId('convo'),
      platform: item.conversation.platform,
      url: item.conversation.url,
      author: item.conversation.author,
      title: item.conversation.title,
      excerpt: item.conversation.excerpt,
      discoveredAt: new Date().toISOString(),
      scores: item.scores,
    };
    rememberConversation(record);
    return record;
  });

  const chosen = pickEngageable(scored);
  const chosenId = chosen
    ? stored.find((record) => record.url === chosen.conversation.url)?.id
    : undefined;
  const strategy = chooseStrategy(config.pillars, memory, chosen?.conversation ?? null);
  const factualClaims = factsForTopic(config.facts, strategy.topic);
  const masterIdea = writeMasterIdea(strategy, config.facts, config.phrases);
  const versions = adaptForPlatforms(masterIdea, strategy.callToAction);

  const draft: DraftRecord = {
    id: newId('draft'),
    createdAt: new Date().toISOString(),
    conversationId: chosenId,
    pillar: strategy.pillar.id,
    reasoning: [
      strategy.angle,
      chosen
        ? `Scored relevance ${chosen.scores.relevance}, usefulness ${chosen.scores.usefulness}, risk ${chosen.scores.risk}.`
        : 'No conversation cleared the reply bar. Used the next unused content pillar.',
      `Invite: ${strategy.invite}.`,
    ].join(' '),
    topic: strategy.topic,
    audience: strategy.audience,
    sourceUrls: chosen ? [chosen.conversation.url] : [],
    factualClaims,
    masterIdea,
    ...versions,
    callToAction: strategy.callToAction,
    riskFlags: [],
    approvalStatus: 'pending',
  };

  draft.riskFlags = [
    ...safetyFlags(draft),
    ...checkClaims(draft, config.facts, config.phrases),
    ...validateX(draft.xVersion ?? ''),
    ...validateInstagram(draft.instagramVersion ?? ''),
    ...validateFacebook(draft.facebookVersion ?? ''),
  ];

  rememberDraft(draft);
  const card = queueForReview(draft);

  return {
    reviewed: scored.length,
    selected: chosen ? 1 : 0,
    skipped: scored.filter((item) => !item.scores.shouldReply).length,
    card,
    draft,
  };
}

export function reviewPending(): ReviewCard[] {
  return pendingCards();
}

export function publishIfApproved(id: string): DraftRecord {
  const published = publishApproved(id);
  rememberLearning({
    topic: published.topic,
    whatWorked: `Approved and exported for hand-publish. Sources: ${published.sourceUrls.join(', ') || 'pillar'}`,
  });
  return published;
}

export async function publishApprovedToFacebook(id: string, scheduledAt?: Date) {
  const draft = getDraft(id);
  if (!draft) throw new Error(`Unknown draft ${id}`);
  if (draft.approvalStatus !== 'approved') throw new Error('Publish only after approval');
  const result = await publishToFacebook({
    message: draft.facebookVersion ?? draft.masterIdea,
    scheduledAt,
  });
  rememberLearning({
    topic: draft.topic,
    whatWorked: `Facebook ${result.scheduled ? 'scheduled' : 'published'} ${result.url}`,
  });
  logPublish(`Facebook ${result.scheduled ? 'scheduled' : 'published'}: ${id} · ${result.url}`);
  return { draft, result };
}

export { approveDraft, rejectDraft } from './approval.ts';
